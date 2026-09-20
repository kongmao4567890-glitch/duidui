/**
 * 游戏进程控制器
 * ------------------------------------------------------------------
 * 管理一局游戏的：关卡、计分、任务目标、道具、胜负判定与结算。
 *
 * 胜负规则（联众原版）：
 *   · 达到本关目标分数 → 通关
 *   · 棋盘上再无 ≥2 的同色相连组合 → 本局结束，按当时分数判定成败
 *   · 结束时剩余方块越少，奖励分越高；全部清空有额外大奖
 */

import { Board, BOARD_STATE } from './board.js';
import { Rng } from './rng.js';
import { EventBus, clamp } from './util.js';
import { makeStage, missionDone, missionProgressText } from './stage.js';
import { Companion } from './companion.js';
import {
  SCORE, ITEMS, BLOCK_KIND, GEM_COLORS,
  TRANSFORM_SHAPE, COLLAPSE
} from './config.js';

export const MODE = {
  CAMPAIGN: 'campaign',   // 闯关：有目标分与任务
  FREE: 'free',           // 自由：没有目标，尽量把棋盘点干净
  CHALLENGE: 'challenge'  // 连关挑战：一条命连闯，失败即结束
};

export const PHASE = {
  READY: 'ready',
  PLAYING: 'playing',
  PAUSED: 'paused',
  WIN: 'win',
  LOSE: 'lose'
};

export class Game {
  constructor({ settings, bus }) {
    this.bus = bus || new EventBus();
    this.settings = settings;
    this.rng = new Rng(Date.now());

    this.mode = MODE.CAMPAIGN;
    this.phase = PHASE.READY;
    this.stage = makeStage(1, settings.board);
    this.scoreFactor = this.stage.scoreFactor;

    this.score = 0;
    this.displayScore = 0;
    this.elapsed = 0;
    this.totalScore = 0;      // 连关挑战的累计分

    this.items = { ...ITEMS };
    this.armedItem = null;    // 已激活、等待点击棋盘的道具

    this.board = null;
    this.companion = null;
    this.floatTexts = [];

    this.stats = this._blankStats();
    this.missionState = [];

    this._bind();
  }

  _blankStats() {
    return {
      groupCount: 0,        // 消除的组数
      blocksCleared: 0,     // 消除的方块总数
      maxGroup: 0,          // 单次最多消除
      magicCleared: 0,      // 消除的魔术方块数
      itemsUsed: 0,
      colorCleared: new Array(GEM_COLORS.length).fill(0),
      remaining: 0,
      bestScoreOnce: 0
    };
  }

  // ==================== 生命周期 ====================

  /**
   * 开始一局。
   * @param {string} mode MODE 之一
   * @param {number} stageNo 关卡号
   */
  start(mode, stageNo = 1) {
    this.mode = mode;
    this.stage = makeStage(Math.max(1, stageNo), this.settings.board);
    this.phase = PHASE.READY;

    this.rng.reset((Date.now() ^ (stageNo * 2654435761)) >>> 0);
    this.scoreFactor = this.stage.scoreFactor;

    this.board = new Board({
      cols: this.stage.cols,
      rows: this.stage.rows,
      colors: mode === MODE.FREE ? Math.min(6, this.stage.colors) : this.stage.colors,
      rng: this.rng,
      bus: this.bus,
      // 原版是「上方落下 + 空列左移」；设置里可以切成向中间靠拢的变体
      collapse: COLLAPSE[(this.settings.collapse || 'gravity').toUpperCase()] || COLLAPSE.GRAVITY,
      magicRate: mode === MODE.FREE ? 0.03 : this.stage.magicRate,
      stoneRate: mode === MODE.FREE ? 0 : this.stage.stoneRate
    });
    this.board.generate();
    this.board.enabled = false;

    this.score = 0;
    this.displayScore = 0;
    this.elapsed = 0;
    this.armedItem = null;
    this.floatTexts.length = 0;
    this.stats = this._blankStats();
    this.stats.remaining = this.board.remaining;

    this.missionState = (this.stage.missions || []).map((m) => ({ ...m, done: false }));

    this.companion = new Companion({ mascot: this.stage.mascot, rng: this.rng, bus: this.bus });

    // 先发 game:start 让 UI 重建（其中会清空聊天记录），
    // 再让看板娘开口，否则开场那两句会被立刻清掉。
    this.bus.emit('game:start', { mode, stage: this.stage });
    this.companion.onStageStart(this.stage);
    return this;
  }

  /** 新的一次挑战（重置道具与累计分） */
  startCampaign(stageNo = 1) {
    this.items = { ...ITEMS };
    this.totalScore = 0;
    return this.start(MODE.CAMPAIGN, stageNo);
  }

  beginPlay() {
    if (this.phase !== PHASE.READY) return;
    this.phase = PHASE.PLAYING;
    this.board.enabled = true;
    this.bus.emit('game:play', {});
  }

  pause() {
    if (this.phase !== PHASE.PLAYING) return;
    this.phase = PHASE.PAUSED;
    this.board.enabled = false;
    this.bus.emit('game:pause', {});
  }

  resume() {
    if (this.phase !== PHASE.PAUSED) return;
    this.phase = PHASE.PLAYING;
    this.board.enabled = true;
    this.bus.emit('game:resume', {});
  }

  next() {
    this.totalScore += this.score;
    return this.start(this.mode, this.stage.n + 1);
  }

  retry() {
    return this.start(this.mode, this.stage.n);
  }

  // ==================== 事件绑定 ====================

  _bind() {
    this.bus.on('board:remove', (info) => this._onRemove(info));
    this.bus.on('board:noMoves', (info) => this._onNoMoves(info));
    this.bus.on('board:selectFail', (info) => {
      if (info.size === 1) this.pushFloat('孤立方块，点不掉', this.board.colOf(info.index), this.board.rowOf(info.index), '#ff8787', 0.85);
    });
  }

  _onRemove(info) {
    if (this.phase !== PHASE.PLAYING) return;

    const n = info.size;
    let gained = 0;

    if (info.reason === 'match') {
      gained = Board.groupScore(n, this.scoreFactor);
      if (n >= SCORE.bigGroup) gained += SCORE.bigGroupBonus * (n - SCORE.bigGroup + 1);
      gained += info.magicCount * SCORE.magicBonus;

      this.stats.groupCount++;
      this.stats.maxGroup = Math.max(this.stats.maxGroup, n);
      this.stats.bestScoreOnce = Math.max(this.stats.bestScoreOnce, gained);
    } else if (info.reason === 'hammer') {
      gained = 0;   // 榔头不得分
    }

    this.stats.blocksCleared += n;
    this.stats.magicCleared += info.magicCount;
    for (const r of info.removed) {
      if (r.kind === BLOCK_KIND.NORMAL && r.type >= 0) this.stats.colorCleared[r.type]++;
    }
    this.stats.remaining = this.board.remaining - n;

    if (gained > 0) this.addScore(gained);

    // 飘字
    const oc = this.board.colOf(info.origin);
    const or = this.board.rowOf(info.origin);
    if (info.reason === 'hammer') {
      this.pushFloat('砸掉了！', oc, or, '#ffd43b', 1.1);
    } else if (n >= 10) {
      this.pushFloat(`${n} 连消！+${gained}`, oc, or, '#ff6b81', 1.6);
    } else if (n >= 6) {
      this.pushFloat(`${n} 连消 +${gained}`, oc, or, '#ffd43b', 1.3);
    } else {
      this.pushFloat(`+${gained}`, oc, or, '#ffffff', 1);
    }

    if (this.companion) this.companion.onRemove(n, gained);
    this._checkMissions();
    this.bus.emit('game:score', { gained, total: this.score, size: n });

    // 达标即通关（仍可继续点完，由结算界面决定）
    if (this.mode !== MODE.FREE && this.score >= this.stage.target) {
      this.bus.emit('game:targetReached', { score: this.score, target: this.stage.target });
    }
  }

  _onNoMoves(info) {
    if (this.phase !== PHASE.PLAYING) return;
    this.stats.remaining = info.remaining;
    // 还有榔头 / 变换可以救场时，先提示玩家
    const canRescue = (this.items.hammer > 0 || this.items.transform > 0) && info.remaining > 0;
    if (canRescue) {
      this.bus.emit('game:rescue', { remaining: info.remaining, items: { ...this.items } });
      this.pushFloat('没有可消组合了！试试道具', this.board.cols / 2 - 1, this.board.rows / 2, '#ffd43b', 1.2);
      return;
    }
    this._finish();
  }

  // ==================== 计分 ====================

  addScore(v) {
    this.score = Math.max(0, this.score + v);
  }

  pushFloat(text, col, row, color = '#fff', scale = 1) {
    this.floatTexts.push({ text, col, row, color, scale, life: 0, dur: 1150 });
    if (this.floatTexts.length > 20) this.floatTexts.shift();
  }

  /** 检查任务达成情况（非结算期的任务） */
  _checkMissions() {
    for (const m of this.missionState) {
      if (m.done) continue;
      if (m.type === 'leftover' || m.type === 'noItem') continue;  // 结算时才判定
      if (missionDone(m, this.stats)) {
        m.done = true;
        this.addScore(SCORE.missionBonus);
        this.pushFloat(`任务达成 +${SCORE.missionBonus}`, this.board.cols / 2 - 1, 1, '#69db7c', 1.3);
        if (this.companion) this.companion.onMissionDone(m);
        this.bus.emit('game:mission', { mission: m });
      }
    }
  }

  /** 任务进度文本（供 UI 调用） */
  missionText(m) {
    return missionProgressText(m, this.stats);
  }

  // ==================== 道具 ====================

  /** 激活 / 取消激活一个道具（原版：先点道具图标，再点棋盘） */
  armItem(key) {
    if (this.phase !== PHASE.PLAYING) return false;
    if (key === 'hint') return this.useHint();
    if (!(key in this.items)) return false;
    if (this.items[key] <= 0) {
      this.bus.emit('game:itemEmpty', { key });
      return false;
    }
    this.armedItem = this.armedItem === key ? null : key;
    this.board.clearSelection();
    this.bus.emit('game:itemArmed', { key, armed: this.armedItem === key });
    return true;
  }

  useHint() {
    if (this.items.hint <= 0) { this.bus.emit('game:itemEmpty', { key: 'hint' }); return false; }
    if (this.board.state !== BOARD_STATE.IDLE) return false;
    const hint = this.board.requestHint();
    if (!hint) return false;
    this.items.hint--;
    this.stats.itemsUsed++;
    this.addScore(-SCORE.hintPenalty);
    this.bus.emit('game:itemUsed', { key: 'hint', left: this.items.hint });
    return true;
  }

  /** 把已激活的道具用在某一格 */
  applyItemAt(index) {
    if (!this.armedItem) return false;
    const key = this.armedItem;

    if (key === 'hammer') {
      if (!this.board.hammerAt(index)) return false;
      this.items.hammer--;
      this.stats.itemsUsed++;
      this.addScore(-SCORE.hammerPenalty);
    } else if (key === 'transform') {
      if (!this.board.transformAt(index, TRANSFORM_SHAPE)) return false;
      this.items.transform--;
      this.stats.itemsUsed++;
      this.addScore(-SCORE.transformPenalty);
    } else {
      return false;
    }

    this.armedItem = null;
    this.bus.emit('game:itemUsed', { key, left: this.items[key] });
    return true;
  }

  // ==================== 玩家点击入口 ====================

  /**
   * 处理一次棋盘点击。
   * 顺序：道具 → 魔术方块 → 选中/确认消除
   * @param {number} index 格子索引
   * @returns {string} 'item' | 'magic' | 'select' | 'remove' | 'none'
   */
  tapCell(index) {
    if (this.phase !== PHASE.PLAYING) return 'none';
    if (this.board.state !== BOARD_STATE.IDLE) return 'none';

    if (this.armedItem) {
      return this.applyItemAt(index) ? 'item' : 'none';
    }

    const block = this.board.grid[index];
    if (!block) return 'none';

    if (block.isMagic) {
      return this.board.cycleMagic(index) ? 'magic' : 'none';
    }
    if (block.isStone) {
      this.pushFloat('顽石，只能用榔头', this.board.colOf(index), this.board.rowOf(index), '#adb5bd', 0.85);
      return 'none';
    }

    // 二次确认模式：第一次点亮，第二次才消
    if (this.settings.confirmTap) {
      if (this.board.selectionHas(index)) {
        return this.board.removeAt(index) ? 'remove' : 'none';
      }
      return this.board.select(index) ? 'select' : 'none';
    }
    return this.board.removeAt(index) ? 'remove' : 'none';
  }

  // ==================== 结算 ====================

  /** 本局结束（无可消组合，或玩家主动收局） */
  _finish() {
    if (this.phase === PHASE.WIN || this.phase === PHASE.LOSE) return;

    const remaining = this.board.remaining;
    this.stats.remaining = remaining;

    // 剩余方块奖励
    let bonus = Math.max(0, SCORE.leftoverBase - remaining * SCORE.leftoverStep);
    if (remaining === 0) bonus += SCORE.clearAllBonus;
    if (bonus > 0) {
      this.addScore(bonus);
      this.pushFloat(`清场奖励 +${bonus}`, this.board.cols / 2 - 1, this.board.rows / 2, '#69db7c', 1.4);
    }

    // 结算期任务判定
    let missionBonus = 0;
    for (const m of this.missionState) {
      if (m.done) continue;
      if (missionDone(m, this.stats)) {
        m.done = true;
        missionBonus += SCORE.missionBonus;
        if (this.companion) this.companion.onMissionDone(m);
      }
    }
    if (missionBonus) this.addScore(missionBonus);

    const passed = this.mode === MODE.FREE || this.score >= this.stage.target;
    const stars = this.stage.stars.filter((s) => this.score >= s).length;

    this.board.enabled = false;
    this.phase = passed ? PHASE.WIN : PHASE.LOSE;
    if (this.companion) this.companion.onNoMoves(passed);

    const payload = {
      stage: this.stage,
      score: this.score,
      totalScore: this.totalScore + this.score,
      clearBonus: bonus,
      missionBonus,
      remaining,
      stars: passed ? Math.max(1, stars) : 0,
      missions: this.missionState,
      stats: { ...this.stats },
      perfect: remaining === 0
    };
    this.bus.emit(passed ? 'game:win' : 'game:lose', payload);
  }

  /** 玩家在「无路可走」提示后选择结束本局 */
  giveUpRescue() {
    this._finish();
  }

  // ==================== 帧更新 ====================

  update(dt) {
    if (!this.board) return;
    this.board.update(dt);

    if (this.phase === PHASE.READY && this.board.state === BOARD_STATE.IDLE) {
      this.beginPlay();
    }

    if (this.companion) this.companion.update(dt);

    if (this.phase === PHASE.PLAYING) this.elapsed += dt;

    // 分数滚动
    if (this.displayScore !== this.score) {
      const diff = this.score - this.displayScore;
      const step = Math.max(6, Math.abs(diff) * 0.2);
      this.displayScore += Math.sign(diff) * Math.min(Math.abs(diff), step);
      if (Math.abs(this.score - this.displayScore) < 1) this.displayScore = this.score;
    }

    for (let i = this.floatTexts.length - 1; i >= 0; i--) {
      const f = this.floatTexts[i];
      f.life += dt;
      if (f.life >= f.dur) this.floatTexts.splice(i, 1);
    }
  }

  // ==================== 查询 ====================

  get progress() {
    return this.stage.target ? clamp(this.score / this.stage.target, 0, 1) : 0;
  }

  /** 棋盘清空度（0~1） */
  get clearRatio() {
    if (!this.board || !this.board.initialCount) return 0;
    return 1 - this.board.remaining / this.board.initialCount;
  }

  /** 理论上棋盘剩余可拿的分（用于判断是否还救得回来） */
  get potentialScore() {
    if (!this.board) return 0;
    let sum = 0;
    for (const g of this.board.allGroups()) sum += Board.groupScore(g.length, this.scoreFactor);
    return sum;
  }
}
