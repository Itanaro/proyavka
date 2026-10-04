// Проявка: keeps the app itself available offline. Models live in IndexedDB, not here.
const CACHE = 'proyavka-shell-v13';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'vendor/ag-psd.js', 'vendor/fflate.js', 'vendor/ort.min.js',
  'vendor/ort-wasm-simd-threaded.jsep.mjs', 'vendor/fonts/ibm-plex-sans-cyrillic-400-normal.woff2','vendor/fonts/ibm-plex-sans-cyrillic-500-normal.woff2','vendor/fonts/ibm-plex-sans-cyrillic-600-normal.woff2','vendor/fonts/ibm-plex-sans-latin-400-normal.woff2','vendor/fonts/ibm-plex-sans-latin-500-normal.woff2','vendor/fonts/ibm-plex-sans-latin-600-normal.woff2','vendor/fonts/ibm-plex-mono-cyrillic-400-normal.woff2','vendor/fonts/ibm-plex-mono-latin-400-normal.woff2','vendor/fonts/ibm-plex-mono-cyrillic-500-normal.woff2','vendor/fonts/ibm-plex-mono-latin-500-normal.woff2', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
// install: always take fresh files from the network, not from the browser's HTTP cache
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, {cache: 'reload'})))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/models/')) return;
  // the page itself: fresh when online (so updates arrive), cached copy when offline
  if (e.request.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    // slow or stuck network (VPN): after 6 s open the cached copy instead of hanging on a white screen
    const net = fetch(e.request, {cache: 'no-store'});
    // keep the worker alive until the fresh page is stored, even when the cached copy was shown first (iOS kills it otherwise)
    e.waitUntil(net.then(r => r.ok ? caches.open(CACHE).then(x => x.put('index.html', r.clone())) : null).catch(() => {}));
    const late = new Promise(res => setTimeout(res, 6000)).then(() => caches.match('index.html')).then(hit => hit || net);
    e.respondWith(Promise.race([net, late]).catch(() => caches.match('index.html')).then(r => r || net));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
