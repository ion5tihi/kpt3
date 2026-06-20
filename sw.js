const CACHE_NAME = 'kpt-assistant-v3.0.0';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './storage.js',
  './api.js',
  './speech.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Install Service Worker and cache all core assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching all app shell assets');
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate Service Worker and clean up old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch events: Stale-While-Revalidate strategy for app assets, bypass for APIs
self.addEventListener('fetch', (e) => {
  // Only handle GET requests (bypass POST requests for APIs)
  if (e.request.method !== 'GET') {
    return;
  }

  // Bypass chrome-extension:// or other non-http/https protocols
  if (!e.request.url.startsWith(self.location.origin) && !e.request.url.startsWith('http')) {
    return;
  }

  e.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(e.request).then((cachedResponse) => {
        const fetchedResponse = fetch(e.request).then((networkResponse) => {
          // Cache the new response if it's a valid local asset
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            cache.put(e.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(() => {
          // If network fails, we just return the cached response
        });

        // Return cached response instantly if available, otherwise wait for network
        return cachedResponse || fetchedResponse;
      });
    })
  );
});
