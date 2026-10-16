/* ==========================================================================
   TRAVEL STATS: countries, cities, nights away and distance flown across all trips, and a
   map of every place stayed. Worked out on the device; each stop's country is looked up once
   from its coordinates (OpenStreetMap's Photon) and cached.
   ========================================================================== */
import { trips, safeGetStorage, safeSetStorage, getDistance, escapeHTML, icon, parseLocalDate, formatLocalDate, closeModal } from './state.js';
import { getDistanceUnit } from './settings.js';
import { tileSpec, limitWorldZoom, hasCoords } from './maps.js';

const COUNTRY_KEY = 'trippo_country_cache_v1';
let countryCache = null;
let lookupRunning = false;
let statsMap = null;

const coordKey = s => `${Number(s.lat).toFixed(2)},${Number(s.lon).toFixed(2)}`;
function cache() {
    if (!countryCache) {
        try { countryCache = JSON.parse(safeGetStorage(COUNTRY_KEY) || '{}') || {}; } catch (e) { countryCache = {}; }
    }
    return countryCache;
}

// Country of a stop from the cache: { code: 'CN', name: 'China' } or null until it's been looked up
export function cachedCountry(stop) {
    if (!hasCoords(stop)) return null;
    const hit = cache()[coordKey(stop)];
    return hit && hit[0] ? { code: hit[0], name: hit[1] } : null;
}

export const flagEmoji = code => (/^[A-Z]{2}$/.test(code || '') ? String.fromCodePoint(...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) : '');

// Look up countries for stops not in the cache yet, a few at a time, then redraw the card
async function lookupCountries(stops) {
    if (lookupRunning) return;
    const todo = [];
    const seen = new Set();
    stops.forEach(s => { const k = coordKey(s); if (!(k in cache()) && !seen.has(k)) { seen.add(k); todo.push(s); } });
    if (!todo.length || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    lookupRunning = true;
    try {
        for (const s of todo.slice(0, 40)) {
            try {
                const res = await fetch(`https://photon.komoot.io/reverse?lat=${Number(s.lat)}&lon=${Number(s.lon)}&lang=en&limit=1`);
                const data = res.ok ? await res.json() : null;
                const p = data && data.features && data.features[0] && data.features[0].properties;
                cache()[coordKey(s)] = p && p.countrycode ? [String(p.countrycode).toUpperCase(), p.country || p.countrycode] : ['', ''];
            } catch (e) { break; }
        }
        safeSetStorage(COUNTRY_KEY, JSON.stringify(cache()));
    } finally {
        lookupRunning = false;
    }
    renderTravelStatsCard();
}

function tripEnd(trip) {
    if (!trip.startDate) return null;
    const d = parseLocalDate(trip.startDate);
    d.setDate(d.getDate() + (trip.stops || []).reduce((n, s) => n + (Number(s.nights) || 0), 0));
    return d;
}

// Every place stayed (a night or more) across all trips, and the totals
export function computeTravelStats() {
    const today = formatLocalDate(new Date());
    const stays = [];
    let nights = 0, flownKm = 0, tripCount = 0, done = 0;
    trips.forEach(trip => {
        const stops = trip.stops || [];
        if (!stops.some(s => Number(s.nights) > 0)) return;
        tripCount++;
        const end = tripEnd(trip);
        if (end && formatLocalDate(end) < today) done++;
        stops.forEach((s, i) => {
            if (Number(s.nights) > 0 && hasCoords(s)) { stays.push({ stop: s, trip }); nights += Number(s.nights) || 0; }
            const next = stops[i + 1];
            if (next && s.transit && s.transit.method === 'plane' && hasCoords(s) && hasCoords(next)) {
                flownKm += (getDistance(Number(s.lat), Number(s.lon), Number(next.lat), Number(next.lon)) || 0);
            }
        });
    });
    const cityNames = new Set(stays.map(x => String(x.stop.name || '').split(',')[0].trim().toLowerCase()).filter(Boolean));
    const countries = new Map();
    let unknown = 0;
    stays.forEach(x => {
        const c = cachedCountry(x.stop);
        if (c && c.code) countries.set(c.code, c.name);
        else if (!c) unknown++;
    });
    return { tripCount, done, stays, nights, flownKm, cities: cityNames.size, countries, unknown };
}

const fmtNum = n => Math.round(n).toLocaleString('en-US');

export function renderTravelStatsCard() {
    const el = document.getElementById('home-travel-stats');
    if (!el) return;
    const st = computeTravelStats();
    if (!st.stays.length) { el.innerHTML = ''; return; }
    if (st.unknown) lookupCountries(st.stays.map(x => x.stop));
    const unit = getDistanceUnit();
    const flown = unit === 'km' ? st.flownKm : st.flownKm * 0.621371;
    const flags = [...st.countries.keys()].map(flagEmoji).join(' ');
    el.innerHTML = `
        <button type="button" class="stats-card" onclick="openTravelStats()">
            <div class="stats-card-head">${icon('world')}<strong>Your travels</strong><span>${st.tripCount} trip${st.tripCount === 1 ? '' : 's'}${st.done && st.done < st.tripCount ? ` · ${st.done} done` : ''}</span></div>
            <div class="stats-grid">
                <div><strong>${st.countries.size || (st.unknown ? '…' : 0)}</strong><span>countr${st.countries.size === 1 ? 'y' : 'ies'}</span></div>
                <div><strong>${st.cities}</strong><span>cit${st.cities === 1 ? 'y' : 'ies'}</span></div>
                <div><strong>${fmtNum(st.nights)}</strong><span>night${st.nights === 1 ? '' : 's'} away</span></div>
                <div><strong>${fmtNum(flown)}</strong><span>${unit} flown</span></div>
            </div>
            ${flags ? `<div class="stats-flags">${flags}</div>` : ''}
        </button>`;
}

/* ---------- the map of everywhere ---------- */
export function openTravelStats() {
    const st = computeTravelStats();
    let modal = document.getElementById('travel-stats-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'travel-stats-modal';
        modal.className = 'modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', 'Your travels');
        modal.addEventListener('click', e => { if (e.target === modal) closeModal('travel-stats-modal'); });
        document.body.appendChild(modal);
    }
    const unit = getDistanceUnit();
    const flown = unit === 'km' ? st.flownKm : st.flownKm * 0.621371;
    const countries = [...st.countries.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    modal.innerHTML = `
        <div class="modal-content stats-modal" onclick="event.stopPropagation()">
            <button class="close-modal" onclick="closeModal('travel-stats-modal')" aria-label="Close">✕</button>
            <h2 class="stats-title">${icon('world')}Your travels</h2>
            <p class="stats-sub">${st.tripCount} trip${st.tripCount === 1 ? '' : 's'}, upcoming ones included · ${fmtNum(st.nights)} nights · ${fmtNum(flown)} ${unit} flown</p>
            <div id="travel-stats-map" class="stats-map"></div>
            ${countries.length ? `<div class="stats-countries">${countries.map(([code, name]) => `<span class="stats-country">${flagEmoji(code)} ${escapeHTML(name)}</span>`).join('')}</div>` : ''}
            ${st.unknown ? '<p class="stats-sub">Still looking up some countries; check back in a moment.</p>' : ''}
        </div>`;
    modal.style.display = 'flex';
    if (typeof L === 'undefined') return;
    if (statsMap) { statsMap.remove(); statsMap = null; }
    setTimeout(() => {
        const el = document.getElementById('travel-stats-map');
        if (!el) return;
        statsMap = L.map(el, { zoomControl: true, attributionControl: true }).setView([20, 0], 1);
        limitWorldZoom(statsMap);
        const spec = tileSpec();
        L.tileLayer(spec.url, spec.opts).addTo(statsMap);
        if (spec.labelsUrl) L.tileLayer(spec.labelsUrl, { maxZoom: 19, maxNativeZoom: 16, zIndex: 5 }).addTo(statsMap);
        // one dot per place, listing the trips that stayed there
        const places = new Map();
        st.stays.forEach(({ stop, trip }) => {
            const k = coordKey(stop);
            if (!places.has(k)) places.set(k, { stop, trips: new Set(), nights: 0 });
            const p = places.get(k);
            p.trips.add(trip.name || 'Trip');
            p.nights += Number(stop.nights) || 0;
        });
        const bounds = L.latLngBounds();
        places.forEach(p => {
            const ll = [Number(p.stop.lat), Number(p.stop.lon)];
            bounds.extend(ll);
            L.circleMarker(ll, { radius: Math.min(11, 5 + p.nights), color: '#ffffff', weight: 2, fillColor: '#124b43', fillOpacity: 0.9 })
                .bindPopup(`<strong>${escapeHTML(p.stop.name)}</strong><br><small>${p.nights} night${p.nights === 1 ? '' : 's'} · ${escapeHTML([...p.trips].join(', '))}</small>`)
                .addTo(statsMap);
        });
        statsMap.invalidateSize();
        if (bounds.isValid()) statsMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 6 });
    }, 60);
}
