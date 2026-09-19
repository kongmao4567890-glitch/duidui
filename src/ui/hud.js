/**
 * 游戏内 HUD
 * ------------------------------------------------------------------
 * 负责把游戏状态同步到顶栏、分数面板、任务条、道具栏、聊天框。
 * 只在数值真的变化时才碰 DOM。
 */

import { $, el, clear, setText } from './dom.js';
import { formatScore } from '../core/util.js';
import { ITEM_META } from '../core/config.js';

export class Hud {
  constructor(game) {
    this.game = game;
    this.node = {
      stageNum: $('stageNum'),
      missions: $('missions'),
      targetScore: $('targetScore'),
      myScore: $('myScore'),
      progressFill: $('progressFill'),
      progress: $('progressFill')?.parentElement,
      progressText: $('progressText'),
      progressStar2: $('progressStar2'),
      progressStar3: $('progressStar3'),
      mascotFace: $('mascotFace'),
      mascotName: $('mascotName'),
      mascotTitle: $('mascotTitle'),
      statRemain: $('statRemain'),
      statCleared: $('statCleared'),
      statMaxGroup: $('statMaxGroup'),
      chatLog: $('chatLog'),
      chatStripFace: $('chatStripFace'),
      chatStripText: $('chatStripText'),
      puppyBubble: $('puppyBubble'),
      banner: $('boardBanner'),
      toast: $('toast')
    };
    this.itemNodes = {
      hammer: { btn: $('itemHammer'), count: $('countHammer') },
      transform: { btn: $('itemTransform'), count: $('countTransform') },
      hint: { btn: $('itemHint'), count: $('countHint') }
    };
    this._lastScore = -1;
    this._missionNodes = [];
    this._toastTimer = null;
    this._bannerTimer = null;
    this._puppyTimer = null;
  }

  /** 关卡开始时重建整套 HUD */
  onStageStart() {
    const g = this.game;
    const s = g.stage;

    setText(this.node.stageNum, String(s.n).padStart(2, '0'));
    setText(this.node.targetScore, formatScore(s.target));
    setText(this.node.mascotFace, s.mascot.face);
    setText(this.node.mascotName, s.mascot.name);
    setText(this.node.mascotTitle, s.mascot.title);
    setText(this.node.chatStripFace, s.mascot.face);

    // 主题色
    const root = document.documentElement.style;
    root.setProperty('--sky-1', s.chapter.sky[0]);
    root.setProperty('--sky-2', s.chapter.sky[1]);
    root.setProperty('--accent', s.chapter.accent);
    root.setProperty('--lamp', s.chapter.lamp);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', s.chapter.sky[0]);

    // 三星刻度
    if (this.node.progressStar2 && s.stars[1]) {
      this.node.progressStar2.style.left = `${Math.min(99, (s.stars[1] / s.stars[2]) * 100)}%`;
      this.node.progressStar2.hidden = false;
    }
    if (this.node.progressStar3) this.node.progressStar3.style.left = '99%';

    this._buildMissions();
    clear(this.node.chatLog);
    this._chatCount = 0;
    this._lastScore = -1;
    this.updateItems();
  }

  _buildMissions() {
    const box = this.node.missions;
    if (!box) return;
    clear(box);
    this._missionNodes = [];

    const list = this.game.missionState;
    if (!list.length) {
      const hint = el('div', 'mission');
      hint.appendChild(el('div', 'mission-head', '本关目标'));
      hint.appendChild(el('div', 'mission-text', this.game.stage.brief));
      box.appendChild(hint);
      return;
    }

    list.forEach((m, i) => {
      const node = el('div', 'mission');
      const head = el('div', 'mission-head');
      head.appendChild(el('span', null, `任务 ${i + 1}`));
      const prog = el('span', 'mission-prog', '');
      head.appendChild(prog);
      const text = el('div', 'mission-text', m.text);
      const bar = el('div', 'mission-bar');
      const fill = el('i');
      bar.appendChild(fill);
      node.append(head, text, bar);
      box.appendChild(node);
      this._missionNodes.push({ node, prog, fill, mission: m });
    });
  }

  /** 每帧刷新 */
  update() {
    const g = this.game;
    if (!g.board) return;

    const shown = Math.round(g.displayScore);
    if (shown !== this._lastScore) {
      setText(this.node.myScore, formatScore(shown));
      this._lastScore = shown;
      if (this.node.myScore) {
        this.node.myScore.classList.remove('bump');
        // 强制重排以便动画能重放
        void this.node.myScore.offsetWidth;
        this.node.myScore.classList.add('bump');
      }
    }

    const ratio = g.stage.target ? Math.min(1, g.score / g.stage.target) : 0;
    if (this.node.progressFill) this.node.progressFill.style.width = `${ratio * 100}%`;
    if (this.node.progress) this.node.progress.classList.toggle('full', ratio >= 1);
    const left = g.stage.target - g.score;
    setText(this.node.progressText, left > 0 ? `还差 ${formatScore(left)} 分` : '已达标 ✓');

    setText(this.node.statRemain, g.board.remaining);
    setText(this.node.statCleared, g.stats.blocksCleared);
    setText(this.node.statMaxGroup, g.stats.maxGroup);

    this._updateMissions();
  }

  _updateMissions() {
    for (const m of this._missionNodes) {
      const done = m.mission.done;
      m.node.classList.toggle('done', done);
      const text = this.game.missionText(m.mission);
      setText(m.prog, done ? '已完成' : text);
      // 进度条
      let ratio = done ? 1 : 0;
      if (!done) {
        const parts = /^(\d+)\s*\/\s*≤?(\d+)$/.exec(text);
        if (parts) ratio = Math.min(1, Number(parts[1]) / Number(parts[2]));
      }
      m.fill.style.width = `${ratio * 100}%`;
    }
  }

  /** 道具数量与激活态 */
  updateItems() {
    const g = this.game;
    for (const key of Object.keys(this.itemNodes)) {
      const { btn, count } = this.itemNodes[key];
      if (!btn) continue;
      const n = g.items[key] || 0;
      setText(count, n);
      btn.classList.toggle('empty', n <= 0);
      btn.classList.toggle('armed', g.armedItem === key);
      btn.setAttribute('aria-label', `${ITEM_META[key].name}，剩余 ${n} 个：${ITEM_META[key].desc}`);
    }
  }

  // ==================== 聊天 ====================

  addChat(who, text, face) {
    const log = this.node.chatLog;
    if (log) {
      const line = el('div', 'chat-line');
      const w = el('span', who === '系统' ? 'chat-who sys' : 'chat-who', `${face || ''}${who}：`);
      const b = el('span', 'chat-body', text);
      line.append(w, b);
      log.appendChild(line);
      while (log.children.length > 60) log.removeChild(log.firstChild);
      log.scrollTop = log.scrollHeight;
    }

    if (who === '旺财') {
      this._showPuppyBubble(text);
    } else {
      setText(this.node.chatStripFace, face || '💬');
      setText(this.node.chatStripText, text);
      if (this.node.chatStripText) {
        this.node.chatStripText.style.animation = 'none';
        void this.node.chatStripText.offsetWidth;
        this.node.chatStripText.style.animation = '';
      }
    }
  }

  _showPuppyBubble(text) {
    const b = this.node.puppyBubble;
    if (!b) return;
    b.textContent = text;
    b.hidden = false;
    clearTimeout(this._puppyTimer);
    this._puppyTimer = setTimeout(() => { b.hidden = true; }, 2200);
  }

  // ==================== 提示 ====================

  /** 屏幕中央的大字横幅 */
  banner(text, ms = 1100) {
    const b = this.node.banner;
    if (!b) return;
    b.textContent = text;
    b.hidden = false;
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => { b.hidden = true; }, ms);
  }

  /** 底部小提示条 */
  toast(text, ms = 1700) {
    const t = this.node.toast;
    if (!t) return;
    t.textContent = text;
    t.hidden = false;
    t.style.animation = 'none';
    void t.offsetWidth;
    t.style.animation = '';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }
}
