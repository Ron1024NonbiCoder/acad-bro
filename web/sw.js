/* AcadBro service worker.

   Its primary job is simply to exist: a registered service worker with a fetch
   handler is what lets a Chromium browser install this as a real home-screen
   app. It also gives basic offline support.

   Strategy: network-first for same-origin GETs. Filenames are stable (not
   content-hashed), so a cache-first worker would pin stale JS after every
   deploy; instead, online users always get the freshly deployed code and the
   cache is only a fallback when the network is unavailable. Cross-origin
   requests (Firebase, later) are never intercepted. */

const CACHE = 'acadbro-v1';

/* Precached resiliently so one missing URL can't abort install. JS modules get
   cached on first visit by the fetch handler, so this list need not track
   module splits. */
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './styles.css',
  './icon/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  /* Same-origin only: never touch Firebase or any CDN. */
  if (url.origin !== self.location.origin) return;
  /* Firebase Hosting reserved paths -- leave alone. */
  if (url.pathname.startsWith('/__/')) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      /* Cache only clean, complete same-origin 200s. */
      if (fresh && fresh.status === 200 && fresh.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      /* Offline navigation with nothing cached for this URL: fall back to the
         app shell so the single-page app can still boot. */
      if (req.mode === 'navigate') {
        const shell = (await caches.match('./index.html')) || (await caches.match('./'));
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
