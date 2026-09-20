/**
 * 关卡数据：目标分数、颜色数、特殊方块比例、任务目标。
 * 关卡无限延伸，参数按公式随关数成长。
 */
import { STAGE, GEM_COLORS, BOARD_PRESETS, SCORE } from './config.js';
import { numToHan, clamp } from './util.js';
import { Rng } from './rng.js';

/** 章节主题（影响背景、配色与旁白） */
export const CHAPTERS = [
  { id: 'dusk',   name: '夕照湖畔', from: 1,  to: 10,   sky: ['#c2551f', '#8a3312'], accent: '#ffc46b', lamp: '#ffd166' },
  { id: 'candy',  name: '糖果之城', from: 11, to: 20,   sky: ['#b8306a', '#6e1740'], accent: '#ff9ecd', lamp: '#ffd6e7' },
  { id: 'frost',  name: '霜寒雪原', from: 21, to: 30,   sky: ['#2f6f95', '#17415c'], accent: '#8ed8ff', lamp: '#d0f0ff' },
  { id: 'flame',  name: '熔岩深渊', from: 31, to: 40,   sky: ['#a8340e', '#4d1505'], accent: '#ffb057', lamp: '#ff7b3d' },
  { id: 'night',  name: '星夜回廊', from: 41, to: 60,   sky: ['#2a3470', '#141a3c'], accent: '#c5b3ff', lamp: '#b8c6ff' },
  { id: 'abyss',  name: '终焉之渊', from: 61, to: 9999, sky: ['#3c1259', '#160823'], accent: '#e599f7', lamp: '#ff9ce0' }
];

/** 右侧头像的角色资料（原版右下角小狗在此作为看板娘/吉祥物） */
export const MASCOTS = [
  { art: 'assets/art/hood.svg', name: '小红帽', title: '森林向导',   face: '🧚', art: 'assets/art/hood.svg', color: '#ff6b81',
    lines: ['一次点掉的方块越多，分数越高哦！', '别急着点，先找最大的一坨。', '实在没得点了，就用删除道具吧。'] },
  { art: 'assets/art/piggy.svg', name: '糖果师', title: '甜品屋掌柜', face: '🍬', color: '#ffa94d',
    lines: ['甜甜的方块，一次来一大串！', '留在最后的方块越少，奖励越丰厚～', '变换道具能把一片染成同色哟。'] },
  { art: 'assets/art/hood.svg', name: '雪灵',   title: '霜原的低语', face: '❄️', color: '#74c0fc',
    lines: ['冷静点，先看清楚整块形状。', '边角的方块最容易被孤立。', '消掉下面的，上面的就会掉下来。'] },
  { art: 'assets/art/monkey.svg', name: '炎心',   title: '烈焰学派',   face: '🔥', color: '#ff8787',
    lines: ['烧掉一大片才够痛快！', '魔术方块点一下就换色，别浪费。', '顽石只能用删除道具清掉。'] },
  { art: 'assets/art/hood.svg', name: '云雀',   title: '云端信使',   face: '☁️', color: '#c5b3ff',
    lines: ['任务完成能拿一大笔奖励分。', '两个任务都做到，这关就稳了。', '慢慢来，这局没有时间限制。'] },
  { art: 'assets/art/piggy.svg', name: '渊主',   title: '终焉看门人', face: '👑', color: '#e599f7',
    lines: ['走到这里的人不多。', '让我看看你的极限。', '每一步都算数。'] }
];

/** 旁边那只只负责卖萌的小狗（原版右下角装饰） */
export const PUPPY = { art: 'assets/art/hood.svg', name: '旺财', face: '🐶', lines: ['汪！', '汪汪～', '（歪头）', '（摇尾巴）', '（打了个哈欠）'] };

export function chapterOf(stage) {
  return CHAPTERS.find((c) => stage >= c.from && stage <= c.to) || CHAPTERS[CHAPTERS.length - 1];
}

/**
 * 任务定义
 * ------------------------------------------------------------------
 * 原版的任务只有一种形态：给定几种颜色，各消除 6 个，全部完成拿奖励分。
 * 从干净截图里能直接读出来：4 个色块各标着 6，奖励 4000 分；
 * 录屏里是 3 个各 6、奖励 3000 分 —— 即每完成一项 1000 分。
 */
export const MISSION_NEED = 6;

/** 这一关有没有游戏任务 */
export function hasMissions(n) {
  if (STAGE.missionStages.includes(n)) return true;
  const last = STAGE.missionStages[STAGE.missionStages.length - 1];
  return n > last && (n - last) % STAGE.missionEvery === 0;
}

/** 按关卡抽取任务：3 种颜色起步，第 11 关起 4 种 */
function makeMissions(n, ctx, rng) {
  if (!hasMissions(n)) return [];
  const count = Math.min(ctx.colors, n >= 11 ? 4 : 3);
  const pool = [];
  for (let i = 0; i < ctx.colors; i++) pool.push(i);
  rng.shuffle(pool);
  return pool.slice(0, count).map((color) => ({
    type: 'color',
    color,
    need: MISSION_NEED,
    text: `消除 ${MISSION_NEED} 个「${GEM_COLORS[color].name}」方块`
  }));
}

/** 任务是否完成 */
export function missionDone(mission, stats) {
  return (stats.colorCleared[mission.color] || 0) >= mission.need;
}

/** 任务进度文本 */
export function missionProgressText(mission, stats) {
  const cur = Math.min(mission.need, stats.colorCleared[mission.color] || 0);
  return `${cur} / ${mission.need}`;
}

/**
 * 棋盘尺寸。原版固定 10×10 —— 原版还原模式的底板就是按这个尺寸抠的，
 * 棋盘一变大就对不上位。难度改由难度压强、顽石与任务推进。
 * 想玩更大的棋盘，把 config 里的 maxExtraRows 调大即可（会自动切到手机版式）。
 * @param {number} n 关卡号
 * @param {string} boardKey 玩家选择的尺寸预设
 */
export function stageBoardSize(n, boardKey = 'standard') {
  const preset = BOARD_PRESETS[boardKey] || BOARD_PRESETS.standard;
  const extraRows = Math.min(STAGE.maxExtraRows, Math.floor((n - 1) / STAGE.rowEveryStages));
  return { cols: preset.cols, rows: preset.rows + extraRows };
}

/**
 * 单格期望产出分：颜色越多，能连成的块越小，单格产出骤降。
 * 数值由 tools/curve.mjs 在真实棋盘上用机器人实测后标定。
 */
const PER_CELL_SCORE = { 3: 140, 4: 79, 5: 45, 6: 30, 7: 21 };

/** 该颜色数下的单组得分系数 */
export function colorScoreFactor(colors) {
  return SCORE.colorFactor[clamp(colors, 3, 7)] ?? 1;
}

/** 估算某个配置下「认真玩」能拿到的分数上限（已计入颜色补偿系数） */
export function achievableScore(colors, cells, magicRate = 0, stoneRate = 0) {
  const c = clamp(colors, 3, 7);
  const per = (PER_CELL_SCORE[c] ?? 21) * colorScoreFactor(c);
  // 顽石消不掉，还会把色块切断，是纯粹的阻碍；
  // 魔术方块则是白送的万能牌 —— 换色不要钱，会用的人能靠它把两片色块接起来。
  // 系数由 tools/balance.mjs 在固定 10×10 棋盘上回归得出：
  // 每 1% 的魔术方块把可达分抬高约 2.6%。
  const effective = cells * (1 - stoneRate * 2.2) * (1 + magicRate * 2.6);
  return Math.max(500, effective * per);
}

/** 难度压强：目标分占可达分的比例，随关卡爬升 */
export function stagePressure(n) {
  return Math.min(STAGE.pressureMax, STAGE.pressureBase + (n - 1) * STAGE.pressureStep);
}

/** 目标分缓存：key = `${boardKey}:${n}` */
const targetCache = new Map();

/** 某关的原始目标分（未做单调处理） */
function rawTarget(n, boardKey) {
  const size = stageBoardSize(n, boardKey);
  const cells = size.cols * size.rows;
  const colors = Math.min(STAGE.colorsMax, STAGE.colorsStart + Math.floor((n - 1) / STAGE.colorsEveryStages));
  const magicRate = n >= STAGE.magicFromStage
    ? Math.min(STAGE.magicRateMax, STAGE.magicRateBase + (n - STAGE.magicFromStage) * STAGE.magicRateStep) : 0;
  const stoneRate = n >= STAGE.stoneFromStage
    ? Math.min(STAGE.stoneRateMax, STAGE.stoneRateBase + (n - STAGE.stoneFromStage) * STAGE.stoneRateStep) : 0;
  const ceiling = achievableScore(colors, cells, magicRate, stoneRate);
  return { raw: ceiling * stagePressure(n), ceiling };
}

/**
 * 目标分必须单调不降 —— 玩家看到「第 7 关目标比第 6 关低」会以为变简单了。
 * 但也不能硬涨到打不过，所以上限锁在可达分的 hardCap 比例。
 * @param {number} n 关卡号
 * @param {string} boardKey 棋盘预设
 * @param {number} [ceiling] 本关可达分（传入可省一次计算）
 */
export function targetFor(n, boardKey = 'standard', ceiling = null) {
  const key = `${boardKey}:${n}`;
  if (targetCache.has(key)) return targetCache.get(key);

  let prev = 0;
  for (let i = 1; i <= n; i++) {
    const k = `${boardKey}:${i}`;
    if (targetCache.has(k)) { prev = targetCache.get(k); continue; }
    const { raw, ceiling: cap } = i === n && ceiling != null
      ? { raw: rawTarget(i, boardKey).raw, ceiling: ceiling }
      : rawTarget(i, boardKey);
    // 先取「不低于上一关」，再压回可达分上限之内；
    // 最后再兜一次 prev —— 宁可微微超过软上限，也不能让玩家看到目标分往回掉。
    const wanted = Math.max(raw, prev);
    const capped = Math.round(Math.min(wanted, cap * STAGE.hardCap) / 50) * 50;
    const value = Math.max(500, prev, capped);
    targetCache.set(k, value);
    prev = value;
  }
  return targetCache.get(key);
}

/**
 * 生成关卡定义。
 * @param {number} n 关卡号（从 1 开始）
 * @param {string} boardKey 棋盘尺寸预设 key
 */
export function makeStage(n, boardKey = 'standard') {
  n = Math.max(1, Math.floor(n));
  const size = stageBoardSize(n, boardKey);
  const cells = size.cols * size.rows;
  const rng = new Rng((0x9e3779b9 ^ (n * 2654435761)) >>> 0);

  const colors = Math.min(
    STAGE.colorsMax,
    STAGE.colorsStart + Math.floor((n - 1) / STAGE.colorsEveryStages)
  );

  const magicRate = n >= STAGE.magicFromStage
    ? Math.min(STAGE.magicRateMax, STAGE.magicRateBase + (n - STAGE.magicFromStage) * STAGE.magicRateStep)
    : 0;

  const stoneRate = n >= STAGE.stoneFromStage
    ? Math.min(STAGE.stoneRateMax, STAGE.stoneRateBase + (n - STAGE.stoneFromStage) * STAGE.stoneRateStep)
    : 0;

  const ceiling = achievableScore(colors, cells, magicRate, stoneRate);
  const target = targetFor(n, boardKey, ceiling);

  const ctx = { n, colors, cells };
  const missions = makeMissions(n, ctx, rng);
  const chapter = chapterOf(n);
  const mascot = MASCOTS[Math.min(MASCOTS.length - 1, Math.floor((n - 1) / 10))];

  return {
    n,
    label: `第 ${n} 关`,
    hanLabel: `第${numToHan(n)}关`,
    stageCode: `${chapter.id.toUpperCase()}-${n}`,
    cols: size.cols,
    rows: size.rows,
    cells,
    target,
    colors,
    magicRate,
    stoneRate,
    /** 本关的单组得分系数 */
    scoreFactor: SCORE.groupFactor * colorScoreFactor(colors),
    missions,
    chapter,
    mascot,
    /** 三星门槛 */
    stars: [target, Math.round(target * 1.22 / 50) * 50, Math.round(target * 1.5 / 50) * 50],
    brief: missions.length
      ? `达到 ${target} 分过关；完成 ${missions.length} 个游戏任务另有 ${missions.length * 1000} 分奖励。`
      : `在方块点完之前达到 ${target} 分即可过关。`
  };
}
