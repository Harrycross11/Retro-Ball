// Bump this whenever any cached file changes - a new name forces the old
// cache out and the new files to be fetched fresh, rather than someone's
// install getting stuck on a stale copy forever.
const CACHE_NAME = 'retro-ball-v2';
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

// Cache-first - this game's assets barely change, so prefer the instant
// offline copy and only fall back to the network for anything uncached
// (e.g. the relay server's own WebSocket connection, which this never
// touches anyway since that's a direct ws:// connection, not a fetch).
self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then((cached) => cached || fetch(e.request)));
});
