/* ==========================================================================
   TODAY: the trip day in your pocket
   Now / next, directions (Amap inside mainland China), driver cards with the local-script
   name, tickets, "running late" time shifting, a rainy-day plan from Gemini, and
   book-ahead reminders that are due. Also the "Today" card on the home screen.
   ========================================================================== */
import {
    trips, saveTrips, getActiveTrip, showNotification, escapeHTML, escapeJS, icon, triggerHaptic,
    parseLocalDate, formatLocalDate, formatTime, inMainlandChina, activePlacesStopIndex, activePlacesDayIndex
} from './state.js';
import { askGeminiJSON, getGeminiApiKey, checkIsOnline } from './ai.js';
import { ticketLink } from './travel-payouts.js';
import { getCachedCheckup } from './trip-checkup.js';

let view = null;          // { tripId, stopIndex, dayIndex }
let lateUndo = null;      // [{ id, time }] before the last "running late" shift
let rainIdeas = null;     // { key, swaps } for the day on screen
let rainBusy = false;

const toMin = t => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const fromMin = m => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
const NON_LATIN = /[Ͱ-ϿЀ-ӿ֐-ۿ฀-๿぀-ヿ㐀-鿿가-힯]/;

// Every day of the trip in order: [{ stopIndex, dayIndex, date }]
function tripDays(trip) {
    const out = [];
    const d = trip.startDate ? parseLocalDate(trip.startDate) : null;
    (trip.stops || []).forEach((stop, si) => {
        const nights = Number(stop.nights) || 0;
        for (let di = 0; di < Math.max(1, nights); di++) {
            const date = d ? new Date(d) : null;
            if (date) date.setDate(date.getDate() + di);
            out.push({ stopIndex: si, dayIndex: di, date });
        }
        if (d) d.setDate(d.getDate() + nights);
    });
    return out;
}

export function findTripDay(trip, when = new Date()) {
    if (!trip || !trip.startDate) return null;
    const key = formatLocalDate(when);
    return tripDays(trip).find(x => x.date && formatLocalDate(x.date) === key) || null;
}

function currentTrip() {
    return (view && trips.find(t => t.id === view.tripId)) || getActiveTrip();
}

function dayPlaces(trip, si, di) {
    return (trip.places || []).filter(p => p.cityIndex === si && (Number(p.dayIndex) || 0) === di)
        .sort((a, b) => (toMin(a.time) ?? 9999) - (toMin(b.time) ?? 9999));
}

// Map link for one place: Amap inside mainland China (Google Maps doesn't work there)
function placeMapUrl(p) {
    const lat = Number(p.lat), lon = Number(p.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}`;
    if (inMainlandChina(lat, lon)) return `https://uri.amap.com/marker?position=${lon},${lat}&name=${encodeURIComponent(p.localName || p.name)}&coordinate=wgs84&callnative=1`;
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}

export function openToday(stopIndex = null, dayIndex = null) {
    const trip = getActiveTrip();
    if (!trip || !trip.stops || !trip.stops.length) { showNotification('Add stops to your trip first.'); return; }
    let pos = Number.isInteger(stopIndex) && trip.stops[stopIndex] ? { stopIndex, dayIndex: Number(dayIndex) || 0 } : findTripDay(trip);
    if (!pos) pos = tripDays(trip).find(x => Number(trip.stops[x.stopIndex].nights) > 0) || { stopIndex: 0, dayIndex: 0 };
    view = { tripId: trip.id, stopIndex: pos.stopIndex, dayIndex: pos.dayIndex };
    lateUndo = null;
    renderToday();
    const modal = document.getElementById('today-modal');
    if (modal) { modal.style.display = 'flex'; modal.classList.add('active'); }
}

// Day view button on the Daily tab: open the day that is on screen there
export function openDayViewForDaily() {
    openToday(activePlacesStopIndex, activePlacesDayIndex);
}

export function shiftTodayView(delta) {
    const trip = currentTrip();
    if (!trip || !view) return;
    const days = tripDays(trip);
    const i = days.findIndex(x => x.stopIndex === view.stopIndex && x.dayIndex === view.dayIndex);
    const next = days[Math.max(0, Math.min(days.length - 1, i + delta))];
    if (!next) return;
    view.stopIndex = next.stopIndex;
    view.dayIndex = next.dayIndex;
    lateUndo = null;
    renderToday();
}

export function renderToday() {
    const body = document.getElementById('today-body');
    const trip = currentTrip();
    if (!body || !trip || !view) return;
    const stop = trip.stops[view.stopIndex];
    if (!stop) return;
    const days = tripDays(trip);
    const pos = days.findIndex(x => x.stopIndex === view.stopIndex && x.dayIndex === view.dayIndex);
    const day = days[pos] || {};
    const isToday = day.date && formatLocalDate(day.date) === formatLocalDate(new Date());
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const list = dayPlaces(trip, view.stopIndex, view.dayIndex);
    const nextIdx = isToday ? list.findIndex(p => toMin(p.time) !== null && toMin(p.time) + (Number(p.duration) || 60) > nowMin) : -1;
    const remaining = list.filter((p, i) => toMin(p.time) !== null && (!isToday || i >= Math.max(0, nextIdx)));
    const note = Array.isArray(stop.notes) ? String(stop.notes[view.dayIndex] || '').trim() : '';
    const dateText = day.date ? day.date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : `Day ${pos + 1}`;
    const rainKey = `${trip.id}:${view.stopIndex}:${view.dayIndex}`;

    // book-ahead items due within a week (or overdue)
    const entry = getCachedCheckup(trip.id);
    const soon = new Date(); soon.setDate(soon.getDate() + 7);
    const due = (entry && entry.result && entry.result.bookBy || []).filter(b => b.by <= formatLocalDate(soon));

    body.innerHTML = `
        <div class="today-head">
            <button type="button" class="today-nav" onclick="shiftTodayView(-1)" aria-label="Previous day" ${pos <= 0 ? 'disabled' : ''}>‹</button>
            <div class="today-title">
                <strong>${isToday ? 'Today · ' : ''}${escapeHTML(dateText)}</strong>
                <span>${escapeHTML(stop.name)} · day ${pos + 1} of ${days.length}</span>
            </div>
            <button type="button" class="today-nav" onclick="shiftTodayView(1)" aria-label="Next day" ${pos >= days.length - 1 ? 'disabled' : ''}>›</button>
        </div>
        ${day.date && window.travelDayCardHTML ? window.travelDayCardHTML(trip, formatLocalDate(day.date), isToday) : ''}
        ${note ? `<div class="today-note">${escapeHTML(note).replace(/\n/g, '<br>')}</div>` : ''}
        ${due.length ? `<div class="today-due">${icon('calendar-event')}<div><strong>Book ahead</strong>${due.map(b => `<span>${escapeHTML(b.what)}: by ${escapeHTML(parseLocalDate(b.by).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}</span>`).join('')}</div></div>` : ''}
        ${list.length ? `<div class="today-list">${list.map((p, i) => {
            const state = !isToday ? '' : i < nextIdx || nextIdx === -1 ? 'done' : i === nextIdx ? (toMin(p.time) <= nowMin ? 'now' : 'next') : '';
            const pid = escapeJS(p.id || p.name);
            const local = p.localName || (NON_LATIN.test(p.name) ? p.name : '');
            return `
            <div class="today-item ${state}">
                <div class="today-time">${p.time ? escapeHTML(formatTime(p.time)) : '–'}${state === 'now' ? '<span>now</span>' : state === 'next' ? '<span>next</span>' : ''}</div>
                <div class="today-info">
                    <strong>${escapeHTML(p.name)}</strong>
                    ${local && local !== p.name ? `<span class="place-local-name">${escapeHTML(local)}</span>` : ''}
                    ${p.duration ? `<small>about ${Number(p.duration) >= 60 ? `${Math.floor(p.duration / 60)}h${p.duration % 60 ? ` ${p.duration % 60}m` : ''}` : `${p.duration}m`}</small>` : ''}
                    <div class="today-actions">
                        <a class="place-chip" href="${escapeHTML(placeMapUrl(p))}" target="_blank" rel="noopener noreferrer">${icon('navigation')}Map</a>
                        ${local || inMainlandChina(Number(p.lat), Number(p.lon)) ? `<button type="button" class="place-chip" onclick="openDriverCard('${pid}')">${icon('language')}Driver card</button>` : ''}
                        ${p.ticketed ? `<a class="place-chip" href="${escapeHTML(ticketLink(p.name, stop.name, p.lat, p.lon))}" target="_blank" rel="noopener noreferrer">${icon('ticket')}Tickets</a>` : ''}
                    </div>
                </div>
            </div>`;
        }).join('')}</div>` : `<p class="checkup-ok">Nothing planned for this day yet.</p>`}
        ${remaining.length ? `
            <div class="today-tools">
                <span>Running late?</span>
                <button type="button" class="place-chip" onclick="todayRunningLate(30)">+30 min</button>
                <button type="button" class="place-chip" onclick="todayRunningLate(60)">+1 hour</button>
                ${lateUndo ? `<button type="button" class="place-chip" onclick="undoTodayRunningLate()">Undo</button>` : ''}
            </div>` : ''}
        <div class="today-rain">
            ${rainBusy ? `<p class="checkup-busy"><span class="ai-btn-spinner"></span> Finding indoor swaps nearby…</p>`
            : rainIdeas && rainIdeas.key === rainKey ? `
                <h3 class="checkup-h">${icon('cloud-rain')}Rainy-day swaps</h3>
                ${rainIdeas.swaps.length ? rainIdeas.swaps.map((s, i) => `
                    <div class="today-swap">
                        <div><strong>${escapeHTML(s.name)}</strong>${s.localName ? `<span class="place-local-name">${escapeHTML(s.localName)}</span>` : ''}<p>${escapeHTML(s.insteadOf ? `Instead of ${s.insteadOf}: ${s.why || ''}` : (s.why || ''))}</p></div>
                        ${s.added ? `<span class="today-added">${icon('check')}Added</span>` : `<button type="button" class="place-chip" onclick="addRainSwap(${i})">Add</button>`}
                    </div>`).join('') : '<p class="checkup-ok">No good indoor swaps found nearby.</p>'}`
            : `<button type="button" class="budget-link-btn" onclick="planRainyDay()">${icon('cloud-rain')}Rain on the way? Get indoor swaps</button>`}
        </div>`;
    if (window.revealDocChips) window.revealDocChips(body);
}

/* ---------- running late: push the rest of the day back ---------- */
export function todayRunningLate(mins) {
    const trip = currentTrip();
    if (!trip || !view) return;
    const days = tripDays(trip);
    const day = days.find(x => x.stopIndex === view.stopIndex && x.dayIndex === view.dayIndex) || {};
    const isToday = day.date && formatLocalDate(day.date) === formatLocalDate(new Date());
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const list = dayPlaces(trip, view.stopIndex, view.dayIndex).filter(p => toMin(p.time) !== null);
    const moving = isToday ? list.filter(p => toMin(p.time) + (Number(p.duration) || 60) > nowMin) : list;
    if (!moving.length) return;
    lateUndo = moving.map(p => ({ id: p.id, time: p.time }));
    moving.forEach(p => { p.time = fromMin(Math.min(23 * 60 + 59, toMin(p.time) + mins)); });
    saveTrips();
    triggerHaptic('light');
    showNotification(`Moved ${moving.length} plan${moving.length === 1 ? '' : 's'} ${mins >= 60 ? `${mins / 60} hour` : `${mins} min`} later.`);
    renderToday();
    if (window.renderCityPlaces) window.renderCityPlaces();
}

export function undoTodayRunningLate() {
    const trip = currentTrip();
    if (!trip || !lateUndo) return;
    lateUndo.forEach(u => { const p = trip.places.find(x => x.id === u.id); if (p) p.time = u.time; });
    lateUndo = null;
    saveTrips();
    renderToday();
    if (window.renderCityPlaces) window.renderCityPlaces();
}

/* ---------- rainy-day plan (Gemini) ---------- */
export async function planRainyDay() {
    const trip = currentTrip();
    if (!trip || !view || rainBusy) return;
    if (!getGeminiApiKey()) { showNotification('Rainy-day swaps need your Gemini key (Settings → AI).', 4000); return; }
    if (!checkIsOnline()) { showNotification('Rainy-day swaps need an internet connection.'); return; }
    const stop = trip.stops[view.stopIndex];
    const day = tripDays(trip).find(x => x.stopIndex === view.stopIndex && x.dayIndex === view.dayIndex) || {};
    const list = dayPlaces(trip, view.stopIndex, view.dayIndex);
    const key = `${trip.id}:${view.stopIndex}:${view.dayIndex}`;
    rainBusy = true;
    renderToday();
    try {
        const res = await askGeminiJSON(`You are a local guide in ${stop.name}. It's going to rain. Suggest indoor alternatives for the outdoor plans below, close to them and open on that day. Real places only.
Return ONLY JSON: {"swaps":[{"insteadOf":"name of the outdoor plan it replaces, or empty","name":"","localName":"name in the local script if the country doesn't use the Latin alphabet","why":"one sentence","lat":0,"lon":0,"durationMinutes":90,"category":"See & Do|Food & Drink|Shopping|Cafe"}]}
Give 3 to 5 swaps.`,
            `City: ${stop.name}\nDate: ${day.date ? formatLocalDate(day.date) : 'unknown'}\nPlans: ${list.map(p => `${p.time || ''} ${p.name}`.trim()).join('; ') || 'nothing planned yet'}`,
            45000, { thinking: 'low' });
        rainIdeas = { key, swaps: (Array.isArray(res.swaps) ? res.swaps : []).filter(s => s && s.name).slice(0, 5) };
    } catch (e) {
        showNotification(e && e.name === 'AbortError' ? 'That took too long. Please try again.' : `Couldn’t get swaps: ${(e && e.message) || 'try again.'}`, 3500);
    } finally {
        rainBusy = false;
        renderToday();
    }
}

export function addRainSwap(i) {
    const trip = currentTrip();
    const s = rainIdeas && rainIdeas.swaps[i];
    if (!trip || !view || !s || s.added) return;
    const stop = trip.stops[view.stopIndex];
    const replaced = s.insteadOf && dayPlaces(trip, view.stopIndex, view.dayIndex).find(p => p.name.toLowerCase() === String(s.insteadOf).toLowerCase());
    const lat = Number(s.lat), lon = Number(s.lon);
    const ok = Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);
    const category = /food|drink/i.test(s.category) ? '🍽 Food & Drink' : /shop/i.test(s.category) ? '🛍 Shopping' : /cafe/i.test(s.category) ? '☕ Cafe & Chill' : '● See & Do';
    const place = {
        id: `poi_rain_${Date.now()}_${i}`,
        cityIndex: view.stopIndex,
        dayIndex: view.dayIndex,
        name: String(s.name).slice(0, 90),
        category,
        address: stop.name,
        notes: `Rainy-day swap${s.insteadOf ? ` for ${s.insteadOf}` : ''}: ${s.why || ''}`.trim(),
        lat: ok ? lat : Number(stop.lat) + (Math.random() - 0.5) * 0.02,
        lon: ok ? lon : Number(stop.lon) + (Math.random() - 0.5) * 0.02,
        time: replaced && replaced.time ? replaced.time : ''
    };
    if (!ok) place.approxLocation = true;
    if (s.localName) place.localName = String(s.localName).slice(0, 80);
    const mins = Number(s.durationMinutes);
    if (mins >= 10 && mins <= 720) place.duration = Math.round(mins);
    trip.places.push(place);
    s.added = true;
    saveTrips();
    triggerHaptic('success');
    renderToday();
    if (window.renderCityPlaces) window.renderCityPlaces();
}

/* ---------- driver card: the place name in the local script, big ---------- */
let driverPlaceId = null;
export function openDriverCard(placeId) {
    const trip = currentTrip() || getActiveTrip();
    const p = trip && trip.places.find(x => (x.id || x.name) === placeId);
    if (!p) return;
    driverPlaceId = placeId;
    renderDriverCard(p);
    const modal = document.getElementById('driver-card-modal');
    if (modal) { modal.style.display = 'flex'; modal.classList.add('active'); }
}

function renderDriverCard(p, busy = false) {
    const body = document.getElementById('driver-card-body');
    if (!body) return;
    const local = p.localName || (NON_LATIN.test(p.name) ? p.name : '');
    body.innerHTML = local ? `
        <div class="driver-local">${escapeHTML(local)}</div>
        ${p.localAddress ? `<div class="driver-address">${escapeHTML(p.localAddress)}</div>` : ''}
        <div class="driver-english">${escapeHTML(p.name)}</div>`
        : `<div class="driver-english" style="font-size:20px;">${escapeHTML(p.name)}</div>
        <p class="checkup-intro">No local-language name saved for this place yet.</p>
        <button type="button" class="save-btn" onclick="fetchLocalName()" ${busy ? 'disabled' : ''}>${busy ? '<span class="ai-btn-spinner"></span> Looking it up…' : `${icon('language')}Get the local name`}</button>`;
}

export async function fetchLocalName() {
    const trip = currentTrip() || getActiveTrip();
    const p = trip && trip.places.find(x => (x.id || x.name) === driverPlaceId);
    if (!p) return;
    if (!getGeminiApiKey()) { showNotification('This needs your Gemini key (Settings → AI).', 3500); return; }
    renderDriverCard(p, true);
    try {
        const city = trip.stops[p.cityIndex] ? trip.stops[p.cityIndex].name : '';
        const res = await askGeminiJSON('You help travellers show taxi drivers where to go. Give the official name of the place in the local language and script, and its street address in the local language. Return ONLY JSON: {"localName":"","localAddress":""}. Leave a field empty if unsure.',
            `Place: ${p.name}\nCity: ${city}\nCoordinates: ${p.lat}, ${p.lon}`, 30000, { thinking: 'low' });
        if (res.localName) {
            p.localName = String(res.localName).slice(0, 80);
            if (res.localAddress) p.localAddress = String(res.localAddress).slice(0, 160);
            saveTrips();
            if (window.renderCityPlaces) window.renderCityPlaces();
        } else {
            showNotification('Couldn’t find a local name for this place.');
        }
    } catch (e) {
        showNotification(`Couldn’t look it up: ${(e && e.message) || 'try again.'}`, 3500);
    }
    renderDriverCard(p);
    renderToday();
}

/* ---------- home screen card during a trip ---------- */
export function renderHomeTodayCard() {
    const el = document.getElementById('home-today-card');
    if (!el) return;
    const active = getActiveTrip();
    const candidates = active ? [active, ...trips.filter(t => t !== active)] : trips;
    let html = '';
    for (const trip of candidates) {
        const pos = findTripDay(trip);
        if (!pos) continue;
        const stop = trip.stops[pos.stopIndex];
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const next = dayPlaces(trip, pos.stopIndex, pos.dayIndex).find(p => toMin(p.time) !== null && toMin(p.time) + (Number(p.duration) || 60) > nowMin);
        // a flight or train still to catch today comes first
        const leg = window.legsOnDate ? window.legsOnDate(trip, formatLocalDate(now)).find(l => toMin(l.transit.depTime) !== null && toMin(l.transit.depTime) > nowMin) : null;
        const lb = leg && window.leaveBy ? window.leaveBy(leg) : null;
        const line = leg ? `${window.methodName(leg.method)} at ${formatTime(leg.transit.depTime)}${lb ? ` · leave by ${formatTime(lb.at)}` : ''}`
            : next ? `Next: ${next.name} at ${formatTime(next.time)}` : trip.name;
        html = `<button type="button" class="home-today-card" onclick="openTodayFor('${escapeJS(trip.id)}')">
            ${icon(leg ? window.methodIcon(leg.method) : 'sun')}<span><strong>Today in ${escapeHTML(stop.name)}</strong><small>${escapeHTML(line)}</small></span><span aria-hidden="true">›</span>
        </button>`;
        break;
    }
    el.innerHTML = html;
}

export function openTodayFor(tripId) {
    if (window.setActiveTripId) window.setActiveTripId(tripId);
    openToday();
}
