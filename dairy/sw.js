// Offline app shell: everything the app needs is cached on first load.
// Records never pass through here — they live in IndexedDB on the device.
const VERSION = 'dairy-herd-v2';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './js/app.js', './js/db.js', './js/time.js', './js/logic.js', './js/ui.js', './js/store.js', './js/actions.js',
  './js/components.js', './js/sample.js', './js/i18n.js', './js/pl.js', './js/auth.js',
  './js/views/today.js', './js/views/animal.js', './js/views/herd.js', './js/views/breeding.js', './js/views/milk.js', './js/views/more.js', './js/views/users.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Cache first (fast and works with no signal); refresh the cache in the background when online.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('./index.html') : null);
    const net = fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});
