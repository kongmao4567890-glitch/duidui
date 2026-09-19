/** 通用工具函数 */

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

export const lerp = (a, b, t) => a + (b - a) * t;

/** 缓动：先快后慢 */
export const easeOutQuad = (t) => t * (2 - t);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInQuad = (t) => t * t;
export const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
/** 回弹：落地时轻微反弹 */
export const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeOutBounce = (t) => {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
};

/** 千分位格式化：12345 -> 12,345 */
export function formatScore(n) {
  return Math.max(0, Math.floor(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 秒数格式化：95.4 -> 1:35 */
export function formatTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

/** 将数字转为汉字（用于关卡「第X关」展示，支持 1-999） */
export function numToHan(n) {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n < 10) return digits[n];
  if (n < 20) return n === 10 ? '十' : '十' + digits[n % 10];
  if (n < 100) {
    const t = Math.floor(n / 10), r = n % 10;
    return digits[t] + '十' + (r ? digits[r] : '');
  }
  const h = Math.floor(n / 100), rest = n % 100;
  let s = digits[h] + '百';
  if (rest === 0) return s;
  if (rest < 10) return s + '零' + digits[rest];
  return s + numToHan(rest);
}

/** 简易事件总线 */
export class EventBus {
  constructor() { this.map = new Map(); }
  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type).add(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    const set = this.map.get(type);
    if (set) set.delete(fn);
  }
  emit(type, payload) {
    const set = this.map.get(type);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try { fn(payload); } catch (err) { console.error(`[事件 ${type}] 处理出错：`, err); }
    }
  }
  clear() { this.map.clear(); }
}

/** requestAnimationFrame 驱动的固定回调循环 */
export class Ticker {
  constructor(callback) {
    this.callback = callback;
    this.running = false;
    this.last = 0;
    this._loop = this._loop.bind(this);
  }
  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this._loop);
  }
  stop() { this.running = false; }
  _loop(now) {
    if (!this.running) return;
    // 单帧最大步进 100ms，避免切后台回来后大幅跳变
    const dt = Math.min(100, now - this.last);
    this.last = now;
    this.callback(dt, now);
    requestAnimationFrame(this._loop);
  }
}
