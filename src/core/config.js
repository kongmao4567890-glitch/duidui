/**
 * 对对碰 · 全局配置
 * ------------------------------------------------------------------
 * 玩法基准（联众原版 Flash）：
 *   · 点击上下左右相连、≥2 个的同色方块，整组消除（斜向不算）
 *   · 消除后同一行的方块向中间靠拢填补空位，不会上下掉落、不会补充新块
 *   · 一次消除得越多，单组得分越高
 *   · 达到本关目标分数即通关；无可消组合且未达标则本局结束
 */

/** 方块颜色表（对应原版的糖果配色） */
export const GEM_COLORS = [
  { key: 'red',    name: '红',  main: '#ff4d6a', light: '#ffc2cd', dark: '#9e0f33', glow: '#ff2d55' },
  { key: 'yellow', name: '黄',  main: '#ffd93d', light: '#fff3b0', dark: '#9c7400', glow: '#ffc400' },
  { key: 'green',  name: '绿',  main: '#5ce072', light: '#c3f7cc', dark: '#0f7c35', glow: '#2ee05a' },
  { key: 'blue',   name: '蓝',  main: '#4d8dff', light: '#c0d6ff', dark: '#10399e', glow: '#2d6dff' },
  { key: 'purple', name: '紫',  main: '#c05cff', light: '#e9caff', dark: '#620f9e', glow: '#a82dff' },
  { key: 'orange', name: '橙',  main: '#ff9a2e', light: '#ffdcae', dark: '#9e5203', glow: '#ff8a00' },
  { key: 'cyan',   name: '青',  main: '#3ed6e0', light: '#bdf3f7', dark: '#077784', glow: '#12c2d6' }
];

/** 方块的特殊属性 */
export const BLOCK_KIND = {
  NORMAL: 0,
  MAGIC: 1,     // 魔术方块：点击可切换自身颜色，不会被直接消除
  STONE: 2      // 顽石：无色，只能用榔头敲掉（后期关卡出现）
};

/** 消除后空位的填补方式 */
export const COLLAPSE = {
  CENTER: 'center',  // 原版：同一行两侧方块向中间靠拢
  LEFT: 'left',      // 整行靠左
  RIGHT: 'right'     // 整行靠右
};

/** 棋盘尺寸预设 */
export const BOARD_PRESETS = {
  mini:     { cols: 8,  rows: 9,  label: '迷你 8×9' },
  standard: { cols: 9,  rows: 11, label: '原版 9×11' },
  large:    { cols: 10, rows: 13, label: '挑战 10×13' }
};

/** 计分规则 */
export const SCORE = {
  /** 单组得分 = groupFactor × colorFactor[颜色数] × (n − 1)²，n 为该组方块数 */
  groupFactor: 25,
  /**
   * 颜色越多越难连成大块，单格产出会断崖式下跌。
   * 用这个系数补偿，让分数尺度不随颜色数崩塌，
   * 目标分才能一路单调上升，而不是在加颜色那关突然倒退。
   * 系数由 tools/curve.mjs 实测的单格产出反推而来。
   */
  colorFactor: { 3: 0.39, 4: 0.61, 5: 1.0, 6: 1.47, 7: 1.86 },
  /** 一次消除 ≥ bigGroup 个时的额外喝彩奖励 */
  bigGroup: 8,
  bigGroupBonus: 150,
  /** 消除到魔术方块的额外分 */
  magicBonus: 80,
  /** 全盘清空奖励 */
  clearAllBonus: 2000,
  /** 剩余方块奖励：max(0, leftoverBase − 剩余数 × leftoverStep) */
  leftoverBase: 900,
  leftoverStep: 25,
  /** 道具惩罚 */
  hammerPenalty: 50,
  transformPenalty: 80,
  hintPenalty: 30,
  /** 任务完成奖励 */
  missionBonus: 800
};

/** 关卡生成参数 */
export const STAGE = {
  /**
   * 目标分不再线性累加 —— 固定大小的棋盘总分有上限，硬涨只会变成必输。
   * 改为：目标分 = 该配置下「认真玩能拿到的分」× 难度压强。
   * 压强从第 1 关的 42% 一路爬到 88%，配合颜色数增加与特殊方块，
   * 难度稳定上升，第 1 关的目标分依然是原版的 2500。
   */
  pressureBase: 0.443,   // 标定为「第 1 关目标分 = 原版的 2500」
  pressureStep: 0.040,
  pressureMax: 0.90,
  /** 目标分的硬上限：不得超过可达分的这个比例，防止单调化把关卡顶成必输 */
  hardCap: 0.83,
  /** 棋盘随关卡长高，给后期更高的分数天花板 */
  rowEveryStages: 5,
  maxExtraRows: 4,
  colorsStart: 5,          // 起始颜色数
  colorsMax: 7,
  colorsEveryStages: 6,    // 每多少关多一种颜色
  missionFromStage: 6,     // 第 6 关起出现任务目标
  magicFromStage: 3,       // 第 3 关起出现魔术方块
  magicRateBase: 0.025,    // 魔术方块占比
  magicRateStep: 0.004,
  magicRateMax: 0.07,
  stoneFromStage: 12,      // 第 12 关起出现顽石
  stoneRateBase: 0.02,
  stoneRateStep: 0.004,
  stoneRateMax: 0.08
};

/** 动画时长（毫秒） */
export const ANIM = {
  remove: 260,
  collapse: 220,
  spawn: 520,
  magicFlip: 220,
  hintPeriod: 850,
  idleHintAfter: 6000
};

/** 道具初始数量 */
export const ITEMS = {
  hammer: 3,
  transform: 2,
  hint: 5
};

export const ITEM_META = {
  hammer:    { name: '榔头',   desc: '敲掉任意一个方块，不受相连规则限制', icon: '🔨' },
  transform: { name: '变换',   desc: '把一片区域染成同色，制造可消组合',   icon: '🎨' },
  hint:      { name: '提示',   desc: '指出一组可以消除的方块',             icon: '👁' }
};

/** 变换道具影响的范围（十字 + 中心，共 5 格） */
export const TRANSFORM_SHAPE = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];

/** 默认设置 */
export const DEFAULT_SETTINGS = {
  board: 'standard',
  sound: true,
  music: true,
  vibrate: true,
  particles: true,
  confirmTap: true,     // true = 先点选高亮、再点一次确认消除
  showGrid: true,
  showCount: true       // 在选中组上显示数量与预估得分
};
