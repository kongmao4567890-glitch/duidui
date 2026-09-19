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
  ...devices['Pixel 7'],
  locale: 'zh-CN',
  reducedMotion: 'no-preference'
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
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('#screenTitle:not([hidden])', { timeout: 8000 });
ok(true, '标题页出现');
ok(await page.locator('.game-title').textContent() === '对对碰', '标题文字为「对对碰」');
await page.waitForTimeout(500);
await shot('01-标题页');

console.log('\n【2】玩法说明');
await page.click('#btnHowTo');
await page.waitForSelector('#screenHelp:not([hidden])');
const helpText = await page.locator('#screenHelp').textContent();
ok(/两个以上/.test(helpText), '说明里写了「两个以上」的消除门槛');
ok(/向中间靠拢/.test(helpText), '说明里写了「向中间靠拢」的填补规则');
ok(/魔术方块/.test(helpText) && /顽石/.test(helpText), '说明里介绍了特殊方块');
ok((await page.locator('#helpScoreTable tr').count()) > 5, '分值表已按当前公式生成');
await shot('02-玩法说明');
await page.click('#btnHelpClose');

console.log('\n【3】开始游戏');
await page.click('#btnPlay');
await page.waitForSelector('#screenIntro:not([hidden])', { timeout: 5000 });
ok(true, '关卡开场动画出现');
const introTarget = await page.locator('#introTarget').textContent();
ok(introTarget === '2,500', `第 1 关目标分为 2,500（实际 ${introTarget}）`);
await shot('03-关卡开场');

await page.waitForSelector('#screenIntro', { state: 'hidden', timeout: 6000 });
await page.waitForFunction(() => window.__duidui?.game?.phase === 'playing', null, { timeout: 8000 });
ok(true, '开场结束后进入游戏');
await page.waitForTimeout(600);
await shot('04-棋盘');

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
  await page.waitForTimeout(90);
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
await shot('06-消除后');

console.log('\n【5】填补规则：不掉落、向中间靠拢');
const collapseCheck = await page.evaluate(() => {
  const b = window.__duidui.game.board;
  const mid = Math.floor(b.cols / 2);
  let holes = 0, rowsChecked = 0;
  for (let r = 0; r < b.rows; r++) {
    rowsChecked++;
    let gap = false;
    for (let c = mid - 1; c >= 0; c--) {           // 左半区：从中线往外
      if (!b.get(c, r)) gap = true; else if (gap) holes++;
    }
    gap = false;
    for (let c = mid; c < b.cols; c++) {            // 右半区：从中线往外
      if (!b.get(c, r)) gap = true; else if (gap) holes++;
    }
  }
  return { holes, rowsChecked };
});
ok(collapseCheck.holes === 0, `所有行都紧贴中线、没有空洞（检查了 ${collapseCheck.rowsChecked} 行）`);

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
ok(await page.locator('#itemHammer.armed').count() === 1, '榔头激活后按钮高亮');
await shot('07-榔头已激活');
const beforeHammer = await page.evaluate(() => window.__duidui.game.board.remaining);
const target = await page.evaluate(() => {
  const b = window.__duidui.game.board;
  return b.grid.findIndex((x) => x);
});
await tapIndex(target);
await page.waitForTimeout(700);
const afterHammer = await page.evaluate(() => window.__duidui.game.board.remaining);
ok(afterHammer === beforeHammer - 1, `榔头敲掉了一个方块（${beforeHammer} → ${afterHammer}）`);
ok(await page.locator('#countHammer').textContent() === '2', '榔头数量从 3 减到 2');

await page.click('#itemHint');
await page.waitForTimeout(200);
const hinted = await page.evaluate(() => (window.__duidui.game.board.hint || []).length);
ok(hinted >= 2, `提示指出了一组 ${hinted} 个方块`);
await shot('08-提示');

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
await shot('11-关卡选择');
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
    if (g.board.state !== 'idle') { await sleep(20); continue; }
    const groups = g.board.allGroups();
    if (!groups.length) break;
    g.tapCell(groups[0][0]);
    steps++;
    await sleep(30);
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
await shot('13-结算');

console.log('\n【11】横屏三栏布局');
await page.setViewportSize({ width: 900, height: 480 });
await page.waitForTimeout(400);
const landscape = await page.evaluate(() => {
  const r = getComputedStyle(document.querySelector('.side-right')).display;
  const strip = getComputedStyle(document.querySelector('.chat-strip')).display;
  return { rightPanel: r, chatStrip: strip };
});
ok(landscape.rightPanel !== 'none', '横屏下右侧聊天栏显示出来');
ok(landscape.chatStrip === 'none', '横屏下底部聊天条隐藏');
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
await shot('15-超窄屏');

console.log('\n【13】离线缓存');
await page.setViewportSize({ width: 412, height: 915 });
const swReady = await page.evaluate(() => navigator.serviceWorker?.controller != null
  || navigator.serviceWorker?.ready.then(() => true).catch(() => false));
ok(swReady !== false, 'Service Worker 已注册');

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
