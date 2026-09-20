/**
 * 浏览器端烟囱测试
 * ------------------------------------------------------------------
 * 用 Chromium 真跑一遍：启动 → 开始游戏 → 点击消除 → 用道具 →
 * 打开各个弹层 → 切横屏。全程监控控制台报错，并截图存档。
 *
 * 用法：node tools/smoke.mjs [--headed]
 */
import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shotDir = join(root, 'docs', 'screenshots');
await mkdir(shotDir, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

// 一个最小静态服务器：Service Worker 需要 http(s)，file:// 跑不起来
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const file = join(root, p);
    if (!file.startsWith(root) || !existsSync(file)) {
      res.writeHead(404); res.end('not found'); return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    res.writeHead(500); res.end(String(err));
  }
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}/index.html`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: !process.argv.includes('--headed')
});

const errors = [];
const logs = [];
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  isMobile: true, hasTouch: true,
  deviceScaleFactor: 1,     // 截图只为看版式，1 倍足够，3 倍会把整轮测试拖慢好几倍
  locale: 'zh-CN'
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`页面异常：${e.message}`));
page.on('console', (m) => {
  const t = m.text();
  logs.push(`[${m.type()}] ${t}`);
  if (m.type() === 'error' && !/favicon|Service Worker|sw\.js/i.test(t)) errors.push(`控制台错误：${t}`);
});

const shot = async (name) => {
  await page.screenshot({ path: join(shotDir, `${name}.png`) });
  console.log('     📸', `docs/screenshots/${name}.png`);
};

console.log(`\n访问 ${BASE}\n`);
console.log('【1】启动');
const t0 = Date.now();
const lap = (name) => console.log(`     ⏱ ${name} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('#screenTitle:not([hidden])', { timeout: 8000 });
ok(true, '标题页出现');
ok(await page.locator('.game-title').textContent() === '对对碰', '标题文字为「对对碰」');
await shot('01-标题页'); lap('启动');

console.log('\n【2】玩法说明');
await page.click('#btnHowTo');
await page.waitForSelector('#screenHelp:not([hidden])');
const helpText = await page.locator('#screenHelp').textContent();
ok(/两个以上/.test(helpText), '说明里写了「两个以上」的消除门槛');
ok(/上方的方块掉下来/.test(helpText) && /整体向左合拢/.test(helpText), '说明里写了重力填补与空列合拢规则');
ok(/魔术方块/.test(helpText) && /顽石/.test(helpText), '说明里介绍了特殊方块');
ok((await page.locator('#helpScoreTable tr').count()) > 5, '分值表已按当前公式生成');
await shot('02-玩法说明'); lap('说明');
await page.click('#btnHelpClose');

console.log('\n【3】开始游戏');
await page.click('#btnPlay');
await page.waitForSelector('#screenIntro:not([hidden])', { timeout: 5000 });
ok(true, '关卡开场动画出现');
const introTarget = await page.locator('#introTarget').textContent();
ok(introTarget === '1,000', `第 1 关目标分为 1,000（与原版录屏一致，实际 ${introTarget}）`);
await shot('03-关卡开场');

await page.waitForSelector('#screenIntro', { state: 'hidden', timeout: 6000 });
await page.waitForFunction(() => window.__duidui?.game?.phase === 'playing', null, { timeout: 8000 });
ok(true, '开场结束后进入游戏');
await shot('04-棋盘'); lap('进入游戏');

const boardInfo = await page.evaluate(() => {
  const b = window.__duidui.game.board;
  return { cols: b.cols, rows: b.rows, remaining: b.remaining, groups: b.allGroups().length };
});
ok(boardInfo.remaining === boardInfo.cols * boardInfo.rows, `棋盘铺满 ${boardInfo.cols}×${boardInfo.rows} = ${boardInfo.remaining} 块`);
ok(boardInfo.groups > 0, `开局有 ${boardInfo.groups} 组可消方块`);

console.log('\n【4】点击消除（二次确认）');
/** 把某个格子的索引换算成屏幕坐标并点击 */
const tapIndex = async (idx) => {
  const pos = await page.evaluate((i) => {
    const app = window.__duidui;
    const b = app.game.board, r = app.renderer;
    const rect = app.canvas.getBoundingClientRect();
    const c = r.cellCenter(b.colOf(i), b.rowOf(i));
    return { x: rect.left + c.x, y: rect.top + c.y };
  }, idx);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(60);
};

const firstGroup = await page.evaluate(() => window.__duidui.game.board.allGroups()[0]);
await tapIndex(firstGroup[0]);
const selSize = await page.evaluate(() => window.__duidui.game.board.selection?.size || 0);
ok(selSize >= 2, `第一次点击只是选中高亮（${selSize} 个）`);
await shot('05-选中高亮');

const before = await page.evaluate(() => window.__duidui.game.board.remaining);
await tapIndex(firstGroup[0]);
await page.waitForTimeout(700);
const after = await page.evaluate(() => window.__duidui.game.board.remaining);
ok(after === before - selSize, `第二次点击真的消除了（${before} → ${after}）`);
const score = await page.evaluate(() => window.__duidui.game.score);
ok(score > 0, `得到了分数：${score}`);
await shot('06-消除后'); lap('消除');

console.log('\n【5】填补规则：上方落下、空列左移');
const collapseCheck = await page.evaluate(() => {
  const b = window.__duidui.game.board;
  let holes = 0, strayCol = 0;
  for (let c = 0; c < b.cols; c++) {
    let seenEmpty = false;
    for (let r = b.rows - 1; r >= 0; r--) {
      if (!b.get(c, r)) seenEmpty = true; else if (seenEmpty) holes++;
    }
  }
  let sawEmptyCol = false;
  for (let c = 0; c < b.cols; c++) {
    let empty = true;
    for (let r = 0; r < b.rows; r++) if (b.get(c, r)) { empty = false; break; }
    if (empty) sawEmptyCol = true; else if (sawEmptyCol) strayCol++;
  }
  return { holes, strayCol, cols: b.cols };
});
ok(collapseCheck.holes === 0, `每一列都严格底对齐，没有悬空方块（检查了 ${collapseCheck.cols} 列）`);
ok(collapseCheck.strayCol === 0, '空列全部合拢到了右侧');

console.log('\n【6】孤立方块点不掉');
const lone = await page.evaluate(() => {
  const b = window.__duidui.game.board;
  for (let i = 0; i < b.grid.length; i++) {
    const blk = b.grid[i];
    if (blk && blk.isNormal && b.findGroup(i).length === 1) return i;
  }
  return -1;
});
if (lone >= 0) {
  const r0 = await page.evaluate(() => window.__duidui.game.board.remaining);
  await tapIndex(lone);
  await page.waitForTimeout(300);
  const r1 = await page.evaluate(() => window.__duidui.game.board.remaining);
  ok(r0 === r1, '点孤立方块没有任何方块被消除');
} else {
  ok(true, '（当前棋盘没有孤立方块，跳过）');
}

console.log('\n【7】道具');
await page.click('#itemHammer');
ok(await page.locator('#itemHammer.armed').count() === 1, '删除道具激活后按钮高亮');
await shot('07-榔头已激活');
const beforeHammer = await page.evaluate(() => window.__duidui.game.board.remaining);
const target = await page.evaluate(() => {
  const b = window.__duidui.game.board;
  return b.grid.findIndex((x) => x);
});
await tapIndex(target);
await page.waitForTimeout(700);
const afterHammer = await page.evaluate(() => window.__duidui.game.board.remaining);
ok(afterHammer === beforeHammer - 1, `删除道具清掉了一个方块（${beforeHammer} → ${afterHammer}）`);
ok(await page.locator('#countHammer').textContent() === '2', '删除道具数量从 3 减到 2');

await page.click('#itemHint');
await page.waitForTimeout(200);
const hinted = await page.evaluate(() => (window.__duidui.game.board.hint || []).length);
ok(hinted >= 2, `提示指出了一组 ${hinted} 个方块`);
await shot('08-提示'); lap('道具');

console.log('\n【8】暂停与设置');
await page.click('#btnPause');
await page.waitForSelector('#screenPause:not([hidden])');
ok(await page.evaluate(() => window.__duidui.game.phase) === 'paused', '游戏已暂停');
await shot('09-暂停');
await page.click('#btnPauseSettings');
await page.waitForSelector('#screenSettings:not([hidden])');
ok(await page.locator('#setBoard option').count() === 3, '设置里有三种棋盘尺寸');
await shot('10-设置');
await page.click('#btnSettingsClose');
await page.waitForSelector('#screenPause:not([hidden])');
await page.click('#btnResume');
ok(await page.evaluate(() => window.__duidui.game.phase) === 'playing', '继续游戏恢复正常');

console.log('\n【9】关卡选择');
await page.click('#btnPause');
await page.click('#btnQuit');
await page.waitForSelector('#screenTitle:not([hidden])');
await page.click('#btnStageSelect');
await page.waitForSelector('#screenStages:not([hidden])');
ok(await page.locator('.stage-cell').count() > 5, '关卡列表已生成');
ok(await page.locator('.chapter-tab').count() === 6, '六个章节标签');
ok(await page.locator('#colorCounter .cc-item').count() >= 5, '棋盘顶部有各色剩余数量计数条');
await shot('11-关卡选择'); lap('关卡选择');
await page.click('#btnStagesBack');

console.log('\n【10】一路打到本局结束');
await page.click('#btnPlay');
await page.waitForFunction(() => window.__duidui?.game?.phase === 'playing', null, { timeout: 10000 });
await page.evaluate(() => { window.__duidui.settings.confirmTap = false; });  // 加速：改成单击即消
const runResult = await page.evaluate(async () => {
  const app = window.__duidui;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let steps = 0;
  while (steps < 400) {
    const g = app.game;
    if (g.phase !== 'playing') break;
    if (g.board.state !== 'idle') { await sleep(8); continue; }
    const groups = g.board.allGroups();
    if (!groups.length) break;
    g.tapCell(groups[0][0]);
    steps++;
    await sleep(8);
  }
  return { steps, phase: app.game.phase, score: app.game.score, remaining: app.game.board.remaining };
});
ok(runResult.steps > 10, `自动打了 ${runResult.steps} 步`);
ok(runResult.score > 0, `拿到 ${runResult.score} 分`);
// 无路可走时会先弹救场提示
await page.waitForTimeout(600);
const rescueOpen = await page.locator('#screenRescue:not([hidden])').count();
if (rescueOpen) {
  ok(true, '无路可走时弹出了道具救场提示');
  await shot('12-救场提示');
  await page.click('#rescueActions .btn-danger');
}
await page.waitForSelector('#screenResult:not([hidden])', { timeout: 6000 });
ok(true, '结算界面出现');
const resultScore = await page.locator('#resultScore').textContent();
ok(/[\d,]+/.test(resultScore), `结算分数：${resultScore}`);
await shot('13-结算'); lap('整局');

console.log('\n【11】横屏三栏布局');
await page.setViewportSize({ width: 900, height: 480 });
await page.waitForTimeout(400);
const landscape = await page.evaluate(() => {
  const extra = getComputedStyle(document.querySelector('.side-extra')).display;
  const strip = getComputedStyle(document.querySelector('.chat-strip')).display;
  const cols = getComputedStyle(document.querySelector('.app')).gridTemplateColumns.split(' ').length;
  return { extra, strip, cols };
});
ok(landscape.extra !== 'none', '横屏下右栏的统计与聊天显示出来');
ok(landscape.strip === 'none', '横屏下底部对话条隐藏');
ok(landscape.cols === 2, `横屏为「棋盘 + 信息栏」两栏（实际 ${landscape.cols} 栏）`);
await page.locator('#screenResult .btn').first().click();
await page.waitForTimeout(1600);
await shot('14-横屏布局');

console.log('\n【12】超窄屏');
await page.setViewportSize({ width: 320, height: 568 });
await page.waitForTimeout(500);
const overflow = await page.evaluate(() => ({
  bodyScroll: document.body.scrollWidth > window.innerWidth + 1,
  canvasW: document.getElementById('board').getBoundingClientRect().width
}));
ok(!overflow.bodyScroll, '320px 宽度下没有横向溢出');
ok(overflow.canvasW > 200, `棋盘仍有 ${Math.round(overflow.canvasW)}px 可用宽度`);
await shot('15-超窄屏'); lap('自适应');

console.log('\n【13】离线缓存');
await page.setViewportSize({ width: 412, height: 915 });
// serviceWorker.ready 在没装上时会一直挂着，必须自己加超时
const swReady = await page.evaluate(() => {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  return Promise.race([
    navigator.serviceWorker.getRegistration().then((r) => (r ? 'registered' : 'none')),
    new Promise((r) => setTimeout(() => r('timeout'), 3000))
  ]);
});
ok(swReady === 'registered' || swReady === 'unsupported',
   `Service Worker 状态：${swReady}`);
lap('离线缓存');

await ctx.close();
await browser.close();
server.close();

console.log('\n' + '─'.repeat(60));
if (errors.length) {
  console.log('❌ 捕获到运行时报错：');
  for (const e of [...new Set(errors)]) console.log('   ', e);
  fail += errors.length;
} else {
  console.log('✅ 全程无控制台报错');
}
console.log(`${fail === 0 ? '✅' : '❌'} 浏览器测试：通过 ${pass}，失败 ${fail}\n`);
process.exit(fail ? 1 : 0);
