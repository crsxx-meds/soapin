const CACHE = 'soapin-v6';
const ASSETS = [
  './', './index.html',
  './css/base.css', './css/components.css', './css/visual.css', './css/theme.css',
  './js/app.js', './manifest.webmanifest',
  './assets/logo.svg', './assets/favicon.svg', './assets/icon-192.png', './assets/icon-512.png'
];

self.addEventListener('install', e =>
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));

self.addEventListener('activate', e =>
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())));

// Network-first: selalu ambil versi terbaru bila online, cache sebagai cadangan offline.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});
