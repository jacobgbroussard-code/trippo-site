/* ==========================================================================
   Trippo Travel Planner - Day Trips & Stopovers
   js/day-trips.js

   "Day trips" on the Daily tab asks Gemini (with Google Search) for day trips
   and 1-night stopovers from the current stop, judged by real door-to-door
   travel time on the fastest practical transport (e.g. China's high-speed
   rail), not straight-line distance. Nothing is hardcoded per country.

   Results are cached on this device per city (8 most recent) so reopening
   doesn't spend the user's Gemini quota again. Adding is opt-in:
   - a day trip becomes one stop on a chosen day (only adds, never edits)
   - a stopover becomes a new 1-night stop after the current one
   ========================================================================== */
import {
    trips, getActiveTrip, activePlacesTripId, activePlacesStopIndex, saveTrips, escapeHTML, escapeJS,
    showNotification, icon, triggerHaptic, getDistance, parseLocalDate, safeGetStorage, safeSetStorage, closeModal
} from './state.js';
import { askGeminiJSON, getGeminiApiKey, NoAIKeyError } from './ai.js';

const CACHE_KEY = 'trippo_daytrips_v1';
const CACHE_CITIES = 8;
const MAX_KM = 900;

let session = null; // { tripId, stopIndex, filter, results, fetchedAt }
let runToken = 0;

const hasCoords = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon);
const fmtTravel = m => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`);
const money = n => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');

function readCache() {
    try { const v = JSON.parse(safeGetStorage(CACHE_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
}

function cacheKeyFor(stop) {
    return `${String(stop.name || '').toLowerCase()}|${Number(stop.lat).toFixed(2)},${Number(stop.lon).toFixed(2)}`;
}

function writeCache(stop, results) {
    const all = readCache();
    all[cacheKeyFor(stop)] = { results, fetchedAt: Date.now() };
    Object.keys(all).sort((a, b) => (all[b].fetchedAt || 0) - (all[a].fetchedAt || 0)).slice(CACHE_CITIES).forEach(k => delete all[k]);
    safeSetStorage(CACHE_KEY, JSON.stringify(all));
}

function currentTripStop() {
    const trip = (session && trips.find(t => t.id === session.tripId))
        || trips.find(t => t.id === activePlacesTripId) || getActiveTrip();
    const idx = session ? session.stopIndex : activePlacesStopIndex;
    const stop = trip && trip.stops && trip.stops[idx];
    return trip && stop ? { trip, stop, stopIndex: idx } : null;
}

function stopDates(trip, stopIndex) {
    if (!trip.startDate) return '';
    const start = parseLocalDate(trip.startDate);
    start.setDate(start.getDate() + trip.stops.slice(0, stopIndex).reduce((s, x) => s + (Number(x.nights) || 0), 0));
    const end = new Date(start);
    end.setDate(end.getDate() + Math.max(1, Number(trip.stops[stopIndex].nights) || 1));
    const f = d => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    return `${f(start)} to ${f(end)}`;
}

async function fetchSuggestions(trip, stop, stopIndex) {
    const others = trip.stops.filter((s, i) => i !== stopIndex).map(s => s.name);
    const dates = stopDates(trip, stopIndex);
    const style = trip.budgetPlan && trip.budgetPlan.style;
    const system = `You are an expert local travel planner. Suggest day trips and 1-night stopovers from ${stop.name}.
Judge "nearby" by real door-to-door travel time on the fastest practical public transport available there today, not by straight-line distance. Where high-speed rail exists (China, Japan, South Korea, much of Europe), places 200-400 km away can be easy day trips, so include them. Use Google Search to check current routes, journey times and fares.
Rules:
- Give 8 options: about 5 day trips (at most ~2.5 hours each way) and about 3 overnight stopovers (worth a night, at most ~5 hours each way).
- Do not suggest places that are already stops on this trip: ${others.length ? others.join(', ') : 'none'}.
- Name the exact departure station or pier when relevant, and give a realistic one-way fare per person in USD.
- Mix types (water towns, nature, history, food cities) and order by how worthwhile they are.
Return ONLY JSON:
{"options":[{"name":"Suzhou","area":"Jiangsu, China","type":"day","lat":31.2990,"lon":120.5853,"travelMinutes":30,"transport":"High-speed train from Shanghai Hongqiao to Suzhou","frequency":"every 10-15 min","farePerPersonUSD":6,"why":"Classical gardens and canals, an easy half or full day","highlights":["Humble Administrator's Garden","Pingjiang Road","Tiger Hill"],"timeNeeded":"Full day","tip":"Book trains on Trip.com or 12306; bring your passport"}]}
type is "day" or "overnight". travelMinutes is one way, door to door.`;
    const user = `Base: ${stop.name}${hasCoords(stop) ? ` (${stop.lat.toFixed(3)}, ${stop.lon.toFixed(3)})` : ''}
Dates there: ${dates || 'not set'} (${Math.max(1, Number(stop.nights) || 1)} nights)
Travelers: ${Number(trip.budgetTravelers) || 2}${style ? `, ${style === 'mid' ? 'mid-range' : style} budget` : ''}`;
    const res = await askGeminiJSON(system, user, 60000, { search: true });
    const list = res && Array.isArray(res.options) ? res.options : [];
    return list.map((o, i) => {
        const lat = Number(o.lat), lon = Number(o.lon);
        const km = hasCoords(stop) && Number.isFinite(lat) && Number.isFinite(lon) ? getDistance(stop.lat, stop.lon, lat, lon) : null;
        return {
            id: 'dt' + i,
            name: String(o.name || '').trim().slice(0, 60),
            area: String(o.area || '').slice(0, 60),
            type: o.type === 'overnight' ? 'overnight' : 'day',
            lat: Number.isFinite(lat) ? lat : null,
            lon: Number.isFinite(lon) ? lon : null,
            km,
            travelMinutes: Math.max(0, Math.round(Number(o.travelMinutes) || 0)),
            transport: String(o.transport || '').slice(0, 120),
            frequency: String(o.frequency || '').slice(0, 60),
            fare: Number(o.farePerPersonUSD) > 0 ? Number(o.farePerPersonUSD) : null,
            why: String(o.why || '').slice(0, 220),
            highlights: Array.isArray(o.highlights) ? o.highlights.map(h => String(h).slice(0, 60)).filter(Boolean).slice(0, 4) : [],
            timeNeeded: String(o.timeNeeded || '').slice(0, 40),
            tip: String(o.tip || '').slice(0, 160)
        };
    }).filter(o => o.name && !(o.km !== null && o.km > MAX_KM) && !others.some(n => n.toLowerCase() === o.name.toLowerCase()));
}

/* --- UI --- */
export async function openDayTrips(forceRefresh = false) {
    const ctx = currentTripStop();
    if (!ctx) { showNotification('Open a trip first.'); return; }
    const { trip, stop, stopIndex } = ctx;
    session = { tripId: trip.id, stopIndex, filter: session && session.stopIndex === stopIndex ? session.filter : 'all', results: null };
    const modal = document.getElementById('day-trips-modal');
    if (modal) modal.style.display = 'flex';
    setText('day-trips-title', `Day trips from ${stop.name}`);
    triggerHaptic('light');

    const cached = readCache()[cacheKeyFor(stop)];
    if (cached && Array.isArray(cached.results) && !forceRefresh) {
        session.results = cached.results;
        session.fetchedAt = cached.fetchedAt;
        renderDayTrips();
        return;
    }
    if (!getGeminiApiKey()) { renderMessage('needs-key'); return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { renderMessage('offline'); return; }

    const token = ++runToken;
    renderMessage('loading');
    try {
        const results = await fetchSuggestions(trip, stop, stopIndex);
        if (token !== runToken) return;
        if (!results.length) { renderMessage('empty'); return; }
        session.results = results;
        session.fetchedAt = Date.now();
        writeCache(stop, results);
        renderDayTrips();
        triggerHaptic('success');
    } catch (e) {
        if (token !== runToken) return;
        console.warn('[Day trips] failed:', e);
        renderMessage(e instanceof NoAIKeyError ? 'needs-key' : 'error', e && e.message);
    }
}

export function closeDayTrips() {
    runToken++;
    closeModal('day-trips-modal');
}

export function setDayTripFilter(filter) {
    if (!session) return;
    session.filter = filter;
    renderDayTrips();
}

function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

function renderMessage(kind, detail) {
    const body = document.getElementById('day-trips-body');
    const filters = document.getElementById('day-trips-filters');
    if (filters) filters.innerHTML = '';
    setText('day-trips-sub', '');
    if (!body) return;
    const msgs = {
        loading: `<div class="day-plan-loading"><span class="ai-btn-spinner"></span>Searching trains, routes and highlights… this can take 20–40 seconds</div>`,
        'needs-key': `<div class="dt-message">${icon('sparkles')}<strong>Day trip ideas use Gemini</strong><span>Add your free Gemini key in Settings and Trippo will search for day trips and overnight stopovers, including high-speed rail options.</span><button type="button" class="save-btn" onclick="closeDayTrips(); openAIKeySettings()">Add Gemini key</button></div>`,
        offline: `<div class="dt-message">${icon('cloud-off')}<strong>You're offline</strong><span>Day trip ideas need an internet connection. Ideas you've already searched for will show here offline.</span></div>`,
        empty: `<div class="dt-message">${icon('compass')}<strong>No ideas came back</strong><span>Try again in a moment.</span><button type="button" class="save-btn" onclick="openDayTrips(true)">Try again</button></div>`,
        error: `<div class="dt-message">${icon('alert-triangle')}<strong>Couldn't get ideas right now</strong><span>${escapeHTML(detail || 'Gemini did not answer.')}</span><button type="button" class="save-btn" onclick="openDayTrips(true)">Try again</button></div>`
    };
    body.innerHTML = msgs[kind] || '';
}

function renderDayTrips() {
    const ctx = currentTripStop();
    if (!ctx || !session || !session.results) return;
    const { trip, stop, stopIndex } = ctx;
    const days = Math.max(1, Number(stop.nights) || 1);
    const list = session.results.filter(o => session.filter === 'all' || o.type === session.filter);
    const age = session.fetchedAt ? Math.round((Date.now() - session.fetchedAt) / 86400000) : 0;
    setText('day-trips-sub', `${session.results.length} ideas · travel times one way${age >= 1 ? ` · found ${age} day${age === 1 ? '' : 's'} ago` : ''}`);

    const filters = document.getElementById('day-trips-filters');
    if (filters) filters.innerHTML = [['all', 'All'], ['day', 'Day trips'], ['overnight', 'Overnight']].map(([id, label]) =>
        `<button type="button" class="budget-style-chip${session.filter === id ? ' active' : ''}" onclick="setDayTripFilter('${id}')">${label}</button>`).join('');

    const dayOptions = Array.from({ length: days }, (_, d) => `<option value="${d}">Day ${d + 1}</option>`).join('');
    const next = trip.stops[stopIndex + 1];
    const cards = list.map(o => {
        const sid = escapeJS(o.id);
        const mapUrl = hasCoords(o) ? `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lon}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.name)}`;
        return `
        <article class="dt-card">
            <div class="dt-head">
                <div><strong>${escapeHTML(o.name)}</strong>${o.area ? `<span class="dt-area">${escapeHTML(o.area)}</span>` : ''}</div>
                <span class="dt-badge${o.type === 'overnight' ? ' night' : ''}">${o.type === 'overnight' ? 'Stay 1 night' : 'Day trip'}</span>
            </div>
            <div class="dt-travel">${icon(/train|rail|metro/i.test(o.transport) ? 'train' : /bus|coach/i.test(o.transport) ? 'bus' : /ferry|boat/i.test(o.transport) ? 'route' : 'car')}
                <span><strong>${o.travelMinutes ? fmtTravel(o.travelMinutes) : '?'}</strong> each way${o.transport ? ` · ${escapeHTML(o.transport)}` : ''}${o.frequency ? ` · ${escapeHTML(o.frequency)}` : ''}${o.fare ? ` · ~${money(o.fare)} pp` : ''}</span></div>
            ${o.why ? `<p class="dt-why">${escapeHTML(o.why)}</p>` : ''}
            ${o.highlights.length ? `<div class="dt-highlights">${o.highlights.map(h => `<span>${escapeHTML(h)}</span>`).join('')}</div>` : ''}
            ${o.tip ? `<p class="dt-tip">${icon('bulb')}${escapeHTML(o.tip)}</p>` : ''}
            <div class="dt-actions">
                <select id="dt-day-${o.id}" aria-label="Day for ${escapeHTML(o.name)}">${dayOptions}</select>
                <button type="button" class="budget-link-btn" onclick="addDayTripToDay('${sid}')">${icon('plus')}Add to day</button>
                ${o.type === 'overnight' ? `<button type="button" class="budget-link-btn" onclick="addStopoverAfter('${sid}')">${icon('bed')}Add as 1-night stop</button>` : ''}
                <a class="budget-link-btn" href="${mapUrl}" target="_blank" rel="noopener noreferrer">${icon('map-pin')}Map</a>
            </div>
        </article>`;
    }).join('');

    const body = document.getElementById('day-trips-body');
    if (body) body.innerHTML = (cards || `<p class="budget-empty">No ${session.filter === 'day' ? 'day trips' : 'overnight stopovers'} in this list.</p>`) +
        `<p class="budget-note">Suggested by Gemini with Google Search. Check train times and fares before booking.
            <button type="button" class="budget-reset" onclick="openDayTrips(true)">Search again</button></p>`;
}

// One stop on the chosen day; nothing existing is changed
export function addDayTripToDay(optionId) {
    const ctx = currentTripStop();
    const o = ctx && session && session.results.find(x => x.id === optionId);
    if (!o) return;
    const { trip, stop, stopIndex } = ctx;
    const day = Number(document.getElementById(`dt-day-${optionId}`)?.value) || 0;
    if (!Array.isArray(trip.places)) trip.places = [];
    const dupe = trip.places.some(p => p.cityIndex === stopIndex && String(p.name).toLowerCase() === `day trip: ${o.name}`.toLowerCase());
    if (dupe && !confirm(`${o.name} is already on your ${stop.name} days. Add it again?`)) return;
    const notes = [
        `${o.travelMinutes ? fmtTravel(o.travelMinutes) + ' each way' : ''}${o.transport ? ` by ${o.transport}` : ''}${o.fare ? ` (~${money(o.fare)} pp)` : ''}`,
        o.why,
        o.highlights.length ? `See: ${o.highlights.join(', ')}` : '',
        o.tip
    ].filter(Boolean).join('\n');
    trip.places.push({
        id: `poi_daytrip_${Date.now().toString(36)}`,
        cityIndex: stopIndex,
        dayIndex: day,
        name: `Day trip: ${o.name}`,
        category: '● See & Do',
        address: o.area || o.name,
        notes,
        lat: hasCoords(o) ? o.lat : stop.lat,
        lon: hasCoords(o) ? o.lon : stop.lon,
        time: '08:30',
        duration: Math.max(240, Math.min(600, (o.travelMinutes || 60) * 2 + 300))
    });
    saveTrips();
    if (typeof window.renderCityPlaces === 'function') window.renderCityPlaces();
    triggerHaptic('success');
    showNotification(`Added ${o.name} to Day ${day + 1}`);
}

// Insert a new 1-night stop right after this one (the trip gets one night longer)
export function addStopoverAfter(optionId) {
    const ctx = currentTripStop();
    const o = ctx && session && session.results.find(x => x.id === optionId);
    if (!o) return;
    const { trip, stop, stopIndex } = ctx;
    const next = trip.stops[stopIndex + 1];
    if (trip.stops.some(s => String(s.name).toLowerCase() === o.name.toLowerCase())) {
        showNotification(`${o.name} is already a stop on this trip.`);
        return;
    }
    const lines = [`Add ${o.name} as a 1-night stop after ${stop.name}?`, '', 'Your trip gets 1 night longer, so later stops move 1 day later.'];
    if (stop.transit && next) lines.push(`Your booked ${stop.transit.method === 'plane' ? 'flight' : stop.transit.method || 'transport'} from ${stop.name} to ${next.name} will move to the ${o.name} → ${next.name} leg, so check its date and station.`);
    if (!confirm(lines.join('\n'))) return;

    const originalStops = [...trip.stops];
    const newStop = {
        id: `stop_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: o.name,
        lat: hasCoords(o) ? o.lat : Number(stop.lat) || 0,
        lon: hasCoords(o) ? o.lon : Number(stop.lon) || 0,
        nights: 1,
        notes: [[o.why, o.highlights.length ? `See: ${o.highlights.join(', ')}` : ''].filter(Boolean).join('\n')],
        transit: null,
        lodging: null,
        locked: false
    };
    trip.stops.splice(stopIndex + 1, 0, newStop);

    // Places follow their stop (same approach as drag-reordering stops)
    (trip.places || []).forEach(p => {
        const target = originalStops[p.cityIndex];
        if (target) p.cityIndex = trip.stops.findIndex(s => s === target);
    });
    // Round-trip legs after this stop shift by one
    if (Array.isArray(trip.roundTripSegments)) trip.roundTripSegments = trip.roundTripSegments.map(i => (i >= stopIndex ? i + 1 : i));
    // The booking that leaves this stop now leaves from the stopover, toward the same next city
    if (stop.transit && next) {
        newStop.transit = stop.transit;
        stop.transit = null;
        const oldKey = stop.id ? `bk_travel_${stop.id}` : null;
        const moved = oldKey && (trip.expenses || []).find(e => e.id === oldKey);
        if (moved) moved.id = `bk_travel_${newStop.id}`;
    }
    saveTrips();
    if (typeof window.renderPlanner === 'function') window.renderPlanner();
    triggerHaptic('success');
    showNotification(`${o.name} added for 1 night after ${stop.name}`);
}
