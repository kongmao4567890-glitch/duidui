/**
 * Service Worker：离线缓存
 * ------------------------------------------------------------------
 * 装完之后断网也能玩。策略：
 *   · 导航请求（打开页面）→ 网络优先，失败回落到缓存
 *   · 静态资源 → 缓存优先，后台顺手更新
 * 换版本号即可让所有客户端强制更新。
 */

const VERSION = 'duidui-v1.0.0';
const CORE = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './src/main.js',
  './src/core/config.js',
  './src/core/board.js',
  './src/core/game.js',
  './src/core/stage.js',
  './src/core/companion.js',
  './src/core/rng.js',
  './src/core/util.js',
  './src/render/renderer.js',
  './src/render/sprites.js',
  './src/render/particles.js',
  './src/audio/audio.js',
  './src/platform/storage.js',
  './src/ui/dom.js',
  './src/ui/hud.js',
  './src/ui/screens.js',
  './src/render/assets.js',
  './src/ui/stage.js',
  './src/audio/tune.js',
  './assets/stage/stage-bg.png',
  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/art/hood.svg',
  './assets/art/monkey.svg',
  './assets/art/piggy.svg',
  './assets/art/puppy.svg',
  './assets/blocks/0.png',
  './assets/blocks/1.png',
  './assets/blocks/2.png',
  './assets/blocks/3.png',
  './assets/blocks/4.png',
  './assets/blocks/5.png',
  './assets/blocks/6.png',
  './assets/blocks/magic.png',
  './assets/blocks/empty.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      // 单个文件缺失不应该让整次安装失败
      .then((cache) => Promise.allSettled(CORE.map((u) => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // 打开页面：优先拿新的，拿不到就用缓存（保证离线可用）
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // 静态资源：缓存优先，同时后台刷新
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// 页面要求立即启用新版本
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
