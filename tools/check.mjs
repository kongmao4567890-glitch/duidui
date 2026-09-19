// ESM 语法与导入检查：逐个 import 所有模块，确保无语法/引用错误
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url).pathname;
const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== 'node_modules' && f !== '.git') walk(p); }
    else if (f.endsWith('.js') || f.endsWith('.mjs')) files.push(p);
  }
})(join(root, 'src'));

let bad = 0;
for (const f of files.sort()) {
  try {
    await import(pathToFileURL(f).href);
    console.log('  ✓', relative(root, f));
  } catch (err) {
    if (err instanceof SyntaxError || /Cannot find module|does not provide an export/.test(err.message)) {
      console.log('  ✗', relative(root, f), '\n     ', err.message.split('\n')[0]);
      bad++;
    } else {
      // 浏览器 API 缺失属于预期（document/window），仅提示
      console.log('  ~', relative(root, f), '(需浏览器环境:', err.message.split('\n')[0].slice(0, 60) + ')');
    }
  }
}
console.log(bad ? `\n❌ ${bad} 个文件存在语法/导入错误` : '\n✅ 全部模块语法检查通过');
process.exit(bad ? 1 : 0);
