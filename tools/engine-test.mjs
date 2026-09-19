/**
 * 引擎无头自测（联众对对碰规则）
 * 覆盖：分组判定、≥2 才能消、斜向不算、魔术方块、顽石、
 *       向中间靠拢的填补规则、无重力无补充、结束判定、完整对局压测。
 */
import { Board, Block, BOARD_STATE } from '../src/core/board.js';
import { Rng } from '../src/core/rng.js';
import { EventBus } from '../src/core/util.js';
import { BLOCK_KIND, COLLAPSE, SCORE } from '../src/core/config.js';
import { Game, MODE, PHASE } from '../src/core/game.js';
import { DEFAULT_SETTINGS } from '../src/core/config.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

function mkBoard(cols = 9, rows = 11, colors = 5, seed = 12345, extra = {}) {
  const bus = new EventBus();
  const b = new Board({ cols, rows, colors, rng: new Rng(seed), bus, ...extra });
  return { b, bus };
}

/** 用字符串布局手工铺棋盘：字母=颜色，'?'=魔术，'#'=顽石，'·'/'.'=空 */
function layout(b, rowsStr) {
  const map = {};
  let next = 0;
  b.grid.fill(null);
  for (let r = 0; r < rowsStr.length; r++) {
    for (let c = 0; c < rowsStr[r].length; c++) {
      const ch = rowsStr[r][c];
      if (ch === '.' || ch === '·') continue;
      let blk;
      if (ch === '#') blk = new Block(-1, BLOCK_KIND.STONE);
      else if (ch === '?') blk = new Block(0, BLOCK_KIND.MAGIC);
      else {
        if (!(ch in map)) map[ch] = next++;
        blk = new Block(map[ch]);
      }
      b.set(c, r, blk);
    }
  }
  b.state = BOARD_STATE.IDLE;
  b.initialCount = b.remaining;
  return map;
}

/** 推进引擎直到静止 */
function settle(b, maxMs = 20000) {
  let t = 0;
  while (t < maxMs) {
    b.update(16); t += 16;
    if (b.state === BOARD_STATE.IDLE && !b.grid.some((x) => x && x.anim)) return t;
  }
  return -1;
}

const render = (b) => b.toString().trimEnd();

/** 按 layout 时使用的字母表把棋盘渲染回来，便于断言 */
function renderAs(b, map) {
  const inv = {};
  for (const k of Object.keys(map)) inv[map[k]] = k;
  let out = '';
  for (let r = 0; r < b.rows; r++) {
    for (let c = 0; c < b.cols; c++) {
      const x = b.get(c, r);
      out += !x ? '·' : x.isStone ? '#' : x.isMagic ? '?' : (inv[x.type] ?? '!');
    }
    if (r < b.rows - 1) out += '\n';
  }
  return out;
}

console.log('\n【1】开局铺盘');
{
  const { b } = mkBoard();
  b.generate(); settle(b);
  ok(b.grid.every((x) => x !== null), '棋盘被完全铺满，没有空格');
  ok(b.remaining === b.cols * b.rows, `方块总数 = ${b.cols}×${b.rows} = ${b.remaining}`);
  ok(b.hasMoves(), '开局保证至少有一组可消方块');
  ok(b.initialCount === b.cols * b.rows, '记录了开局方块总数');
}

console.log('\n【2】分组：上下左右相连，斜向不算');
{
  const { b } = mkBoard(6, 5);
  layout(b, [
    'AABBBC',
    'ABABCC',
    'BBAACC',
    'CCBBAA',
    'ABCABC'
  ]);
  // (0,0)A 与 (1,0)A 相连，(0,1)A 也在同列 → 一组
  const g1 = b.findGroup(b.index(0, 0));
  ok(g1.length === 3, `左上角 A 组 = 3 个（实际 ${g1.length}）`);
  ok(g1.includes(b.index(0, 0)) && g1.includes(b.index(1, 0)) && g1.includes(b.index(0, 1)),
     '组内正好是那三个相连的 A');

  // 对角相邻不应被算进同一组
  const { b: b2 } = mkBoard(3, 3);
  layout(b2, ['A.B', '.A.', 'B.A']);
  const diag = b2.findGroup(b2.index(0, 0));
  ok(diag.length === 1, `斜向相邻不算相连（组大小 ${diag.length}）`);
}

console.log('\n【3】≥2 才能消，孤立方块点不掉');
{
  const { b, bus } = mkBoard(5, 3);
  layout(b, ['ABABA', 'BABAB', 'ABABA']);
  let failEvt = 0;
  bus.on('board:selectFail', () => failEvt++);
  ok(b.removeAt(b.index(0, 0)) === null, '孤立单块无法消除');
  ok(failEvt === 1, '触发了「无法消除」事件');
  ok(b.remaining === 15, '棋盘方块数未变');
  ok(b.hasMoves() === false, '棋盘格式布局确实无可消组合');
}

console.log('\n【4】消除一组');
{
  const { b, bus } = mkBoard(6, 3);
  layout(b, [
    'AAABBB',
    'CBCBCA',
    'BCBCBC'
  ]);
  let evt = null;
  bus.on('board:remove', (i) => { evt = i; });
  const res = b.removeAt(b.index(1, 0));
  ok(res && res.size === 3, `一次消掉整组 3 个（实际 ${res?.size}）`);
  ok(evt && evt.reason === 'match', '发出了 board:remove 事件');
  settle(b);
  ok(b.remaining === 15, `消除后剩 15 个（实际 ${b.remaining}）`);
}

console.log('\n【5】填补规则：同行两侧向中间靠拢，不掉落、不补充');
{
  const { b } = mkBoard(9, 1, 9, 1, { collapse: COLLAPSE.CENTER });
  //           0 1 2 3 | 4 5 6 7 8     mid = 4
  const map = layout(b, ['ABCDEFGHI']);
  // 手工移除第 2、3 格（C、D）
  b.grid[2].removing = true;
  b.grid[3].removing = true;
  b._applyCollapse();
  settle(b);
  ok(renderAs(b, map) === '··ABEFGHI', `左半区向右靠拢：期望 "··ABEFGHI"，实际 "${renderAs(b, map)}"`);
}
{
  const { b } = mkBoard(9, 1, 9, 1, { collapse: COLLAPSE.CENTER });
  const map = layout(b, ['ABCDEFGHI']);
  b.grid[5].removing = true;   // F
  b.grid[6].removing = true;   // G
  b._applyCollapse();
  settle(b);
  ok(renderAs(b, map) === 'ABCDEHI··', `右半区向左靠拢：期望 "ABCDEHI··"，实际 "${renderAs(b, map)}"`);
}
{
  // 跨中线消除：两侧同时向中间靠拢
  const { b } = mkBoard(9, 1, 9, 1, { collapse: COLLAPSE.CENTER });
  const map = layout(b, ['ABCDEFGHI']);
  b.grid[3].removing = true;   // D（左半区）
  b.grid[4].removing = true;   // E（右半区）
  b._applyCollapse();
  settle(b);
  ok(renderAs(b, map) === '·ABCFGHI·', `跨中线：期望 "·ABCFGHI·"，实际 "${renderAs(b, map)}"`);
}

console.log('\n【6】无重力：方块绝不上下移动，也不会补充新块');
{
  const { b } = mkBoard(7, 4);
  layout(b, [
    'AABCDEF',
    'CDEFABC',
    'DEFABCD',
    'EFABCDE'
  ]);
  const before = b.remaining;
  const rowOfIds = () => b.grid.map((x, i) => (x ? `${x.id}@${b.rowOf(i)}` : null)).filter(Boolean).sort();
  const rowsBefore = new Map();
  b.grid.forEach((x, i) => { if (x) rowsBefore.set(x.id, b.rowOf(i)); });

  b.removeAt(b.index(0, 0));   // 消掉第 0 行的 AA
  settle(b);

  let sameRow = true;
  b.grid.forEach((x, i) => {
    if (x && rowsBefore.has(x.id) && rowsBefore.get(x.id) !== b.rowOf(i)) sameRow = false;
  });
  ok(sameRow, '所有幸存方块都留在原来的行（没有掉落）');
  ok(b.remaining === before - 2, `方块只减不增：${before} → ${b.remaining}`);
  ok(b.grid.filter(Boolean).length === before - 2, '顶部没有补充新方块');
}

console.log('\n【7】魔术方块：按当前颜色参与分组，点它只换色');
{
  const { b, bus } = mkBoard(5, 3);
  const map = layout(b, [
    'AA?BB',
    'CDCDC',
    'DCDCD'
  ]);
  const mi = b.index(2, 0);
  b.grid[mi].type = map.B;          // 魔术方块当前是 B 色
  ok(b.grid[mi].isMagic, '魔术方块被正确标记');

  // 它当前是 B 色，所以和右边两个 B 连成一组
  const gB = b.findGroup(b.index(3, 0));
  ok(gB.length === 3 && gB.includes(mi), `魔术方块按当前颜色参与分组（组大小 ${gB.length}）`);
  // 和左边的 A 不相连
  const gA = b.findGroup(b.index(0, 0));
  ok(!gA.includes(mi), '颜色不同就不参与该组');

  ok(b.removeAt(mi) === null, '直接点魔术方块不会消除它');

  const before = b.grid[mi].type;
  let evt = null;
  bus.on('board:magic', (e) => { evt = e; });
  ok(b.cycleMagic(mi) === true, '点击魔术方块可切换颜色');
  ok(b.grid[mi].type === (before + 1) % b.colors, `颜色切到下一种：${before} → ${b.grid[mi].type}`);
  ok(evt !== null, '发出了 board:magic 事件');
  ok(b.remaining === 15, '切换颜色不会减少方块');
}

console.log('\n【7b】魔术方块搭桥：切到需要的颜色，再点旁边的普通方块一起消掉');
{
  const { b } = mkBoard(5, 3);
  const map = layout(b, [
    'A?ACB',
    'CBCBC',
    'BCBCB'
  ]);
  const mi = b.index(1, 0);
  b.grid[mi].type = map.C;                       // 先切成 C 色：左右两个 A 是断开的
  ok(b.findGroup(b.index(0, 0)).length === 1, '搭桥前左边的 A 是孤立的');
  ok(b.removeAt(b.index(0, 0)) === null, '孤立的 A 点不掉');

  // 把魔术方块切成 A 色
  let guard = 0;
  while (b.grid[mi].type !== map.A && guard++ < 10) {
    b.cycleMagic(mi);
    b.state = BOARD_STATE.IDLE;                  // 跳过换色动画
  }
  const bridged = b.findGroup(b.index(0, 0));
  ok(bridged.length === 3, `搭桥后 A—魔术—A 连成一组 3 个（实际 ${bridged.length}）`);

  const res = b.removeAt(b.index(0, 0));
  ok(res && res.size === 3, '点普通方块可以把魔术方块一起带走');
  ok(res && res.magicCount === 1, `统计到 1 个魔术方块被消除（实际 ${res?.magicCount}）`);
  settle(b);
  ok(b.remaining === 12, `消除后剩 12 个（实际 ${b.remaining}）`);
}

console.log('\n【7c】全是魔术方块的组点不掉');
{
  const { b } = mkBoard(5, 3, 4);
  layout(b, [
    '??BCB',
    'CBCBC',
    'BCBCB'
  ]);
  // 把两个魔术方块切成一种四周都没有的颜色，确保它们只和彼此相连
  b.grid[0].type = 3;
  b.grid[1].type = 3;
  const g = b.findGroup(0);
  ok(g.length === 2, '两个同色魔术方块确实相连');
  ok(b.isRemovableGroup(g) === false, '但整组都是魔术方块时无法消除');
  ok(b.removeAt(0) === null, '点它只会换色');
}

console.log('\n【8】顽石');
{
  const { b } = mkBoard(5, 3);
  layout(b, ['AA#BB', 'CDCDC', 'DCDCD']);
  const si = b.index(2, 0);
  ok(b.grid[si].isStone, '顽石被正确标记');
  ok(b.removeAt(si) === null, '顽石不能被点击消除');
  ok(!b.findGroup(b.index(1, 0)).includes(si), '顽石不参与分组');
  ok(b.hammerAt(si) !== null, '榔头可以敲掉顽石');
  settle(b);
  ok(b.remaining === 14, '顽石被敲掉后方块数 -1');
}

console.log('\n【9】榔头与变换道具');
{
  const { b } = mkBoard(6, 4);
  layout(b, ['ABABAB', 'BABABA', 'ABABAB', 'BABABA']);
  ok(b.hasMoves() === false, '棋盘格布局无可消组合');
  const before = b.remaining;
  b.hammerAt(b.index(2, 2));
  settle(b);
  ok(b.remaining === before - 1, '榔头敲掉一个方块');

  const { b: b2 } = mkBoard(6, 4);
  layout(b2, ['ABABAB', 'BABABA', 'ABABAB', 'BABABA']);
  const res = b2.transformAt(b2.index(2, 2), [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]);
  settle(b2);
  ok(res && res.cells.length === 5, `变换影响十字 5 格（实际 ${res?.cells.length}）`);
  ok(b2.hasMoves() === true, '变换之后制造出了可消组合');
  const types = res.cells.map((i) => b2.grid[i].type);
  ok(new Set(types).size === 1, '被变换的格子染成同一种颜色');
}

console.log('\n【10】结束判定');
{
  const { b, bus } = mkBoard(5, 2);
  //  消掉左上角那对 A 之后，剩下的必须是纯交错布局
  layout(b, [
    'AABAB',
    'BBABA'
  ]);
  let noMoves = null;
  bus.on('board:noMoves', (e) => { noMoves = e; });
  const g = b.findGroup(b.index(0, 0));
  b.removeAt(b.index(0, 0));
  settle(b);
  const left = b.remaining;
  console.log(`     （消掉 ${g.length} 个后剩余 ${left}，是否仍有可消组合：${b.hasMoves()}）`);
  if (!b.hasMoves()) {
    ok(noMoves !== null && noMoves.remaining === left, `事件里带上剩余方块数（${noMoves?.remaining} / ${left}）`);
  } else {
    // 继续贪心消到底，确认最终一定会发出 noMoves
    let guard = 0;
    while (b.hasMoves() && guard++ < 50) { b.removeAt(b.allGroups()[0][0]); settle(b); }
    ok(noMoves !== null, `一路消到死局时发出 board:noMoves（剩余 ${b.remaining}）`);
  }
}

console.log('\n【11】贪心 AI 完整对局压测');
{
  let worst = null;
  for (let seed = 1; seed <= 30; seed++) {
    const { b } = mkBoard(9, 11, 5, seed * 7919);
    b.generate(); settle(b);
    let steps = 0;
    while (b.hasMoves() && steps < 300) {
      const groups = b.allGroups();
      const pick = groups[0];
      b.removeAt(pick[0]);
      if (settle(b) < 0) { worst = `seed ${seed} 第 ${steps} 步卡死`; break; }
      steps++;
    }
    if (worst) break;
    if (b.grid.some((x, i) => x && x.anim)) { worst = `seed ${seed} 残留动画`; break; }
    // 行完整性校验：每一行的方块必须连续贴着中线
    for (let r = 0; r < b.rows; r++) {
      const mid = Math.floor(b.cols / 2);
      let leftGap = false;
      for (let c = mid - 1; c >= 0; c--) {
        if (!b.get(c, r)) leftGap = true;
        else if (leftGap) { worst = `seed ${seed} 第 ${r} 行左半区有空洞`; break; }
      }
      let rightGap = false;
      for (let c = mid; c < b.cols; c++) {
        if (!b.get(c, r)) rightGap = true;
        else if (rightGap) { worst = `seed ${seed} 第 ${r} 行右半区有空洞`; break; }
      }
      if (worst) break;
    }
    if (worst) break;
  }
  ok(worst === null, worst || '30 局贪心对局全部正常收官，且行内无空洞');
}

console.log('\n【12】Game 层：完整一关');
{
  const settings = { ...DEFAULT_SETTINGS, board: 'standard', confirmTap: false };
  const game = new Game({ settings, bus: new EventBus() });
  game.startCampaign(1);
  // 推进开局动画
  for (let i = 0; i < 200 && game.phase === PHASE.READY; i++) game.update(16);
  ok(game.phase === PHASE.PLAYING, '开局动画结束后自动进入游戏');

  let rescued = false;
  game.bus.on('game:rescue', () => { rescued = true; });

  let guard = 0;
  while (game.phase === PHASE.PLAYING && guard < 800) {
    if (game.board.state === BOARD_STATE.IDLE) {
      const groups = game.board.allGroups();
      if (!groups.length) { game.giveUpRescue(); break; }
      game.tapCell(groups[0][0]);
      guard++;
    }
    game.update(16);
  }
  for (let i = 0; i < 400 && game.phase === PHASE.PLAYING; i++) game.update(16);
  ok(rescued, '无路可走时先提示可用道具救场，而不是直接结束');

  ok(game.phase === PHASE.WIN || game.phase === PHASE.LOSE, `一关跑完并结算（${game.phase}）`);
  ok(game.score > 0, `得到了分数：${game.score}`);
  ok(game.stats.groupCount > 0, `统计到 ${game.stats.groupCount} 组消除`);
  console.log(`     最终得分 ${game.score} / 目标 ${game.stage.target}，剩余 ${game.stats.remaining} 块，最大一组 ${game.stats.maxGroup}`);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 测试完成：通过 ${pass}，失败 ${fail}\n`);
process.exit(fail ? 1 : 0);
