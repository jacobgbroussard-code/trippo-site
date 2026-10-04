/* ==========================================================================
   Trippo Travel Planner - Lightweight Offline Service Worker
   sw.js
   ========================================================================== */

const CACHE_NAME = 'trippo-cache-v2.3.44';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/styles/main.css',
    '/styles/components.css',
    '/js/app.js',
    '/js/state.js',
    '/js/db.js',
    '/js/maps.js',
    '/js/planner.js',
    '/js/places.js',
    '/js/bookings.js',
    '/js/wishlist.js',
    '/js/tools.js',
    '/manifest.webmanifest',
    '/fad.jpg'
];

// Install: Cache core local assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        }).then(() => self.skipWaiting())
    );
});

// Activate: Purge stale caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch: Stale-while-revalidate for local static assets, Network-first for external APIs
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Bypass non-GET requests (Supabase mutations, etc.)
    if (event.request.method !== 'GET') {
        return;
    }

    // External APIs (Nominatim, Open-Meteo, OSRM, Supabase, Tile servers) -> Network first
    if (url.origin !== self.location.origin) {
        event.respondWith(
            fetch(event.request).catch(() => caches.match(event.request))
        );
        return;
    }

    // Local static assets -> Stale-while-revalidate strategy
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            const fetchPromise = fetch(event.request)
                .then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseToCache);
                        });
                    }
                    return networkResponse;
                })
                .catch(() => cachedResponse);

            return cachedResponse || fetchPromise;
        })
    );
});
