/**
 * 图标生成：用预装的 Chromium 把 Canvas 画的图标截成各尺寸 PNG。
 * 生成 PWA 用的 192/512、iOS 用的 180、以及安卓自适应图标用的前景图。
 * 用法：node tools/make-icons.mjs
 */
import { launchBrowser } from './browser.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'assets', 'icons');
mkdirSync(outDir, { recursive: true });

/** 画一颗糖果方块 —— 和游戏里 sprites.js 的画法保持一致 */
const drawBlock = `
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function block(ctx, x, y, s, c) {
  roundRect(ctx, x, y, s, s, s * 0.26);
  ctx.fillStyle = c.dark; ctx.fill();
  const i = s * 0.07, iw = s - i * 2;
  const g = ctx.createLinearGradient(0, y + i, 0, y + i + iw);
  g.addColorStop(0, c.light); g.addColorStop(0.42, c.main); g.addColorStop(1, c.dark);
  roundRect(ctx, x + i, y + i, iw, iw, s * 0.22);
  ctx.fillStyle = g; ctx.fill();
  ctx.save();
  ctx.globalAlpha = 0.7; ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(x + s * 0.38, y + s * 0.3, iw * 0.24, iw * 0.13, -0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  roundRect(ctx, x + i, y + i, iw, iw, s * 0.22);
  ctx.strokeStyle = 'rgba(255,255,255,0.42)';
  ctx.lineWidth = Math.max(1, s * 0.025);
  ctx.stroke();
}
const COLORS = {
  red:    { main: '#ff4d6a', light: '#ffc2cd', dark: '#9e0f33' },
  yellow: { main: '#ffd93d', light: '#fff3b0', dark: '#9c7400' },
  green:  { main: '#5ce072', light: '#c3f7cc', dark: '#0f7c35' },
  blue:   { main: '#4d8dff', light: '#c0d6ff', dark: '#10399e' },
  purple: { main: '#c05cff', light: '#e9caff', dark: '#620f9e' }
};
`;

/**
 * @param {number} size 画布边长
 * @param {boolean} bleed 是否画满整块（安卓自适应图标前景需要留安全区）
 * @param {boolean} transparent 背景是否透明
 */
function pageHtml(size, { bleed = false, transparent = false } = {}) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:${transparent ? 'transparent' : '#0d1b2f'};}
    canvas{display:block}
  </style></head><body>
  <canvas id="c" width="${size}" height="${size}"></canvas>
  <script>
  (function () {
  ${drawBlock}
  const S = ${size};
  const ctx = document.getElementById('c').getContext('2d');

  ${transparent ? '' : `
  // 底板：深蓝紫渐变 + 金色描边
  const bg = ctx.createLinearGradient(0, 0, S, S);
  bg.addColorStop(0, '#22406b'); bg.addColorStop(0.55, '#141f3b'); bg.addColorStop(1, '#0a0f1e');
  ${bleed ? 'ctx.fillStyle = bg; ctx.fillRect(0,0,S,S);' : `
  roundRect(ctx, 0, 0, S, S, S * 0.22);
  ctx.fillStyle = bg; ctx.fill();
  roundRect(ctx, S*0.025, S*0.025, S*0.95, S*0.95, S*0.2);
  const gold = ctx.createLinearGradient(0,0,S,S);
  gold.addColorStop(0,'#f6d365'); gold.addColorStop(0.5,'#b4874a'); gold.addColorStop(1,'#f6d365');
  ctx.strokeStyle = gold; ctx.lineWidth = S * 0.035; ctx.stroke();`}

  // 背景光晕
  const glow = ctx.createRadialGradient(S*0.5, S*0.42, S*0.05, S*0.5, S*0.5, S*0.6);
  glow.addColorStop(0, 'rgba(246,211,101,0.22)');
  glow.addColorStop(1, 'rgba(246,211,101,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, S, S);
  `}

  // 四色方块：左上两块相连（正是「两个起消」的规则），右下一块单独
  const pad = S * ${bleed ? 0.3 : 0.2};
  const gap = S * 0.035;
  const s = (S - pad * 2 - gap) / 2;
  block(ctx, pad,             pad,             s, COLORS.red);
  block(ctx, pad + s + gap,   pad,             s, COLORS.red);
  block(ctx, pad,             pad + s + gap,   s, COLORS.green);
  block(ctx, pad + s + gap,   pad + s + gap,   s, COLORS.blue);

  // 左上两块之间画一道连接光，强调「相连才能消」
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = S * 0.018;
  ctx.shadowColor = '#fff'; ctx.shadowBlur = S * 0.05;
  roundRect(ctx, pad - gap*0.4, pad - gap*0.4, s*2 + gap + gap*0.8, s + gap*0.8, s*0.3);
  ctx.stroke();
  ctx.restore();
  })();
  <\/script></body></html>`;
}

const browser = await launchBrowser({ headless: !process.argv.includes('--headed') });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('  页面脚本出错：', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('  控制台：', m.text()); });

const targets = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-180.png', size: 180 },
  { file: 'icon-144.png', size: 144 },
  { file: 'icon-96.png',  size: 96 },
  { file: 'icon-48.png',  size: 48 },
  // 安卓自适应图标：前景层需要满幅绘制并留出安全区
  { file: 'icon-fg-432.png', size: 432, opts: { bleed: true, transparent: true } },
  { file: 'icon-maskable-512.png', size: 512, opts: { bleed: true } }
];

for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(pageHtml(t.size, t.opts || {}));
  await page.waitForTimeout(80);
  // 自检：确认画布上真的画了东西，避免生成一张纯色图
  const ink = await page.evaluate(() => {
    const c = document.getElementById('c');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4 * 97) seen.add(`${d[i]},${d[i+1]},${d[i+2]},${d[i+3]}`);
    return seen.size;
  });
  if (ink < 8) throw new Error(`${t.file} 画布内容为空（仅 ${ink} 种颜色）`);
  const buf = await page.locator('#c').screenshot({ omitBackground: !!(t.opts && t.opts.transparent) });
  writeFileSync(join(outDir, t.file), buf);
  console.log('  ✓', t.file, `${t.size}×${t.size}`, `${(buf.length / 1024).toFixed(1)} KB`);
}

await browser.close();
console.log('\n图标生成完成 →', outDir);
