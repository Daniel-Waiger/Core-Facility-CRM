/* sw.js — app-shell cache for offline/installable use.
   Only ever registered when served over https/localhost (see index.html) — file:// pages
   cannot register a service worker at all, so this file is simply unused there. */

// Bump this on any deploy that changes cached files, so clients pick up the new version
// instead of serving a stale cache forever. Kept in step with the app version.
const CACHE_VERSION = '1.3.0';
const CACHE_NAME = 'core-facility-tracker-' + CACHE_VERSION;

// Precache the app shell. Paths are relative to this file's own scope, so this works
// unmodified whether the app is served at a domain root or under a GitHub Pages subpath.
// Keep the ?v= suffixes in sync with index.html — the page requests those exact URLs, and a
// precache entry without the query string would never match them.
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './favicon.svg',
  './css/app.css?v=1.3.0',
  './js/consts.js?v=1.3.0',
  './js/db.js?v=1.3.0',
  './js/ui.js?v=1.3.0',
  './js/views.js?v=1.3.0',
  './js/exports.js?v=1.3.0',
  './js/app.js?v=1.3.0',
  './libs/sql-asm.js',
  './libs/xlsx.full.min.js',
  './libs/jspdf.umd.min.js',
  './libs/docx.iife.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Cache-first: instant offline loads for the app shell. Anything not precached (e.g. a
// future asset) falls back to the network, and network failures return whatever's cached.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
