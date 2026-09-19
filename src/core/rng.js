/**
 * 可复现随机数发生器（mulberry32）。
 * 使用固定种子可以让同一关卡的初始棋盘完全一致，方便调试与「重玩本关」。
 */
export class Rng {
  constructor(seed = Date.now()) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  /** 重置到指定种子 */
  reset(seed = this.seed) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  /** [0, 1) */
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [0, n) 整数 */
  int(n) {
    return Math.floor(this.next() * n);
  }

  /** [min, max] 整数 */
  range(min, max) {
    return min + this.int(max - min + 1);
  }

  /** 按概率返回真 */
  chance(p) {
    return this.next() < p;
  }

  /** 从数组随机取一个 */
  pick(arr) {
    return arr[this.int(arr.length)];
  }

  /** 原地洗牌 */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }
}

export const rng = new Rng();
