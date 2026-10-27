/* AcadBro service worker.

   Its primary job is simply to exist: a registered service worker with a fetch
   handler is what lets a Chromium browser install this as a real home-screen
   app. It also gives basic offline support.

   Strategy: network-first for same-origin GETs. Filenames are stable (not
   content-hashed), so a cache-first worker would pin stale JS after every
   deploy; instead, online users always get the freshly deployed code and the
   cache is only a fallback when the network is unavailable. Cross-origin
   requests are never intercepted, except the Firebase SDK files (see below).

   The SDK URLs carry their version (must match SDK_BASE in js/cloud.js), so
   they are immutable: cache-first, cached on first use. This lets a signed-in
   user who launches offline still load the SDK. They live in their own cache
   (SDK_CACHE), which an app cache bump never deletes; only an SDK cache of
   another version is cleaned up. */

const CACHE = 'acadbro-v8';
const SDK_VERSION = '12.16.0'; /* must match SDK_BASE in js/cloud.js */
const SDK_PREFIX = 'https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/';
const SDK_CACHE = 'acadbro-sdk-' + SDK_VERSION;

/* Precached resiliently so one missing URL can't abort install. JS modules get
   cached on first visit by the fetch handler, so this list need not track
   module splits. */
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './styles.css',
  './icon/icon.svg',
  './icon/icon-192.png',
  './icon/icon-512.png',
  './icon/icon-maskable-512.png',
  './icon/apple-touch-icon.png',
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
    const stale = names.filter((n) => n.startsWith('acadbro-') && n !== CACHE && n !== SDK_CACHE);
    /* SDK files cached by an older worker inside its app cache move over first,
       so an offline launch right after this update still has them */
    const sdk = await caches.open(SDK_CACHE);
    for (const n of stale) {
      try {
        const old = await caches.open(n);
        for (const req of await old.keys()) {
          if (!req.url.startsWith(SDK_PREFIX) || (await sdk.match(req))) continue;
          const res = await old.match(req);
          if (res) await sdk.put(req, res);
        }
      } catch (err) { /* best effort: the SDK is fetched again on the next online launch */ }
    }
    await Promise.all(stale.map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  if (req.url.startsWith(SDK_PREFIX)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const fresh = await fetch(req);
      if (fresh && fresh.status === 200) {
        const cache = await caches.open(SDK_CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    })());
    return;
  }

  const url = new URL(req.url);
  /* Same-origin only: never touch any other CDN or Firebase API. */
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
