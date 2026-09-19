/**
 * 标定「单格期望产出分」：给 stage.js 的 PER_CELL_SCORE 提供实测依据。
 * 用法：node tools/curve.mjs [每组局数]
 */
import { play, median } from './bot.mjs';
import { SCORE } from '../src/core/config.js';

const RUNS = Number(process.argv[2] || 50);
const SIZES = [[8, 9], [10, 10], [10, 12], [11, 12], [11, 14]];

console.log(`\n每组 ${RUNS} 局，单组公式 ${SCORE.groupFactor}×n×(n−1)（未乘颜色系数）\n`);
console.log('颜色  棋盘     格数  ' + ['random', 'greedy', 'patient', 'lookahead'].map((k) => k.padEnd(10)).join('') + ' 高手单格产出');

const perCell = {};
for (let colors = 4; colors <= 7; colors++) {
  const samples = [];
  for (const [cols, rows] of SIZES) {
    const cells = cols * rows;
    const out = {};
    for (const key of ['random', 'greedy', 'patient', 'lookahead']) {
      const arr = [];
      for (let i = 0; i < RUNS; i++) {
        arr.push(play({ cols, rows, colors, factor: SCORE.groupFactor }, key, (colors * 7919 + cells * 31 + i * 104729) >>> 0).score);
      }
      out[key] = median(arr);
    }
    samples.push(out.lookahead / cells);
    console.log(
      String(colors).padEnd(6) + `${cols}×${rows}`.padEnd(9) + String(cells).padEnd(6) +
      ['random', 'greedy', 'patient', 'lookahead'].map((k) => String(Math.round(out[k])).padEnd(10)).join('') +
      (out.lookahead / cells).toFixed(1)
    );
  }
  perCell[colors] = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
  console.log('');
}

console.log('实测结果 → 建议写入 stage.js 的 PER_CELL_SCORE：');
console.log('const PER_CELL_SCORE = ' + JSON.stringify(perCell) + ';');
const base = perCell[5];
const cf = {};
for (const c of [4, 5, 6, 7]) cf[c] = Number((Math.pow(base / perCell[c], 0.75)).toFixed(2));
cf[3] = Number((Math.pow(base / (perCell[4] * 1.8), 0.75)).toFixed(2));
console.log('建议写入 config.js 的 SCORE.colorFactor：');
console.log('colorFactor: ' + JSON.stringify(cf));
