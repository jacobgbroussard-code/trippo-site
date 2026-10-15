/* ==========================================================================
   FARE WATCH: real fares for the flights on upcoming trips
   Checks each trip's first flight leg (airport codes needed) at most every 12 hours through the
   worker, keeps the first and lowest price seen, and shows the change on the home screen.
   ========================================================================== */
import { trips, escapeHTML, icon, parseLocalDate, formatLocalDate, safeGetStorage, safeSetStorage, showNotification } from './state.js';
import { getLiveFares, hasLiveFlightPrices, airlineName } from './travel-payouts.js';

const STORE = 'trippo_fare_watch_v1';
const RECHECK_MS = 12 * 60 * 60 * 1000;

function load() {
    try { return JSON.parse(safeGetStorage(STORE, '{}')) || {}; } catch (e) { return {}; }
}
function save(data) { safeSetStorage(STORE, JSON.stringify(data)); }

// "IAH", "Houston (IAH)", "George Bush Intercontinental IAH" -> IAH
function airportCode(text) {
    const s = String(text || '').trim();
    if (/^[A-Z]{3}$/i.test(s)) return s.toUpperCase();
    const m = s.match(/\(([A-Z]{3})\)/) || s.match(/\b([A-Z]{3})\b(?!.*\b[A-Z]{3}\b)/);
    return m ? m[1] : '';
}

// The trip's first flight leg with airport codes and a date that hasn't passed
export function watchableFlight(trip) {
    if (!trip || !Array.isArray(trip.stops)) return null;
    const today = formatLocalDate(new Date());
    let offset = 0;
    for (let i = 0; i < trip.stops.length - 1; i++) {
        const t = trip.stops[i].transit;
        let depart = t && t.date;
        if (!depart && trip.startDate) {
            const d = parseLocalDate(trip.startDate);
            d.setDate(d.getDate() + offset);
            depart = formatLocalDate(d);
        }
        offset += Number(trip.stops[i].nights) || 0;
        if (!t || t.method !== 'plane' || !depart || depart < today) continue;
        const from = airportCode(t.depStation), to = airportCode(t.arrStation);
        if (!from || !to || from === to) continue;
        return { from, to, depart, ret: t.flightType === 'rt' && t.returnDate ? t.returnDate : '' };
    }
    return null;
}

export async function checkFareWatches(force = false) {
    if (!hasLiveFlightPrices() || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    const data = load();
    const now = Date.now();
    const drops = [];
    for (const trip of trips.slice(0, 12)) {
        const f = watchableFlight(trip);
        if (!f) continue;
        const key = `${f.from}-${f.to}-${f.depart}-${f.ret}`;
        let w = data[trip.id];
        if (!w || w.key !== key) w = { key, ...f, first: null, low: null, last: null, checkedAt: 0 };
        if (!force && now - w.checkedAt < RECHECK_MS) { data[trip.id] = w; continue; }
        const fares = await getLiveFares(f.from, f.to, f.depart, f.ret);
        w.checkedAt = now;
        if (fares && fares.length) {
            const best = fares.reduce((a, b) => (b.price < a.price ? b : a));
            const price = Math.round(best.price);
            if (w.last && price <= w.last * 0.95) drops.push({ trip, from: w.last, to: price });
            w.first = w.first || price;
            w.low = Math.min(w.low || price, price);
            w.last = price;
            w.lastAt = now;
            w.airline = best.airline || '';
            w.link = best.link || '';
        }
        data[trip.id] = w;
    }
    // forget trips that were deleted
    for (const id of Object.keys(data)) if (!trips.some(t => t.id === id)) delete data[id];
    save(data);
    renderFareWatchCard();
    if (drops.length) {
        const d = drops[0];
        showNotification(`Fare drop: ${d.trip.name} flight now from $${d.to} (was $${d.from})`, 5000);
    }
}

export function renderFareWatchCard() {
    const el = document.getElementById('home-fare-watch');
    if (!el) return;
    const data = load();
    const rows = trips.map(trip => {
        const w = data[trip.id];
        const f = watchableFlight(trip);
        if (!w || !w.last || !f || w.key !== `${f.from}-${f.to}-${f.depart}-${f.ret}`) return '';
        const diff = w.last - w.first;
        const change = diff < 0 ? `<em class="fare-down">down $${-diff}</em>` : diff > 0 ? `<em class="fare-up">up $${diff}</em>` : '<em>no change yet</em>';
        const when = parseLocalDate(w.depart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const href = /^https:\/\//.test(w.link || '') ? w.link : '';
        return `<a class="fare-watch-row" ${href ? `href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer"` : ''}>
            <span><strong>${escapeHTML(w.from)} → ${escapeHTML(w.to)}</strong><small>${escapeHTML(trip.name)} · ${escapeHTML(when)}${w.ret ? ' round trip' : ''}${w.airline ? ` · ${escapeHTML(airlineName(w.airline))}` : ''}</small></span>
            <span class="fare-watch-price">from $${w.last}${change}</span>
        </a>`;
    }).filter(Boolean);
    el.innerHTML = rows.length ? `<div class="fare-watch-card">
        <div class="fare-watch-head">${icon('plane-departure')}<strong>Flight prices</strong><small>Recent fares on Aviasales, per person, checked twice a day</small></div>
        ${rows.join('')}
    </div>` : '';
}

if (typeof window !== 'undefined') {
    setTimeout(() => { renderFareWatchCard(); checkFareWatches(); }, 4000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkFareWatches(); });
}
