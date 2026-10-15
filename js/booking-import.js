/* ==========================================================================
   IMPORT A BOOKING FROM A CONFIRMATION
   Paste the email text or pick a screenshot / PDF. Gemini reads it, we work out which
   stay or travel leg it belongs to, then open that form filled in. Nothing is saved
   until the user checks it and presses Save.
   ========================================================================== */
import { getActiveTrip, showNotification, escapeHTML, triggerHaptic, closeModal, parseLocalDate, formatLocalDate } from './state.js';
import { askGeminiJSON, getGeminiApiKey, checkIsOnline } from './ai.js';

const MAX_FILE_BYTES = 6 * 1024 * 1024;
let importFile = null;      // { mimeType, data (base64), name }
let importContext = null;   // { kind: 'stay' | 'travel', index } when opened from a specific form
let importBusy = false;

function setStatus(html) {
    const el = document.getElementById('booking-import-status');
    if (el) { el.innerHTML = html || ''; el.style.display = html ? '' : 'none'; }
}

function renderFileChip() {
    const chip = document.getElementById('booking-import-file');
    if (!chip) return;
    chip.style.display = importFile ? '' : 'none';
    chip.innerHTML = importFile ? `<span>${escapeHTML(importFile.name)}</span><button type="button" onclick="clearBookingImportFile()" aria-label="Remove file">✕</button>` : '';
}

export function openBookingImport(kind = null, index = null) {
    const trip = getActiveTrip();
    if (!trip || !Array.isArray(trip.stops) || !trip.stops.length) {
        showNotification('Add the stops to your trip first, then import bookings into them.', 3500);
        return;
    }
    importContext = (kind === 'stay' || kind === 'travel') && Number.isInteger(index) ? { kind, index } : null;
    importFile = null;
    const text = document.getElementById('booking-import-text');
    if (text) text.value = '';
    const fileInput = document.getElementById('booking-import-file-input');
    if (fileInput) fileInput.value = '';
    renderFileChip();
    setStatus('');
    // Opened from a stay or leg form: close it so the filled-in one can open on top cleanly
    closeModal('hotel-booking-modal');
    closeModal('transit-booking-modal');
    const modal = document.getElementById('booking-import-modal');
    if (modal) { modal.style.display = 'flex'; modal.classList.add('active'); }
}

export function handleBookingImportFile(input) {
    const file = input && input.files && input.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type) && file.type !== 'application/pdf') {
        showNotification('Pick a screenshot, photo or PDF of the confirmation.', 3000);
        input.value = '';
        return;
    }
    if (file.size > MAX_FILE_BYTES) {
        showNotification('That file is over 6 MB. Try a screenshot of just the booking details.', 3500);
        input.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = () => {
        const dataUrl = String(reader.result || '');
        importFile = { mimeType: file.type, data: dataUrl.slice(dataUrl.indexOf(',') + 1), name: file.name || 'confirmation' };
        renderFileChip();
    };
    reader.readAsDataURL(file);
}

export function clearBookingImportFile() {
    importFile = null;
    const fileInput = document.getElementById('booking-import-file-input');
    if (fileInput) fileInput.value = '';
    renderFileChip();
}

// Date ranges for each stop, so a check-in or flight date can be matched to the right place
function stopRanges(trip) {
    if (!trip.startDate) return trip.stops.map(() => null);
    const d = parseLocalDate(trip.startDate);
    return trip.stops.map(stop => {
        const start = formatLocalDate(d);
        d.setDate(d.getDate() + (Number(stop.nights) || 0));
        return { start, end: formatLocalDate(d) };
    });
}

const norm = s => String(s || '').toLowerCase().replace(/[^a-zÀ-￿]+/g, ' ').trim();
const mentions = (haystack, name) => {
    const n = norm(name).split(' ')[0];
    return n.length > 2 && norm(haystack).includes(n);
};

function matchStay(trip, res, ranges) {
    const h = res.hotel || {};
    const valid = i => Number.isInteger(i) && i >= 0 && i < trip.stops.length && Number(trip.stops[i].nights) > 0;
    let i = ranges.findIndex(r => r && h.checkIn && h.checkIn >= r.start && h.checkIn < r.end);
    if (valid(i)) return i;
    i = trip.stops.findIndex((s, si) => valid(si) && (mentions(h.address, s.name) || mentions(h.name, s.name)));
    if (valid(i)) return i;
    const ai = Number(res.match && res.match.stopIndex);
    return valid(ai) ? ai : -1;
}

function matchLeg(trip, res, ranges) {
    const j = res.journey || {};
    const valid = i => Number.isInteger(i) && i >= 0 && i < trip.stops.length - 1;
    const byCities = trip.stops.findIndex((s, si) => valid(si) &&
        (mentions(j.fromCity || j.from, s.name) || mentions(j.from, s.name)) &&
        (mentions(j.toCity || j.to, trip.stops[si + 1].name) || mentions(j.to, trip.stops[si + 1].name)));
    if (valid(byCities)) return byCities;
    const byDate = ranges.findIndex((r, si) => valid(si) && r && j.date && j.date === r.end);
    if (valid(byDate)) return byDate;
    const ai = Number(res.match && res.match.legFromIndex);
    return valid(ai) ? ai : -1;
}

function to12h(hhmm) {
    const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return String(hhmm || '');
    const h = Number(m[1]) % 24;
    return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

function setField(id, value) {
    const el = document.getElementById(id);
    if (!el || value === undefined || value === null || value === '') return;
    if (el._flatpickr) el._flatpickr.setDate(value, true);
    else el.value = value;
}

function priceFor(res) {
    const p = res.price || {};
    const total = Number(p.total);
    if (!Number.isFinite(total) || total <= 0) return { usd: '', note: '' };
    const cur = String(p.currency || 'USD').toUpperCase();
    return cur === 'USD' ? { usd: String(Math.round(total * 100) / 100), note: '' } : { usd: '', note: `Paid ${total.toLocaleString()} ${cur}` };
}

function fillStay(index, res) {
    const h = res.hotel || {};
    const price = priceFor(res);
    window.openLodgingModal(index);
    setField('hotel-name-input', h.name);
    setField('hotel-conf-input', h.bookingNumber);
    setField('hotel-checkin-time', h.checkInTime ? to12h(h.checkInTime) : '');
    setField('hotel-address-input', h.address);
    setField('hotel-url-input', /^https:\/\//.test(String(h.manageUrl || '')) ? h.manageUrl : '');
    setField('hotel-notes-input', [h.roomInfo, h.guests ? `${h.guests} guests` : '', h.cancellation, price.note].filter(Boolean).join(' · '));
    setField('hotel-price-input', price.usd);
}

function fillLeg(index, res) {
    const j = res.journey || {};
    const price = priceFor(res);
    const method = res.type === 'flight' ? 'plane' : res.type === 'train' ? 'train' : res.type === 'bus' ? 'bus' : 'car';
    window.openTransitBookingModal(index);
    setField('transit-method', method);
    setField('transit-booking-num', j.bookingNumber);
    setField('transit-date', j.date);
    setField('transit-dep-station', j.from);
    setField('transit-arr-station', j.to);
    setField('transit-dep-time', /^\d{2}:\d{2}$/.test(String(j.depTime || '')) ? j.depTime : '');
    setField('transit-arr-time', /^\d{2}:\d{2}$/.test(String(j.arrTime || '')) ? j.arrTime : '');
    if (j.returnDate) {
        setField('transit-flight-type', 'rt');
        if (window.toggleTransitReturnDateField) window.toggleTransitReturnDateField();
        setField('transit-return-date', j.returnDate);
    }
    setField('transit-notes', [
        [j.carrier, j.number].filter(Boolean).join(' '),
        j.arrivesNextDay ? 'lands next day' : '',
        j.seats ? `seats ${j.seats}` : '',
        j.returnDate ? `return ${j.returnDate}${j.returnDepTime ? ` ${j.returnDepTime}` : ''}${j.returnNumber ? ` (${j.returnNumber})` : ''}` : '',
        price.note
    ].filter(Boolean).join(' · '));
    setField('transit-price-input', price.usd);
}

export async function runBookingImport() {
    if (importBusy) return;
    const trip = getActiveTrip();
    const text = (document.getElementById('booking-import-text')?.value || '').trim().slice(0, 20000);
    if (!trip || !trip.stops.length) return;
    if (!text && !importFile) { setStatus('Paste the confirmation text or pick a screenshot first.'); return; }
    if (!getGeminiApiKey()) { setStatus('Reading confirmations needs your Gemini key (Settings → AI).'); return; }
    if (!checkIsOnline()) { setStatus('Reading a confirmation needs an internet connection.'); return; }

    const ranges = stopRanges(trip);
    const stopsList = trip.stops.map((s, i) => `${i}: ${s.name}${ranges[i] ? ` (${ranges[i].start} to ${ranges[i].end}, ${s.nights} nights)` : ` (${s.nights} nights)`}`).join('\n');
    const system = `You read travel booking confirmations (emails, screenshots, PDFs) and pull out the details. Only use what the document says; never invent booking numbers, times or prices.
Return ONLY JSON:
{"type": "flight" | "train" | "bus" | "ferry" | "hotel" | "other",
 "summary": "One short line, e.g. United UA857 IAH to PVG, 1 Apr",
 "hotel": {"name": "", "address": "", "checkIn": "YYYY-MM-DD", "checkOut": "YYYY-MM-DD", "checkInTime": "15:00", "bookingNumber": "", "roomInfo": "", "guests": 2, "cancellation": "short free-cancellation note", "manageUrl": ""},
 "journey": {"from": "airport code or station", "to": "", "fromCity": "", "toCity": "", "date": "YYYY-MM-DD", "depTime": "HH:MM", "arrTime": "HH:MM", "arrivesNextDay": false, "carrier": "", "number": "", "seats": "", "bookingNumber": "", "returnDate": "", "returnDepTime": "", "returnNumber": ""},
 "price": {"total": 0, "currency": "USD"},
 "match": {"stopIndex": -1, "legFromIndex": -1}}
Fill only "hotel" or "journey", whichever fits. Times are 24h local times. For a round trip, "journey" is the outbound part plus the return date.
"match": the stop (hotel) or the stop the journey leaves from, using the trip's numbered stops; -1 if nothing fits.`;
    const user = `Trip "${trip.name}" stops:\n${stopsList}\n\nConfirmation:\n${text || '(see the attached file)'}`;

    importBusy = true;
    const btn = document.getElementById('booking-import-btn');
    if (btn) btn.disabled = true;
    setStatus('<span class="ai-btn-spinner"></span> Reading your confirmation…');
    try {
        const res = await askGeminiJSON(system, user, 60000, { thinking: 'low', attachments: importFile ? [importFile] : [] });
        if (!res || !res.type || res.type === 'other' || (!res.hotel && !res.journey)) {
            setStatus('Couldn’t find a flight, train, bus or hotel booking in that. Try a clearer screenshot or paste the email text.');
            return;
        }
        const isStay = res.type === 'hotel';
        let index = importContext && importContext.kind === (isStay ? 'stay' : 'travel') ? importContext.index : -1;
        if (index < 0) index = isStay ? matchStay(trip, res, ranges) : matchLeg(trip, res, ranges);
        if (index < 0) {
            setStatus(`Read it (${escapeHTML(res.summary || res.type)}), but couldn’t tell which ${isStay ? 'stop' : 'travel leg'} of this trip it’s for. Open that ${isStay ? 'stay' : 'leg'} and use “Fill from confirmation” there.`);
            return;
        }
        closeModal('booking-import-modal');
        if (isStay) fillStay(index, res); else fillLeg(index, res);
        showNotification(`Filled in from your confirmation: ${res.summary || res.type}. Check it, then Save.`, 4500);
        triggerHaptic('success');
    } catch (e) {
        setStatus(escapeHTML(e && e.name === 'AbortError' ? 'That took too long. Please try again.' : (e && e.message) || 'Couldn’t read that confirmation. Please try again.'));
    } finally {
        importBusy = false;
        if (btn) btn.disabled = false;
    }
}
