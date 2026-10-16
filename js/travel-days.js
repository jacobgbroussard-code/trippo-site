/* ==========================================================================
   TRAVEL DAYS: every leg of a trip with its date, "leave by" times for flights and trains,
   and the trip calendar (.ics): stays, legs with check-in and leave-by alerts, and timed plans.
   ========================================================================== */
import { getActiveTrip, showNotification, parseLocalDate, formatLocalDate, formatTime, getDistance, inMainlandChina, escapeHTML, escapeJS, icon } from './state.js';
import { hasCoords } from './maps.js';
import { cachedCountry } from './travel-stats.js';
import { membershipFor, membershipChipHTML } from './memberships.js';

const toMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const fromMin = m => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
const METHOD_NAMES = { plane: 'Flight', train: 'Train', bus: 'Bus', car: 'Drive', ferry: 'Ferry', walk: 'Walk' };
export const methodName = m => METHOD_NAMES[m] || 'Travel';
export const methodIcon = m => ({ plane: 'plane', train: 'train', bus: 'bus', car: 'car', ferry: 'route', walk: 'walk' }[m] || 'route');

// Each leg (stop i -> stop i+1) with the date it leaves on: the booked date, or the day you move on
export function travelLegs(trip) {
    const stops = (trip && trip.stops) || [];
    const start = trip && trip.startDate ? parseLocalDate(trip.startDate) : null;
    const legs = [];
    let offset = 0;
    stops.forEach((s, i) => {
        offset += Number(s.nights) || 0;
        const next = stops[i + 1];
        if (!next) return;
        const t = s.transit || null;
        let date = t && /^\d{4}-\d{2}-\d{2}$/.test(t.date || '') ? t.date : null;
        if (!date && start) { const d = new Date(start); d.setDate(d.getDate() + offset); date = formatLocalDate(d); }
        legs.push({ index: i, from: s, to: next, transit: t || {}, method: (t && t.method) || '', date });
    });
    return legs;
}

function isInternational(leg) {
    const a = cachedCountry(leg.from), b = cachedCountry(leg.to);
    if (a && b) return a.code !== b.code;
    if (hasCoords(leg.from) && hasCoords(leg.to)) return getDistance(Number(leg.from.lat), Number(leg.from.lon), Number(leg.to.lat), Number(leg.to.lon)) > 2000;
    return false;
}

// When to leave for the airport / station: { at: 'HH:MM', minutes before departure, why }
export function leaveBy(leg) {
    const dep = toMin(leg.transit.depTime);
    if (dep === null) return null;
    const m = leg.method;
    // trains into or inside mainland China have ID and security checks (Hong Kong West Kowloon too)
    const inChina = s => hasCoords(s) && inMainlandChina(Number(s.lat), Number(s.lon));
    const china = inChina(leg.from) || inChina(leg.to);
    let early, getThere, why;
    if (m === 'plane') {
        const intl = isInternational(leg);
        early = intl ? 180 : 120;
        getThere = 45;
        why = `${intl ? '3 hours before an international' : '2 hours before a domestic'} flight, plus about 45 min to the airport`;
    } else if (m === 'train') {
        early = china ? 45 : 20;
        getThere = 30;
        why = china ? '45 min for ID and security checks at the station, plus about 30 min to get there' : '20 min at the station, plus about 30 min to get there';
    } else if (m === 'bus' || m === 'ferry') {
        early = m === 'ferry' ? 30 : 20;
        getThere = 30;
        why = `${early} min early at the ${m === 'ferry' ? 'terminal' : 'station'}, plus about 30 min to get there`;
    } else return null;
    const before = early + getThere;
    return { at: fromMin(dep - before), before, why, dayBefore: dep - before < 0 };
}

// Directions to where the leg leaves from (Amap in mainland China, where Google Maps doesn't work)
export function departureMapUrl(leg) {
    const place = leg.transit.depStation || leg.from.name;
    const china = hasCoords(leg.from) && inMainlandChina(Number(leg.from.lat), Number(leg.from.lon));
    if (china) return `https://uri.amap.com/search?keyword=${encodeURIComponent(place)}&callnative=1`;
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place)}`;
}

/* ---------- Today: the travel card for a day ---------- */
export function legsOnDate(trip, dateStr) {
    return travelLegs(trip).filter(l => l.date === dateStr && l.method && l.method !== 'walk');
}

export function travelDayCardHTML(trip, dateStr, isToday) {
    const legs = legsOnDate(trip, dateStr);
    if (!legs.length) return '';
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    return legs.map(leg => {
        const t = leg.transit;
        const lb = leaveBy(leg);
        const dep = toMin(t.depTime);
        const gone = isToday && dep !== null && dep < nowMin;
        const owner = `${trip.id}|travel|${leg.from.id}`;
        const from = t.depStation || leg.from.name;
        const to = t.arrStation || leg.to.name;
        return `
        <div class="today-travel${gone ? ' done' : ''}">
            <div class="today-travel-head">${icon(methodIcon(leg.method))}<strong>${escapeHTML(methodName(leg.method))}${t.bookingNumber ? ` ${escapeHTML(t.bookingNumber)}` : ''}</strong>
                <span>${t.depTime ? escapeHTML(formatTime(t.depTime)) : 'time not set'}${t.arrTime ? ` → ${escapeHTML(formatTime(t.arrTime))}` : ''}</span></div>
            <div class="today-travel-route">${escapeHTML(from)} → ${escapeHTML(to)}</div>
            ${lb && !gone ? `<div class="today-leave">${icon('clock')}<div><strong>Leave by ${escapeHTML(formatTime(lb.at))}${lb.dayBefore ? ' (the night before)' : ''}</strong><small>${escapeHTML(lb.why)}</small></div></div>`
            : !t.depTime ? `<button type="button" class="budget-link-btn" onclick="openTransitBookingModal(${leg.index})">${icon('clock')}Add the departure time for a leave-by time</button>` : ''}
            <div class="today-actions">
                <a class="place-chip" href="${escapeHTML(departureMapUrl(leg))}" target="_blank" rel="noopener noreferrer">${icon('navigation')}Directions</a>
                <button type="button" class="place-chip" data-docs-owner="${escapeHTML(owner)}" hidden onclick="openFirstDoc('${escapeJS(owner)}')">${icon('paperclip')}Boarding pass</button>
                <button type="button" class="place-chip" onclick="openTransitBookingModal(${leg.index})">${icon('pencil')}Details</button>
            </div>
            ${membershipChipHTML(membershipFor('travel', { ...t, method: leg.method }))}
        </div>`;
    }).join('');
}

// Show the document chip only where something's attached (called after the card is drawn)
export async function revealDocChips(root) {
    if (!root || !window.docsCount) return;
    for (const b of root.querySelectorAll('[data-docs-owner]')) {
        const n = await window.docsCount(b.dataset.docsOwner);
        if (n) { b.hidden = false; if (n > 1) b.lastChild.textContent = `Documents (${n})`; }
    }
}

/* ---------- calendar (.ics) ---------- */
const icsText = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// Lines over 75 bytes are folded (RFC 5545); split on characters so emoji / CJK aren't cut
function fold(line) {
    const enc = new TextEncoder();
    if (enc.encode(line).length <= 75) return line;
    const out = [];
    let cur = '', bytes = 0;
    for (const ch of line) {
        const b = enc.encode(ch).length;
        if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
        cur += ch; bytes += b;
    }
    out.push(cur);
    return out.join('\r\n ');
}
const ymd = s => s.replace(/-/g, '');
const localStamp = (dateStr, min) => {
    const d = parseLocalDate(dateStr);
    d.setDate(d.getDate() + Math.floor(min / 1440));
    return `${ymd(formatLocalDate(d))}T${fromMin(min).replace(':', '')}00`;
};
const nextDay = s => { const d = parseLocalDate(s); d.setDate(d.getDate() + 1); return formatLocalDate(d); };

export function buildTripCalendar(trip) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Trippo//Trip calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsText(trip.name)}`];
    const ev = (uid, fields, alarms = []) => {
        L.push('BEGIN:VEVENT', `UID:${uid}@trippo.top`, `DTSTAMP:${stamp}`, ...fields);
        alarms.forEach(a => L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(a.text)}`, `TRIGGER:${a.trigger}`, 'END:VALARM'));
        L.push('END:VEVENT');
    };
    let count = 0;
    // stays
    const start = parseLocalDate(trip.startDate);
    const dayDate = [];
    let offset = 0;
    trip.stops.forEach((s, si) => {
        const nights = Number(s.nights) || 0;
        const d0 = new Date(start); d0.setDate(d0.getDate() + offset);
        dayDate[si] = di => { const d = new Date(d0); d.setDate(d.getDate() + di); return formatLocalDate(d); };
        offset += nights;
        if (!nights) return;
        const lg = s.lodging || {};
        const out = new Date(d0); out.setDate(out.getDate() + nights);
        const desc = [lg.name && `Stay: ${lg.name}`, lg.checkInTime && `Check-in from ${lg.checkInTime}`, lg.bookingNumber && `Confirmation: ${lg.bookingNumber}`, lg.address, lg.notes, `${nights} night${nights === 1 ? '' : 's'} · ${trip.name}`].filter(Boolean).join('\n');
        ev(`trippo-${trip.id}-stay-${s.id || si}`, [`DTSTART;VALUE=DATE:${ymd(formatLocalDate(d0))}`, `DTEND;VALUE=DATE:${ymd(formatLocalDate(out))}`,
            `SUMMARY:${icsText(`${s.name}${lg.name ? ` · ${lg.name}` : ''}`)}`, `DESCRIPTION:${icsText(desc)}`, `LOCATION:${icsText(lg.address || s.name)}`, 'TRANSP:TRANSPARENT']);
        count++;
    });
    // legs
    travelLegs(trip).forEach(leg => {
        if (!leg.method || !leg.date || leg.method === 'walk') return;
        const t = leg.transit;
        const from = t.depStation || leg.from.name, to = t.arrStation || leg.to.name;
        const title = `${methodName(leg.method)}${t.bookingNumber ? ` ${t.bookingNumber}` : ''}: ${String(leg.from.name).split(',')[0]} → ${String(leg.to.name).split(',')[0]}`;
        const member = membershipFor('travel', { ...t, method: leg.method });
        const lb = leaveBy(leg);
        const desc = [`${from} → ${to}`, t.depTime && `Departs ${formatTime(t.depTime)} (local time)`, t.arrTime && `Arrives ${formatTime(t.arrTime)} (local time)`,
            lb && `Leave by ${formatTime(lb.at)}: ${lb.why}`, member && `${member.program}: ${member.number}`, t.notes, trip.name].filter(Boolean).join('\n');
        const uid = `trippo-${trip.id}-leg-${leg.from.id || leg.index}`;
        const dep = toMin(t.depTime);
        if (dep === null) {
            ev(uid, [`DTSTART;VALUE=DATE:${ymd(leg.date)}`, `DTEND;VALUE=DATE:${ymd(nextDay(leg.date))}`, `SUMMARY:${icsText(title)}`, `DESCRIPTION:${icsText(desc)}`, `LOCATION:${icsText(from)}`, 'TRANSP:TRANSPARENT']);
        } else {
            let arr = toMin(t.arrTime);
            if (arr === null) arr = dep + 60; else if (arr <= dep) arr += 1440;
            const alarms = [];
            if (leg.method === 'plane') alarms.push({ trigger: '-PT24H', text: `Check in online: ${title}` });
            if (lb) alarms.push({ trigger: `-PT${lb.before + 15}M`, text: `Leave by ${formatTime(lb.at)} for ${title}` });
            else alarms.push({ trigger: '-PT2H', text: title });
            // floating local times: they show at the local departure time wherever the phone is
            ev(uid, [`DTSTART:${localStamp(leg.date, dep)}`, `DTEND:${localStamp(leg.date, arr)}`, `SUMMARY:${icsText(title)}`, `DESCRIPTION:${icsText(desc)}`, `LOCATION:${icsText(from)}`], alarms);
        }
        count++;
    });
    // timed plans
    (trip.places || []).forEach(p => {
        const m = toMin(p.time);
        const si = Number(p.cityIndex), di = Number(p.dayIndex) || 0;
        if (m === null || !dayDate[si]) return;
        const date = dayDate[si](di);
        const end = m + (Number(p.duration) || 60);
        ev(`trippo-${trip.id}-place-${p.id || `${si}-${di}-${m}`}`, [`DTSTART:${localStamp(date, m)}`, `DTEND:${localStamp(date, end)}`, `SUMMARY:${icsText(p.name)}`,
            `DESCRIPTION:${icsText([p.localName, p.notes, trip.name].filter(Boolean).join('\n'))}`, `LOCATION:${icsText(p.address || p.name)}`],
            [{ trigger: '-PT30M', text: p.name }]);
        count++;
    });
    L.push('END:VCALENDAR');
    return { text: L.map(fold).join('\r\n') + '\r\n', count };
}

export function exportTripCalendar() {
    const trip = getActiveTrip();
    if (!trip || !trip.stops || !trip.stops.length) { showNotification('Add some stops first.'); return; }
    if (!trip.startDate || !String(trip.startDate).trim()) {
        showNotification('Set the trip\u2019s start date first, so the calendar has dates.');
        if (window.openEditTripModal) window.openEditTripModal(trip.id);
        return;
    }
    const { text, count } = buildTripCalendar(trip);
    const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${String(trip.name || 'trip').replace(/[^\w-]+/g, '_')}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    showNotification(`${count} event${count === 1 ? '' : 's'} saved, with check-in and leave-by alerts. Open the file to add them to your calendar.`, 4000);
}
