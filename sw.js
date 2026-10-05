/* ==========================================================================
   Trippo Travel Planner - Lightweight Offline Service Worker
   sw.js
   ========================================================================== */

const CACHE_NAME = 'trippo-cache-v2.3.64';
const STATIC_ASSETS = [
    './',
    './index.html',
    './styles/main.css',
    './styles/components.css',
    './js/app.js',
    './js/state.js',
    './js/db.js',
    './js/maps.js',
    './js/planner.js',
    './js/places.js',
    './js/bookings.js',
    './js/wishlist.js',
    './js/tools.js',
    './js/places-autocomplete.js',
    './manifest.webmanifest',
    './apple-touch-icon.png',
    './apple-touch-icon-180x180.png',
    './icon-192.png',
    './icon-512.png',
    './fad.jpg',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://cdn.jsdelivr.net/npm/sortablejs@latest/Sortable.min.js',
    'https://cdn.jsdelivr.net/npm/flatpickr',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// Install: Cache core local assets and CDN dependencies
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

// Fetch: Stale-while-revalidate for local static assets & CDN libraries, with offline navigation fallback
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Bypass non-GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    // Live streaming APIs & tile layers should not be cached in service worker
    // to avoid iOS WebKit tile blanking or memory exhaustion:
    if (
        url.hostname.includes('tile.openstreetmap.org') ||
        url.hostname.includes('arcgisonline.com') ||
        url.hostname.includes('tile.waymarkedtrails.org') ||
        url.hostname.includes('open-meteo.com') ||
        url.hostname.includes('project-osrm.org') ||
        url.hostname.includes('nominatim.openstreetmap.org') ||
        url.hostname.includes('googleapis.com') ||
        url.hostname.includes('supabase.co')
    ) {
        return;
    }

    // HTML Navigation requests: Network-First with guaranteed cache fallback
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseToCache);
                        });
                    }
                    return networkResponse;
                })
                .catch(async () => {
                    return (await caches.match(event.request)) || 
                           (await caches.match('./index.html')) || 
                           (await caches.match('./'));
                })
        );
        return;
    }

    // Local static assets & CDN dependencies: Cache-First with Network fallback / Stale-While-Revalidate
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                // Fetch in background to update cache if online
                fetch(event.request).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, networkResponse);
                        });
                    }
                }).catch(() => {});
                return cachedResponse;
            }

            return fetch(event.request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            });
        })
    );
});
