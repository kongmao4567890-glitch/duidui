/**
 * 无头机器人：给调参工具用的几档「玩家水平」模拟。
 * 不跑动画，直接同步推进棋盘。
 */
import { Board } from '../src/core/board.js';
import { Rng } from '../src/core/rng.js';
import { EventBus } from '../src/core/util.js';
import { SCORE, COLLAPSE } from '../src/core/config.js';

/** 同步消除一组，返回得分 */
export function fastRemove(b, start, factor) {
  const cells = b.findGroup(start);
  if (!b.isRemovableGroup(cells)) return 0;
  const magic = cells.filter((i) => b.grid[i].isMagic).length;
  for (const i of cells) b.grid[i].removing = true;
  b._applyCollapse();
  for (const x of b.grid) if (x) { x.ox = 0; x.anim = null; }
  b.state = 'idle';
  let s = Board.groupScore(cells.length, factor);
  if (cells.length >= SCORE.bigGroup) s += SCORE.bigGroupBonus * (cells.length - SCORE.bigGroup + 1);
  return s + magic * SCORE.magicBonus;
}

/**
 * 把每个魔术方块切到最有利的颜色。
 * 真人玩家一定会这么做 —— 换色不花钱、也没有步数限制。
 */
export function tuneMagic(b, passes = 2) {
  for (let p = 0; p < passes; p++) {
    let changed = false;
    for (let i = 0; i < b.grid.length; i++) {
      const blk = b.grid[i];
      if (!blk || !blk.isMagic) continue;
      const original = blk.type;
      let bestColor = original, bestSize = -1;
      for (let t = 0; t < b.colors; t++) {
        blk.type = t;
        const g = b.findGroup(i);
        const size = b.isRemovableGroup(g) ? g.length : 0;
        if (size > bestSize) { bestSize = size; bestColor = t; }
      }
      blk.type = bestColor;
      if (bestColor !== original) changed = true;
    }
    if (!changed) break;
  }
}

export const STRATEGIES = {
  /** 乱点：随便挑一组（完全不动脑） */
  random: (b, rng) => { const g = b.allGroups(); return g.length ? rng.pick(g)[0] : -1; },

  /** 见大就吃：永远先消最大的一组（新手直觉，其实并不优） */
  greedy: (b) => { const g = b.allGroups(); return g.length ? g[0][0] : -1; },

  /** 先清小块：把大色块留到最后滚雪球（老手打法） */
  patient: (b) => {
    const g = b.allGroups();
    if (!g.length) return -1;
    const small = g.filter((x) => x.length <= 3);
    return small.length ? small[small.length - 1][0] : g[g.length - 1][0];
  },

  /** 一层前瞻：模拟每一步之后棋盘的剩余潜力，取综合最优 */
  lookahead: (b, rng, factor) => {
    const groups = b.allGroups();
    if (!groups.length) return -1;
    if (groups.length === 1) return groups[0][0];
    const cands = groups.length > 12 ? rng.shuffle(groups.slice()).slice(0, 12) : groups;
    let best = groups[0][0], bestVal = -Infinity;
    for (const g of cands) {
      const snap = b.serialize();
      const gain = fastRemove(b, g[0], factor);
      let pot = 0;
      for (const ng of b.allGroups()) pot += Board.groupScore(ng.length, factor);
      b.load(snap);
      const val = gain + pot * 0.8;
      if (val > bestVal) { bestVal = val; best = g[0]; }
    }
    return best;
  }
};

/**
 * 跑完一整局。
 * @param {object} opts {cols, rows, colors, magicRate, stoneRate, factor}
 * @param {string} strategyKey
 * @param {number} seed
 */
export function play(opts, strategyKey, seed) {
  const { cols, rows, colors, magicRate = 0, stoneRate = 0, factor = SCORE.groupFactor } = opts;
  const rng = new Rng(seed);
  const b = new Board({ cols, rows, colors, rng, bus: new EventBus(), collapse: COLLAPSE.CENTER, magicRate, stoneRate });

  let guard = 0;
  do {
    for (let i = 0; i < b.grid.length; i++) b.grid[i] = b._rollBlock();
    guard++;
  } while (!b.hasMoves() && guard < 60);
  b.initialCount = b.remaining;
  b.state = 'idle';

  const fn = STRATEGIES[strategyKey];
  // 乱点的玩家不会去研究魔术方块，其余水平都会用
  const smart = strategyKey !== 'random';

  let score = 0, steps = 0, maxGroup = 0;
  for (;;) {
    if (smart) tuneMagic(b);
    if (!b.hasMoves()) break;
    if (steps++ > 500) break;
    const pick = fn(b, rng, factor);
    if (pick < 0) break;
    const g = b.findGroup(pick);
    maxGroup = Math.max(maxGroup, g.length);
    score += fastRemove(b, pick, factor);
  }

  const remaining = b.remaining;
  let bonus = Math.max(0, SCORE.leftoverBase - remaining * SCORE.leftoverStep);
  if (remaining === 0) bonus += SCORE.clearAllBonus;
  return { score: score + bonus, remaining, steps, maxGroup };
}

export const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
export const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
