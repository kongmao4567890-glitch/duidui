/**
 * 方块贴图生成器
 * ------------------------------------------------------------------
 * 全部用 Canvas 程序化绘制并缓存成离屏画布，游戏不依赖任何图片文件。
 * 换句话说：整个包里没有一张 png，加载秒开，任意分辨率都清晰。
 */

import { GEM_COLORS, BLOCK_KIND } from '../core/config.js';

/** 缓存：key = `${kind}:${type}:${size}` */
const cache = new Map();
let cacheSize = 0;
const CACHE_LIMIT = 240;

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') {
    try { return new OffscreenCanvas(w, h); } catch { /* 退回普通 canvas */ }
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** 圆角矩形路径 */
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/**
 * 绘制一颗普通糖果方块。
 * 层次：外描边 → 主体渐变 → 内高光环 → 顶部油亮高光 → 底部反射 → 中心色标
 */
function drawCandy(ctx, size, color) {
  const pad = Math.max(1.5, size * 0.055);
  const w = size - pad * 2;
  const r = w * 0.26;

  // 外描边（深色，让方块之间界限分明）
  ctx.save();
  roundRect(ctx, pad, pad, w, w, r);
  ctx.fillStyle = color.dark;
  ctx.fill();
  ctx.restore();

  // 主体：自上而下由亮到深
  const inset = pad + Math.max(1, size * 0.028);
  const iw = size - inset * 2;
  const grad = ctx.createLinearGradient(0, inset, 0, inset + iw);
  grad.addColorStop(0, color.light);
  grad.addColorStop(0.42, color.main);
  grad.addColorStop(1, color.dark);
  ctx.save();
  roundRect(ctx, inset, inset, iw, iw, r * 0.92);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  // 内高光环：糖体的通透感
  ctx.save();
  roundRect(ctx, inset, inset, iw, iw, r * 0.92);
  ctx.clip();
  const ring = ctx.createRadialGradient(
    size * 0.35, size * 0.32, size * 0.04,
    size * 0.5, size * 0.5, size * 0.62
  );
  ring.addColorStop(0, 'rgba(255,255,255,0.55)');
  ring.addColorStop(0.45, 'rgba(255,255,255,0.10)');
  ring.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = ring;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  // 顶部油亮高光
  ctx.save();
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(size * 0.38, size * 0.29, iw * 0.24, iw * 0.135, -0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.ellipse(size * 0.63, size * 0.24, iw * 0.08, iw * 0.05, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 底部反射光：让方块看起来是立体的
  ctx.save();
  roundRect(ctx, inset, inset, iw, iw, r * 0.92);
  ctx.clip();
  const bounce = ctx.createLinearGradient(0, size * 0.7, 0, size);
  bounce.addColorStop(0, 'rgba(255,255,255,0)');
  bounce.addColorStop(1, 'rgba(255,255,255,0.28)');
  ctx.fillStyle = bounce;
  ctx.fillRect(0, size * 0.7, size, size * 0.3);
  ctx.restore();

  // 描边高光
  ctx.save();
  roundRect(ctx, inset, inset, iw, iw, r * 0.92);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = Math.max(1, size * 0.022);
  ctx.stroke();
  ctx.restore();
}

/**
 * 色盲友好标记：每种颜色在中心叠一个不同的形状，
 * 这样不靠颜色也能分辨方块种类。
 */
function drawColorMark(ctx, size, index) {
  const cx = size / 2, cy = size * 0.54;
  const r = size * 0.15;
  ctx.save();
  ctx.globalAlpha = 0.34;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = Math.max(1, size * 0.02);
  ctx.beginPath();
  switch (index % 7) {
    case 0:  // 圆
      ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
      break;
    case 1:  // 方
      ctx.rect(cx - r * 0.7, cy - r * 0.7, r * 1.4, r * 1.4);
      break;
    case 2:  // 三角
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r * 0.9, cy + r * 0.7);
      ctx.lineTo(cx - r * 0.9, cy + r * 0.7);
      ctx.closePath();
      break;
    case 3:  // 菱形
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      break;
    case 4: {  // 五角星
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
        const a2 = a + Math.PI / 5;
        ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.lineTo(cx + Math.cos(a2) * r * 0.45, cy + Math.sin(a2) * r * 0.45);
      }
      ctx.closePath();
      break;
    }
    case 5: {  // 六边形
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9);
      }
      ctx.closePath();
      break;
    }
    default:   // 水滴
      ctx.moveTo(cx, cy - r);
      ctx.quadraticCurveTo(cx + r, cy, cx, cy + r);
      ctx.quadraticCurveTo(cx - r, cy, cx, cy - r);
      ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** 魔术方块：底色是当前颜色，外面罩一层彩虹光环和星芒 */
function drawMagic(ctx, size, color) {
  drawCandy(ctx, size, color);

  const cx = size / 2, cy = size / 2;
  // 彩虹光环
  ctx.save();
  const pad = size * 0.085;
  roundRect(ctx, pad, pad, size - pad * 2, size - pad * 2, size * 0.24);
  ctx.clip();
  const rainbow = ctx.createLinearGradient(0, 0, size, size);
  rainbow.addColorStop(0.00, 'rgba(255,80,120,0.55)');
  rainbow.addColorStop(0.25, 'rgba(255,220,70,0.45)');
  rainbow.addColorStop(0.50, 'rgba(90,230,130,0.45)');
  rainbow.addColorStop(0.75, 'rgba(90,160,255,0.45)');
  rainbow.addColorStop(1.00, 'rgba(200,110,255,0.55)');
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = rainbow;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  // 中心星芒
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = size * 0.16;
  ctx.beginPath();
  const R = size * 0.2, r2 = size * 0.075;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const rad = i % 2 === 0 ? R : r2;
    ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 外圈虚线，强调「可点击换色」
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = Math.max(1, size * 0.03);
  ctx.setLineDash([size * 0.1, size * 0.07]);
  roundRect(ctx, size * 0.13, size * 0.13, size * 0.74, size * 0.74, size * 0.2);
  ctx.stroke();
  ctx.restore();
}

/** 顽石：灰色岩块，带裂纹，明确表示「点不动」 */
function drawStone(ctx, size) {
  const pad = Math.max(1.5, size * 0.055);
  const w = size - pad * 2;
  const r = w * 0.2;

  ctx.save();
  roundRect(ctx, pad, pad, w, w, r);
  ctx.fillStyle = '#2b3138';
  ctx.fill();
  ctx.restore();

  const inset = pad + Math.max(1, size * 0.03);
  const iw = size - inset * 2;
  const grad = ctx.createLinearGradient(0, inset, 0, inset + iw);
  grad.addColorStop(0, '#8d97a3');
  grad.addColorStop(0.5, '#646e7b');
  grad.addColorStop(1, '#3d454f');
  ctx.save();
  roundRect(ctx, inset, inset, iw, iw, r * 0.9);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.clip();

  // 裂纹
  ctx.strokeStyle = 'rgba(25,28,33,0.65)';
  ctx.lineWidth = Math.max(1, size * 0.035);
  ctx.beginPath();
  ctx.moveTo(size * 0.3, size * 0.2);
  ctx.lineTo(size * 0.44, size * 0.47);
  ctx.lineTo(size * 0.32, size * 0.62);
  ctx.lineTo(size * 0.45, size * 0.82);
  ctx.moveTo(size * 0.44, size * 0.47);
  ctx.lineTo(size * 0.72, size * 0.4);
  ctx.moveTo(size * 0.6, size * 0.6);
  ctx.lineTo(size * 0.78, size * 0.75);
  ctx.stroke();

  // 颗粒感
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 14; i++) {
    const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const y = (Math.sin(i * 78.233) * 43758.5453) % 1;
    ctx.fillRect(
      inset + Math.abs(x) * iw,
      inset + Math.abs(y) * iw,
      size * 0.035, size * 0.035
    );
  }
  ctx.restore();

  ctx.save();
  roundRect(ctx, inset, inset, iw, iw, r * 0.9);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = Math.max(1, size * 0.02);
  ctx.stroke();
  ctx.restore();
}

/**
 * 取得（并缓存）一张方块贴图。
 * @param {number} type 颜色索引
 * @param {number} kind BLOCK_KIND
 * @param {number} size 像素边长
 * @param {boolean} colorMark 是否叠加色盲友好形状标记
 */
export function getSprite(type, kind, size, colorMark = true) {
  const px = Math.max(8, Math.round(size));
  const key = `${kind}:${type}:${px}:${colorMark ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = makeCanvas(px, px);
  const ctx = canvas.getContext('2d');
  const color = GEM_COLORS[type] || GEM_COLORS[0];

  if (kind === BLOCK_KIND.STONE) {
    drawStone(ctx, px);
  } else if (kind === BLOCK_KIND.MAGIC) {
    drawMagic(ctx, px, color);
  } else {
    drawCandy(ctx, px, color);
    if (colorMark) drawColorMark(ctx, px, type);
  }

  // 缓存满了就整体清空，避免无限增长（换分辨率时会重建）
  if (cacheSize > CACHE_LIMIT) { cache.clear(); cacheSize = 0; }
  cache.set(key, canvas);
  cacheSize++;
  return canvas;
}

/** 生成一张「选中发光」的叠加贴图 */
export function getGlow(type, size) {
  const px = Math.max(8, Math.round(size));
  const key = `glow:${type}:${px}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = makeCanvas(px, px);
  const ctx = canvas.getContext('2d');
  const color = GEM_COLORS[type] || GEM_COLORS[0];
  ctx.save();
  ctx.shadowColor = color.glow;
  ctx.shadowBlur = px * 0.3;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1.5, px * 0.06);
  roundRect(ctx, px * 0.1, px * 0.1, px * 0.8, px * 0.8, px * 0.22);
  ctx.stroke();
  ctx.restore();

  cache.set(key, canvas);
  cacheSize++;
  return canvas;
}

/** 分辨率或设置变化时清空缓存 */
export function clearSpriteCache() {
  cache.clear();
  cacheSize = 0;
}

export { roundRect, makeCanvas };
