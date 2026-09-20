/**
 * 方块贴图生成器
 * ------------------------------------------------------------------
 * 全部用 Canvas 程序化绘制并缓存成离屏画布，游戏不依赖任何图片文件。
 * 换句话说：整个包里没有一张 png，加载秒开，任意分辨率都清晰。
 */

import { GEM_COLORS, BLOCK_KIND } from '../core/config.js';
import { getImage } from './assets.js';

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
 * 方块中央的动物脸。
 * 原版每种颜色画的是一只不同的小动物（猫、虎、蛙、熊、兔、狗、猪），
 * 靠脸型而不是只靠颜色区分，色弱玩家也能玩。
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} s 方块边长
 * @param {number} index 颜色索引，决定画哪只动物
 * @param {object} color 该颜色的配色表
 */
function drawAnimalFace(ctx, s, index, color) {
  const cx = s / 2;
  const cy = s * 0.54;
  const R = s * 0.27;              // 脸的半径
  const dark = color.dark;
  const face = color.light;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const ear = (x, y, w, h, rot = 0, fill = dark) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  const triEar = (x, y, w, h, flip = 1) => {
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(x, y - h);
    ctx.lineTo(x + w * flip, y + h * 0.5);
    ctx.lineTo(x - w * flip * 0.6, y + h * 0.5);
    ctx.closePath();
    ctx.fill();
  };

  // ── 耳朵（画在脸之前，让脸压住根部）
  switch (index % 7) {
    case 0:   // 猫：尖耳
      triEar(cx - R * 0.72, cy - R * 0.72, R * 0.42, R * 0.52, 1);
      triEar(cx + R * 0.72, cy - R * 0.72, R * 0.42, R * 0.52, -1);
      break;
    case 1:   // 虎：圆耳 + 额头条纹
      ear(cx - R * 0.82, cy - R * 0.7, R * 0.34, R * 0.34);
      ear(cx + R * 0.82, cy - R * 0.7, R * 0.34, R * 0.34);
      break;
    case 2:   // 蛙：眼睛顶在头上
      ear(cx - R * 0.6, cy - R * 0.82, R * 0.36, R * 0.34, 0, face);
      ear(cx + R * 0.6, cy - R * 0.82, R * 0.36, R * 0.34, 0, face);
      break;
    case 3:   // 熊：大圆耳
      ear(cx - R * 0.86, cy - R * 0.62, R * 0.4, R * 0.4);
      ear(cx + R * 0.86, cy - R * 0.62, R * 0.4, R * 0.4);
      break;
    case 4:   // 兔：长耳
      ear(cx - R * 0.42, cy - R * 1.15, R * 0.2, R * 0.6, -0.2);
      ear(cx + R * 0.42, cy - R * 1.15, R * 0.2, R * 0.6, 0.2);
      break;
    case 5:   // 狗：耷拉到脸颊两侧的垂耳
      ear(cx - R * 0.96, cy + R * 0.02, R * 0.25, R * 0.55, -0.22);
      ear(cx + R * 0.96, cy + R * 0.02, R * 0.25, R * 0.55, 0.22);
      break;
    default:  // 猪：外撇的三角耳
      triEar(cx - R * 0.78, cy - R * 0.74, R * 0.36, R * 0.44, 1);
      triEar(cx + R * 0.78, cy - R * 0.74, R * 0.36, R * 0.44, -1);
  }

  // ── 脸
  ctx.fillStyle = dark;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  if (index % 7 === 2) {
    ctx.ellipse(cx, cy + R * 0.06, R * 1.05, R * 0.9, 0, 0, Math.PI * 2);   // 蛙脸偏扁
  } else {
    ctx.ellipse(cx, cy, R, R * 0.94, 0, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.globalAlpha = 1;

  // 虎额头的三道条纹
  if (index % 7 === 1) {
    ctx.strokeStyle = color.light;
    ctx.lineWidth = Math.max(1, s * 0.026);
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.moveTo(cx - R * 0.3, cy - R * 0.74); ctx.lineTo(cx - R * 0.34, cy - R * 0.46);
    ctx.moveTo(cx, cy - R * 0.8);            ctx.lineTo(cx, cy - R * 0.5);
    ctx.moveTo(cx + R * 0.3, cy - R * 0.74); ctx.lineTo(cx + R * 0.34, cy - R * 0.46);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ── 眼睛
  const eyeY = cy - R * 0.14;
  const eyeDX = R * 0.42;
  const eyeR = R * 0.27;
  const eye = (ex) => {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeR, eyeR * 1.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#231a12';
    ctx.beginPath();
    ctx.ellipse(ex + eyeR * 0.1, eyeY + eyeR * 0.1, eyeR * 0.5, eyeR * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ex + eyeR * 0.3, eyeY - eyeR * 0.3, eyeR * 0.22, 0, Math.PI * 2);
    ctx.fill();
  };
  if (index % 7 === 2) {
    // 蛙的眼睛在头顶那两个鼓包里
    const by = cy - R * 0.82;
    [cx - R * 0.6, cx + R * 0.6].forEach((ex) => {
      ctx.fillStyle = '#231a12';
      ctx.beginPath();
      ctx.arc(ex, by, R * 0.17, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(ex + R * 0.06, by - R * 0.06, R * 0.07, 0, Math.PI * 2);
      ctx.fill();
    });
  } else {
    eye(cx - eyeDX);
    eye(cx + eyeDX);
  }

  // ── 鼻子与嘴
  ctx.strokeStyle = face;
  ctx.fillStyle = face;
  ctx.lineWidth = Math.max(1, s * 0.022);
  const my = cy + R * 0.42;
  switch (index % 7) {
    case 0:   // 猫：小三角鼻 + 胡须
      ctx.beginPath();
      ctx.moveTo(cx - R * 0.13, my - R * 0.16);
      ctx.lineTo(cx + R * 0.13, my - R * 0.16);
      ctx.lineTo(cx, my + R * 0.02);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - R * 0.85, my - R * 0.1); ctx.lineTo(cx - R * 0.3, my);
      ctx.moveTo(cx + R * 0.85, my - R * 0.1); ctx.lineTo(cx + R * 0.3, my);
      ctx.stroke();
      break;
    case 2:   // 蛙：大咧嘴
      ctx.beginPath();
      ctx.arc(cx, my - R * 0.42, R * 0.62, 0.18 * Math.PI, 0.82 * Math.PI);
      ctx.stroke();
      break;
    case 6:   // 猪：圆鼻拱
      ctx.beginPath();
      ctx.ellipse(cx, my, R * 0.34, R * 0.25, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.ellipse(cx - R * 0.13, my, R * 0.07, R * 0.1, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + R * 0.13, my, R * 0.07, R * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:  // 其余：小鼻子 + 微笑
      ctx.beginPath();
      ctx.ellipse(cx, my - R * 0.1, R * 0.15, R * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx, my + R * 0.02);
      ctx.quadraticCurveTo(cx - R * 0.26, my + R * 0.3, cx - R * 0.4, my + R * 0.1);
      ctx.moveTo(cx, my + R * 0.02);
      ctx.quadraticCurveTo(cx + R * 0.26, my + R * 0.3, cx + R * 0.4, my + R * 0.1);
      ctx.stroke();
  }

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
  // 优先用从原版录屏里抠出来的贴图；它本身就是位图，直接交给 drawImage 缩放即可
  if (colorMark) {
    if (kind === BLOCK_KIND.MAGIC) {
      const img = getImage('magic');
      if (img) return img;
    } else if (kind !== BLOCK_KIND.STONE) {
      const img = getImage(`block:${type}`);
      if (img) return img;
    }
  }

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
    if (colorMark) drawAnimalFace(ctx, px, type, color);
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
