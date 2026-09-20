/**
 * 统一的浏览器启动入口
 * ------------------------------------------------------------------
 * 本机预装的 Chromium 在固定路径下；CI 上则由 Playwright 自己下载。
 * 所以这里只在那个路径真的存在时才指定 executablePath，
 * 否则交给 Playwright 用它自己的那份。
 */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const CANDIDATES = [
  process.env.CHROMIUM_BIN,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome'
].filter(Boolean);

export function findChromium() {
  return CANDIDATES.find((p) => existsSync(p)) || null;
}

export async function launchBrowser(opts = {}) {
  const exe = findChromium();
  return chromium.launch({ ...(exe ? { executablePath: exe } : {}), ...opts });
}
