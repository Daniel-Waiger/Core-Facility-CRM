/* sw.js — app-shell cache for offline/installable use.
   Only ever registered when served over https/localhost (see index.html) — file:// pages
   cannot register a service worker at all, so this file is simply unused there. */

// Bump this on any deploy that changes cached files, so clients pick up the new version
// instead of serving a stale cache forever. Kept in step with the app version.
const CACHE_VERSION = '1.5.7';
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
  './favicon.ico',
  './icons/icon-16.png',
  './icons/icon-32.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './css/app.css?v=1.5.7',
  './js/consts.js?v=1.5.7',
  './js/db.js?v=1.5.7',
  './js/ui.js?v=1.5.7',
  './js/views.js?v=1.5.7',
  './js/reports.js?v=1.5.7',
  './js/exports.js?v=1.5.7',
  './js/app.js?v=1.5.7',
  './libs/sql-asm.js',
  './libs/xlsx.full.min.js',
  './libs/jspdf.umd.min.js',
  './libs/docx.iife.js'
];

/* Precache with `cache: 'reload'` so every one of these comes off the network, never out of the
   browser's own HTTP cache.

   This matters most for the two UNVERSIONED entries, './' and './index.html'. GitHub Pages serves
   them with `Cache-Control: max-age=600`, so a plain cache.addAll() could satisfy them from the
   HTTP cache and seed a brand-new cache with the PREVIOUS release's index.html — a shell still
   asking for ?v=<old> assets. Those aren't in this list, so the fetch handler below would fetch
   and cache them too, pinning the user to the old release under a correctly-named new cache. That
   really happened: clients sat on 1.4.0 while 1.5.1 was live and every version string on the
   server said 1.5.1. */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' }))))
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

/* Two strategies, because the app shell and its assets have opposite requirements.

   The HTML shell (a navigation, or index.html itself) carries no ?v= of its own — it is the thing
   that NAMES which ?v= assets to load. Serving it cache-first means a stale shell keeps pointing at
   a stale release forever, with no way back short of clearing site data. So it goes NETWORK-FIRST:
   take the fresh copy when the network is there, fall back to cache only when it isn't. That costs
   one request on load and is what makes an update actually arrive.

   That fresh-copy fetch uses `cache: 'reload'` for the same reason the precache step above does:
   GitHub Pages serves every page — this app's shell AND every docs/manual/*.html page, since this
   worker's scope is the whole site — with `Cache-Control: max-age=600`. A plain `fetch(event.request)`
   still consults the browser's own HTTP cache first and can silently return a response cached
   before the last deploy, with no network round-trip at all, on anything that isn't an explicit
   reload (a link click to an already-visited page, reopening a tab, going back/forward) — so
   "network-first" without `reload` is, for up to 10 minutes after any deploy, actually
   "cache-first" for exactly the requests this branch exists to keep fresh. This is what let the
   manual's theme-toggle button vanish on ordinary navigation right after it shipped, reappearing
   only on a hard refresh (which forces revalidation the way `reload` does here explicitly).

   Everything else is cache-first as before. Those URLs carry an explicit ?v=, so a given URL's
   content never changes — a cache hit is always correct, and it is what makes the app load
   instantly and work offline. */
function isShellRequest(request) {
  if (request.mode === 'navigate') return true;
  const url = new URL(request.url);
  return url.origin === self.location.origin && /(^\/|\/|\.html)$/.test(url.pathname) && !url.search;
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  if (isShellRequest(event.request)) {
    event.respondWith(
      fetch(event.request, { cache: 'reload' })
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        // Offline (or the request failed): fall back to whatever shell we have. Scoped to this
        // release's cache so a leftover cache can never answer for the current one.
        .catch(() => caches.match(event.request, { cacheName: CACHE_NAME })
          .then((cached) => cached || caches.match('./index.html', { cacheName: CACHE_NAME })))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request, { cacheName: CACHE_NAME }).then((cached) => {
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
