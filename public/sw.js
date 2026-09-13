/* Minimal service worker for PWA installability (GUIDE.md §4.4).
 * Installed PWAs are granted autoplay on desktop — one of the gates that
 * removes the "click to enable sound" restriction without registry edits.
 * Network-first passthrough: never serve stale dashboard data.
 */
const CACHE = 'vendor-orders-v1';
const CORE = ['/manifest.webmanifest', '/favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE)).catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Only handle GET navigations/assets; let WS/API calls pass through.
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/quickVerse/ws')) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        // Cache a copy of static assets only.
        if (res.ok && (url.pathname.match(/\.(js|css|png|svg|mp3|webmanifest)$/))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy)).catch(() => undefined);
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || Promise.reject(new Error('offline'))))
  );
});
