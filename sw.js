/* Word Fall — Service Worker
   Enables offline play and home-screen installation (PWA).

   Strategy:
   - CODE (html / css / js / manifest): NETWORK-FIRST with cache fallback.
     Code must always update when online — a cache-first policy here once
     pinned a broken build onto every visitor with no way to recover.
   - ASSETS (images / audio / fonts): cache-first with network fill.
     Heavy and effectively immutable; instant loads + offline support.
   - API calls (DeepSeek): network only, never cached.

   All paths are RELATIVE so the worker functions both at a domain root
   and under a project path like /wordfall/ on GitHub Pages. */

const CACHE_NAME = 'wordfall-v2'; // bump to purge clients' old caches

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './game.js',
  './manifest.json',
  './assets/img/bg-skyline.png',
  './assets/img/cannon-typewriter.png',
  './assets/img/logo-wordmark.png',
  './assets/img/boss-warning.png',
  './assets/img/share-card-bg.png',
  './assets/img/key-base.png',
  './assets/icons/icon-freeze.png',
  './assets/icons/icon-bomb.png',
  './assets/icons/icon-shield.png',
  './assets/icons/icon-settings.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/vfx/shard-neon.png',
  './assets/vfx/spark-cyan.png',
  './assets/vfx/spark-magenta.png',
  './assets/vfx/chain-link.png',
  './assets/audio/music-main-loop.mp3',
  './assets/audio/music-menu-loop.wav',
  './assets/audio/sfx-bomb.mp3',
  './assets/audio/sfx-boss-defeat.mp3',
  './assets/audio/sfx-boss-warning.mp3',
  './assets/audio/sfx-combo.mp3',
  './assets/audio/sfx-destroy.mp3',
  './assets/audio/sfx-lock.mp3',
  './assets/audio/sfx-powerup.mp3',
  './assets/audio/sfx-type.wav',
];

// Paths treated as code → network-first. Everything else is an asset.
function isCodeRequest(url) {
  const p = url.pathname;
  return p.endsWith('/') || p.endsWith('.html') || p.endsWith('.css')
      || p.endsWith('.js') || p.endsWith('.json');
}

// Install: best-effort pre-cache. cache.addAll() rejects the whole install
// if a single asset 404s; caching individually keeps installation robust.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(
        PRECACHE_ASSETS.map(a => cache.add(a))
      ))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches (this is what purges a stale broken build).
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls — always network, never cached.
  if (url.hostname.includes('deepseek') || url.hostname.includes('api.')) {
    return; // default browser fetch
  }

  // CODE — network-first so updates always flow; cached copy only when offline.
  if (url.origin === self.location.origin && isCodeRequest(url)) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // ASSETS (same-origin media + cross-origin fonts) — cache-first.
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
