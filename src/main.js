/**
 * 对对碰 · 入口
 * ------------------------------------------------------------------
 * 把引擎、渲染、音频、存档、UI 串起来：
 * 启动流程、输入处理、主循环、事件路由。
 */

import { Game, MODE, PHASE } from './core/game.js';
import { BOARD_STATE } from './core/board.js';
import { EventBus, Ticker } from './core/util.js';
import { Renderer } from './render/renderer.js';
import { audio } from './audio/audio.js';
import { storage } from './platform/storage.js';
import { Hud } from './ui/hud.js';
import { Screens } from './ui/screens.js';
import { $, vibrate } from './ui/dom.js';
import { ITEM_META } from './core/config.js';
import { clearSpriteCache } from './render/sprites.js';

class App {
  constructor() {
    this.bus = new EventBus();
    this.settings = storage.settings;
    this.game = new Game({ settings: this.settings, bus: this.bus });
    this.game.items = { ...storage.items };

    this.canvas = $('board');
    this.renderer = new Renderer(this.canvas, {
      showGrid: this.settings.showGrid,
      showCount: this.settings.showCount,
      colorMark: this.settings.colorMark
    });
    this.renderer.particles.enabled = this.settings.particles;

    this.hud = new Hud(this.game);
    this.screens = new Screens({
      game: this.game,
      storage,
      audio,
      hud: this.hud,
      on: (action, arg) => this.handle(action, arg)
    });

    this.ticker = new Ticker((dt) => this.frame(dt));
    this.needResize = true;
    this.pendingTap = null;
    this.resultShown = false;
  }

  // ==================== 启动 ====================

  async boot() {
    this.bindEvents();
    this.bindInput();
    this.applySettings();

    // 让载入页至少露个脸，避免闪一下就没了
    await new Promise((r) => setTimeout(r, 260));
    $('boot').classList.add('hide');
    setTimeout(() => { $('boot').hidden = true; }, 420);
    $('app').hidden = false;

    this.screens.showTitle();
    this.ticker.start();
    this.registerServiceWorker();
  }

  applySettings() {
    const s = this.settings;
    audio.setSound(s.sound);
    audio.setMusic(s.music);
    this.renderer.setOptions({
      showGrid: s.showGrid,
      showCount: s.showCount,
      colorMark: s.colorMark,
      particles: s.particles
    });
    this.needResize = true;
  }

  // ==================== 事件总线 ====================

  bindEvents() {
    const bus = this.bus;
    const g = this.game;

    bus.on('game:start', ({ stage }) => {
      this.resultShown = false;
      this.renderer.reset();
      this.renderer.setTheme(stage.chapter);
      this.hud.onStageStart();
      this.needResize = true;
      audio.startMusic(stage.chapter.id);
      this.screens.showIntro(stage);
    });

    bus.on('board:select', (sel) => {
      audio.select(sel.size);
      if (this.settings.vibrate) vibrate(8);
    });

    bus.on('board:selectFail', () => {
      audio.deny();
      if (this.settings.vibrate) vibrate([12, 40, 12]);
    });

    bus.on('board:remove', (info) => {
      this.renderer.onRemove(info, g.board);
      if (info.reason === 'hammer') audio.hammer();
      else audio.remove(info.size);
      if (this.settings.vibrate) vibrate(Math.min(60, 10 + info.size * 4));
      if (info.size >= 10) this.hud.banner(`${info.size} 连消！`, 900);
    });

    bus.on('board:magic', ({ index }) => {
      this.renderer.onMagic(index, g.board);
      audio.magic();
      if (this.settings.vibrate) vibrate(12);
    });

    bus.on('board:transform', ({ cells, color }) => {
      this.renderer.onTransform(cells, color, g.board);
      audio.transform();
    });

    bus.on('board:magicOnly', () => {
      this.hud.toast('没现成的组合了，试试点一下魔术方块换色', 2400);
    });

    bus.on('game:mission', ({ mission }) => {
      audio.mission();
      this.hud.banner('任务达成！', 1100);
      this.hud.toast(`任务达成：${mission.text}`, 2200);
    });

    bus.on('game:itemUsed', () => {
      this.hud.updateItems();
      storage.setItems(g.items);
    });

    bus.on('game:itemArmed', ({ key, armed }) => {
      this.hud.updateItems();
      if (armed) this.hud.toast(`${ITEM_META[key].icon} ${ITEM_META[key].desc}`, 2000);
    });

    bus.on('game:itemEmpty', ({ key }) => {
      audio.deny();
      this.hud.toast(`${ITEM_META[key].name}已经用完了`, 1600);
    });

    bus.on('game:rescue', (info) => {
      if (this.resultShown) return;
      this.screens.showRescue(info);
    });

    bus.on('game:win', (payload) => this.onFinish(payload, true));
    bus.on('game:lose', (payload) => this.onFinish(payload, false));

    bus.on('game:targetReached', () => {
      if (this._reachedShown) return;
      this._reachedShown = true;
      this.hud.banner('已达标！继续刷分吧', 1300);
    });

    bus.on('chat:say', ({ who, text, face }) => this.hud.addChat(who, text, face));
  }

  onFinish(payload, win) {
    if (this.resultShown) return;
    this.resultShown = true;
    audio[win ? 'win' : 'lose']();
    if (win) {
      storage.recordWin(payload.stage.n, payload.score, payload.stars, payload.stats);
    } else {
      storage.recordLose(payload.stage.n, payload.score, payload.stats);
    }
    storage.setItems(this.game.items);
    // 等结算动画跑完再弹窗，让玩家看清最后一次消除
    setTimeout(() => this.screens.showResult(payload, win), 850);
  }

  // ==================== 输入 ====================

  bindInput() {
    const canvas = this.canvas;

    // 首次交互解锁音频（手机浏览器的硬性要求）
    const unlock = () => {
      if (audio.unlock()) {
        audio.setSound(this.settings.sound);
        audio.setMusic(this.settings.music);
        if (this.game.stage) audio.startMusic(this.game.stage.chapter.id);
      }
      document.removeEventListener('pointerdown', unlock);
    };
    document.addEventListener('pointerdown', unlock, { once: true });

    // 棋盘点击：用 pointerup 而不是 pointerdown，
    // 这样手指按下后滑开可以取消，避免误触
    let downIdx = -1;
    let downPos = null;

    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const idx = this.pickCell(e);
      downIdx = idx;
      downPos = { x: e.clientX, y: e.clientY };
      // 按下即预览高亮，手感更跟手
      if (idx >= 0 && this.settings.confirmTap) this.previewCell(idx);
    });

    canvas.addEventListener('pointerup', (e) => {
      e.preventDefault();
      const idx = this.pickCell(e);
      const moved = downPos && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 24;
      if (idx >= 0 && idx === downIdx && !moved) this.tapCell(idx);
      downIdx = -1;
      downPos = null;
    });

    canvas.addEventListener('pointercancel', () => { downIdx = -1; downPos = null; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // 道具按钮
    for (const key of ['hammer', 'transform', 'hint']) {
      const btn = $(`item${key[0].toUpperCase()}${key.slice(1)}`);
      if (btn) {
        btn.addEventListener('click', () => {
          audio.click();
          this.game.armItem(key);
          this.hud.updateItems();
        });
      }
    }

    // 顶栏 / 标题页 / 弹层按钮
    const click = (id, fn) => {
      const n = $(id);
      if (n) n.addEventListener('click', () => { audio.click(); fn(); });
    };

    click('btnPause', () => this.pause());
    click('btnHelp', () => this.screens.showHelp());
    click('btnHelpClose', () => this.screens.close('help'));

    click('btnPlay', () => this.handle('startStage', storage.progress.maxStage));
    click('btnStageSelect', () => this.screens.showStageSelect());
    click('btnStagesBack', () => this.screens.close('stages'));
    click('btnFree', () => this.handle('startFree'));
    click('btnHowTo', () => this.screens.showHelp());
    click('btnSettings', () => this.screens.showSettings());
    click('btnSettingsClose', () => {
      this.screens.close('settings');
      if (this.game.phase === PHASE.PAUSED && !this.screens.isOpen('pause')) this.screens.showPause();
    });

    click('btnResume', () => this.resume());
    click('btnRestart', () => { this.screens.close('pause'); this.handle('retryStage'); });
    click('btnPauseSettings', () => { this.screens.close('pause'); this.screens.showSettings(); });
    click('btnQuit', () => { this.screens.close('pause'); this.handle('quit'); });

    this.bindSettingInputs();

    // 系统返回键 / 浏览器后退
    window.addEventListener('popstate', () => {
      if (this.screens.anyOpen && this.screens.top !== 'title') {
        this.screens.close(this.screens.top);
      } else if (this.game.phase === PHASE.PLAYING) {
        this.pause();
      }
      history.pushState(null, '', location.href);
    });
    history.pushState(null, '', location.href);

    // 键盘（桌面调试用）
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.screens.anyOpen) this.screens.close(this.screens.top);
        else if (this.game.phase === PHASE.PLAYING) this.pause();
      } else if (e.key === 'h' || e.key === 'H') {
        this.game.armItem('hint');
        this.hud.updateItems();
      }
    });

    // 窗口尺寸变化
    let resizeTimer = null;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { this.needResize = true; clearSpriteCache(); }, 80);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);

    // 切到后台自动暂停并静音
    document.addEventListener('visibilitychange', () => {
      const active = document.visibilityState === 'visible';
      audio.setPageActive(active);
      if (!active && this.game.phase === PHASE.PLAYING) this.pause();
    });
  }

  bindSettingInputs() {
    const bindSwitch = (id, key, after) => {
      const n = $(id);
      if (!n) return;
      n.addEventListener('change', () => {
        storage.updateSettings({ [key]: n.checked });
        this.settings = storage.settings;
        this.game.settings = this.settings;
        if (after) after(n.checked);
      });
    };

    bindSwitch('setConfirmTap', 'confirmTap');
    bindSwitch('setShowCount', 'showCount', (v) => this.renderer.setOptions({ showCount: v }));
    bindSwitch('setVibrate', 'vibrate');
    bindSwitch('setShowGrid', 'showGrid', (v) => this.renderer.setOptions({ showGrid: v }));
    bindSwitch('setParticles', 'particles', (v) => this.renderer.setOptions({ particles: v }));
    bindSwitch('setColorMark', 'colorMark', (v) => this.renderer.setOptions({ colorMark: v }));
    bindSwitch('setSound', 'sound', (v) => audio.setSound(v));
    bindSwitch('setMusic', 'music', (v) => {
      audio.setMusic(v);
      if (v && this.game.stage) audio.startMusic(this.game.stage.chapter.id);
    });

    const sel = $('setBoard');
    if (sel) {
      sel.addEventListener('change', () => {
        storage.updateSettings({ board: sel.value });
        this.settings = storage.settings;
        this.game.settings = this.settings;
        this.hud.toast('棋盘尺寸已切换，本关将重新开始', 2000);
        if (this.game.phase !== PHASE.READY) {
          this.screens.close('settings');
          this.screens.close('pause');
          this.handle('retryStage');
        }
      });
    }

    const click = (id, fn) => { const n = $(id); if (n) n.addEventListener('click', fn); };

    click('btnExport', async () => {
      const text = storage.export();
      try {
        await navigator.clipboard.writeText(text);
        this.hud.toast('存档已复制到剪贴板', 2200);
      } catch {
        // 剪贴板不可用时退回到手动复制
        window.prompt('复制下面这串文字保存好：', text);
      }
    });

    click('btnImport', () => {
      const text = window.prompt('把之前导出的存档粘贴到这里：');
      if (!text) return;
      if (storage.import(text)) {
        this.settings = storage.settings;
        this.game.settings = this.settings;
        this.game.items = { ...storage.items };
        this.applySettings();
        this.hud.updateItems();
        this.hud.toast('存档已导入', 1800);
        this.screens.showSettings();
      } else {
        this.hud.toast('存档格式不对，导入失败', 2200);
      }
    });

    click('btnResetSave', () => {
      if (!window.confirm('确定要清空全部进度吗？此操作无法撤销。')) return;
      storage.reset();
      this.settings = storage.settings;
      this.game.settings = this.settings;
      this.game.items = { ...storage.items };
      this.applySettings();
      this.hud.updateItems();
      this.screens.close('settings');
      this.handle('quit');
      this.hud.toast('进度已清空', 1800);
    });
  }

  /** 把指针事件换算成棋盘格索引 */
  pickCell(e) {
    const rect = this.canvas.getBoundingClientRect();
    return this.renderer.hitTest(e.clientX - rect.left, e.clientY - rect.top, this.game.board);
  }

  /** 按下时的预览高亮（不消除） */
  previewCell(idx) {
    const g = this.game;
    if (g.phase !== PHASE.PLAYING || g.armedItem) return;
    if (g.board.state !== BOARD_STATE.IDLE) return;
    const b = g.board.grid[idx];
    if (!b || !b.isNormal) return;
    if (!g.board.selectionHas(idx)) g.board.select(idx);
  }

  /** 真正的一次点击 */
  tapCell(idx) {
    const g = this.game;
    if (g.phase !== PHASE.PLAYING) return;
    const result = g.tapCell(idx);
    if (result === 'item') this.hud.updateItems();
  }

  // ==================== 流程控制 ====================

  handle(action, arg) {
    switch (action) {
      case 'startStage':
        this._reachedShown = false;
        this.screens.closeAll();
        this.game.items = { ...storage.items };
        this.game.start(MODE.CAMPAIGN, arg || 1);
        this.hud.updateItems();
        break;
      case 'startFree':
        this._reachedShown = false;
        this.screens.closeAll();
        this.game.items = { ...storage.items };
        this.game.start(MODE.FREE, storage.progress.maxStage);
        this.hud.updateItems();
        break;
      case 'nextStage':
        this._reachedShown = false;
        this.game.items = { ...storage.items };
        this.game.next();
        this.hud.updateItems();
        break;
      case 'retryStage':
        this._reachedShown = false;
        this.game.items = { ...storage.items };
        this.game.retry();
        this.hud.updateItems();
        break;
      case 'quit':
        audio.stopMusic();
        this.screens.showTitle();
        break;
      case 'armItem':
        this.game.armItem(arg);
        this.hud.updateItems();
        break;
      case 'giveUp':
        this.game.giveUpRescue();
        break;
      default:
        break;
    }
  }

  pause() {
    if (this.game.phase !== PHASE.PLAYING) return;
    this.game.pause();
    this.screens.showPause();
  }

  resume() {
    this.screens.close('pause');
    this.game.resume();
  }

  // ==================== 主循环 ====================

  frame(dt) {
    const g = this.game;

    if (this.needResize) {
      this.renderer.resize(g.board);
      this.needResize = false;
    }

    // 弹层挡住棋盘时不推进游戏逻辑（开场动画除外）
    const blocking = this.screens.isOpen('pause') || this.screens.isOpen('result')
      || this.screens.isOpen('settings') || this.screens.isOpen('help')
      || this.screens.isOpen('title') || this.screens.isOpen('stages');

    if (g.board) {
      if (!blocking) g.update(dt);
      this.renderer.draw(g, dt);
      if (!blocking) this.hud.update();
    }
  }

  // ==================== PWA ====================

  registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    // file:// 打开时没有 SW，直接跳过
    if (location.protocol === 'file:') return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => {
        console.info('离线缓存未启用：', err.message);
      });
    });
  }
}

const app = new App();
app.boot().catch((err) => {
  console.error('启动失败：', err);
  const boot = $('boot');
  if (boot) {
    boot.classList.remove('hide');
    boot.hidden = false;
    const tip = boot.querySelector('.boot-tip');
    if (tip) tip.textContent = '启动失败：' + err.message;
  }
});

// 方便在浏览器控制台里调试
window.__duidui = app;
