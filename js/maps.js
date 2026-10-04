/* ==========================================================================
   Trippo Travel Planner - Maps & Overlays Engine
   js/maps.js
   ========================================================================== */

import { getActiveTrip, trips, activePlacesTripId, activePlacesStopIndex, showNotification } from './state.js';

export let plannerMap = null;
export let placesMap = null;
export let wishlistMap = null;

export let plannerHikingLayer = null;
export let wishlistHikingLayer = null;

export let pMarkers = [];
export let pLines = [];
export let cMarkers = [];
export let cLines = [];
export let wMarkers = [];

let activeRouteToken = null;

const BASE_MAP_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const BASE_MAP_OPTS = {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
};
const FALLBACK_MAP_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';

export function createBaseTileLayer() {
    const layer = L.tileLayer(BASE_MAP_URL, BASE_MAP_OPTS);
    layer.on('tileerror', (error) => {
        if (error.tile && !error.tile.dataset.fallback) {
            error.tile.dataset.fallback = 'true';
            const { z, x, y } = error.coords;
            error.tile.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`;
        }
    });
    return layer;
}

export const trainOverlayModes = { planner: 'off', wishlist: 'off' };
export const trainLayers = {
    planner: { standard: null, maxspeed: null },
    wishlist: { standard: null, maxspeed: null }
};

const mapObservers = new WeakMap();

export function attachMapResizeObserver(mapInstance, containerId) {
    if (typeof window !== 'undefined' && typeof window.attachMapResizeObserver === 'function') {
        const id = containerId || (mapInstance && mapInstance.getContainer ? mapInstance.getContainer().id : null);
        if (id) {
            return window.attachMapResizeObserver(mapInstance, id);
        }
    }
    if (!mapInstance || typeof ResizeObserver === 'undefined') return;
    let container = null;
    try {
        container = typeof containerId === 'string' ? document.getElementById(containerId) : mapInstance.getContainer();
    } catch (e) {
        return;
    }
    if (!container || mapObservers.has(mapInstance)) return;

    let debounceTimer = null;
    const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
            const width = entry.contentRect.width;
            const height = entry.contentRect.height;
            if (width > 0 && height > 0) {
                if (mapInstance && typeof mapInstance.invalidateSize === 'function') {
                    mapInstance.invalidateSize({ debounceMove: true });
                }
                if (mapInstance && mapInstance._pendingBounds && typeof mapInstance.fitBounds === 'function') {
                    try {
                        mapInstance.fitBounds(mapInstance._pendingBounds, { padding: [40, 40], maxZoom: 14 });
                        mapInstance._pendingBounds = null;
                    } catch (e) {}
                }
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    if (mapInstance && typeof mapInstance.invalidateSize === 'function') {
                        mapInstance.invalidateSize({ debounceMove: true });
                    }
                }, 320);
            }
        }
    });

    ro.observe(container);
    mapObservers.set(mapInstance, ro);
}

export function safeInvalidate(mapInstance, extraDelay = 0) {
    if (!mapInstance) return;
    setTimeout(() => {
        requestAnimationFrame(() => {
            if (mapInstance && typeof mapInstance.invalidateSize === 'function') {
                mapInstance.invalidateSize();
            }
        });
    }, extraDelay);
}

export function setPlannerMap(m) { plannerMap = m; }
export function setPlacesMap(m) { placesMap = m; }
export function setWishlistMap(m) { wishlistMap = m; }

export function initPlannerMap() {
    if (!plannerMap && typeof L !== 'undefined') {
        const el = document.getElementById('planner-map');
        if (el) {
            plannerMap = L.map('planner-map', {
                tap: false,
                zoomControl: true,
                fullscreenControl: false,
                dragging: true,
                touchZoom: true,
                scrollWheelZoom: true,
                doubleClickZoom: true,
                boxZoom: true
            }).setView([30.2241, -92.0198], 3);
            createBaseTileLayer().addTo(plannerMap);
            attachMapResizeObserver(plannerMap, 'planner-map');
        }
    }
    if (plannerMap) {
        window.plannerMap = plannerMap;
        attachMapResizeObserver(plannerMap, 'planner-map');
        [50, 150, 300, 500].forEach(d => safeInvalidate(plannerMap, d));
    }
    return plannerMap;
}

export function initPlacesMap() {
    if (!placesMap && typeof L !== 'undefined') {
        const el = document.getElementById('places-map');
        if (el) {
            placesMap = L.map('places-map', {
                tap: false,
                zoomControl: true,
                fullscreenControl: false,
                dragging: true,
                touchZoom: true,
                scrollWheelZoom: true,
                doubleClickZoom: true,
                boxZoom: true
            }).setView([30.2241, -92.0198], 12);
            createBaseTileLayer().addTo(placesMap);
            attachMapResizeObserver(placesMap, 'places-map');
        }
    }
    if (placesMap) {
        window.placesMap = placesMap;
        attachMapResizeObserver(placesMap, 'places-map');
        [50, 150, 300, 500].forEach(d => safeInvalidate(placesMap, d));
    }
    return placesMap;
}

export function initWishlistMap() {
    if (!wishlistMap && typeof L !== 'undefined') {
        const el = document.getElementById('wishlist-map');
        if (el) {
            wishlistMap = L.map('wishlist-map', {
                tap: false,
                zoomControl: true,
                fullscreenControl: false,
                dragging: true,
                touchZoom: true,
                scrollWheelZoom: true,
                doubleClickZoom: true,
                boxZoom: true
            }).setView([20, 0], 2);
            createBaseTileLayer().addTo(wishlistMap);
            attachMapResizeObserver(wishlistMap, 'wishlist-map');
            if (window.handleWishlistMapClick) {
                wishlistMap.on('click', window.handleWishlistMapClick);
            }
        }
    }
    if (wishlistMap) {
        window.wishlistMap = wishlistMap;
        attachMapResizeObserver(wishlistMap, 'wishlist-map');
        [50, 150, 300, 500].forEach(d => safeInvalidate(wishlistMap, d));
    }
    return wishlistMap;
}

export function cycleTrainOverlay(target) {
    const map = target === 'wishlist' ? wishlistMap : plannerMap;
    const btn = document.getElementById(target === 'wishlist' ? 'wishlist-train-btn' : 'planner-train-btn');
    if (!map) return;

    if (!trainLayers[target].standard) {
        trainLayers[target].standard = L.tileLayer('https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', {
            maxZoom: 19,
            opacity: 0.85,
            zIndex: 1000,
            attribution: '&copy; OpenRailwayMap'
        });
    }
    if (!trainLayers[target].maxspeed) {
        trainLayers[target].maxspeed = L.tileLayer('https://tiles.openrailwaymap.org/maxspeed/{z}/{x}/{y}.png', {
            maxZoom: 19,
            opacity: 0.85,
            zIndex: 1000,
            attribution: '&copy; OpenRailwayMap'
        });
    }

    const current = trainOverlayModes[target];
    if (current === 'off') {
        trainOverlayModes[target] = 'standard';
        map.addLayer(trainLayers[target].standard);
        if (btn) btn.innerText = '🚆 Trains: Red';
        showNotification("Standard Railway overlay active");
    } else if (current === 'standard') {
        map.removeLayer(trainLayers[target].standard);
        trainOverlayModes[target] = 'maxspeed';
        map.addLayer(trainLayers[target].maxspeed);
        if (btn) btn.innerText = '🚆 Trains: Speed';
        showNotification("Speed overlay active");
    } else {
        map.removeLayer(trainLayers[target].maxspeed);
        trainOverlayModes[target] = 'off';
        if (btn) btn.innerText = '🚆 Trains: Off';
        showNotification("Train overlays hidden");
    }
}

export function toggleTrails(target) {
    const map = target === 'wishlist' ? wishlistMap : plannerMap;
    if (!map) return;

    let layer = target === 'wishlist' ? wishlistHikingLayer : plannerHikingLayer;
    if (!layer) {
        layer = L.tileLayer('https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png', {
            maxZoom: 18,
            opacity: 0.85,
            zIndex: 900,
            attribution: '&copy; Waymarked Trails'
        });
        if (target === 'wishlist') wishlistHikingLayer = layer;
        else plannerHikingLayer = layer;
    }

    if (map.hasLayer(layer)) {
        map.removeLayer(layer);
        showNotification("Hiking trails overlay hidden");
    } else {
        map.addLayer(layer);
        showNotification("🥾 Waymarked Hiking Trails active");
    }
}

export function openAllTrailsNearCenter() {
    if (!wishlistMap) return;
    const center = wishlistMap.getCenter();
    const clampedLatMax = Math.min(85, center.lat + 0.3);
    const clampedLatMin = Math.max(-85, center.lat - 0.3);
    const lngMax = center.lng + 0.3;
    const lngMin = center.lng - 0.3;
    const url = `https://www.alltrails.com/explore?b_tl_lat=${clampedLatMax}&b_tl_lng=${lngMin}&b_br_lat=${clampedLatMin}&b_br_lng=${lngMax}`;
    window.open(url, '_blank');
}

export function drawPlannerMapRoute() {
    if (!plannerMap) return;
    pMarkers.forEach(m => plannerMap.removeLayer(m));
    pLines.forEach(p => plannerMap.removeLayer(p));
    pMarkers = [];
    pLines = [];

    const trip = getActiveTrip();
    if (!trip || !trip.stops || trip.stops.length === 0) return;
    const stops = trip.stops;

    const bounds = L.latLngBounds();
    stops.forEach(stop => {
        if (stop.lat === 0 && stop.lon === 0) return;
        const marker = L.circleMarker([stop.lat, stop.lon], {
            radius: 8,
            fillColor: "#124b43",
            color: "#ffffff",
            weight: 2.5,
            fillOpacity: 1
        }).addTo(plannerMap);
        marker.bindPopup(`<div style="font-weight:700; font-size:14px; color:#124b43; padding:2px 0;">📍 ${stop.name}</div><div style="font-size:12px; color:#555;">${stop.nights} Night${stop.nights !== 1 ? 's' : ''}</div>`);
        pMarkers.push(marker);
        bounds.extend([stop.lat, stop.lon]);
    });

    for (let i = 0; i < stops.length - 1; i++) {
        if ((stops[i].lat === 0 && stops[i].lon === 0) || (stops[i + 1].lat === 0 && stops[i + 1].lon === 0)) continue;

        const pLine = L.polyline([[stops[i].lat, stops[i].lon], [stops[i + 1].lat, stops[i + 1].lon]], {
            color: '#124b43',
            weight: 5,
            dashArray: '8, 8',
            opacity: 0.85
        }).addTo(plannerMap);

        pLine.on('click', function () {
            if (window.openTransitBookingModal) window.openTransitBookingModal(i);
        });
        pLines.push(pLine);

        if (stops[i].transit && stops[i].transit.method) {
            const emojis = { plane: '✈️', train: '🚆', bus: '🚌', car: '🚗' };
            const emoji = emojis[stops[i].transit.method] || '🎟';
            let midLat = (stops[i].lat + stops[i + 1].lat) / 2;
            let midLon = (stops[i].lon + stops[i + 1].lon) / 2;

            const icon = L.divIcon({
                className: 'transit-div-icon',
                html: `<div style="background:white; border-radius:50%; width:30px; height:30px; display:flex; align-items:center; justify-content:center; font-size:16px; border:2px solid var(--primary); box-shadow:0 3px 6px rgba(0,0,0,0.3); cursor:pointer;">${emoji}</div>`,
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            });

            const marker = L.marker([midLat, midLon], { icon: icon, zIndexOffset: 1000 }).addTo(plannerMap);
            marker.on('click', function () {
                if (window.openTransitBookingModal) window.openTransitBookingModal(i);
            });
            pMarkers.push(marker);
        }
    }

    requestAnimationFrame(() => {
        if (plannerMap) {
            plannerMap.invalidateSize();
            const size = plannerMap.getSize ? plannerMap.getSize() : null;
            if (bounds.isValid()) {
                if (!size || size.x === 0 || size.y === 0) {
                    plannerMap._pendingBounds = bounds;
                } else {
                    plannerMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
                    plannerMap._pendingBounds = null;
                }
            }
        }
    });
}

export async function drawPlacesMapRoute(dayPlaces) {
    if (!placesMap) return;
    cMarkers.forEach(m => placesMap.removeLayer(m));
    cLines.forEach(p => placesMap.removeLayer(p));
    cMarkers = [];
    cLines = [];

    const currentToken = Date.now();
    activeRouteToken = currentToken;

    if (dayPlaces.length === 0) {
        const trip = trips.find(t => t.id === activePlacesTripId);
        if (trip && trip.stops && trip.stops[activePlacesStopIndex]) {
            const city = trip.stops[activePlacesStopIndex];
            if (placesMap) {
                placesMap.setView([city.lat, city.lon], 12);
                safeInvalidate(placesMap);
            }
        }
        return;
    }

    const validPlaces = dayPlaces.filter(p => !isNaN(p.lat) && !isNaN(p.lon) && !(p.lat === 0 && p.lon === 0));
    const bounds = L.latLngBounds();
    validPlaces.forEach((p, index) => {
        const isStart = index === 0;
        const bg = isStart ? 'var(--accent)' : 'var(--primary)';
        const iconHtml = isStart ? '🏨' : (index + 1);

        const icon = L.divIcon({
            className: 'custom-div-icon',
            html: `<div style="background:${bg};color:white;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;border:2px solid white;box-shadow:0 3px 6px rgba(0,0,0,0.3);">${iconHtml}</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });
        const marker = L.marker([p.lat, p.lon], { icon: icon }).addTo(placesMap);
        cMarkers.push(marker);
        bounds.extend([p.lat, p.lon]);
    });

    if (validPlaces.length > 1) {
        const coords = validPlaces.map(p => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2500);

            const res = await fetch(`https://router.project-osrm.org/route/v1/walking/${coords}?overview=full&geometries=geojson`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            const data = await res.json();

            if (activeRouteToken !== currentToken) return;

            if (data.routes && data.routes[0]) {
                const routeObj = data.routes[0];
                const routeLine = L.geoJSON(routeObj.geometry, {
                    style: { color: '#ff4757', weight: 5, opacity: 0.85, dashArray: '8, 8' }
                }).addTo(placesMap);

                routeLine.on('click', function () {
                    const p1 = validPlaces[0];
                    const p2 = validPlaces[1] || p1;
                    const mapUrl = `https://www.google.com/maps/dir/?api=1&origin=${p1.lat},${p1.lon}&destination=${p2.lat},${p2.lon}&travelmode=walking`;
                    window.open(mapUrl, '_blank');
                });

                cLines.push(routeLine);
            }
        } catch (e) {
            if (activeRouteToken !== currentToken) return;
            const latlngs = validPlaces.map(p => [p.lat, p.lon]);
            const polyline = L.polyline(latlngs, {
                color: '#ff4757',
                weight: 4,
                dashArray: '6, 6'
            }).addTo(placesMap);
            cLines.push(polyline);
        }
    }

    if (placesMap && bounds.isValid()) {
        const size = placesMap.getSize ? placesMap.getSize() : null;
        if (!size || size.x === 0 || size.y === 0) {
            placesMap._pendingBounds = bounds;
        } else {
            placesMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
            placesMap._pendingBounds = null;
        }
        safeInvalidate(placesMap);
    }
}

export function toggleMapMode(target) {
    let containerEl = null;
    let mapInstance = null;
    let btnId = null;

    if (target === 'planner') {
        containerEl = document.getElementById('planner-view');
        mapInstance = plannerMap;
        btnId = 'planner-fullscreen-btn';
    } else if (target === 'places') {
        containerEl = document.getElementById('places-city-view');
        mapInstance = placesMap;
        btnId = 'places-fullscreen-btn';
    } else if (target === 'wishlist') {
        containerEl = document.getElementById('wishlist-detail-view');
        mapInstance = wishlistMap;
        btnId = 'wishlist-fullscreen-btn';
    }

    if (!containerEl) return;

    const isExpanded = containerEl.classList.toggle('map-expanded');
    const btn = btnId ? document.getElementById(btnId) : null;
    if (btn) {
        if (isExpanded) {
            btn.innerHTML = '📋 Split View';
            btn.classList.add('active-mode');
        } else {
            btn.innerHTML = '⛶ Full Map';
            btn.classList.remove('active-mode');
        }
    }

    safeInvalidate(mapInstance, 50);
    safeInvalidate(mapInstance, 150);
    safeInvalidate(mapInstance, 320);
}

if (typeof window !== 'undefined') {
    window.toggleMapMode = toggleMapMode;
}
