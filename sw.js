/* Toofan service worker — offline app shell (hand-written, no build step).
 *
 * Strategy:
 * - Same-origin GET requests (app shell, JS/CSS chunks, manifest, icons):
 *   cache-first, then network; successful network responses refresh the cache.
 * - Everything else (weather APIs, map tiles, CDN scripts): NOT intercepted.
 *   API payloads are cached separately in localStorage by the app itself
 *   (see src/api/cache.ts) with honest stale-data labeling.
 *
 * This keeps the app installable and launchable offline; live data still
 * needs connectivity, and the UI says so truthfully.
 */
const CACHE = 'toofan-shell-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => {
        /* cache priming failed (offline on first visit) — not fatal */
      }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Only handle our own files. Never touch APIs, tiles, or CDN.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((hit) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches
              .open(CACHE)
              .then((cache) => cache.put(event.request, copy))
              .catch(() => {});
          }
          return res;
        })
        .catch(() => hit); // offline → fall back to cache (may be undefined)
      // Cache-first for instant offline loads; network refreshes in background.
      return hit || network;
    }),
  );
});
