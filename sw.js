/* Word Fall — Service Worker
   Enables offline play and home-screen installation (PWA).
   Strategy: cache-first for static assets, network-first for API calls. */

const CACHE_NAME = 'wordfall-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/game.js',
  '/manifest.json',
  '/assets/img/bg-skyline.png',
  '/assets/img/cannon-typewriter.png',
  '/assets/img/logo-wordmark.png',
  '/assets/img/boss-warning.png',
  '/assets/img/share-card-bg.png',
  '/assets/img/key-base.png',
  '/assets/icons/icon-freeze.png',
  '/assets/icons/icon-bomb.png',
  '/assets/icons/icon-shield.png',
  '/assets/icons/icon-settings.png',
  '/assets/vfx/shard-neon.png',
  '/assets/vfx/spark-cyan.png',
  '/assets/vfx/spark-magenta.png',
  '/assets/vfx/chain-link.png',
  '/assets/audio/music-main-loop.mp3',
  '/assets/audio/music-menu-loop.wav',
  '/assets/audio/sfx-bomb.mp3',
  '/assets/audio/sfx-boss-defeat.mp3',
  '/assets/audio/sfx-boss-warning.mp3',
  '/assets/audio/sfx-combo.mp3',
  '/assets/audio/sfx-destroy.mp3',
  '/assets/audio/sfx-lock.mp3',
  '/assets/audio/sfx-powerup.mp3',
  '/assets/audio/sfx-type.wav',
];

// Install: pre-cache all static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: cache-first for static, network-first for API
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // DeepSeek API calls — always go to network, never cache
  if (url.hostname.includes('deepseek') || url.hostname.includes('api.')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Google Fonts — cache with network fallback
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const fetched = fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        });
        return cached || fetched;
      })
    );
    return;
  }

  // Everything else — cache first, then network
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(response => {
        // Cache successful responses for future offline use
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
