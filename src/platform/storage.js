/**
 * 本地存档
 * ------------------------------------------------------------------
 * 用 localStorage 保存设置、关卡进度、道具数量与最高分。
 * 所有读写都包了 try/catch —— 隐私模式或存储被禁用时游戏照样能玩，
 * 只是不记进度。
 */

import { DEFAULT_SETTINGS, ITEMS } from '../core/config.js';

const KEY = 'duidui.save.v1';

const BLANK = {
  version: 1,
  settings: { ...DEFAULT_SETTINGS },
  progress: {
    maxStage: 1,          // 已解锁到第几关
    stars: {},            // { 关卡号: 星数 }
    bestScore: {},        // { 关卡号: 最高分 }
    totalScore: 0,
    totalBlocks: 0,       // 累计消除方块数
    totalGames: 0,
    bestGroup: 0,         // 历史最大一次消除
    perfectClears: 0      // 全清次数
  },
  items: { ...ITEMS },
  lastPlayed: 0
};

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(patch || {})) {
    const v = patch[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

export class Storage {
  constructor() {
    this.available = this._probe();
    this.data = this.load();
  }

  _probe() {
    try {
      const k = '__duidui_probe__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch {
      return false;
    }
  }

  load() {
    if (!this.available) return structuredClone(BLANK);
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(BLANK);
      const parsed = JSON.parse(raw);
      return deepMerge(structuredClone(BLANK), parsed);
    } catch (err) {
      console.warn('存档损坏，已重置：', err);
      return structuredClone(BLANK);
    }
  }

  save() {
    if (!this.available) return false;
    try {
      this.data.lastPlayed = Date.now();
      localStorage.setItem(KEY, JSON.stringify(this.data));
      return true;
    } catch (err) {
      console.warn('存档写入失败：', err);
      return false;
    }
  }

  get settings() { return this.data.settings; }
  get progress() { return this.data.progress; }
  get items() { return this.data.items; }

  updateSettings(patch) {
    Object.assign(this.data.settings, patch);
    this.save();
    return this.data.settings;
  }

  setItems(items) {
    this.data.items = { ...items };
    this.save();
  }

  /** 记录一次通关 */
  recordWin(stageNo, score, stars, stats) {
    const p = this.data.progress;
    p.maxStage = Math.max(p.maxStage, stageNo + 1);
    p.stars[stageNo] = Math.max(p.stars[stageNo] || 0, stars);
    p.bestScore[stageNo] = Math.max(p.bestScore[stageNo] || 0, score);
    p.totalScore += score;
    p.totalGames++;
    if (stats) {
      p.totalBlocks += stats.blocksCleared || 0;
      p.bestGroup = Math.max(p.bestGroup, stats.maxGroup || 0);
      if (stats.remaining === 0) p.perfectClears++;
    }
    this.save();
  }

  /** 记录一次失败 */
  recordLose(stageNo, score, stats) {
    const p = this.data.progress;
    p.bestScore[stageNo] = Math.max(p.bestScore[stageNo] || 0, score);
    p.totalGames++;
    if (stats) {
      p.totalBlocks += stats.blocksCleared || 0;
      p.bestGroup = Math.max(p.bestGroup, stats.maxGroup || 0);
    }
    this.save();
  }

  /** 补充道具（看完奖励、或每日登录） */
  grantItems(patch) {
    for (const k of Object.keys(patch)) {
      this.data.items[k] = (this.data.items[k] || 0) + patch[k];
    }
    this.save();
  }

  /** 清空全部数据 */
  reset() {
    this.data = structuredClone(BLANK);
    if (this.available) {
      try { localStorage.removeItem(KEY); } catch { /* 忽略 */ }
    }
    return this.data;
  }

  /** 导出存档（给玩家换设备用） */
  export() {
    return btoa(unescape(encodeURIComponent(JSON.stringify(this.data))));
  }

  /** 导入存档 */
  import(text) {
    try {
      const obj = JSON.parse(decodeURIComponent(escape(atob(text.trim()))));
      this.data = deepMerge(structuredClone(BLANK), obj);
      this.save();
      return true;
    } catch (err) {
      console.warn('存档导入失败：', err);
      return false;
    }
  }
}

export const storage = new Storage();
