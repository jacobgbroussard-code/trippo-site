/* ==========================================================================
   TRIP CHECK-UP
   Quick checks run instantly on the device (overlaps, packed days, plans before you
   arrive, missing travel legs or hotels). The smart check-up asks Gemini to review the
   whole trip: holidays and closures, pacing, entry rules, what to book ahead and by when,
   and a "before you go" list (money, apps, eSIM...). Results are cached per trip.
   ========================================================================== */
import {
    getActiveTrip, showNotification, escapeHTML, icon, triggerHaptic,
    parseLocalDate, formatLocalDate, safeGetStorage, safeSetStorage, getDistance
} from './state.js';
import { askGeminiJSON, getGeminiApiKey, checkIsOnline } from './ai.js';
import { getTravelProfile, getTravelProfileText } from './travel-profile.js';
import { esimLink } from './travel-payouts.js';

const CACHE_KEY = 'trippo_checkup_v1';
const MAX_CACHED = 8;
let checkupBusy = false;

const toMin = t => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const dayLabel = d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

// Start date of each stop (null without a trip start date)
function stopStarts(trip) {
    if (!trip.startDate) return trip.stops.map(() => null);
    const d = parseLocalDate(trip.startDate);
    return trip.stops.map(stop => {
        const start = new Date(d);
        d.setDate(d.getDate() + (Number(stop.nights) || 0));
        return start;
    });
}

function dayPlaces(trip, si, di) {
    return (trip.places || []).filter(p => p.cityIndex === si && (Number(p.dayIndex) || 0) === di);
}

/* ---------- quick checks (no AI) ---------- */
export function quickTripChecks(trip) {
    const out = [];
    const add = (severity, title, detail) => out.push({ severity, title, detail });
    const stops = trip.stops || [];
    const starts = stopStarts(trip);
    if (!trip.startDate) add('medium', 'No start date yet', 'Set a start date so days, weather, bookings and this check-up line up with real dates.');

    const noLeg = [];
    const noHotel = [];
    stops.forEach((stop, si) => {
        const nights = Number(stop.nights) || 0;
        for (let di = 0; di < Math.max(1, nights); di++) {
            const all = dayPlaces(trip, si, di);
            const timed = all.filter(p => toMin(p.time) !== null).sort((a, b) => toMin(a.time) - toMin(b.time));
            let when = `Day ${di + 1} in ${stop.name}`;
            if (starts[si]) { const d = new Date(starts[si]); d.setDate(d.getDate() + di); when = `${dayLabel(d)} in ${stop.name}`; }
            for (let k = 0; k + 1 < timed.length; k++) {
                const a = timed[k], b = timed[k + 1];
                const end = toMin(a.time) + (Number(a.duration) || 60);
                if (end > toMin(b.time) + 10) {
                    add('medium', `${a.name} runs into ${b.name}`, `${when}: ${a.name} starts ${a.time}${a.duration ? ` and takes about ${a.duration} min` : ''}, but ${b.name} is at ${b.time}.`);
                }
            }
            const busy = timed.reduce((n, p) => n + (Number(p.duration) || 60), 0);
            if (all.length > 7 || busy > 10 * 60) {
                add('low', `${when} looks packed`, `${all.length} places${busy ? `, about ${Math.round(busy / 60)} h of visits` : ''} before any travel time. "Plan my days" in the stop's Planner can spread them out.`);
            }
            if (di === 0 && si > 0) {
                const arr = toMin(stops[si - 1].transit && stops[si - 1].transit.arrTime);
                const early = arr === null ? [] : timed.filter(p => toMin(p.time) < arr + 60);
                if (early.length) {
                    add('high', `Plans before you reach ${stop.name}`, `${early.map(p => `${p.name} (${p.time})`).join(', ')} ${early.length > 1 ? 'are' : 'is'} planned before or right as you arrive at ${stops[si - 1].transit.arrTime}.`);
                }
            }
        }
        if (si < stops.length - 1) {
            const next = stops[si + 1];
            const km = getDistance(Number(stop.lat), Number(stop.lon), Number(next.lat), Number(next.lon)) || 0;
            const tr = stop.transit;
            if ((!tr || !tr.method) && km > 30) noLeg.push(`${stop.name} → ${next.name}`);
            else if (tr && (tr.method === 'car' || tr.method === 'bus') && km > 900) {
                add('medium', `Long ${tr.method === 'car' ? 'drive' : 'bus ride'}: ${stop.name} → ${next.name}`, `About ${Math.round(km)} km. A train or flight could save most of a day.`);
            }
        }
        if (nights > 0 && !stop.overnightFlight && !(stop.lodging && stop.lodging.name)) noHotel.push(stop.name);
    });
    if (noLeg.length) add('low', 'Travel not planned yet', `How you'll get ${noLeg.join(', ')}. Tap the line between stops on the map to add the train, flight or drive.`);
    if (noHotel.length) {
        const soon = trip.startDate && (parseLocalDate(trip.startDate) - new Date()) / 86400000 < 60;
        add(soon ? 'medium' : 'low', 'No hotel saved yet', `${noHotel.join(', ')}. Add stays in the Stays tab${soon ? ', the trip is less than 2 months away' : ''}.`);
    }
    const rank = { high: 0, medium: 1, low: 2 };
    return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/* ---------- smart check-up (Gemini) ---------- */
function tripSummary(trip) {
    const starts = stopStarts(trip);
    const lines = [`Trip "${trip.name}", ${Number(trip.budgetTravelers) || 2} travellers, starts ${trip.startDate || 'date not set'}.`];
    trip.stops.forEach((stop, si) => {
        const nights = Number(stop.nights) || 0;
        const range = starts[si] ? (() => { const e = new Date(starts[si]); e.setDate(e.getDate() + nights); return `${formatLocalDate(starts[si])} to ${formatLocalDate(e)}, `; })() : '';
        const tr = stop.transit;
        const next = trip.stops[si + 1];
        lines.push(`STOP ${si + 1}: ${stop.name} (${range}${nights} nights)${stop.lodging && stop.lodging.name ? `, hotel ${stop.lodging.name}` : ''}${tr && tr.method && next ? `; then ${tr.method} to ${next.name}${tr.date ? ` on ${tr.date}` : ''}${tr.depTime ? ` ${tr.depTime}` : ''}${tr.arrTime ? `-${tr.arrTime}` : ''}${tr.depStation ? ` (${tr.depStation} to ${tr.arrStation || next.name})` : ''}` : ''}`);
        for (let di = 0; di < Math.max(1, nights); di++) {
            const list = dayPlaces(trip, si, di).sort((a, b) => (toMin(a.time) ?? 9999) - (toMin(b.time) ?? 9999)).slice(0, 12);
            if (!list.length) continue;
            let label = `Day ${di + 1}`;
            if (starts[si]) { const d = new Date(starts[si]); d.setDate(d.getDate() + di); label = `${formatLocalDate(d)} (${d.toLocaleDateString('en-US', { weekday: 'short' })})`; }
            lines.push(`  ${label}: ${list.map(p => `${p.time ? p.time + ' ' : ''}${p.name}${p.duration ? ` (${p.duration} min)` : ''}`).join('; ')}`);
        }
    });
    return lines.join('\n').slice(0, 14000);
}

function hashText(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return String(h);
}

function readCache() {
    try { const c = JSON.parse(safeGetStorage(CACHE_KEY) || '{}'); return c && typeof c === 'object' ? c : {}; } catch (e) { return {}; }
}

function writeCache(tripId, entry) {
    const cache = readCache();
    cache[tripId] = entry;
    const ids = Object.keys(cache).sort((a, b) => (cache[b].at || 0) - (cache[a].at || 0)).slice(0, MAX_CACHED);
    safeSetStorage(CACHE_KEY, JSON.stringify(Object.fromEntries(ids.map(id => [id, cache[id]]))));
}

export function getCachedCheckup(tripId) {
    return readCache()[tripId] || null;
}

export async function runSmartCheckup() {
    const trip = getActiveTrip();
    if (!trip || checkupBusy) return;
    if (!getGeminiApiKey()) { showNotification('The smart check-up needs your Gemini key (Settings → AI).', 4000); return; }
    if (!checkIsOnline()) { showNotification('The smart check-up needs an internet connection.'); return; }
    checkupBusy = true;
    renderTripCheckup();
    const passport = (getTravelProfile().passport || '').trim();
    const system = `You are a meticulous travel advisor reviewing a traveller's itinerary before they go. Today is ${formatLocalDate(new Date())}.
Check, using the actual dates:
- public holidays, festivals and peak crowds; places closed on the planned weekday or at the planned time; seasonal weather problems
- pacing: overloaded days, long or tight transfers, arrival and departure days, jet lag
- logistics: getting between cities and from airports, tickets or reservations that must be booked ahead
- entry rules for the passport (visa, visa-free stays, passport validity, registrations); say to confirm on the official government website
Return ONLY JSON:
{"issues": [{"severity": "high|medium|low", "date": "YYYY-MM-DD or empty", "where": "city", "title": "short", "detail": "1-2 sentences", "fix": "one concrete fix"}],
 "bookBy": [{"what": "Forbidden City tickets", "by": "YYYY-MM-DD", "where": "Beijing", "why": "released 7 days ahead and sell out fast"}],
 "beforeYouGo": [{"topic": "Entry & visa|Money|Phone & internet|Apps|Getting around|Health|Etiquette|Packing", "item": "short action", "detail": "one sentence"}],
 "countries": ["China"]}
At most 8 issues (most important first; skip trivia), at most 8 bookBy items in date order (only things that really need booking ahead), at most 10 beforeYouGo items. Be specific to this trip.`;
    const user = `${tripSummary(trip)}\nPassport: ${passport || 'United States (assumed; say so if entry rules depend on it)'}${getTravelProfileText() ? `\n${getTravelProfileText()}` : ''}`;
    try {
        const res = await askGeminiJSON(system, user, 90000, { thinking: 'low' });
        const clean = {
            issues: (Array.isArray(res.issues) ? res.issues : []).filter(x => x && x.title).slice(0, 8),
            bookBy: (Array.isArray(res.bookBy) ? res.bookBy : []).filter(x => x && x.what && /^\d{4}-\d{2}-\d{2}$/.test(String(x.by || ''))).sort((a, b) => a.by.localeCompare(b.by)).slice(0, 8),
            beforeYouGo: (Array.isArray(res.beforeYouGo) ? res.beforeYouGo : []).filter(x => x && x.item).slice(0, 10),
            countries: (Array.isArray(res.countries) ? res.countries : []).filter(c => typeof c === 'string').slice(0, 6)
        };
        writeCache(trip.id, { hash: hashText(tripSummary(trip)), at: Date.now(), result: clean });
        triggerHaptic('success');
    } catch (e) {
        showNotification(e && e.name === 'AbortError' ? 'The check-up took too long. Please try again.' : `Check-up failed: ${(e && e.message) || 'please try again.'}`, 4000);
    } finally {
        checkupBusy = false;
        renderTripCheckup();
    }
}

/* ---------- book-ahead reminders as a calendar file ---------- */
const icsText = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

export function exportBookByICS() {
    const trip = getActiveTrip();
    const entry = trip && getCachedCheckup(trip.id);
    const items = entry && entry.result && entry.result.bookBy;
    if (!items || !items.length) { showNotification('Run the smart check-up first.'); return; }
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Trippo//Book ahead//EN', 'CALSCALE:GREGORIAN'];
    items.forEach((b, i) => {
        const day = parseLocalDate(b.by);
        const next = new Date(day); next.setDate(next.getDate() + 1);
        lines.push('BEGIN:VEVENT', `UID:trippo-bookby-${trip.id}-${i}@trippo.top`, `DTSTAMP:${stamp}`,
            `DTSTART;VALUE=DATE:${b.by.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${formatLocalDate(next).replace(/-/g, '')}`,
            `SUMMARY:${icsText(`Book: ${b.what}`)}`, `DESCRIPTION:${icsText(`${b.why || ''}${b.where ? ` (${b.where})` : ''} - ${trip.name}`)}`,
            'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(`Book: ${b.what}`)}`, 'TRIGGER:PT9H', 'END:VALARM', 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${trip.name.replace(/[^\w-]+/g, '_')}_book_ahead.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showNotification('Book-ahead reminders saved. Open the file to add them to your calendar.', 3500);
}

/* ---------- UI ---------- */
function issueHTML(x) {
    return `<div class="checkup-item sev-${escapeHTML(x.severity || 'low')}">
        <span class="checkup-dot" aria-hidden="true"></span>
        <div><strong>${escapeHTML(x.title)}</strong>${x.date || x.where ? `<span class="checkup-meta">${escapeHTML([x.date, x.where].filter(Boolean).join(' · '))}</span>` : ''}
        <p>${escapeHTML(x.detail || '')}</p>${x.fix ? `<p class="checkup-fix">${icon('bulb')}${escapeHTML(x.fix)}</p>` : ''}</div>
    </div>`;
}

export function renderTripCheckup() {
    const body = document.getElementById('trip-checkup-body');
    const trip = getActiveTrip();
    if (!body || !trip) return;
    const title = document.getElementById('trip-checkup-title');
    if (title) title.textContent = `Check-up: ${trip.name}`;
    const quick = quickTripChecks(trip);
    const entry = getCachedCheckup(trip.id);
    const r = entry && entry.result;
    const stale = entry && entry.hash !== hashText(tripSummary(trip));
    const today = formatLocalDate(new Date());
    const ago = entry ? Math.max(1, Math.round((Date.now() - entry.at) / 60000)) : 0;
    const agoText = !entry ? '' : ago < 60 ? `${ago} min ago` : ago < 1440 ? `${Math.round(ago / 60)} h ago` : `${Math.round(ago / 1440)} days ago`;

    const groups = {};
    (r ? r.beforeYouGo : []).forEach(x => { (groups[x.topic || 'Other'] = groups[x.topic || 'Other'] || []).push(x); });

    body.innerHTML = `
        <h3 class="checkup-h">${icon('list-details')}Quick checks</h3>
        ${quick.length ? quick.map(issueHTML).join('') : `<p class="checkup-ok">${icon('check')}Nothing obvious: no overlaps, overloaded days or missing legs.</p>`}

        <h3 class="checkup-h">${icon('sparkles')}Smart check-up</h3>
        ${checkupBusy ? `<p class="checkup-busy"><span class="ai-btn-spinner"></span> Gemini is reviewing your dates, places and route…</p>` : ''}
        ${!checkupBusy && !r ? `<p class="checkup-intro">Gemini reviews the whole trip: holidays and closures on your dates, pacing, entry rules, what to book ahead and by when, and what to set up before you go.</p>
            <button type="button" class="save-btn" onclick="runSmartCheckup()">${icon('sparkles')}Run smart check-up</button>` : ''}
        ${!checkupBusy && r ? `
            <div class="checkup-run-row"><span>Checked ${agoText}${stale ? ' · trip changed since' : ''}</span><button type="button" class="ai-refine-undo" onclick="runSmartCheckup()">${stale ? 'Check again' : 'Re-run'}</button></div>
            ${r.issues.length ? r.issues.map(issueHTML).join('') : `<p class="checkup-ok">${icon('check')}No problems found.</p>`}
            ${r.bookBy.length ? `
                <h3 class="checkup-h">${icon('calendar-event')}Book ahead</h3>
                <div class="bookby-list">${r.bookBy.map(b => `
                    <div class="bookby-item${b.by < today ? ' overdue' : ''}">
                        <div class="bookby-date">${escapeHTML(parseLocalDate(b.by).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}${b.by < today ? '<span>now</span>' : ''}</div>
                        <div><strong>${escapeHTML(b.what)}</strong><p>${escapeHTML([b.why, b.where].filter(Boolean).join(' · '))}</p></div>
                    </div>`).join('')}</div>
                <button type="button" class="budget-link-btn" onclick="exportBookByICS()">${icon('calendar-event')}Add reminders to my calendar</button>` : ''}
            ${Object.keys(groups).length ? `
                <h3 class="checkup-h">${icon('check')}Before you go</h3>
                ${Object.entries(groups).map(([topic, items]) => `
                    <div class="bgo-group"><div class="bgo-topic">${escapeHTML(topic)}</div>
                    ${items.map(x => `<label class="bgo-item"><input type="checkbox" onchange="toggleBeforeYouGo(this)" data-key="${escapeHTML(x.item)}"${isTicked(trip.id, x.item) ? ' checked' : ''}><span><strong>${escapeHTML(x.item)}</strong>${x.detail ? `<small>${escapeHTML(x.detail)}</small>` : ''}</span></label>`).join('')}
                    ${/phone|internet|sim/i.test(topic) && r.countries.length ? `<div class="bgo-links">${r.countries.map(c => `<a href="${escapeHTML(esimLink(c))}" target="_blank" rel="noopener noreferrer">${icon('antenna-bars-5')}eSIM for ${escapeHTML(c)}</a>`).join('')}</div>` : ''}
                    </div>`).join('')}` : ''}` : ''}`;
}

/* ticked "before you go" items, per trip */
const TICKS_KEY = 'trippo_checkup_ticks_v1';
function readTicks() { try { return JSON.parse(safeGetStorage(TICKS_KEY) || '{}') || {}; } catch (e) { return {}; } }
function isTicked(tripId, item) { const t = readTicks()[tripId]; return Array.isArray(t) && t.includes(item); }
export function toggleBeforeYouGo(input) {
    const trip = getActiveTrip();
    if (!trip || !input) return;
    const ticks = readTicks();
    const list = new Set(Array.isArray(ticks[trip.id]) ? ticks[trip.id] : []);
    if (input.checked) list.add(input.dataset.key); else list.delete(input.dataset.key);
    ticks[trip.id] = [...list].slice(0, 40);
    safeSetStorage(TICKS_KEY, JSON.stringify(ticks));
}

export function openTripCheckup() {
    const trip = getActiveTrip();
    if (!trip || !trip.stops || !trip.stops.length) { showNotification('Add some stops first, then run a check-up.'); return; }
    if (window.toggleSidebar) window.toggleSidebar(false);
    renderTripCheckup();
    const modal = document.getElementById('trip-checkup-modal');
    if (modal) { modal.style.display = 'flex'; modal.classList.add('active'); }
}
