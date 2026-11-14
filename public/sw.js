// Offline support: the app's own files are cached so Brain Dump opens with no signal.
// Strategy: serve from cache instantly, refresh the cache in the background (new versions show up next launch).
const CACHE = 'braindump-v3';
const CORE = [
  '/', '/css/app.css', '/manifest.webmanifest',
  '/js/main.js', '/js/db.js', '/js/store.js', '/js/ui.js', '/js/ink.js', '/js/shapes.js', '/js/templates.js',
  '/js/editor.js', '/js/checkboxes.js', '/js/library.js', '/js/picker.js', '/js/importer.js', '/js/sync.js', '/js/settings.js',
  '/vendor/perfect-freehand.mjs', '/icons/icon-180.png', '/icons/icon-192.png',
  // the owner's Canva pages (keep in sync with CANVA in js/templates.js)
  ...['lined-stone', 'lined-peach', 'lined-lavender', 'lined-pink', 'lined-black', 'lined-charcoal', 'notes-checklist',
    'checklists-bright', 'checklists-soft', 'lemon-week', 'five-boxes', 'blocks']
    .flatMap((n) => [`/templates/${n}.png`, `/templates/thumbs/${n}.jpg`]),
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = url.pathname === '/index.html' ? '/' : url.pathname;
    const cached = await cache.match(key);
    const network = fetch(e.request).then((res) => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { e.waitUntil(network); return cached; }
    const res = await network;
    return res || new Response('Offline', { status: 503 });
  })());
});
