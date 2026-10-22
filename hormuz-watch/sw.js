/* دیده‌بان هرمز — Service Worker: کش پوسته اپ (آفلاین برای خودِ اپ؛ داده‌ها همیشه تازه از شبکه) */
const CACHE = 'hormuz-watch-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icon.svg',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // داده‌های زنده (پرواز، هوا، کاشی نقشه) همیشه از شبکه — کش نمی‌شوند
  const liveHosts = ['adsb.lol', 'adsb.fi', 'codetabs.com', 'allorigins.win', 'open-meteo.com', 'basemaps.cartocdn.com'];
  if (e.request.method !== 'GET' || liveHosts.some(h => url.hostname.includes(h))) {
    return; // پیش‌فرض مرورگر
  }
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
