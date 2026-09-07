// Simha Workbench service worker — PWA offline shell + smart caching.
// Strategy:
//   · App shell / navigation requests: network-first, fall back to cached
//     shell when offline (so the installed app always opens).
//   · Static assets (icons, fonts, _next/static): cache-first — immutable
//     hashed bundles never re-fetch.
//   · API calls: never cached (auth + streaming require freshness).
// Version bump invalidates old caches on deploy.
const VERSION = 'sw-v3';
const SHELL_CACHE = `simha-shell-${VERSION}`;
const ASSET_CACHE = `simha-assets-${VERSION}`;

const SHELL_URLS = ['/', '/chat', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API + SSE: always network, never cache (auth, streaming chat)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  // Static assets: cache-first (hashed bundles + icons)
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((resp) => {
        const copy = resp.clone();
        caches.open(ASSET_CACHE).then((c) => c.put(request, copy));
        return resp;
      })),
    );
    return;
  }

  // Navigation/app shell: network-first with offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
          return resp;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('/chat'))),
    );
  }
});