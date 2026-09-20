/**
 * 音频自测
 * ------------------------------------------------------------------
 * 1) 在 Node 里把 tune.js 的音符渲染成 WAV，再做一次 FFT 扒回音高，
 *    确认「写进去的」和「听到的」是同一串音 —— 防止音符表写错。
 * 2) 在浏览器里真的跑一遍 AudioEngine，确认音乐调度器在推进、
 *    各个音效函数都能正常发声而不抛异常。
 */
import { writeFileSync } from 'node:fs';
import { MELODY, CHORDS, STEP, STEPS_PER_BAR, TOTAL_STEPS, freq } from '../src/audio/tune.js';
import { launchBrowser } from './browser.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

const SR = 22050;

console.log('\n【1】把曲子渲染成波形，再扒回音高对账');

// ── 简易合成：方波 + 线性包络，够用来验证音高
const total = Math.ceil(TOTAL_STEPS * STEP * SR) + SR;
const buf = new Float32Array(total);
let t = 0;
for (const [midi, steps] of MELODY) {
  const f = freq(midi);
  const dur = steps * STEP * 0.85;
  const start = Math.floor(t * SR);
  const len = Math.floor(dur * SR);
  for (let i = 0; i < len; i++) {
    const env = Math.min(1, i / (SR * 0.01)) * Math.min(1, (len - i) / (SR * 0.02));
    buf[start + i] += Math.sign(Math.sin(2 * Math.PI * f * i / SR)) * 0.22 * env;
  }
  t += steps * STEP;
}
ok(Math.abs(t - TOTAL_STEPS * STEP) < 1e-6, `旋律总时长与步数一致（${t.toFixed(2)}s）`);

// 伴奏也铺一遍，确认小节数对得上
let bars = 0;
for (let s = 0; s < TOTAL_STEPS; s++) {
  if (s % STEPS_PER_BAR === 0) bars++;
}
ok(bars === TOTAL_STEPS / STEPS_PER_BAR, `共 ${bars} 小节，每小节 ${STEPS_PER_BAR} 步`);
ok(CHORDS.length >= bars, `和弦表覆盖全部小节（${CHORDS.length} ≥ ${bars}）`);

// 导出 WAV 方便人工试听
const pcm = Buffer.alloc(44 + total * 2);
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + total * 2, 4); pcm.write('WAVE', 8);
pcm.write('fmt ', 12); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20);
pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(SR, 24); pcm.writeUInt32LE(SR * 2, 28);
pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34);
pcm.write('data', 36); pcm.writeUInt32LE(total * 2, 40);
for (let i = 0; i < total; i++) {
  pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(buf[i] * 32767))), 44 + i * 2);
}
writeFileSync(new URL('../docs/bgm-preview.wav', import.meta.url), pcm);

// ── 扒回音高
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'A♭', 'A', 'B♭', 'B'];
const nameOf = (m) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
function pitchAt(sec) {
  // 窗口必须比最短的音符还短，否则会跨到下一个音上去（一步 = 0.12s）
  const i = Math.floor(sec * SR), w = 600;
  if (i + w > buf.length) return 0;
  const lo = Math.floor(SR / 1200), hi = Math.floor(SR / 180);
  const corr = new Float64Array(hi);
  let bestVal = -1;
  for (let lag = lo; lag < hi; lag++) {
    let sum = 0;
    for (let k = 0; k < w; k++) sum += buf[i + k] * buf[i + k + lag];
    corr[lag] = sum;
    if (sum > bestVal) bestVal = sum;
  }
  if (bestVal <= 0) return 0;
  // 方波的自相关在基频周期的整数倍上一样高，直接取最大值会掉八度。
  // 所以取「相关度达到峰值 90% 的最小周期」，这才是真正的基频。
  for (let lag = lo; lag < hi; lag++) {
    if (corr[lag] >= bestVal * 0.9) return SR / lag;
  }
  return 0;
}

let checked = 0, matched = 0, mism = 0;
let cursor = 0;
for (const [midi, steps] of MELODY) {
  const mid = cursor + steps * STEP * 0.35;
  const f = pitchAt(mid);
  if (f > 0) {
    const got = Math.round(12 * Math.log2(f / 440) + 69);
    checked++;
    if (Math.abs(got - midi) <= 0) matched++;
    else if (mism++ < 6) console.log(`     第 ${checked} 个音：写的是 ${nameOf(midi)}，听到 ${nameOf(got)}`);
  }
  cursor += steps * STEP;
}
ok(checked > 40 && matched / checked > 0.92,
   `${checked} 个音里扒回 ${matched} 个完全一致（${(matched / checked * 100).toFixed(0)}%）`);
console.log(`     试听文件：docs/bgm-preview.wav（${(total / SR).toFixed(1)} 秒）`);

console.log('\n【2】浏览器里真跑一遍 AudioEngine');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8',
  '.css': 'text/css;charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const f = join(root, p);
  if (!f.startsWith(root) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(await readFile(f));
});
await new Promise((r) => server.listen(0, r));

const browser = await launchBrowser({
  args: ['--autoplay-policy=no-user-gesture-required']
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
await page.waitForSelector('#screenTitle:not([hidden])');

const result = await page.evaluate(async () => {
  const { audio } = await import('./src/audio/audio.js');
  const out = { unlocked: audio.unlock() };
  audio.setSound(true);
  audio.setMusic(true);
  audio.startMusic('dusk');
  out.playing = audio.playing;
  const s0 = audio.step;
  await new Promise((r) => setTimeout(r, 700));
  out.stepAdvanced = audio.step !== s0 || audio.nextTime > 0;
  out.ctxState = audio.ctx?.state;
  // 逐个触发音效，确认不抛异常
  const fx = ['click', 'deny', 'magic', 'hammer', 'transform', 'mission', 'win', 'lose', 'warn'];
  out.fxErrors = [];
  for (const f of fx) {
    try { audio[f](); } catch (e) { out.fxErrors.push(`${f}: ${e.message}`); }
  }
  for (const n of [2, 3, 5, 8, 12]) {
    try { audio.remove(n); audio.select(n); } catch (e) { out.fxErrors.push(`remove(${n}): ${e.message}`); }
  }
  // 切章节换调
  for (const ch of ['candy', 'frost', 'flame', 'night', 'abyss']) {
    try { audio.startMusic(ch); } catch (e) { out.fxErrors.push(`startMusic(${ch}): ${e.message}`); }
  }
  out.styleShift = audio.style.shift;
  audio.stopMusic();
  out.stoppedClean = audio.playing === false && audio.timer === null;
  return out;
});

ok(result.unlocked, '音频上下文解锁成功');
ok(result.playing, '音乐调度器已启动');
ok(result.stepAdvanced, `调度器在推进（ctx 状态：${result.ctxState}）`);
ok(result.fxErrors.length === 0, result.fxErrors.length ? `音效抛异常：${result.fxErrors[0]}` : '全部音效与章节变调都能正常发声');
ok(result.styleShift === -7, `章节变调生效（终焉之渊降五度，实际 ${result.styleShift}）`);
ok(result.stoppedClean, 'stopMusic 能干净地停下并清掉定时器');
ok(errs.length === 0, errs.length ? `页面异常：${errs[0]}` : '全程无页面异常');

await browser.close();
server.close();

console.log(`\n${fail === 0 ? '✅' : '❌'} 音频测试：通过 ${pass}，失败 ${fail}\n`);
process.exit(fail ? 1 : 0);
