/* ==========================================================================
   EXPLORE LAYERS: Sights, Famous nearby, Neighborhoods, Metro & tram, High-speed rail
   Toggled from the Layers menus on the Route, Daily and Wishlist maps.
   - Sights: OpenStreetMap attractions, museums, viewpoints, temples, parks and markets (Overpass API)
   - Famous nearby: Wikipedia articles near the map center, sized by reads in the last 30 days
   - Neighborhoods: Gemini names the areas worth exploring, one request for every city on the trip
   - Metro & tram: the city's metro, light rail and tram lines in their own colors (Overpass API)
   - High-speed rail: data/highspeed-rail.json, built by data/build-highspeed-rail.js
   Whatever is fetched is kept in IndexedDB (not localStorage, which holds the trips), so it keeps
   working offline and in mainland China, where Google and Wikipedia are blocked, once loaded.
   ========================================================================== */
import {
    trips, getActiveTrip, activePlacesTripId, activePlacesStopIndex, activePlacesDayIndex, activeWishlistId, wishlistPins,
    saveTrips, saveWishlist, escapeHTML, icon, showNotification, triggerHaptic, getDistance, safeGetStorage, safeSetStorage, inMainlandChina
} from './state.js';
import { plannerMap, placesMap, wishlistMap, hasCoords, refreshLayersButton } from './maps.js';
import { askGeminiJSON, NoAIKeyError } from './ai.js';

const KINDS = ['sights', 'famous', 'areas', 'metro', 'hsr'];
const PREFS_KEY = 'trippo_map_layers_v1';
// Public Overpass servers are often busy: try each in turn, starting with whichever answered last
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
let overpassFirst = 0;
const ctx = {}; // per map target: { map, groups, loaded, timer, lineRenderer }

const mapFor = target => (target === 'places' ? placesMap : target === 'wishlist' ? wishlistMap : plannerMap);
const round5 = n => Math.round(n * 1e5) / 1e5;
// popups keep clear of the buttons along the top of the map
const POPUP_OPTS = { className: 'explore-popup', maxWidth: 260, autoPanPaddingTopLeft: [16, 110], autoPanPaddingBottomRight: [16, 40] };

/* --- preferences: which layers are on, per map --- */
function prefs() {
    try { return JSON.parse(safeGetStorage(PREFS_KEY, '{}')) || {}; } catch (e) { return {}; }
}
const isOn = (target, kind) => !!(prefs()[target] || {})[kind];
function setPref(target, kind, on) {
    const p = prefs();
    p[target] = { ...(p[target] || {}), [kind]: !!on };
    safeSetStorage(PREFS_KEY, JSON.stringify(p));
}
const inMenu = (target, kind) => !!document.getElementById(`${target}-${kind}-state`);

function setState(target, kind, text) {
    const el = document.getElementById(`${target}-${kind}-state`);
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('on', text !== 'Off');
    refreshLayersButton(target);
}

/* --- IndexedDB cache (big data stays out of localStorage) --- */
let dbPromise = null;
function db() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
            const req = indexedDB.open('trippo-explore', 1);
            req.onupgradeneeded = () => req.result.createObjectStore('kv');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        }).catch(e => { dbPromise = null; throw e; });
    }
    return dbPromise;
}
const memo = new Map();
async function cacheGet(key) {
    if (memo.has(key)) return memo.get(key);
    try {
        const d = await db();
        const val = await new Promise(resolve => {
            const r = d.transaction('kv').objectStore('kv').get(key);
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => resolve(undefined);
        });
        if (val !== undefined) memo.set(key, val);
        return val;
    } catch (e) { return undefined; }
}
async function cacheSet(key, val) {
    memo.set(key, val);
    try {
        const d = await db();
        await new Promise(resolve => {
            const tx = d.transaction('kv', 'readwrite');
            tx.objectStore('kv').put(val, key);
            tx.oncomplete = tx.onerror = tx.onabort = resolve;
        });
    } catch (e) { /* memory copy still works this session */ }
}

async function overpass(query, timeoutMs = 40000) {
    let lastErr = null;
    for (let n = 0; n < OVERPASS.length; n++) {
        const at = (overpassFirst + n) % OVERPASS.length;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const r = await fetch(OVERPASS[at], { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctrl.signal });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const data = await r.json();
            if (data.remark && /error|timed out|out of memory/i.test(data.remark) && !(data.elements || []).length) throw new Error(data.remark);
            overpassFirst = at;
            return data;
        } catch (e) { lastErr = e; } finally { clearTimeout(timer); }
    }
    throw lastErr || new Error('Overpass unavailable');
}

// After a failed download, wait a minute before trying that layer again (panning would otherwise retry and
// complain on every move); the message shows once per failure streak.
const retryAt = {};
const canFetch = kind => Date.now() >= (retryAt[kind] || 0);
function failed(kind, what, lat, lon, blockedInChina = false) {
    const repeat = retryAt[kind] && Date.now() - retryAt[kind] < 5 * 60000;
    retryAt[kind] = Date.now() + 60000;
    if (!repeat) loadFailed(what, lat, lon, blockedInChina);
}

function loadFailed(what, lat, lon, blockedInChina = false) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) showNotification(`You're offline: ${what} loaded earlier still show`);
    else if (blockedInChina && inMainlandChina(lat, lon)) showNotification(`${what} can't load here: it's blocked in mainland China without a VPN. Anything loaded earlier still shows.`);
    else showNotification(`Couldn't load ${what}: the map data servers are busy. Move the map or try again in a minute.`);
}

/* --- per-map setup --- */
function setup(target) {
    const map = mapFor(target);
    if (!map || typeof L === 'undefined') return null;
    let c = ctx[target];
    if (c && c.map === map) return c;
    c = ctx[target] = { map, groups: {}, markers: {}, loaded: {}, timer: null };
    if (!map.getPane('exploreAreas')) map.createPane('exploreAreas').style.zIndex = 330;
    if (!map.getPane('exploreLines')) map.createPane('exploreLines').style.zIndex = 340;
    if (!map.getPane('exploreMarkers')) map.createPane('exploreMarkers').style.zIndex = 590;
    c.lineRenderer = L.canvas({ pane: 'exploreLines', padding: 0.3, tolerance: 6 });
    map.on('moveend', () => { clearTimeout(c.timer); c.timer = setTimeout(() => refresh(target), 450); });
    map.on('zoomend', () => zoomClasses(target));
    zoomClasses(target);
    return c;
}

function zoomClasses(target) {
    const c = ctx[target];
    if (!c) return;
    const z = c.map.getZoom();
    c.map.getContainer().classList.toggle('explore-low-zoom', z < 11);
    if (c.groups.metroStations) {
        if (z >= 13 && isOn(target, 'metro')) c.groups.metroStations.addTo(c.map);
        else c.map.removeLayer(c.groups.metroStations);
    }
}

function group(c, kind) {
    if (!c.groups[kind]) c.groups[kind] = L.layerGroup();
    if (!c.map.hasLayer(c.groups[kind])) c.groups[kind].addTo(c.map);
    return c.groups[kind];
}
function clearGroup(c, kind) {
    c.markers[kind] = null;
    [kind, kind === 'metro' ? 'metroStations' : null].filter(Boolean).forEach(k => {
        if (c.groups[k]) { c.groups[k].clearLayers(); c.map.removeLayer(c.groups[k]); }
    });
    c.loaded[kind] = null;
}

// Keep markers that stay in view (an open popup survives the map panning), add new ones, drop the rest
function syncMarkers(c, kind, items) {
    const g = group(c, kind);
    const have = c.markers[kind] || (c.markers[kind] = new Map());
    const want = new Set(items.map(it => it.id));
    for (const [id, m] of have) if (!want.has(id)) { g.removeLayer(m); have.delete(id); }
    items.forEach(it => { if (!have.has(it.id)) { const m = it.make(); m.addTo(g); have.set(it.id, m); } });
}

export function toggleExploreLayer(target, kind) {
    setExploreLayer(target, kind, !isOn(target, kind), true);
}

export function setExploreLayer(target, kind, on, announce = false) {
    setPref(target, kind, on);
    setState(target, kind, on ? 'On' : 'Off');
    const c = setup(target);
    if (!c) return;
    if (!on) { clearGroup(c, kind); return; }
    triggerHaptic('light');
    run(target, c, kind, announce);
}

// Called when a map is created: bring back the layers that were on last time
export function restoreExploreLayers(target) {
    const c = setup(target);
    KINDS.forEach(kind => { if (inMenu(target, kind)) setState(target, kind, isOn(target, kind) ? 'On' : 'Off'); });
    if (c) refresh(target);
}

function refresh(target) {
    const c = setup(target);
    if (!c) return;
    KINDS.forEach(kind => { if (isOn(target, kind) && inMenu(target, kind)) run(target, c, kind, false); });
}

function run(target, c, kind, announce) {
    const fn = { sights: drawSights, famous: drawFamous, areas: drawAreas, metro: drawMetro, hsr: drawHsr }[kind];
    if (fn) fn(target, c, announce).catch(e => console.warn('Explore layer failed:', kind, e));
}

/* --- popups and "add" actions --- */
const picked = new Map();
let pickSeq = 0;
function remember(p) {
    picked.set(++pickSeq, p);
    if (picked.size > 400) picked.delete(picked.keys().next().value);
    return pickSeq;
}

function mapLink(p) {
    return inMainlandChina(p.lat, p.lon)
        ? `https://uri.amap.com/marker?position=${p.lon},${p.lat}&name=${encodeURIComponent(p.local || p.name)}&coordinate=wgs84&callnative=1`
        : `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`;
}

function popupHTML(target, p) {
    const id = remember(p);
    const add = target === 'places'
        ? `<button type="button" class="explore-pop-add" onclick="addExploreToDay(${id})">${icon('plus')}Add to Day ${activePlacesDayIndex + 1}</button>`
        : `<button type="button" class="explore-pop-add" onclick="addExploreToWishlist(${id})">${icon('heart')}Save to Wishlist</button>`;
    return `<div class="explore-pop">
        ${p.thumb ? `<div class="explore-pop-img" style="background-image:url('${escapeHTML(p.thumb)}')"></div>` : ''}
        <div class="explore-pop-kind" style="color:${p.color || 'var(--primary)'}">${escapeHTML(p.kindLabel || '')}</div>
        <strong class="explore-pop-title">${escapeHTML(p.name)}</strong>
        ${p.local ? `<div class="explore-pop-local">${escapeHTML(p.local)}</div>` : ''}
        ${p.desc ? `<p class="explore-pop-desc">${escapeHTML(p.desc)}</p>` : ''}
        <div class="explore-pop-actions">
            ${add}
            <span class="explore-pop-links">
                ${p.wiki ? `<a href="${escapeHTML(p.wiki)}" target="_blank" rel="noopener noreferrer">Wikipedia ↗</a>` : ''}
                <a href="${escapeHTML(mapLink(p))}" target="_blank" rel="noopener noreferrer">${inMainlandChina(p.lat, p.lon) ? 'Amap' : 'Maps'} ↗</a>
            </span>
        </div>
    </div>`;
}

export function addExploreToDay(id) {
    const p = picked.get(Number(id));
    const trip = trips.find(t => t.id === activePlacesTripId) || getActiveTrip();
    if (!p || !trip || !trip.stops || !trip.stops[activePlacesStopIndex]) return;
    if (!Array.isArray(trip.places)) trip.places = [];
    const day = activePlacesDayIndex;
    if (trip.places.some(x => x.cityIndex === activePlacesStopIndex && x.dayIndex === day && String(x.name).toLowerCase() === p.name.toLowerCase())) {
        showNotification(`${p.name} is already on Day ${day + 1}`);
        return;
    }
    trip.places.push({
        id: `poi_explore_${Date.now().toString(36)}`,
        cityIndex: activePlacesStopIndex,
        dayIndex: day,
        name: p.name,
        localName: p.local || '',
        category: p.category || '● See & Do',
        address: '',
        notes: p.desc || '',
        lat: p.lat,
        lon: p.lon,
        ticketed: !!p.ticketed
    });
    saveTrips();
    if (placesMap) placesMap.closePopup();
    if (typeof window.renderCityPlaces === 'function') window.renderCityPlaces();
    triggerHaptic('success');
    showNotification(`Added ${p.name} to Day ${day + 1}`);
}

export function addExploreToWishlist(id) {
    const p = picked.get(Number(id));
    if (!p) return;
    const listId = activeWishlistId || 'master';
    if (wishlistPins.some(x => (x.wishlistId || 'master') === listId && String(x.name).toLowerCase() === p.name.toLowerCase())) {
        showNotification(`${p.name} is already on your wishlist`);
        return;
    }
    wishlistPins.push({ id: `pin_${Date.now()}`, wishlistId: listId, name: p.name, category: p.wishCat || 'Attractions', lat: p.lat, lon: p.lon, notes: [p.local, p.desc].filter(Boolean).join(' · ') });
    saveWishlist();
    [plannerMap, wishlistMap].forEach(m => m && m.closePopup());
    if (wishlistMap && typeof window.renderWishlistPins === 'function') window.renderWishlistPins(false);
    if (typeof window.renderWishlistCollections === 'function') window.renderWishlistCollections();
    triggerHaptic('success');
    showNotification(`Saved ${p.name} to your wishlist`);
}

/* --- Sights (OpenStreetMap) --- */
const SIGHT_CELL = 0.05;
// how many sights to show at each zoom (best known first), so a whole-city view stays readable
const SIGHT_CAPS = { 12: 25, 13: 40, 14: 70, 15: 120 };
const SIGHT_TYPES = {
    museum: { icon: 'building', color: '#7c3aed', label: 'Museum', wish: 'Attractions', ticketed: true },
    history: { icon: 'compass', color: '#b45309', label: 'Historic site', wish: 'Attractions' },
    worship: { icon: 'building', color: '#a16207', label: 'Temple / church', wish: 'Attractions' },
    view: { icon: 'eye', color: '#0e7490', label: 'Viewpoint', wish: 'Nature' },
    nature: { icon: 'trees', color: '#15803d', label: 'Park / garden', wish: 'Nature' },
    market: { icon: 'tag', color: '#be185d', label: 'Market', wish: 'Food', category: '🛍 Shopping' },
    fun: { icon: 'rocket', color: '#1d4ed8', label: 'Zoo / theme park', wish: 'Fun', ticketed: true },
    sight: { icon: 'camera', color: '#2563eb', label: 'Attraction', wish: 'Attractions' }
};

function sightType(t) {
    if (t.tourism === 'museum' || t.tourism === 'gallery') return 'museum';
    if (t.tourism === 'viewpoint') return 'view';
    if (t.tourism === 'zoo' || t.tourism === 'theme_park' || t.tourism === 'aquarium') return 'fun';
    if (t.amenity === 'marketplace') return 'market';
    if (t.amenity === 'place_of_worship') return 'worship';
    if (t.leisure === 'park' || t.leisure === 'garden') return 'nature';
    if (t.historic) return 'history';
    return 'sight';
}

function sightsQuery(s, w, n, e) {
    const b = `(${s},${w},${n},${e})`;
    return `[out:json][timeout:25];(
nwr["tourism"~"^(attraction|museum|gallery|viewpoint|zoo|theme_park|aquarium)$"]["name"]${b};
nwr["historic"~"^(monument|castle|memorial|ruins|archaeological_site|fort|city_gate|palace|temple|monastery|tower)$"]["name"]["wikidata"]${b};
nwr["amenity"="place_of_worship"]["name"]["wikidata"]${b};
nwr["leisure"~"^(park|garden)$"]["name"]["wikidata"]${b};
nwr["amenity"="marketplace"]["name"]${b};
);out tags center 800;`;
}

async function drawSights(target, c, announce) {
    const map = c.map;
    if (map.getZoom() < 12) {
        syncMarkers(c, 'sights', []);
        setState(target, 'sights', 'Zoom in');
        if (announce) showNotification('Zoom in on a city to see its sights');
        return;
    }
    setState(target, 'sights', 'On');
    const view = map.getBounds().pad(0.1);
    const i0 = Math.floor(view.getSouth() / SIGHT_CELL), i1 = Math.floor(view.getNorth() / SIGHT_CELL);
    const j0 = Math.floor(view.getWest() / SIGHT_CELL), j1 = Math.floor(view.getEast() / SIGHT_CELL);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 60) return;
    const keys = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) keys.push(`sights:${i}:${j}`);
    const cells = await Promise.all(keys.map(cacheGet));
    if (cells.some(x => !x) && canFetch('sights')) {
        try {
            if (announce) showNotification('Loading sights…');
            const data = await overpass(sightsQuery(i0 * SIGHT_CELL, j0 * SIGHT_CELL, (i1 + 1) * SIGHT_CELL, (j1 + 1) * SIGHT_CELL));
            const byCell = new Map(keys.map(k => [k, []]));
            for (const el of data.elements || []) {
                const t = el.tags || {};
                const lat = el.lat ?? (el.center && el.center.lat), lon = el.lon ?? (el.center && el.center.lon);
                if (!Number.isFinite(lat) || !Number.isFinite(lon) || !t.name) continue;
                const k = `sights:${Math.floor(lat / SIGHT_CELL)}:${Math.floor(lon / SIGHT_CELL)}`;
                if (byCell.has(k)) byCell.get(k).push([round5(lat), round5(lon), t.name, t['name:en'] || '', sightType(t), t.wikipedia || '', t.wikidata ? 1 : 0]);
            }
            await Promise.all(keys.map((k, n) => (cells[n] ? null : cacheSet(k, { t: Date.now(), items: byCell.get(k) }))));
            keys.forEach((k, n) => { if (!cells[n]) cells[n] = memo.get(k); });
        } catch (e) {
            failed('sights', 'Sights', map.getCenter().lat, map.getCenter().lng);
        }
    }
    if (!isOn(target, 'sights') || map.getZoom() < 12) return;
    const seen = new Set();
    const items = cells.filter(Boolean).flatMap(x => x.items || [])
        .filter(it => map.getBounds().pad(0.1).contains([it[0], it[1]]))
        .filter(it => { const k = `${it[2]}|${it[0].toFixed(3)}`; if (seen.has(k)) return false; seen.add(k); return true; })
        .sort((a, b) => (b[6] - a[6]) || (['museum', 'sight', 'view', 'history'].includes(b[4]) - ['museum', 'sight', 'view', 'history'].includes(a[4])))
        .slice(0, SIGHT_CAPS[Math.min(15, map.getZoom())] || 25);
    syncMarkers(c, 'sights', items.map(([lat, lon, name, nameEn, type, wiki, notable]) => ({ id: `${name}|${lat}|${lon}`, make: () => {
        const k = SIGHT_TYPES[type] || SIGHT_TYPES.sight;
        const wikiUrl = /^[a-z-]+:.+/.test(wiki) ? `https://${wiki.split(':')[0]}.wikipedia.org/wiki/${encodeURIComponent(wiki.slice(wiki.indexOf(':') + 1).replace(/ /g, '_'))}` : '';
        const p = { name: nameEn || name, local: nameEn && nameEn !== name ? name : '', lat, lon, kindLabel: k.label, color: k.color, wiki: wikiUrl, wishCat: k.wish, category: k.category, ticketed: k.ticketed };
        return L.marker([lat, lon], {
            pane: 'exploreMarkers',
            keyboard: false,
            title: p.name,
            icon: L.divIcon({ className: 'explore-pin-icon', html: `<div class="explore-pin${notable ? ' is-notable' : ''}" style="--pin:${k.color}">${icon(k.icon, 'ico-only')}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] })
        }).bindPopup(() => popupHTML(target, p), POPUP_OPTS);
    } })));
}

/* --- Famous nearby (Wikipedia, ranked by reads) --- */
const WIKI_CELL = 0.06;
const NOT_A_SIGHT = /\b(district|county|subdistrict|province|prefecture|township|village|town in|city in|capital of|metropolis|station|rapid transit|metro system|transit system|university|college|school|hospital|company|neighbou?rhood|constituency|electoral|road in|street in|airport|line of)\b/i;

async function drawFamous(target, c, announce) {
    const map = c.map;
    if (map.getZoom() < 11) {
        syncMarkers(c, 'famous', []);
        setState(target, 'famous', 'Zoom in');
        if (announce) showNotification('Zoom in on a city to see its famous places');
        return;
    }
    setState(target, 'famous', 'On');
    const center = map.getCenter();
    const key = `famous:${Math.round(center.lat / WIKI_CELL)}:${Math.round(center.lng / WIKI_CELL)}`;
    if (!(await cacheGet(key)) && canFetch('famous')) {
        try {
            if (announce) showNotification('Loading famous places…');
            const url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=geosearch'
                + `&ggscoord=${center.lat.toFixed(4)}%7C${center.lng.toFixed(4)}&ggsradius=10000&ggslimit=50`
                + '&prop=coordinates%7Cpageimages%7Cdescription%7Cpageviews&piprop=thumbnail&pithumbsize=200&pilimit=50&pvipdays=30&colimit=50';
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 20000);
            // read counts come back for a few pages per answer; follow "continue" until every page has them
            const pages = {};
            let cont = null;
            try {
                for (let round = 0; round < 8; round++) {
                    const more = cont ? Object.entries(cont).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('') : '';
                    const data = await fetch(url + more, { signal: ctrl.signal }).then(r => r.json());
                    Object.values((data.query && data.query.pages) || {}).forEach(pg => {
                        const prev = pages[pg.pageid] || {};
                        pages[pg.pageid] = { ...prev, ...pg, pageviews: { ...(prev.pageviews || {}), ...(pg.pageviews || {}) } };
                    });
                    if (!data.continue) break;
                    cont = data.continue;
                }
            } finally { clearTimeout(timer); }
            const items = Object.values(pages).map(pg => {
                const co = pg.coordinates && pg.coordinates[0];
                if (!co || NOT_A_SIGHT.test(pg.description || '')) return null;
                const views = Object.values(pg.pageviews || {}).reduce((s, v) => s + (Number(v) || 0), 0);
                const thumb = pg.thumbnail && /^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(pg.thumbnail.source) ? pg.thumbnail.source : '';
                return [round5(co.lat), round5(co.lon), pg.title, String(pg.description || '').slice(0, 140), thumb, views];
            }).filter(Boolean);
            await cacheSet(key, { t: Date.now(), items });
        } catch (e) {
            failed('famous', 'Famous places', center.lat, center.lng, true);
        }
    }
    if (!isOn(target, 'famous') || map.getZoom() < 11) return;
    // everything cached around the view, not just this center
    const r0 = Math.round(center.lat / WIKI_CELL), c0 = Math.round(center.lng / WIKI_CELL);
    const near = [];
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) near.push(`famous:${r0 + i}:${c0 + j}`);
    const seen = new Set();
    const view = map.getBounds().pad(0.1);
    const items = (await Promise.all(near.map(cacheGet))).filter(Boolean).flatMap(x => x.items || [])
        .filter(it => view.contains([it[0], it[1]]) && !seen.has(it[2]) && seen.add(it[2]))
        .sort((a, b) => b[5] - a[5])
        .slice(0, 30);
    const top = items.length ? Math.max(1, items[0][5]) : 1;
    syncMarkers(c, 'famous', items.map(([lat, lon, title, desc, thumb, views], rank) => ({ id: title, make: () => {
        const size = Math.round(28 + 14 * Math.sqrt(views / top));
        const reads = views >= 1000 ? `${Math.round(views / 1000)}k` : String(views);
        const p = {
            name: title, lat, lon, desc, thumb, kindLabel: `Famous · ${reads} reads this month`, color: '#c2410c', wishCat: 'Attractions',
            wiki: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
        };
        const face = thumb ? `style="width:${size}px;height:${size}px;background-image:url('${escapeHTML(thumb)}')"` : `style="width:${size}px;height:${size}px"`;
        return L.marker([lat, lon], {
            pane: 'exploreMarkers',
            keyboard: false,
            title,
            zIndexOffset: 100 - rank,
            icon: L.divIcon({ className: 'explore-pin-icon', html: `<div class="famous-pin${thumb ? '' : ' no-photo'}" ${face}>${thumb ? '' : icon('flame', 'ico-only')}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
        }).bindPopup(() => popupHTML(target, p), POPUP_OPTS);
    } })));
}

/* --- Neighborhoods (Gemini, cached per city, fetched for the whole trip at once) --- */
const AREA_COLORS = { historic: '#b45309', food: '#dc2626', nightlife: '#7c3aed', shopping: '#db2777', waterfront: '#0284c7', nature: '#15803d', art: '#9333ea', local: '#0f766e', modern: '#2563eb' };
const cityKey = s => `areas:${String(s.name || '').toLowerCase()}|${Number(s.lat).toFixed(2)},${Number(s.lon).toFixed(2)}`;

function tripCities(target) {
    const trip = target === 'places' ? (trips.find(t => t.id === activePlacesTripId) || getActiveTrip()) : getActiveTrip();
    if (!trip || !Array.isArray(trip.stops)) return { here: [], all: [] };
    const seen = new Set();
    const all = trip.stops.filter((s, i) => hasCoords(s) && (Number(s.nights) > 0 || (i > 0 && i < trip.stops.length - 1)))
        .filter(s => !seen.has(cityKey(s)) && seen.add(cityKey(s)));
    const cur = trip.stops[activePlacesStopIndex];
    return { here: target === 'places' ? (cur && hasCoords(cur) ? [cur] : []) : all, all };
}

let areasRequest = null;
async function fetchAreas(cities) {
    const system = `You are a local travel expert. For each city, name the 5 to 7 areas a first-time visitor should spend time exploring on foot: old towns, food streets, nightlife districts, waterfronts, shopping streets, art districts and characterful local neighborhoods. Use Google Search to check names and locations.
Rules:
- lat/lon is the middle of the area, to 4 decimals. radiusM is roughly how far it spreads, 200 to 2500.
- vibe is exactly one of: historic, food, nightlife, shopping, waterfront, nature, art, local, modern.
- localName is the name in the local script when it differs (e.g. Chinese characters), otherwise "".
- why is one short sentence on what it's like and what to do there. bestTime is when to go, e.g. "Evening".
Return ONLY JSON: {"cities":[{"key":"<the key you were given>","areas":[{"name":"Shamian Island","localName":"沙面岛","lat":23.1075,"lon":113.2440,"radiusM":600,"vibe":"historic","why":"Colonial-era villas under huge banyan trees; quiet, shady and very walkable","bestTime":"Late afternoon"}]}]}`;
    const user = cities.map(s => `key: ${cityKey(s)} | city: ${s.name} (${Number(s.lat).toFixed(3)}, ${Number(s.lon).toFixed(3)})`).join('\n');
    const res = await askGeminiJSON(system, user, 90000, { search: true });
    const list = res && Array.isArray(res.cities) ? res.cities : [];
    await Promise.all(cities.map((s, n) => {
        const entry = list.find(x => x && x.key === cityKey(s)) || list[n];
        const areas = (entry && Array.isArray(entry.areas) ? entry.areas : []).map(a => ({
            name: String(a.name || '').trim().slice(0, 50),
            local: String(a.localName || '').trim().slice(0, 30),
            lat: Number(a.lat), lon: Number(a.lon),
            radius: Math.max(150, Math.min(3000, Number(a.radiusM) || 600)),
            vibe: AREA_COLORS[a.vibe] ? a.vibe : 'local',
            why: String(a.why || '').slice(0, 200),
            best: String(a.bestTime || '').slice(0, 40)
        })).filter(a => a.name && Number.isFinite(a.lat) && Number.isFinite(a.lon) && getDistance(s.lat, s.lon, a.lat, a.lon) < 60).slice(0, 8);
        return areas.length ? cacheSet(cityKey(s), { t: Date.now(), areas }) : null;
    }));
}

async function drawAreas(target, c, announce) {
    const { here, all } = tripCities(target);
    if (!here.length) {
        setState(target, 'areas', 'On');
        if (announce) showNotification('Neighborhoods show for the cities on your trip');
        return;
    }
    const missingHere = (await Promise.all(here.map(s => cacheGet(cityKey(s))))).some(x => !x);
    if (missingHere && canFetch('areas')) {
        // one request covers every city on the trip that isn't cached yet, so it works later offline
        const missing = [];
        for (const s of all) if (!(await cacheGet(cityKey(s)))) missing.push(s);
        const todo = missing.length ? missing : here;
        try {
            if (!areasRequest) {
                showNotification(todo.length > 1 ? `Finding neighborhoods for ${todo.length} cities on your trip…` : `Finding neighborhoods in ${todo[0].name}…`);
                areasRequest = (async () => { for (let i = 0; i < todo.length; i += 6) await fetchAreas(todo.slice(i, i + 6)); })().finally(() => { areasRequest = null; });
            }
            await areasRequest;
        } catch (e) {
            const anyCached = (await Promise.all(here.map(s => cacheGet(cityKey(s))))).some(Boolean);
            if (e instanceof NoAIKeyError && !anyCached) {
                retryAt.areas = 0;
                setExploreLayer(target, 'areas', false);
                showNotification('Neighborhoods use Gemini: add your free Gemini key in Settings to turn them on');
                return;
            }
            if (e instanceof NoAIKeyError) { retryAt.areas = Date.now() + 10 * 60000; showNotification('Add your free Gemini key in Settings to see neighborhoods for the rest of your cities'); }
            else failed('areas', 'Neighborhoods', here[0].lat, here[0].lon, true);
        }
    }
    if (!isOn(target, 'areas')) return;
    const entries = (await Promise.all(here.map(s => cacheGet(cityKey(s))))).filter(Boolean);
    const sig = here.map(cityKey).join(',') + ':' + entries.map(e => e.t).join(',');
    if (c.loaded.areas === sig && c.groups.areas && c.map.hasLayer(c.groups.areas)) return;
    const g = group(c, 'areas');
    g.clearLayers();
    entries.forEach(entry => (entry.areas || []).forEach(a => {
        const color = AREA_COLORS[a.vibe] || AREA_COLORS.local;
        const vibe = a.vibe.charAt(0).toUpperCase() + a.vibe.slice(1);
        const p = { name: a.name, local: a.local, lat: a.lat, lon: a.lon, desc: [a.why, a.best ? `Best: ${a.best}` : ''].filter(Boolean).join(' '), kindLabel: `${vibe} area`, color, wishCat: 'Cities' };
        const open = () => popupHTML(target, p);
        L.circle([a.lat, a.lon], { pane: 'exploreAreas', radius: a.radius, color, weight: 1.5, opacity: 0.75, dashArray: '5 5', fillColor: color, fillOpacity: 0.13 })
            .bindPopup(open, POPUP_OPTS).addTo(g);
        L.marker([a.lat, a.lon], {
            pane: 'exploreMarkers',
            keyboard: false,
            icon: L.divIcon({ className: 'explore-area-icon', html: `<div class="explore-area-label" style="--area:${color}">${escapeHTML(a.name)}</div>`, iconSize: [0, 0], iconAnchor: [0, 0] })
        }).bindPopup(open, POPUP_OPTS).addTo(g);
    }));
    c.loaded.areas = sig;
}

/* --- Metro & tram (OpenStreetMap route relations, per city) --- */
const ROUTE_RANK = { subway: 0, light_rail: 1, monorail: 2, tram: 3 };
const ROUTE_COLORS = { subway: '#2563eb', light_rail: '#0d9488', monorail: '#9333ea', tram: '#ea580c' };
const metroKey = s => `metro:${String(s.name || '').toLowerCase()}|${Number(s.lat).toFixed(2)},${Number(s.lon).toFixed(2)}`;

function lineColor(v, route) {
    const s = String(v || '').trim();
    if (/^#?[0-9a-f]{6}$/i.test(s) || /^#?[0-9a-f]{3}$/i.test(s)) return s.startsWith('#') ? s : '#' + s;
    if (/^[a-z]+$/i.test(s) && typeof CSS !== 'undefined' && CSS.supports && CSS.supports('color', s)) return s;
    return ROUTE_COLORS[route] || '#2563eb';
}

function thin(pts, tol) {
    // keep a point only when it bends away from the straight line (cheap Douglas-Peucker)
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
        const [a, b] = stack.pop();
        const [y1, x1] = pts[a], [y2, x2] = pts[b];
        const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
        let best = -1, bestD = tol * tol;
        for (let i = a + 1; i < b; i++) {
            const t = len2 ? Math.max(0, Math.min(1, ((pts[i][1] - x1) * dx + (pts[i][0] - y1) * dy) / len2)) : 0;
            const ex = x1 + t * dx - pts[i][1], ey = y1 + t * dy - pts[i][0];
            if (ex * ex + ey * ey > bestD) { bestD = ex * ex + ey * ey; best = i; }
        }
        if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
    }
    return pts.filter((_, i) => keep[i]);
}

async function fetchMetro(city) {
    const dLat = 0.4, dLon = 0.4 / Math.max(0.3, Math.cos(city.lat * Math.PI / 180));
    const b = `(${(city.lat - dLat).toFixed(3)},${(city.lon - dLon).toFixed(3)},${(city.lat + dLat).toFixed(3)},${(city.lon + dLon).toFixed(3)})`;
    const data = await overpass(`[out:json][timeout:90];
rel["route"~"^(subway|light_rail|monorail|tram)$"]${b}->.r;
.r out body qt;
way(r.r)["railway"];
out geom qt;
(node["railway"="station"]["station"~"^(subway|light_rail|monorail)$"]${b};node["public_transport"="station"]["subway"="yes"]${b};);
out qt;`, 100000);
    const els = data.elements || [];
    const rels = els.filter(e => e.type === 'relation').sort((a, b2) => (ROUTE_RANK[a.tags && a.tags.route] ?? 9) - (ROUTE_RANK[b2.tags && b2.tags.route] ?? 9));
    const lines = [], lineIndex = new Map(), wayLine = new Map();
    for (const r of rels) {
        const t = r.tags || {};
        const name = t['name:en'] || t.name || (t.ref ? `Line ${t.ref}` : 'Metro line');
        const id = `${t.route}|${t.ref || ''}|${t.colour || ''}|${t.ref ? '' : name}`;
        if (!lineIndex.has(id)) { lineIndex.set(id, lines.length); lines.push({ c: lineColor(t.colour, t.route), n: name.slice(0, 60), r: t.route }); }
        const idx = lineIndex.get(id);
        (r.members || []).forEach(m => { if (m.type === 'way' && !wayLine.has(m.ref)) wayLine.set(m.ref, idx); });
    }
    const ways = [];
    for (const w of els) {
        if (w.type !== 'way' || !w.geometry || !wayLine.has(w.id)) continue;
        const pts = thin(w.geometry.map(g => [g.lat, g.lon]), 0.00006);
        const flat = [wayLine.get(w.id)];
        pts.forEach(([la, lo]) => flat.push(round5(la), round5(lo)));
        ways.push(flat);
    }
    const stations = [];
    for (const n of els) {
        if (n.type !== 'node' || !n.tags || !n.tags.name) continue;
        if (stations.some(s => s[2] === n.tags.name && getDistance(s[0], s[1], n.lat, n.lon) < 0.4)) continue;
        stations.push([round5(n.lat), round5(n.lon), n.tags.name, n.tags['name:en'] || '']);
    }
    return { t: Date.now(), lines, ways, stations };
}

let metroRequest = null;
async function drawMetro(target, c, announce) {
    const { here } = tripCities('places');
    const city = target === 'places' ? here[0] : null;
    if (!city) return;
    const key = metroKey(city);
    if (c.loaded.metro === key) return;
    let data = await cacheGet(key);
    if (!data) {
        if (!canFetch('metro') && !(metroRequest && metroRequest.key === key)) return;
        if (metroRequest && metroRequest.key === key) data = await metroRequest.promise.catch(() => null);
        else {
            showNotification(`Loading metro lines for ${city.name}…`);
            const promise = fetchMetro(city);
            metroRequest = { key, promise };
            try {
                data = await promise;
                await cacheSet(key, data);
            } catch (e) {
                failed('metro', 'Metro lines', city.lat, city.lon);
                return;
            } finally {
                if (metroRequest && metroRequest.key === key) metroRequest = null;
            }
        }
        if (!data) return;
        if (!data.ways.length && announce) showNotification(`No metro or tram lines mapped around ${city.name}`);
    }
    if (!isOn(target, 'metro') || metroKey(tripCities('places').here[0] || {}) !== key) return;
    const g = group(c, 'metro');
    g.clearLayers();
    data.ways.forEach(w => {
        const line = data.lines[w[0]] || { c: '#2563eb', n: 'Metro line', r: 'subway' };
        const pts = [];
        for (let i = 1; i < w.length; i += 2) pts.push([w[i], w[i + 1]]);
        L.polyline(pts, { renderer: c.lineRenderer, color: line.c, weight: line.r === 'tram' ? 3 : 4.5, opacity: 0.9, lineCap: 'round', lineJoin: 'round' })
            .bindPopup(`<div class="explore-pop"><div class="explore-pop-kind" style="color:${line.c}">${escapeHTML(line.r === 'tram' ? 'Tram' : line.r === 'light_rail' ? 'Light rail' : line.r === 'monorail' ? 'Monorail' : 'Metro')}</div><strong class="explore-pop-title">${escapeHTML(line.n)}</strong></div>`, POPUP_OPTS)
            .addTo(g);
    });
    if (!c.groups.metroStations) c.groups.metroStations = L.layerGroup();
    c.groups.metroStations.clearLayers();
    data.stations.forEach(([lat, lon, name, nameEn]) => {
        L.circleMarker([lat, lon], { renderer: c.lineRenderer, radius: 4, color: '#1e293b', weight: 1.5, fillColor: '#ffffff', fillOpacity: 1 })
            .bindPopup(`<div class="explore-pop"><div class="explore-pop-kind">Station</div><strong class="explore-pop-title">${escapeHTML(nameEn || name)}</strong>${nameEn && nameEn !== name ? `<div class="explore-pop-local">${escapeHTML(name)}</div>` : ''}</div>`, POPUP_OPTS)
            .addTo(c.groups.metroStations);
    });
    c.loaded.metro = key;
    zoomClasses(target);
}

/* --- High-speed rail (prebuilt file) --- */
let hsrData = null;
async function drawHsr(target, c, announce) {
    if (c.loaded.hsr) return;
    if (!hsrData) {
        try {
            const r = await fetch('data/highspeed-rail.json');
            if (!r.ok) throw new Error('HTTP ' + r.status);
            hsrData = await r.json();
        } catch (e) {
            if (announce) showNotification("Couldn't load the high-speed rail map. Check your connection and try again.");
            return;
        }
    }
    if (!isOn(target, 'hsr')) return;
    const lines = (hsrData.lines || []).map(flat => {
        const pts = [];
        for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
        return pts;
    });
    const g = group(c, 'hsr');
    g.clearLayers();
    L.polyline(lines, { renderer: c.lineRenderer, color: '#ffffff', weight: 5.5, opacity: 0.7, interactive: false }).addTo(g);
    L.polyline(lines, { renderer: c.lineRenderer, color: '#7c3aed', weight: 3, opacity: 0.9, interactive: false }).addTo(g);
    c.loaded.hsr = true;
    if (announce) showNotification('High-speed rail: G/D/C lines in China, Shinkansen, TGV, ICE, AVE and more');
}
