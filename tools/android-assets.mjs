/**
 * 生成安卓工程需要的图标与启动页
 * ------------------------------------------------------------------
 * 用预装的 Chromium 渲染，中文字体直接可用。
 * 覆盖 android/app/src/main/res/ 下 Capacitor 自带的占位图。
 * 用法：node tools/android-assets.mjs
 */
import { launchBrowser } from './browser.mjs';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RES = join(root, 'android', 'app', 'src', 'main', 'res');
if (!existsSync(RES)) {
  console.error('找不到 android/app/src/main/res，请先运行 npx cap add android');
  process.exit(1);
}

const browser = await launchBrowser({ headless: !process.argv.includes('--headed') });
const page = await browser.newPage();

async function render(html, w, h, transparent = false) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(html);
  await page.waitForTimeout(40);
  return page.screenshot({ omitBackground: transparent });
}

function save(dir, name, buf) {
  const d = join(RES, dir);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, name), buf);
}

/** 圆角方块画法，与游戏内的贴图保持同一套观感 */
const BLOCK_JS = `
function rr(x,a,b,c,d,r){x.beginPath();x.moveTo(a+r,b);x.arcTo(a+c,b,a+c,b+d,r);x.arcTo(a+c,b+d,a,b+d,r);x.arcTo(a,b+d,a,b,r);x.arcTo(a,b,a+c,b,r);x.closePath();}
function blk(x,px,py,s,c){
  rr(x,px,py,s,s,s*0.26); x.fillStyle=c[2]; x.fill();
  const i=s*0.07, iw=s-i*2;
  const g=x.createLinearGradient(0,py+i,0,py+i+iw);
  g.addColorStop(0,c[1]); g.addColorStop(0.42,c[0]); g.addColorStop(1,c[2]);
  rr(x,px+i,py+i,iw,iw,s*0.22); x.fillStyle=g; x.fill();
  x.save(); x.globalAlpha=0.7; x.fillStyle='#fff';
  x.beginPath(); x.ellipse(px+s*0.38,py+s*0.3,iw*0.24,iw*0.13,-0.38,0,Math.PI*2); x.fill(); x.restore();
  rr(x,px+i,py+i,iw,iw,s*0.22);
  x.strokeStyle='rgba(255,255,255,0.42)'; x.lineWidth=Math.max(1,s*0.025); x.stroke();
}
const C={red:['#ff4d6a','#ffc2cd','#9e0f33'],green:['#5ce072','#c3f7cc','#0f7c35'],
         blue:['#4d8dff','#c0d6ff','#10399e'],gold:['#f6d365','#fff3c4','#8a5f2e']};
`;

const iconHtml = (S, { bleed = false, transparent = false } = {}) => `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:${transparent ? 'transparent' : '#0d1b2f'}}canvas{display:block}</style></head><body>
<canvas id="c" width="${S}" height="${S}"></canvas><script>(function(){
${BLOCK_JS}
const x=document.getElementById('c').getContext('2d'), S=${S};
${transparent ? '' : `
const bg=x.createLinearGradient(0,0,S,S);
bg.addColorStop(0,'#22406b'); bg.addColorStop(0.55,'#141f3b'); bg.addColorStop(1,'#0a0f1e');
${bleed ? "x.fillStyle=bg; x.fillRect(0,0,S,S);" : `
rr(x,0,0,S,S,S*0.22); x.fillStyle=bg; x.fill();
rr(x,S*0.025,S*0.025,S*0.95,S*0.95,S*0.2);
const go=x.createLinearGradient(0,0,S,S);
go.addColorStop(0,'#f6d365'); go.addColorStop(0.5,'#b4874a'); go.addColorStop(1,'#f6d365');
x.strokeStyle=go; x.lineWidth=S*0.035; x.stroke();`}
const gl=x.createRadialGradient(S*0.5,S*0.42,S*0.05,S*0.5,S*0.5,S*0.6);
gl.addColorStop(0,'rgba(246,211,101,0.22)'); gl.addColorStop(1,'rgba(246,211,101,0)');
x.fillStyle=gl; x.fillRect(0,0,S,S);`}
const pad=S*${bleed ? 0.3 : 0.2}, gap=S*0.035, s=(S-pad*2-gap)/2;
blk(x,pad,pad,s,C.red); blk(x,pad+s+gap,pad,s,C.red);
blk(x,pad,pad+s+gap,s,C.green); blk(x,pad+s+gap,pad+s+gap,s,C.blue);
x.save(); x.strokeStyle='rgba(255,255,255,0.92)'; x.lineWidth=S*0.018;
x.shadowColor='#fff'; x.shadowBlur=S*0.05;
rr(x,pad-gap*0.4,pad-gap*0.4,s*2+gap+gap*0.8,s+gap*0.8,s*0.3); x.stroke(); x.restore();
})();<\/script></body></html>`;

const splashHtml = (w, h) => `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;
  background:radial-gradient(120% 80% at 50% 26%,#22406b 0%,#0d1b2f 55%,#05070d 100%);
  display:flex;align-items:center;justify-content:center;flex-direction:column;gap:${Math.round(Math.min(w,h)*0.04)}px;
  font-family:"PingFang SC","Noto Sans SC","Microsoft YaHei",system-ui,sans-serif;}
.t{font-size:${Math.round(Math.min(w, h) * 0.17)}px;font-weight:900;letter-spacing:.1em;
  background:linear-gradient(180deg,#fffbe8 0%,#f6d365 42%,#b06c1e 100%);
  -webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 4px 14px rgba(246,211,101,.4));}
.s{font-size:${Math.round(Math.min(w, h) * 0.035)}px;color:#a8b3c5;letter-spacing:.2em;}
</style></head><body><div class="t">对对碰</div><div class="s">相连同色方块，两个起消</div></body></html>`;

// ── 启动器图标
const ICONS = [
  ['mipmap-mdpi', 48], ['mipmap-hdpi', 72], ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144], ['mipmap-xxxhdpi', 192]
];
for (const [dir, size] of ICONS) {
  const normal = await render(iconHtml(size), size, size);
  save(dir, 'ic_launcher.png', normal);
  save(dir, 'ic_launcher_round.png', normal);
  // 自适应图标的前景层：满幅绘制、透明底，系统会自己裁形状
  const fg = Math.round(size * 2.25);
  save(dir, 'ic_launcher_foreground.png', await render(iconHtml(fg, { bleed: true, transparent: true }), fg, fg, true));
  console.log('  ✓', dir, `${size}×${size}`);
}

// ── 启动页
const SPLASH = [
  ['mdpi', 320, 480], ['hdpi', 480, 800], ['xhdpi', 720, 1280],
  ['xxhdpi', 960, 1600], ['xxxhdpi', 1280, 1920]
];
for (const [d, w, h] of SPLASH) {
  save(`drawable-port-${d}`, 'splash.png', await render(splashHtml(w, h), w, h));
  save(`drawable-land-${d}`, 'splash.png', await render(splashHtml(h, w), h, w));
  console.log('  ✓ splash', d, `${w}×${h}`);
}
save('drawable', 'splash.png', await render(splashHtml(480, 800), 480, 800));

await browser.close();
console.log('\n安卓图标与启动页已全部替换');
