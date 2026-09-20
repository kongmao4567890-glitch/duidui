/**
 * 原版素材加载器
 * ------------------------------------------------------------------
 * assets/blocks/ 下是从原版录屏里逐格切出、多帧中位数叠加去噪、
 * 再放大锐化得到的方块贴图（见 tools/rip.py 与 tools/finalize-assets.py）。
 *
 * 加载失败时不会让游戏挂掉 —— sprites.js 会自动退回到程序化绘制的方块。
 */

const BASE = 'assets/blocks/';

/** 已加载的贴图：key → HTMLImageElement */
export const images = new Map();

let loadPromise = null;
export let assetsReady = false;

function loadOne(key, file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { images.set(key, img); resolve(true); };
    img.onerror = () => {
      console.info(`[素材] ${file} 加载失败，该方块改用程序化绘制`);
      resolve(false);
    };
    img.src = BASE + file;
  });
}

/**
 * 预加载全部方块贴图。
 * @param {number} colors 需要几种颜色
 * @returns {Promise<boolean>} 是否至少加载到一张
 */
export function loadAssets(colors = 7) {
  if (loadPromise) return loadPromise;
  const jobs = [];
  for (let i = 0; i < colors; i++) jobs.push(loadOne(`block:${i}`, `${i}.png`));
  jobs.push(loadOne('magic', 'magic.png'));
  jobs.push(loadOne('empty', 'empty.png'));

  loadPromise = Promise.all(jobs).then((results) => {
    assetsReady = results.some(Boolean);
    const ok = results.filter(Boolean).length;
    console.info(`[素材] 载入 ${ok}/${results.length} 张原版贴图`);
    return assetsReady;
  });
  return loadPromise;
}

export function getImage(key) {
  return images.get(key) || null;
}
