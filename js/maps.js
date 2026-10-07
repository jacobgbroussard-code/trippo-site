/* ==========================================================================
   Trippo Travel Planner - Maps & Overlays Engine
   js/maps.js
   ========================================================================== */

import { getActiveTrip, trips, activePlacesTripId, activePlacesStopIndex, showNotification, escapeHTML, escapeJS, getDistance, calculateTransitEstimate, safeGetStorage } from './state.js';

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

const BASE_MAP_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
const BASE_MAP_OPTS = {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, Esri Japan, METI, Esri China (Hong Kong), Esri (Thailand), TomTom, 2012'
};
const FALLBACK_MAP_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';

export const GOOGLE_MAPS_KEY = atob('QUl6YVN5Qk12bExzNXNmenJJcFFsZ216dzFZcVRjU2NnSXl6TERn');

export function getStreetViewUrl(lat, lon, width = 600, height = 300) {
    if (!lat || !lon) return '';
    return `https://maps.googleapis.com/maps/api/streetview?size=${width}x${height}&location=${lat},${lon}&fov=90&heading=0&pitch=0&key=${GOOGLE_MAPS_KEY}`;
}

export function openStreetViewModal(lat, lon, title = 'Street View') {
    if (!lat || !lon) {
        showNotification("Location coordinates not available.");
        return;
    }
    const modal = document.getElementById('streetview-modal');
    const img = document.getElementById('streetview-modal-img');
    const titleEl = document.getElementById('streetview-modal-title');
    const gmapsLink = document.getElementById('streetview-gmaps-link');

    if (titleEl) titleEl.innerText = title;
    if (img) {
        img.src = getStreetViewUrl(lat, lon, 640, 360);
    }
    if (gmapsLink) {
        gmapsLink.href = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`;
    }
    if (modal) modal.style.display = 'flex';
}

export let baseLayers = { planner: null, places: null, wishlist: null };

export function updateMapProvider() {
    const provider = safeGetStorage('trippo_map_provider', 'mapbox-light');
    const mapboxKey = safeGetStorage('trippo_mapbox_key', atob('cGsuZXlKMUlqb2ljMjV2YjNCcGRIa2lMQ0poSWpvaVkyMTFlVE4xZDNFNU1ESTNNako2Y0hFNWIzbDFaamd3Y2lKOS51SnRoR0tnMmsweTJKOUtycTRvMWdB'));
    
    let url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
    let opts = {
        maxZoom: 19,
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, Esri Japan, METI, Esri China (Hong Kong), Esri (Thailand), TomTom, 2012'
    };

    if (provider === 'carto-voyager') {
        url = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
        opts.attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
    } else if (provider === 'carto-positron') {
        url = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
        opts.attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
    } else if (provider === 'carto-dark') {
        url = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
        opts.attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
    } else if (provider === 'esri-topo') {
        url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}';
    } else if (provider === 'esri-satellite') {
        url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
        opts.attribution = 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community';
    } else if (provider === 'esri-natgeo') {
        url = 'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}';
        opts.attribution = 'Tiles &copy; Esri &mdash; National Geographic, Esri, DeLorme, NAVTEQ, UNEP-WCMC, USGS, NASA, ESA, METI, NRCAN, GEBCO, NOAA, iPC';
    } else if (provider === 'opentopo') {
        url = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
        opts.attribution = 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)';
        opts.maxZoom = 17;
    } else if (provider === 'osm') {
        url = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
        opts.attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
    } else if (provider.startsWith('mapbox') && mapboxKey) {
        const style = provider.replace('mapbox-', '');
        const styleId = {
            'outdoors': 'outdoors-v12',
            'streets': 'streets-v12',
            'light': 'light-v11',
            'dark': 'dark-v11'
        }[style] || 'outdoors-v12';

        url = `https://api.mapbox.com/styles/v1/mapbox/${styleId}/tiles/256/{z}/{x}/{y}@2x?access_token=${mapboxKey}`;
        opts = {
            maxZoom: 19,
            attribution: '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        };
    }

    const replaceLayer = (mapObj, key) => {
        if (!mapObj) return;
        if (baseLayers[key]) mapObj.removeLayer(baseLayers[key]);
        baseLayers[key] = L.tileLayer(url, opts);
        baseLayers[key].on('tileerror', (error) => {
            if (error.tile && !error.tile.dataset.fallback) {
                error.tile.dataset.fallback = 'true';
                const { z, x, y } = error.coords;
                error.tile.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`;
            }
        });
        baseLayers[key].addTo(mapObj);
        baseLayers[key].bringToBack();
    };

    replaceLayer(plannerMap, 'planner');
    replaceLayer(placesMap, 'places');
    replaceLayer(wishlistMap, 'wishlist');
}
window.updateMapProvider = updateMapProvider;

export function createBaseTileLayer(mapKey) {
    const layer = L.tileLayer('', { maxZoom: 19 });
    baseLayers[mapKey] = layer;
    return layer;
}

export const trainOverlayModes = { planner: 'off', wishlist: 'off' };
export const trainLayers = {
    planner: { standard: null, maxspeed: null },
    wishlist: { standard: null, maxspeed: null }
};

const mapObservers = new WeakMap();

export function attachMapResizeObserver(mapInstance, containerId) {
    if (!mapInstance || typeof ResizeObserver === 'undefined') return null;
    let container = null;
    try {
        container = typeof containerId === 'string'
            ? document.getElementById(containerId)
            : (mapInstance.getContainer ? mapInstance.getContainer() : null);
    } catch (e) {
        return null;
    }
    if (!container) return null;
    if (container._trippoObserverAttached) return null;
    container._trippoObserverAttached = true;

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
                }, 200);
            }
        }
    });

    ro.observe(container);
    mapObservers.set(mapInstance, ro);
    return ro;
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
            createBaseTileLayer('planner').addTo(plannerMap);
            updateMapProvider();
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
            createBaseTileLayer('places').addTo(placesMap);
            updateMapProvider();
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
            createBaseTileLayer('wishlist').addTo(wishlistMap);
            updateMapProvider();
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

// --- SHORTEST ROUTE PATH & ANTIMERIDIAN INTERPOLATION ---
export function getShortestRoutePath(lat1, lon1, lat2, lon2) {
    let l1 = Number(lon1);
    let l2 = Number(lon2);
    let lt1 = Number(lat1);
    let lt2 = Number(lat2);

    while (l1 > 180) l1 -= 360;
    while (l1 < -180) l1 += 360;
    while (l2 > 180) l2 -= 360;
    while (l2 < -180) l2 += 360;

    const diff = l2 - l1;

    // Standard case: shortest path does NOT cross the antimeridian
    if (Math.abs(diff) <= 180) {
        return {
            crossesAntimeridian: false,
            latlngs: [[lt1, l1], [lt2, l2]],
            midLat: (lt1 + lt2) / 2,
            midLon: (l1 + l2) / 2
        };
    }

    // Antimeridian crossing:
    if (diff > 180) {
        // Traveler is heading WEST from l1 (e.g. -118) across -180 into eastern hemisphere to l2 (e.g. +140)
        const totalSpan = 360 - diff;
        const dToDateLine = Math.abs(-180 - l1);
        const t = dToDateLine / totalSpan;
        const latEdge = lt1 + t * (lt2 - lt1);

        const halfSpan = totalSpan / 2;
        const midLon = (halfSpan <= dToDateLine) ? (l1 - halfSpan) : (180 - (halfSpan - dToDateLine));
        const midLat = (lt1 + lt2) / 2;

        const latlngs = [
            [[lt1, l1], [latEdge, -180]],
            [[latEdge, 180], [lt2, l2]],
            // Mirrored/wrapped segments so the line stays connected during world panning
            [[latEdge, -180], [lt2, l2 - 360]],
            [[lt1, l1 + 360], [latEdge, 180]]
        ];

        return {
            crossesAntimeridian: true,
            latlngs,
            midLat,
            midLon
        };
    } else {
        // diff < -180: Traveler is heading EAST from l1 (e.g. +140) across +180 into western hemisphere to l2 (e.g. -118)
        const totalSpan = 360 + diff;
        const dToDateLine = 180 - l1;
        const t = dToDateLine / totalSpan;
        const latEdge = lt1 + t * (lat2 - lt1);

        const halfSpan = totalSpan / 2;
        const midLon = (halfSpan <= dToDateLine) ? (l1 + halfSpan) : (-180 + (halfSpan - dToDateLine));
        const midLat = (lt1 + lt2) / 2;

        const latlngs = [
            [[lt1, l1], [latEdge, 180]],
            [[latEdge, -180], [lt2, l2]],
            // Mirrored/wrapped segments so the line stays connected during world panning
            [[lt1, l1 - 360], [latEdge, -180]],
            [[latEdge, 180], [lt2, l2 + 360]]
        ];

        return {
            crossesAntimeridian: true,
            latlngs,
            midLat,
            midLon
        };
    }
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
        marker.bindPopup(`<div style="font-weight:700; font-size:14px; color:#124b43; padding:2px 0;">📍 ${escapeHTML(stop.name)}</div><div style="font-size:12px; color:#555;">${stop.nights} Night${stop.nights !== 1 ? 's' : ''}</div>`);
        pMarkers.push(marker);
        bounds.extend([stop.lat, stop.lon]);
    });

    for (let i = 0; i < stops.length - 1; i++) {
        if ((stops[i].lat === 0 && stops[i].lon === 0) || (stops[i + 1].lat === 0 && stops[i + 1].lon === 0)) continue;

        const routeInfo = getShortestRoutePath(stops[i].lat, stops[i].lon, stops[i + 1].lat, stops[i + 1].lon);

        const pLine = L.polyline(routeInfo.latlngs, {
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

            const addTransitMarker = (lat, lon) => {
                const icon = L.divIcon({
                    className: 'transit-div-icon',
                    html: `<div style="background:white; border-radius:50%; width:30px; height:30px; display:flex; align-items:center; justify-content:center; font-size:16px; border:2px solid var(--primary); box-shadow:0 3px 6px rgba(0,0,0,0.3); cursor:pointer;">${emoji}</div>`,
                    iconSize: [32, 32],
                    iconAnchor: [16, 16]
                });

                const marker = L.marker([lat, lon], { icon: icon, zIndexOffset: 1000 }).addTo(plannerMap);
                marker.on('click', function () {
                    if (window.openTransitBookingModal) window.openTransitBookingModal(i);
                });
                pMarkers.push(marker);
            };

            addTransitMarker(routeInfo.midLat, routeInfo.midLon);
            if (routeInfo.crossesAntimeridian) {
                const mirrorLon = routeInfo.midLon < 0 ? routeInfo.midLon + 360 : routeInfo.midLon - 360;
                addTransitMarker(routeInfo.midLat, mirrorLon);
            }
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

export function getPlaceModeStyle(mode) {
    if (mode === 'driving') {
        return {
            color: '#2563eb',
            weight: 5,
            opacity: 0.9,
            dashArray: null,
            borderColor: '#2563eb',
            emoji: '🚗'
        };
    } else if (mode === 'transit') {
        return {
            color: '#8b5cf6',
            weight: 5,
            opacity: 0.9,
            dashArray: '8, 6',
            borderColor: '#8b5cf6',
            emoji: '🚆'
        };
    } else {
        return {
            color: '#10b981',
            weight: 5,
            opacity: 0.9,
            dashArray: '6, 6',
            borderColor: '#10b981',
            emoji: '🚶'
        };
    }
}

export let activeSegmentPopupPlaceId = null;
export let activeSegmentPopupLatLng = null;

export function getSegmentPopupHTML(fromPlace, toPlace, fromIdx, toIdx, currentMode) {
    const safePlaceId = escapeJS(toPlace.id || toPlace.name);
    const distKm = getDistance(fromPlace.lat, fromPlace.lon, toPlace.lat, toPlace.lon);
    const transit = calculateTransitEstimate(fromPlace.lat, fromPlace.lon, toPlace.lat, toPlace.lon, currentMode) || {
        icon: currentMode === 'walking' ? '🚶' : (currentMode === 'driving' ? '🚗' : '🚆'),
        text: `${distKm.toFixed(1)} km`,
        mode: currentMode
    };
    const modeLabel = currentMode === 'walking' ? 'Walk' : (currentMode === 'driving' ? 'Drive' : 'Transit');

    return `
    <div class="map-segment-popup">
        <div class="map-segment-header">Leg ${fromIdx + 1} ➔ ${toIdx + 1}</div>
        <div class="map-segment-title">${escapeHTML(fromPlace.name)} ➔ ${escapeHTML(toPlace.name)}</div>
        <div class="map-segment-chips">
            <button type="button" class="segment-mode-btn mode-walk ${currentMode === 'walking' ? 'active' : ''}" 
                onclick="window.setPlaceTransitMode('${safePlaceId}', 'walking')" 
                title="Walking directions">
                🚶 Walk
            </button>
            <button type="button" class="segment-mode-btn mode-drive ${currentMode === 'driving' ? 'active' : ''}" 
                onclick="window.setPlaceTransitMode('${safePlaceId}', 'driving')" 
                title="Driving directions">
                🚗 Drive
            </button>
            <button type="button" class="segment-mode-btn mode-transit ${currentMode === 'transit' ? 'active' : ''}" 
                onclick="window.setPlaceTransitMode('${safePlaceId}', 'transit')" 
                title="Transit / Train directions">
                🚆 Transit
            </button>
        </div>
        <div class="map-segment-estimate">
            <span style="font-size: 14px;">${transit.icon}</span>
            <span>${transit.text}</span>
        </div>
        <button type="button" class="map-segment-gmaps-btn"
            onclick="window.openDirectionsLink(${fromPlace.lat}, ${fromPlace.lon}, ${toPlace.lat}, ${toPlace.lon}, '${currentMode}')" 
            title="Open in Google Maps (${modeLabel})">
            <span>Open in Google Maps (${modeLabel})</span>
            <span style="font-size: 12px;">↗</span>
        </button>
    </div>`;
}

export async function drawPlacesMapRoute(dayPlaces) {
    if (!placesMap) return;

    const preservePopupPlaceId = activeSegmentPopupPlaceId;
    const preservePopupLatLng = activeSegmentPopupLatLng;

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
        for (let i = 0; i < validPlaces.length - 1; i++) {
            const fromPlace = validPlaces[i];
            const toPlace = validPlaces[i + 1];
            const safePlaceId = escapeJS(toPlace.id || toPlace.name);
            const distKm = getDistance(fromPlace.lat, fromPlace.lon, toPlace.lat, toPlace.lon);
            const currentMode = toPlace.transitMode || (distKm <= 2.0 ? 'walking' : (distKm <= 15.0 ? 'driving' : 'transit'));
            const modeStyle = getPlaceModeStyle(currentMode);
            const popupHTML = getSegmentPopupHTML(fromPlace, toPlace, i, i + 1, currentMode);

            // 1. Immediate straight polyline for instant responsiveness
            const routeInfo = getShortestRoutePath(fromPlace.lat, fromPlace.lon, toPlace.lat, toPlace.lon);
            let segmentLayer = L.polyline(routeInfo.latlngs, {
                color: modeStyle.color,
                weight: modeStyle.weight,
                opacity: modeStyle.opacity,
                dashArray: modeStyle.dashArray
            }).addTo(placesMap);

            segmentLayer.bindPopup(popupHTML);
            segmentLayer.on('popupopen', function (e) {
                activeSegmentPopupPlaceId = toPlace.id || toPlace.name;
                activeSegmentPopupLatLng = e.popup.getLatLng();
            });
            segmentLayer.on('popupclose', function () {
                setTimeout(() => {
                    if (!placesMap || !placesMap._popup) {
                        activeSegmentPopupPlaceId = null;
                        activeSegmentPopupLatLng = null;
                    }
                }, 180);
            });
            segmentLayer.on('mouseover', function () {
                this.setStyle({ weight: modeStyle.weight + 2, opacity: 1 });
            });
            segmentLayer.on('mouseout', function () {
                this.setStyle({ weight: modeStyle.weight, opacity: modeStyle.opacity });
            });
            cLines.push(segmentLayer);

            // 2. Midpoint transit mode badge with 1-tap popup
            const midLat = routeInfo.midLat;
            const midLon = routeInfo.midLon;
            const badgeIcon = L.divIcon({
                className: 'transit-seg-icon',
                html: `<div style="background:white; border-radius:50%; width:26px; height:26px; display:flex; align-items:center; justify-content:center; font-size:12px; border:2px solid ${modeStyle.color}; box-shadow:0 2px 6px rgba(0,0,0,0.25); cursor:pointer;" title="Commute: ${currentMode} (Click to switch)">${modeStyle.emoji}</div>`,
                iconSize: [26, 26],
                iconAnchor: [13, 13]
            });
            const badgeMarker = L.marker([midLat, midLon], { icon: badgeIcon, zIndexOffset: 750 }).addTo(placesMap);
            badgeMarker.bindPopup(popupHTML);
            badgeMarker.on('popupopen', function (e) {
                activeSegmentPopupPlaceId = toPlace.id || toPlace.name;
                activeSegmentPopupLatLng = e.popup.getLatLng();
            });
            badgeMarker.on('popupclose', function () {
                setTimeout(() => {
                    if (!placesMap || !placesMap._popup) {
                        activeSegmentPopupPlaceId = null;
                        activeSegmentPopupLatLng = null;
                    }
                }, 180);
            });
            cMarkers.push(badgeMarker);

            // Restore popup if user was viewing this segment when mode switched
            if (preservePopupPlaceId && (toPlace.id === preservePopupPlaceId || toPlace.name === preservePopupPlaceId) && preservePopupLatLng) {
                segmentLayer.openPopup(preservePopupLatLng);
            }

            // 3. Asynchronously fetch detailed road geometry for walking and driving
            if (currentMode === 'walking' || currentMode === 'driving') {
                const osrmProfile = currentMode === 'walking' ? 'walking' : 'driving';
                const coords = `${fromPlace.lon.toFixed(5)},${fromPlace.lat.toFixed(5)};${toPlace.lon.toFixed(5)},${toPlace.lat.toFixed(5)}`;

                (async (capturedLayer, segToken, targetToPlace) => {
                    try {
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 1800);
                        const res = await fetch(`https://router.project-osrm.org/route/v1/${osrmProfile}/${coords}?overview=full&geometries=geojson`, {
                            signal: controller.signal
                        });
                        clearTimeout(timeoutId);
                        const data = await res.json();
                        if (activeRouteToken !== segToken) return;

                        if (data.routes && data.routes[0] && data.routes[0].geometry) {
                            const isCapturedPopupOpen = placesMap && placesMap.hasLayer(capturedLayer) && capturedLayer.isPopupOpen && capturedLayer.isPopupOpen();
                            const currentPopupLatLng = (isCapturedPopupOpen && placesMap._popup) ? placesMap._popup.getLatLng() : null;

                            if (placesMap && placesMap.hasLayer(capturedLayer)) {
                                placesMap.removeLayer(capturedLayer);
                                const idx = cLines.indexOf(capturedLayer);
                                if (idx > -1) cLines.splice(idx, 1);
                            }
                            const osrmLayer = L.geoJSON(data.routes[0].geometry, {
                                style: {
                                    color: modeStyle.color,
                                    weight: modeStyle.weight,
                                    opacity: modeStyle.opacity,
                                    dashArray: modeStyle.dashArray
                                }
                            }).addTo(placesMap);
                            osrmLayer.bindPopup(popupHTML);
                            osrmLayer.on('popupopen', function (e) {
                                activeSegmentPopupPlaceId = targetToPlace.id || targetToPlace.name;
                                activeSegmentPopupLatLng = e.popup.getLatLng();
                            });
                            osrmLayer.on('popupclose', function () {
                                setTimeout(() => {
                                    if (!placesMap || !placesMap._popup) {
                                        activeSegmentPopupPlaceId = null;
                                        activeSegmentPopupLatLng = null;
                                    }
                                }, 180);
                            });
                            osrmLayer.on('mouseover', function () {
                                this.setStyle({ weight: modeStyle.weight + 2, opacity: 1 });
                            });
                            osrmLayer.on('mouseout', function () {
                                this.setStyle({ weight: modeStyle.weight, opacity: modeStyle.opacity });
                            });
                            cLines.push(osrmLayer);

                            if (isCapturedPopupOpen && currentPopupLatLng) {
                                osrmLayer.openPopup(currentPopupLatLng);
                            }
                        }
                    } catch (e) {
                        // Gracefully retain straight polyline if network fails or times out
                    }
                })(segmentLayer, currentToken, toPlace);
            }
        }
    }

    if (placesMap && bounds.isValid()) {
        const size = placesMap.getSize ? placesMap.getSize() : null;
        if (!size || size.x === 0 || size.y === 0) {
            placesMap._pendingBounds = bounds;
        } else {
            try {
                placesMap.fitBounds(bounds, { padding: [45, 45], maxZoom: 15, animate: !!placesMap._loaded });
            } catch (e) {
                placesMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
            }
            placesMap._pendingBounds = null;
        }
        safeInvalidate(placesMap);
    }
}

export function toggleMapMode(target, forceMode = null) {
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

    const hasMapExpanded = containerEl.classList.contains('map-expanded');
    const hasListExpanded = containerEl.classList.contains('list-expanded');
    const btn = btnId ? document.getElementById(btnId) : null;

    if (forceMode === 'map') {
        containerEl.classList.remove('list-expanded');
        containerEl.classList.toggle('map-expanded');
    } else if (forceMode === 'list') {
        containerEl.classList.remove('map-expanded');
        containerEl.classList.toggle('list-expanded');
    } else {
        if (hasMapExpanded) {
            containerEl.classList.remove('map-expanded');
            containerEl.classList.remove('list-expanded');
        } else if (hasListExpanded) {
            containerEl.classList.remove('list-expanded');
            containerEl.classList.add('map-expanded');
        } else {
            containerEl.classList.add('list-expanded');
        }
    }

    const isNowMapExpanded = containerEl.classList.contains('map-expanded');
    const isNowListExpanded = containerEl.classList.contains('list-expanded');

    if (btn) {
        if (isNowMapExpanded) {
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

/* ==========================================================================
   LIVE GPS LOCATION ON MAPS (BLUE DOT)
   ========================================================================== */
let userLocationMarker = null;
let userLocationCircle = null;
let userLocationWatchId = null;
let activeGpsContext = null;

export function toggleUserLocation(context = 'places') {
    const targetMap = context === 'places' ? placesMap : (context === 'wishlist' ? wishlistMap : plannerMap);
    const btnId = `${context}-gps-btn`;
    const btn = document.getElementById(btnId);

    // If currently active in this map context, toggle off
    if (activeGpsContext === context) {
        if (userLocationWatchId !== null && navigator.geolocation) {
            navigator.geolocation.clearWatch(userLocationWatchId);
            userLocationWatchId = null;
        }
        if (userLocationMarker && targetMap) targetMap.removeLayer(userLocationMarker);
        if (userLocationCircle && targetMap) targetMap.removeLayer(userLocationCircle);
        userLocationMarker = null;
        userLocationCircle = null;
        activeGpsContext = null;
        if (btn) {
            btn.classList.remove('active-mode');
            btn.innerHTML = '🎯 My Location';
        }
        showNotification("📍 Location tracking turned off.");
        return;
    }

    if (!('geolocation' in navigator)) {
        showNotification("Geolocation is not supported by your browser.");
        return;
    }

    if (btn) {
        btn.innerHTML = '🎯 Locating...';
    }

    const onLocationFound = (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        if (!targetMap) return;

        const pulseIcon = L.divIcon({
            className: 'gps-marker-wrapper',
            html: '<div class="gps-user-pulse"><div class="gps-user-dot"></div></div>',
            iconSize: [22, 22],
            iconAnchor: [11, 11]
        });

        if (!userLocationMarker) {
            userLocationMarker = L.marker([latitude, longitude], { icon: pulseIcon, zIndexOffset: 2000 }).addTo(targetMap);
            userLocationCircle = L.circle([latitude, longitude], {
                radius: Math.max(accuracy, 30),
                color: '#1a73e8',
                fillColor: '#1a73e8',
                fillOpacity: 0.12,
                weight: 1
            }).addTo(targetMap);
            targetMap.flyTo([latitude, longitude], Math.max(targetMap.getZoom(), 15), { animate: true, duration: 1 });
            showNotification(`📍 Found your location (±${Math.round(accuracy)}m)`);
        } else {
            userLocationMarker.setLatLng([latitude, longitude]);
            if (!targetMap.hasLayer(userLocationMarker)) userLocationMarker.addTo(targetMap);
            if (userLocationCircle) {
                userLocationCircle.setLatLng([latitude, longitude]);
                userLocationCircle.setRadius(Math.max(accuracy, 30));
                if (!targetMap.hasLayer(userLocationCircle)) userLocationCircle.addTo(targetMap);
            }
        }

        activeGpsContext = context;
        if (btn) {
            btn.classList.add('active-mode');
            btn.innerHTML = '🎯 My Location';
        }
    };

    const onLocationError = (err) => {
        console.warn("GPS Location error:", err);
        if (btn) {
            btn.classList.remove('active-mode');
            btn.innerHTML = '🎯 My Location';
        }
        activeGpsContext = null;
        if (err.code === 1) {
            showNotification("Location permission denied. Please allow location access in browser settings.");
        } else {
            showNotification("Unable to determine location. Check GPS/Wi-Fi connection.");
        }
    };

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            onLocationFound(pos);
            if (userLocationWatchId !== null) navigator.geolocation.clearWatch(userLocationWatchId);
            userLocationWatchId = navigator.geolocation.watchPosition(onLocationFound, onLocationError, {
                enableHighAccuracy: true,
                maximumAge: 10000,
                timeout: 15000
            });
        },
        onLocationError,
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

if (typeof window !== 'undefined') {
    window.toggleMapMode = toggleMapMode;
    window.toggleUserLocation = toggleUserLocation;
}
