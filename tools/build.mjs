/**
 * 打包：把要发布的文件拷到 dist/
 * 没有编译步骤 —— 源码就是浏览器直接能跑的 ES 模块，
 * 这里只做收集与清点，顺便报出体积。
 */
import { cp, rm, mkdir, readdir, stat } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const ITEMS = [
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'sw.js',
  'src',
  'assets/icons',
  'assets/blocks',
  'assets/art'
];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const item of ITEMS) {
  const from = join(root, item);
  const to = join(dist, item);
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
}

// 清点体积
let total = 0, files = 0;
const walk = async (dir) => {
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    const st = await stat(p);
    if (st.isDirectory()) await walk(p);
    else { total += st.size; files++; }
  }
};
await walk(dist);

console.log(`✅ 打包完成 → dist/`);
console.log(`   ${files} 个文件，共 ${(total / 1024).toFixed(0)} KB`);
console.log(`   （没有任何构建产物，源码即发布内容）`);
