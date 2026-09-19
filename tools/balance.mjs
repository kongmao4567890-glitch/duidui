/**
 * 难度曲线校验
 * ------------------------------------------------------------------
 * 用四档水平的机器人把每一关跑很多遍，检查目标分是否落在
 * 「认真玩能过、乱点会输」的区间里。
 *
 * 用法：node tools/balance.mjs [关卡数] [每关局数]
 */
import { play, median } from './bot.mjs';
import { makeStage } from '../src/core/stage.js';

const STAGES = Number(process.argv[2] || 20);
const RUNS = Number(process.argv[3] || 40);
const KEYS = ['random', 'greedy', 'patient', 'lookahead'];

console.log(`\n每关 ${RUNS} 局；random=乱点，greedy=见大就吃，patient=先清小块，lookahead=一层前瞻`);
console.log('（后三档都会主动把魔术方块切到最有利的颜色，乱点的不会）\n');
console.log('关卡  棋盘    色  目标分  ' + KEYS.map((k) => k.padEnd(11)).join('') + ' 判定');
console.log('─'.repeat(100));

let bad = 0;
for (let n = 1; n <= STAGES; n++) {
  const stage = makeStage(n, 'standard');
  const opts = {
    cols: stage.cols, rows: stage.rows, colors: stage.colors,
    magicRate: stage.magicRate, stoneRate: stage.stoneRate, factor: stage.scoreFactor
  };
  const med = {};
  for (const k of KEYS) {
    const arr = [];
    for (let i = 0; i < RUNS; i++) arr.push(play(opts, k, (n * 7919 + i * 104729) >>> 0).score);
    med[k] = Math.round(median(arr));
  }
  // 判定标准：认真玩（lookahead）必须能过；第 8 关起乱点必须过不了
  const proOk = med.lookahead >= stage.target;
  const noobFail = med.random < stage.target;
  const tutorial = n < 8;
  const good = proOk && (noobFail || tutorial);
  if (!good) bad++;
  const verdict = !proOk ? '❌ 太难' : (noobFail ? '✅ 合适' : (tutorial ? '✅ 新手关' : '⚠ 太松'));
  console.log(
    String(n).padEnd(6) + `${stage.cols}×${stage.rows}`.padEnd(8) + String(stage.colors).padEnd(4) +
    String(stage.target).padEnd(8) + KEYS.map((k) => String(med[k]).padEnd(11)).join('') + ' ' + verdict
  );
}
console.log('─'.repeat(100));
console.log(bad === 0 ? '✅ 难度曲线全程合理\n' : `⚠ ${bad} 关需要调整\n`);
