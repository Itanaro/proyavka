// Проявка: keeps the app itself available offline. Models live in IndexedDB, not here.
const CACHE = 'proyavka-shell-v11';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'vendor/ag-psd.js', 'vendor/fflate.js', 'vendor/ort.min.js',
  'vendor/ort-wasm-simd-threaded.jsep.mjs', 'vendor/fonts/ibm-plex-sans-cyrillic-400-normal.woff2','vendor/fonts/ibm-plex-sans-cyrillic-500-normal.woff2','vendor/fonts/ibm-plex-sans-cyrillic-600-normal.woff2','vendor/fonts/ibm-plex-sans-latin-400-normal.woff2','vendor/fonts/ibm-plex-sans-latin-500-normal.woff2','vendor/fonts/ibm-plex-sans-latin-600-normal.woff2','vendor/fonts/ibm-plex-mono-cyrillic-400-normal.woff2','vendor/fonts/ibm-plex-mono-latin-400-normal.woff2','vendor/fonts/ibm-plex-mono-cyrillic-500-normal.woff2','vendor/fonts/ibm-plex-mono-latin-500-normal.woff2', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/models/')) return;
  // the page itself: fresh when online (so updates arrive), cached copy when offline
  if (e.request.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    e.respondWith(fetch(e.request, {cache: 'no-store'}).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put('index.html', c)); } return r; })
      .catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
