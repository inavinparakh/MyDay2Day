/* service-worker.js — caches the app shell so the planner opens and works
   offline. Data itself lives in IndexedDB (not touched here). Google Drive
   backup calls always go to the network and are never cached.
   LIMITATION: a service worker keeps the app installable and lets it open
   instantly offline, but it does NOT let a fully-closed browser tab wake up
   at an exact future time to fire a reminder — see notifications.js and
   alarms.js for details on that limitation and its mitigation. */

const CACHE_NAME = 'navin-day-planner-v2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './styles.css',
  './config.js',
  './db.js',
  './utils.js',
  './categories.js',
  './tasks.js',
  './ui.js',
  './calendar.js',
  './notifications.js',
  './alarms.js',
  './backup.js',
  './google-drive.js',
  './settings.js',
  './app.js',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache Google APIs / OAuth traffic — always go live.
  if (url.origin.includes('googleapis.com') || url.origin.includes('accounts.google.com')) {
    return;
  }

  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.ok && url.origin === self.location.origin) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
