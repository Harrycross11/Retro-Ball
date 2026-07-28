// Bump this whenever any cached file changes - a new name forces the old
// cache out. Less critical now the fetch handler below is network-first
// (see that comment), but still worth bumping on real updates so anyone
// currently offline gets the new files into their fallback cache sooner.
const CACHE_NAME = 'retro-ball-v3';
const ASSETS = [
  './',
  './index.html',
  './game.js',
  './style.css',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Network-first, falling back to the cached copy only when there's no
// connection - this game is under active development (updates go out
// often), so always prefer whatever's actually live over a possibly-stale
// cached copy. Every successful network fetch also refreshes the cache, so
// the offline fallback stays reasonably current too. Previously this was
// cache-first on the assumption the game "barely changes" - that assumption
// stopped being true and left updates invisible until CACHE_NAME was bumped
// by hand each time.
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
