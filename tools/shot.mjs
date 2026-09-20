/**
 * 快速截图：起服务、开到游戏里、按指定视口截几张。
 * 用法：node tools/shot.mjs [输出目录]
 */
import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || join(root, 'docs', 'screenshots');
await mkdir(out, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const f = join(root, p);
  if (!f.startsWith(root) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(await readFile(f));
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}/index.html`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
});

async function capture(name, viewport, mobile, steps) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#screenTitle:not([hidden])', { timeout: 8000 });
  if (steps) await steps(page);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log('  📸', name, errs.length ? `⚠ ${errs.length} 处报错: ${errs[0]}` : '');
  await ctx.close();
  return errs;
}

const intoGame = async (page) => {
  await page.click('#btnPlay');
  await page.waitForFunction(() => window.__duidui?.game?.phase === 'playing', null, { timeout: 12000 });
  await page.waitForTimeout(900);
};

const allErrs = [];
allErrs.push(...await capture('p1-标题', { width: 412, height: 915 }, true));
allErrs.push(...await capture('p2-游戏中', { width: 412, height: 915 }, true, intoGame));
allErrs.push(...await capture('p3-选中', { width: 412, height: 915 }, true, async (page) => {
  await intoGame(page);
  await page.evaluate(() => {
    const a = window.__duidui, b = a.game.board;
    const g = b.allGroups()[0];
    b.select(g[0]);
  });
  await page.waitForTimeout(400);
}));
allErrs.push(...await capture('l1-横屏游戏中', { width: 1180, height: 720 }, false, intoGame));
allErrs.push(...await capture('p4-窄屏', { width: 320, height: 640 }, true, intoGame));

await browser.close();
server.close();
console.log(allErrs.length ? `\n⚠ 共 ${new Set(allErrs).size} 类报错` : '\n✅ 无报错');
