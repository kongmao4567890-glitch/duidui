/**
 * 对对碰核心棋盘引擎（联众原版规则）
 * ------------------------------------------------------------------
 * 规则要点：
 *   1. 棋盘为矩形网格，一次性铺满彩色方块，不会补充新方块。
 *   2. 点击上下左右相连、数量 ≥2 的同色方块，整组一起消除；
 *      斜向不算相连，孤立的单个方块无法消除。
 *   3. 消除后方块不会从上往下掉落；同一行中空位两侧的方块
 *      向中间靠拢来填补空位。
 *   4. 魔术方块点击时不消除，而是切换自身颜色。
 *   5. 当棋盘上再也找不到 ≥2 的同色相连组合时，本局结束。
 *
 * 棋盘用「时间驱动状态机」推进动画，渲染层只需读取
 * 每个方块的 ox/oy/scale/alpha 即可绘制。
 */

import { BLOCK_KIND, COLLAPSE, ANIM } from './config.js';
import { clamp, easeOutCubic, easeOutBack, easeInOutQuad } from './util.js';

/** 棋盘状态 */
export const BOARD_STATE = {
  IDLE: 'idle',            // 等待玩家点击
  SPAWNING: 'spawning',    // 开局铺盘动画
  REMOVING: 'removing',    // 消除动画中
  COLLAPSING: 'collapsing',// 靠拢填补动画中
  FLIPPING: 'flipping',    // 魔术方块变色中
  SETTLING: 'settling',    // 结算：判断是否还有可消组合
  LOCKED: 'locked'         // 外部锁定（暂停 / 关卡结算）
};

let blockIdSeq = 1;

/** 单个方块 */
export class Block {
  constructor(type, kind = BLOCK_KIND.NORMAL) {
    this.id = blockIdSeq++;
    this.type = type;          // 颜色索引；顽石为 -1
    this.kind = kind;          // BLOCK_KIND
    this.ox = 0;               // 渲染横向偏移（单位：格）
    this.oy = 0;               // 渲染纵向偏移（单位：格）
    this.scale = 1;
    this.alpha = 1;
    this.spin = 0;
    this.wobble = 0;           // 选中时的轻微抖动相位
    this.anim = null;
    this.removing = false;
  }

  get isMagic() { return this.kind === BLOCK_KIND.MAGIC; }
  get isStone() { return this.kind === BLOCK_KIND.STONE; }
  get isNormal() { return this.kind === BLOCK_KIND.NORMAL; }
  /**
   * 是否参与同色相连判定。
   * 魔术方块按它「当前的颜色」参与分组 —— 这正是它的用处：
   * 先把它切成需要的颜色，再点旁边的普通方块，就能把两片色块桥接起来。
   * 但它自己被点到时只换色、不消除，所以一组里必须有普通方块才点得掉。
   */
  get matchable() { return this.kind !== BLOCK_KIND.STONE; }
}

export class Board {
  /**
   * @param {object} opts
   * @param {number} opts.cols 列数
   * @param {number} opts.rows 行数
   * @param {number} opts.colors 颜色种类数
   * @param {import('./rng.js').Rng} opts.rng 随机源
   * @param {import('./util.js').EventBus} opts.bus 事件总线
   * @param {string} [opts.collapse] 填补方式，见 COLLAPSE
   * @param {number} [opts.magicRate] 魔术方块占比
   * @param {number} [opts.stoneRate] 顽石占比
   */
  constructor({ cols, rows, colors, rng, bus, collapse = COLLAPSE.CENTER, magicRate = 0, stoneRate = 0 }) {
    this.cols = cols;
    this.rows = rows;
    this.colors = colors;
    this.rng = rng;
    this.bus = bus;
    this.collapse = collapse;
    this.magicRate = magicRate;
    this.stoneRate = stoneRate;

    this.grid = new Array(cols * rows).fill(null);
    this.state = BOARD_STATE.IDLE;

    this.selection = null;      // {cells:number[], type:number, score:number}
    this.hint = null;           // 提示的一组方块
    this.idleTime = 0;
    this.animT = 0;
    this.animDur = 0;

    this.initialCount = 0;      // 开局方块总数
    this.lastRemoval = null;    // 最近一次消除的统计
    this.enabled = true;        // 是否接受输入
    this.movesUsed = 0;         // 有效消除次数
  }

  // ==================== 基础访问 ====================

  index(c, r) { return r * this.cols + c; }
  inside(c, r) { return c >= 0 && c < this.cols && r >= 0 && r < this.rows; }
  get(c, r) { return this.inside(c, r) ? this.grid[this.index(c, r)] : null; }
  set(c, r, b) { if (this.inside(c, r)) this.grid[this.index(c, r)] = b; }
  colOf(i) { return i % this.cols; }
  rowOf(i) { return Math.floor(i / this.cols); }

  get busy() { return this.state !== BOARD_STATE.IDLE; }

  /** 棋盘上剩余方块数 */
  get remaining() {
    let n = 0;
    for (const b of this.grid) if (b) n++;
    return n;
  }

  /** 剩余的非顽石方块数 */
  get remainingMatchable() {
    let n = 0;
    for (const b of this.grid) if (b && b.matchable) n++;
    return n;
  }

  // ==================== 初始化 ====================

  /** 铺满棋盘，并保证至少存在一组可消除的方块 */
  generate() {
    let guard = 0;
    do {
      for (let i = 0; i < this.grid.length; i++) {
        this.grid[i] = this._rollBlock();
      }
      guard++;
    } while (!this.hasMoves() && guard < 50);

    if (!this.hasMoves()) this._forcePair();

    this.initialCount = this.remaining;
    this.movesUsed = 0;

    // 开局铺盘动画：方块由小变大、错落登场
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const b = this.get(c, r);
        if (!b) continue;
        b.scale = 0;
        const delay = (r * this.cols + c) * 7 + this.rng.next() * 60;
        b.anim = { type: 'spawn', t: -delay, dur: 260 };
      }
    }
    this.state = BOARD_STATE.SPAWNING;
    this.animT = 0;
    this.animDur = ANIM.spawn + this.grid.length * 7;
    return this;
  }

  /** 随机生成一个方块（按配置概率出现魔术方块 / 顽石） */
  _rollBlock() {
    const roll = this.rng.next();
    if (roll < this.stoneRate) return new Block(-1, BLOCK_KIND.STONE);
    if (roll < this.stoneRate + this.magicRate) {
      return new Block(this.rng.int(this.colors), BLOCK_KIND.MAGIC);
    }
    return new Block(this.rng.int(this.colors), BLOCK_KIND.NORMAL);
  }

  /** 极端情况下强行制造一组可消方块 */
  _forcePair() {
    const c = this.rng.int(this.cols - 1);
    const r = this.rng.int(this.rows);
    const t = this.rng.int(this.colors);
    this.set(c, r, new Block(t));
    this.set(c + 1, r, new Block(t));
  }

  // ==================== 分组与判定 ====================

  /**
   * 以某格为起点做四方向洪水填充，取出同色相连的一整组。
   * 魔术方块与顽石不参与分组。
   * @returns {number[]} 该组所有格子的索引（含起点）
   */
  findGroup(start) {
    const origin = this.grid[start];
    if (!origin || !origin.matchable) return [];
    const type = origin.type;
    const seen = new Set([start]);
    const stack = [start];
    const out = [];

    while (stack.length) {
      const i = stack.pop();
      out.push(i);
      const c = this.colOf(i), r = this.rowOf(i);
      // 只走上下左右四个方向，斜向不算相连
      const neighbours = [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]];
      for (const [nc, nr] of neighbours) {
        if (!this.inside(nc, nr)) continue;
        const j = this.index(nc, nr);
        if (seen.has(j)) continue;
        const b = this.grid[j];
        if (!b || !b.matchable || b.type !== type) continue;
        seen.add(j);
        stack.push(j);
      }
    }
    return out;
  }

  /**
   * 一组方块是否「点得掉」：至少 2 个，且其中至少有一个普通方块
   * （点魔术方块只会换色，所以全是魔术方块的组无法消除）。
   */
  isRemovableGroup(group) {
    if (group.length < 2) return false;
    return group.some((i) => this.grid[i] && this.grid[i].isNormal);
  }

  /** 棋盘上是否还存在可消组合 */
  hasMoves() {
    const seen = new Uint8Array(this.grid.length);
    for (let i = 0; i < this.grid.length; i++) {
      if (seen[i]) continue;
      const b = this.grid[i];
      if (!b || !b.matchable) { seen[i] = 1; continue; }
      const group = this.findGroup(i);
      group.forEach((j) => { seen[j] = 1; });
      if (this.isRemovableGroup(group)) return true;
    }
    return false;
  }

  /**
   * 是否还有「能靠切换魔术方块颜色救出来」的走法。
   * 棋盘看似死局时用它判断要不要提示玩家去点魔术方块。
   */
  hasMagicRescue() {
    for (let i = 0; i < this.grid.length; i++) {
      const b = this.grid[i];
      if (!b || !b.isMagic) continue;
      const original = b.type;
      for (let t = 0; t < this.colors; t++) {
        if (t === original) continue;
        b.type = t;
        const group = this.findGroup(i);
        if (this.isRemovableGroup(group)) { b.type = original; return { index: i, color: t }; }
      }
      b.type = original;
    }
    return null;
  }

  /** 列出当前所有可消组合，按大小从大到小排序 */
  allGroups() {
    const seen = new Uint8Array(this.grid.length);
    const groups = [];
    for (let i = 0; i < this.grid.length; i++) {
      if (seen[i]) continue;
      const b = this.grid[i];
      if (!b || !b.matchable) { seen[i] = 1; continue; }
      const group = this.findGroup(i);
      group.forEach((j) => { seen[j] = 1; });
      if (this.isRemovableGroup(group)) groups.push(group);
    }
    groups.sort((a, b) => b.length - a.length);
    return groups;
  }

  /**
   * 单组得分公式：factor × (n − 1)²
   * 二次成长让「攒大块」的收益远高于「见到就点」，
   * 正好对应原版「一次消除数量越多、单组得分越高」的手感。
   *   n=2 → 1f    n=3 → 4f    n=5 → 16f
   *   n=8 → 49f   n=12 → 121f n=20 → 361f
   */
  static groupScore(n, factor = 25) {
    return factor * (n - 1) * (n - 1);
  }

  // ==================== 玩家操作 ====================

  /**
   * 点选一格：返回该格对应的可消组合（用于高亮预览）。
   * @returns {{cells:number[], type:number, size:number}|null}
   */
  select(i) {
    if (!this.enabled || this.state !== BOARD_STATE.IDLE) return null;
    const b = this.grid[i];
    if (!b) { this.selection = null; return null; }

    if (b.isStone) {
      this.selection = { cells: [i], type: -1, size: 1, special: b.kind };
      return this.selection;
    }
    if (b.isMagic) {
      // 高亮它当前所在的整组，让玩家看清切到哪个颜色能接上
      const g = this.findGroup(i);
      this.selection = { cells: g, type: b.type, size: g.length, special: b.kind };
      return this.selection;
    }

    const cells = this.findGroup(i);
    if (!this.isRemovableGroup(cells)) {
      this.selection = null;
      this.bus.emit('board:selectFail', { index: i, size: cells.length });
      return null;
    }
    this.selection = { cells, type: b.type, size: cells.length, special: BLOCK_KIND.NORMAL };
    this.bus.emit('board:select', this.selection);
    return this.selection;
  }

  clearSelection() { this.selection = null; }

  /** 当前选中的组是否包含该格 */
  selectionHas(i) {
    return !!(this.selection && this.selection.cells.includes(i));
  }

  /**
   * 消除以 i 为起点的一组方块。
   * @returns {{cells:number[], size:number, type:number}|null} 未能消除时返回 null
   */
  removeAt(i) {
    if (!this.enabled || this.state !== BOARD_STATE.IDLE) return null;
    const b = this.grid[i];
    // 必须从普通方块发起：点魔术方块是换色，点顽石没反应
    if (!b || !b.isNormal) return null;
    const cells = this.findGroup(i);
    if (!this.isRemovableGroup(cells)) {
      this.bus.emit('board:selectFail', { index: i, size: cells.length });
      return null;
    }
    return this._doRemove(cells, { reason: 'match', origin: i, type: b.type });
  }

  /** 榔头：敲掉任意单个方块（包括魔术方块与顽石） */
  hammerAt(i) {
    if (!this.enabled || this.state !== BOARD_STATE.IDLE) return null;
    if (!this.grid[i]) return null;
    return this._doRemove([i], { reason: 'hammer', origin: i, type: this.grid[i].type });
  }

  /**
   * 变换：把一片区域的方块染成同一种颜色，制造可消组合。
   * @param {number} i 中心格
   * @param {Array<[number,number]>} shape 相对坐标
   * @param {number|null} color 指定颜色，留空则自动挑一个最有利的颜色
   */
  transformAt(i, shape, color = null) {
    if (!this.enabled || this.state !== BOARD_STATE.IDLE) return null;
    const c0 = this.colOf(i), r0 = this.rowOf(i);
    const targets = [];
    for (const [dc, dr] of shape) {
      const c = c0 + dc, r = r0 + dr;
      if (!this.inside(c, r)) continue;
      const b = this.get(c, r);
      if (!b || b.isStone) continue;
      targets.push(this.index(c, r));
    }
    if (!targets.length) return null;

    // 自动选色：挑区域四周出现最多的颜色，最容易连成大组
    let picked = color;
    if (picked == null) {
      const counts = new Array(this.colors).fill(0);
      for (const t of targets) {
        const c = this.colOf(t), r = this.rowOf(t);
        for (const [nc, nr] of [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]]) {
          const nb = this.get(nc, nr);
          if (nb && nb.matchable) counts[nb.type]++;
        }
      }
      picked = counts.indexOf(Math.max(...counts));
      if (picked < 0) picked = this.rng.int(this.colors);
    }

    for (const t of targets) {
      const b = this.grid[t];
      b.type = picked;
      b.kind = BLOCK_KIND.NORMAL;
      b.anim = { type: 'flip', t: 0, dur: ANIM.magicFlip };
    }
    this.selection = null;
    this.hint = null;
    this.state = BOARD_STATE.FLIPPING;
    this.animT = 0;
    this.animDur = ANIM.magicFlip;
    this.bus.emit('board:transform', { cells: targets, color: picked });
    return { cells: targets, color: picked };
  }

  /** 魔术方块：点击切换自身颜色 */
  cycleMagic(i) {
    if (!this.enabled || this.state !== BOARD_STATE.IDLE) return false;
    const b = this.grid[i];
    if (!b || !b.isMagic) return false;
    const before = b.type;
    b.type = (b.type + 1) % this.colors;
    b.anim = { type: 'flip', t: 0, dur: ANIM.magicFlip };
    this.selection = null;
    this.hint = null;
    this.state = BOARD_STATE.FLIPPING;
    this.animT = 0;
    this.animDur = ANIM.magicFlip;
    this.bus.emit('board:magic', { index: i, from: before, to: b.type });
    return true;
  }

  /** 把魔术方块转为普通方块（用于「魔术方块被相邻同色吸收」的可选玩法） */
  solidify(i) {
    const b = this.grid[i];
    if (b && b.isMagic) { b.kind = BLOCK_KIND.NORMAL; return true; }
    return false;
  }

  /** 请求一次提示 */
  requestHint() {
    const groups = this.allGroups();
    if (groups.length) {
      // 优先提示最大的一组，让玩家拿到更高的分
      this.hint = groups[0];
      this.idleTime = 0;
      this.bus.emit('board:hint', { cells: this.hint, kind: 'group' });
      return this.hint;
    }
    // 没有现成的组时，看看切换某个魔术方块能不能救场
    const rescue = this.hasMagicRescue();
    if (rescue) {
      this.hint = [rescue.index];
      this.idleTime = 0;
      this.bus.emit('board:hint', { cells: this.hint, kind: 'magic', color: rescue.color });
      return this.hint;
    }
    this.hint = null;
    return null;
  }

  // ==================== 消除 / 靠拢 ====================

  _doRemove(cells, info) {
    const removed = [];
    for (const i of cells) {
      const b = this.grid[i];
      if (!b) continue;
      b.removing = true;
      b.anim = { type: 'remove', t: 0, dur: ANIM.remove };
      removed.push({
        index: i,
        type: b.type,
        kind: b.kind,
        col: this.colOf(i),
        row: this.rowOf(i)
      });
    }
    if (!removed.length) return null;

    this.movesUsed++;
    this.selection = null;
    this.hint = null;
    this.idleTime = 0;

    this.lastRemoval = {
      cells: removed.map((r) => r.index),
      removed,
      size: removed.length,
      type: info.type,
      reason: info.reason,
      origin: info.origin,
      magicCount: removed.filter((r) => r.kind === BLOCK_KIND.MAGIC).length
    };

    this.state = BOARD_STATE.REMOVING;
    this.animT = 0;
    this.animDur = ANIM.remove;
    this.bus.emit('board:remove', this.lastRemoval);
    return this.lastRemoval;
  }

  /**
   * 空位填补：同一行中，空位两侧的方块向中间靠拢。
   * 不做任何纵向移动，也不补充新方块。
   */
  _applyCollapse() {
    // 先真正移除方块
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] && this.grid[i].removing) this.grid[i] = null;
    }

    let moved = 0;
    for (let r = 0; r < this.rows; r++) {
      const row = [];
      for (let c = 0; c < this.cols; c++) row.push(this.get(c, r));

      const placed = this._packRow(row);

      for (let c = 0; c < this.cols; c++) {
        const b = placed[c];
        this.set(c, r, b);
        if (!b) continue;
        const from = row.indexOf(b);
        if (from !== -1 && from !== c) {
          b.ox = from - c;
          b.anim = { type: 'slide', t: 0, dur: ANIM.collapse, fromX: b.ox };
          moved++;
        }
      }
    }

    this.state = BOARD_STATE.COLLAPSING;
    this.animT = 0;
    this.animDur = moved ? ANIM.collapse : 0;
    this.bus.emit('board:collapse', { moved });
  }

  /**
   * 把一行的方块按填补规则重新排布。
   * CENTER：左半区向右压实、右半区向左压实（两侧向中间靠拢）
   * LEFT / RIGHT：整行压向一侧
   * @param {Array<Block|null>} row
   * @returns {Array<Block|null>} 新的一行
   */
  _packRow(row) {
    const w = row.length;
    const out = new Array(w).fill(null);

    if (this.collapse === COLLAPSE.LEFT || this.collapse === COLLAPSE.RIGHT) {
      const items = row.filter(Boolean);
      if (this.collapse === COLLAPSE.LEFT) {
        for (let i = 0; i < items.length; i++) out[i] = items[i];
      } else {
        for (let i = 0; i < items.length; i++) out[w - items.length + i] = items[i];
      }
      return out;
    }

    // CENTER：以行中点为界，两侧分别向中间压实
    const mid = Math.floor(w / 2);
    const leftItems = [];
    for (let c = 0; c < mid; c++) if (row[c]) leftItems.push(row[c]);
    const rightItems = [];
    for (let c = mid; c < w; c++) if (row[c]) rightItems.push(row[c]);

    // 左半区靠右（贴着中线）
    for (let k = 0; k < leftItems.length; k++) {
      out[mid - leftItems.length + k] = leftItems[k];
    }
    // 右半区靠左（贴着中线）
    for (let k = 0; k < rightItems.length; k++) {
      out[mid + k] = rightItems[k];
    }

    return out;
  }

  /** 一次消除彻底完成后的判定 */
  _settle() {
    this.state = BOARD_STATE.IDLE;
    this.idleTime = 0;
    if (!this.hasMoves()) {
      // 还能靠切换魔术方块救回来的话，就不算死局
      const rescue = this.hasMagicRescue();
      if (rescue) {
        this.bus.emit('board:magicOnly', rescue);
        return;
      }
      this.bus.emit('board:noMoves', {
        remaining: this.remaining,
        remainingMatchable: this.remainingMatchable
      });
    } else {
      this.bus.emit('board:settled', { remaining: this.remaining });
    }
  }

  // ==================== 帧更新 ====================

  update(dt) {
    for (const b of this.grid) {
      if (!b || !b.anim) continue;
      const a = b.anim;
      a.t += dt;
      if (a.t < 0) { b.scale = 0; continue; }   // 延迟出场
      const p = clamp(a.t / a.dur, 0, 1);
      switch (a.type) {
        case 'spawn':
          b.scale = easeOutBack(p);
          if (p >= 1) { b.scale = 1; b.anim = null; }
          break;
        case 'remove':
          b.scale = 1 + 0.32 * Math.sin(p * Math.PI) - p * p * 1.0;
          b.alpha = 1 - p * p;
          b.spin = p * 1.6;
          if (p >= 1) { b.scale = 0; b.alpha = 0; b.anim = null; }
          break;
        case 'slide':
          b.ox = a.fromX * (1 - easeOutCubic(p));
          if (p >= 1) { b.ox = 0; b.anim = null; }
          break;
        case 'flip':
          b.scale = 1 - 0.55 * Math.sin(p * Math.PI);
          b.spin = easeInOutQuad(p) * Math.PI;
          if (p >= 1) { b.scale = 1; b.spin = 0; b.anim = null; }
          break;
        default:
          b.anim = null;
      }
    }

    switch (this.state) {
      case BOARD_STATE.IDLE:
        this.idleTime += dt;
        if (this.enabled && this.idleTime > ANIM.idleHintAfter && !this.hint) {
          const groups = this.allGroups();
          this.hint = groups.length ? groups[0] : null;
        }
        break;

      case BOARD_STATE.SPAWNING:
        this.animT += dt;
        if (this.animT >= this.animDur || !this.grid.some((b) => b && b.anim)) {
          this.state = BOARD_STATE.IDLE;
          this.idleTime = 0;
          this.bus.emit('board:ready', {});
        }
        break;

      case BOARD_STATE.REMOVING:
        this.animT += dt;
        if (this.animT >= this.animDur) this._applyCollapse();
        break;

      case BOARD_STATE.COLLAPSING:
        this.animT += dt;
        if (this.animT >= this.animDur) this.state = BOARD_STATE.SETTLING;
        break;

      case BOARD_STATE.FLIPPING:
        this.animT += dt;
        if (this.animT >= this.animDur) this.state = BOARD_STATE.SETTLING;
        break;

      case BOARD_STATE.SETTLING:
        this._settle();
        break;

      default:
        break;
    }
  }

  // ==================== 存档 ====================

  serialize() {
    return {
      cols: this.cols,
      rows: this.rows,
      colors: this.colors,
      collapse: this.collapse,
      initialCount: this.initialCount,
      movesUsed: this.movesUsed,
      cells: this.grid.map((b) => (b ? { t: b.type, k: b.kind } : null))
    };
  }

  load(data) {
    if (!data || data.cols !== this.cols || data.rows !== this.rows) return false;
    this.colors = data.colors;
    this.collapse = data.collapse || this.collapse;
    this.initialCount = data.initialCount || 0;
    this.movesUsed = data.movesUsed || 0;
    this.grid = data.cells.map((c) => (c ? new Block(c.t, c.k) : null));
    this.state = BOARD_STATE.IDLE;
    this.selection = null;
    this.hint = null;
    return true;
  }

  /** 调试：打印棋盘 */
  toString() {
    const chars = 'RYGBPOC';
    let s = '';
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const b = this.get(c, r);
        if (!b) s += '·';
        else if (b.isStone) s += '#';
        else if (b.isMagic) s += '?';
        else s += chars[b.type % chars.length];
      }
      s += '\n';
    }
    return s;
  }
}
