/* ==========================================================================
   Trippo Travel Planner - Smart Day Planner
   js/day-planner.js

   Turns a "places I want to see" list (in a stop's Planner sheet) into
   suggested days: typical visit times per kind of place (or Gemini's, when the
   user has a key), nearby places grouped on the same day, lunch / dinner gaps,
   travel time between stops, closed days and full-day trips respected.

   The sheet is an editor for the stop's days: the stops already on them show
   next to the new suggestions, and any row can be renamed (with place search),
   retimed, moved to another day or removed (swipe left). Nothing changes until
   Save, and then only the days with a change are rewritten. Hotels and the
   arrival / departure airport or station are never touched.
   ========================================================================== */
import {
    trips, getActiveTrip, saveTrips, escapeHTML, escapeJS, showNotification, icon, triggerHaptic,
    getDistance, parseLocalDate, closeModal, formatTime, safeGetStorage, safeSetStorage,
    setActivePlacesTripId, setActivePlacesStopIndex, setActivePlacesDayIndex
} from './state.js';
import { askGeminiJSON, getGeminiApiKey } from './ai.js';
import { getProfilePace } from './travel-profile.js';
import { hubKind } from './places.js';

export const DAY_PACES = {
    relaxed: { label: 'Relaxed', start: 600, end: 1110, buffer: 20 },  // 10:00–18:30
    balanced: { label: 'Balanced', start: 540, end: 1200, buffer: 10 }, // 9:00–20:00
    packed: { label: 'Packed', start: 510, end: 1290, buffer: 5 }       // 8:30–21:30
};
const PACE_KEY = 'trippo_day_pace';
const LUNCH_MIN = 60;
const DINNER_MIN = 75;
const FULL_DAY = 360;
const TRAVEL_ALLOWANCE = 25; // per stop, when sharing places out between days
const MAX_ITEMS = 30;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Typical visit lengths (minutes), roughly what map apps show as "people typically spend".
// First match wins, so the more specific kinds come first.
const KINDS = [
    { kind: 'themepark', re: /disney|universal studios|theme park|amusement park|legoland|water ?park/i, min: 480 },
    { kind: 'ride', re: /maglev|cable car|gondola|funicular|train ride|tram ride|ferris wheel/i, min: 60 },
    { kind: 'daytrip', re: /day ?trip|great wall|water ?town|national park|\bhike\b|\btrek|\btrail\b|mountain/i, min: 360, time: 'morning' },
    { kind: 'zoo', re: /\bzoo\b|aquarium|safari|panda base|wildlife/i, min: 180, time: 'morning' },
    { kind: 'bigmuseum', re: /louvre|british museum|metropolitan museum|\bthe met\b|vatican|uffizi|prado|hermitage|forbidden city|palace museum|smithsonian/i, min: 210, time: 'morning' },
    { kind: 'museum', re: /museum|gallery|exhibit|science (center|centre)|art (center|centre)|memorial hall/i, min: 150 },
    { kind: 'palace', re: /palace|castle|\bfort\b|fortress|citadel|imperial|\btomb|mausoleum|ruins|colosseum|acropolis/i, min: 150 },
    { kind: 'show', re: /\bshow\b|acrobat|theat(er|re)|opera|concert|performance|cabaret|musical/i, min: 120, time: 'evening' },
    { kind: 'cruise', re: /cruise|boat|river tour/i, min: 90 },
    { kind: 'tour', re: /\btour\b|\bclass\b|workshop|cooking|tasting/i, min: 180 },
    { kind: 'oldtown', re: /old town|old city|ancient town|village|historic district|quarter|hutong|concession|neighbou?rhood/i, min: 150 },
    { kind: 'market', re: /market|bazaar|food street/i, min: 90, cat: '🛍 Shopping' },
    { kind: 'shopping', re: /shopping|\bmall\b|\bshops\b|outlet|boutique/i, min: 120, cat: '🛍 Shopping' },
    { kind: 'view', re: /tower|observation|observatory|sky ?deck|skyline|viewpoint|lookout|\bpeak\b|rooftop|pearl/i, min: 75 },
    { kind: 'temple', re: /temple|shrine|pagoda|church|cathedral|basilica|mosque|monastery|abbey|synagogue/i, min: 60, time: 'morning' },
    { kind: 'garden', re: /garden|\bpark\b|botanic|\blake\b|square|plaza/i, min: 90 },
    { kind: 'waterfront', re: /\bbund\b|waterfront|promenade|riverside|river walk|\bpier\b|harbou?r|boardwalk/i, min: 90 },
    { kind: 'beach', re: /beach|\bbay\b|island|lagoon/i, min: 180 },
    { kind: 'food', re: /dumpling|restaurant|dinner|lunch|brunch|breakfast|\bfood\b|\beat\b|noodle|bbq|hot ?pot|street food|roast duck|sushi|ramen|bistro|tapas/i, min: 75, cat: '🍽 Food & Drink' },
    { kind: 'cafe', re: /caf[eé]|coffee|tea ?house|bakery|dessert|gelato/i, min: 45, cat: '☕ Cafe & Chill' },
    { kind: 'nightlife', re: /\bbars?\b|\bpubs?\b|\bclubs?\b|speakeasy|nightlife|izakaya/i, min: 120, cat: '🍽 Food & Drink', time: 'evening' }
];
const FOOD_RE = KINDS.find(k => k.kind === 'food').re;

let dp = null;          // current planner session
let runToken = 0;       // ignore results from a run the user already left
const geoCache = new Map();

/* --- small helpers --- */
const hasCoords = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon);
const dist = (a, b) => getDistance(a.lat, a.lon, b.lat, b.lon) || 0;
const hhmm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
export const fmtDur = m => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`);
const norm = s => String(s || '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9À-￿]+/g, '');

function centroid(list) {
    const pts = list.filter(hasCoords);
    if (!pts.length) return null;
    return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length };
}

function toMinutes(t) {
    const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})\s*([ap])?\.?\s*m?\.?$/i);
    if (!m) return null;
    let h = Number(m[1]) % 24;
    if (m[3]) h = (h % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0);
    return h * 60 + Number(m[2]);
}

/* --- parsing the list --- */
function parseDuration(text) {
    const t = String(text).toLowerCase();
    if (/\b(full|all|whole)[ -]day\b/.test(t)) return 480;
    if (/\bhalf[ -]day\b/.test(t)) return 240;
    let m = t.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b(?:\s*(\d+)\s*(?:m|min|mins|minutes)\b)?/);
    if (m) return Math.round(parseFloat(m[1]) * 60 + (m[2] ? Number(m[2]) : 0));
    m = t.match(/(\d+)\s*(?:min|mins|minutes)\b/);
    return m ? Number(m[1]) : null;
}

function cleanName(text) {
    return String(text)
        .replace(/\b(full|all|whole|half)[ -]day\b/gi, '')
        .replace(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b(?:\s*\d+\s*(?:m|min|mins|minutes)\b)?/gi, '')
        .replace(/\d+\s*(?:min|mins|minutes)\b/gi, '')
        .replace(/\(\s*\)/g, '')
        .replace(/[\s\-–—:|]+$/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

// What to type into a map search: the place, not the plan ("The Bund evening walk" → "The Bund")
function searchName(name) {
    return name.split(/\s+(?:&|and|\+)\s+/i)[0]
        .replace(/\b(evening|morning|night|sunset|sunrise|walk|stroll|visit|shopping|excursion|hike|trip|day trip|explore|exploring|see|go to)\b/gi, '')
        .replace(/[()]/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim() || name;
}

export function parsePlanList(text) {
    const seen = new Set();
    return String(text || '')
        .split(/\n|;|,|•|·/)
        .map(s => s.replace(/^\s*(?:[-*–]|\d+[.)])\s*/, '').trim())
        .filter(s => s.length > 1)
        .filter(s => { const k = norm(cleanName(s)); if (!k || seen.has(k)) return false; seen.add(k); return true; })
        .slice(0, MAX_ITEMS)
        .map((raw, i) => {
            const userMin = parseDuration(raw);
            const name = cleanName(raw) || raw;
            const k = KINDS.find(x => x.re.test(name));
            const time = /\b(evening|night|sunset|after dark)\b/i.test(raw) ? 'evening'
                : /\b(morning|sunrise|breakfast|early)\b/i.test(raw) ? 'morning'
                : (k && k.time) || 'any';
            return {
                id: 'dp' + i, raw, name, query: searchName(name),
                minutes: userMin || (k ? k.min : 90), userSet: Boolean(userMin),
                kind: k ? k.kind : 'sight', category: (k && k.cat) || '● See & Do',
                isFood: FOOD_RE.test(name), bestTime: time, closedDays: [],
                lat: null, lon: null, pinDay: null, fixedStart: null, skip: false, source: 'list'
            };
        });
}

/* --- facts: Gemini when there's a key, otherwise typical times + map search --- */
async function enrichWithAI(items, stop) {
    const system = `You are a travel logistics expert helping plan days in ${stop.name}. For each listed entry give realistic planning facts.
Return ONLY JSON: {"places":[{"i":0,"name":"Official place name","lat":31.2397,"lon":121.4900,"minutes":120,"bestTime":"morning","opens":"09:00","closes":"17:00","closedDays":["Monday"],"isFood":false,"isMeal":false}]}
- i: the entry's index from the list. name: the real place's usual English name.
- minutes: how long visitors typically spend there, not counting travel. Full-day trips (e.g. a theme park or a trip out of town) are 360-540.
- bestTime: "morning", "afternoon", "evening" or "any" (e.g. evening for night views, shows and night markets).
- opens / closes: usual opening hours as 24h "HH:MM" (omit for places that are always open, like streets or crossings). Markets that close early should say so.
- closedDays: regular weekly closing days only, as weekday names. isMeal: true when the entry is mainly a meal.
- If an entry is an activity rather than a place, use the most likely spot for it in ${stop.name}.`;
    const user = `City: ${stop.name}${hasCoords(stop) ? ` (around ${stop.lat.toFixed(3)}, ${stop.lon.toFixed(3)})` : ''}\nEntries:\n` +
        items.map((it, i) => `${i}. ${it.raw}`).join('\n');
    const res = await askGeminiJSON(system, user, 35000);
    const list = res && Array.isArray(res.places) ? res.places : [];
    list.forEach(r => {
        const it = items[Number(r && r.i)];
        if (!it) return;
        if (typeof r.name === 'string' && r.name.trim()) it.name = r.name.trim().slice(0, 80);
        const mins = Number(r.minutes);
        if (!it.userSet && mins >= 15 && mins <= 720) it.minutes = Math.round(mins / 5) * 5;
        const lat = Number(r.lat), lon = Number(r.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon) && (!hasCoords(stop) || getDistance(lat, lon, stop.lat, stop.lon) < 150)) { it.lat = lat; it.lon = lon; }
        if (['morning', 'evening'].includes(r.bestTime)) it.bestTime = r.bestTime;
        const opens = toMinutes(r.opens), closes = toMinutes(r.closes);
        if (opens !== null && closes !== null && closes > opens) {
            it.opens = opens; it.closes = closes;
            if (closes <= 15 * 60) it.bestTime = 'morning';      // e.g. fish markets
            else if (opens >= 16 * 60) it.bestTime = 'evening';  // e.g. night markets, bars
        }
        if (Array.isArray(r.closedDays)) it.closedDays = r.closedDays.map(d => WEEKDAYS.indexOf(String(d).toLowerCase())).filter(d => d >= 0);
        if (r.isMeal === true) { it.kind = 'food'; it.category = '🍽 Food & Drink'; }
        if (typeof r.isFood === 'boolean') it.isFood = r.isFood || it.kind === 'food';
        it.facts = 'ai';
    });
}

async function geocode(item, stop, signal) {
    const key = `${stop.name}|${item.query}`.toLowerCase();
    if (geoCache.has(key)) return geoCache.get(key);
    const near = hasCoords(stop);
    const url = near
        ? `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(item.query)}&viewbox=${stop.lon - 0.5},${stop.lat + 0.5},${stop.lon + 0.5},${stop.lat - 0.5}&bounded=1`
        : `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(`${item.query}, ${stop.name}`)}`;
    let hit = null;
    try {
        const res = await fetch(url, { headers: { 'Accept-Language': 'en' }, signal });
        const data = res.ok ? await res.json() : [];
        if (Array.isArray(data) && data[0]) hit = { lat: Number(data[0].lat), lon: Number(data[0].lon), address: String(data[0].display_name || '').split(',').slice(0, 3).join(',').trim() };
    } catch (e) {
        if (e.name === 'AbortError') throw e;
    }
    geoCache.set(key, hit);
    return hit;
}

/* --- scheduling --- */
function stopDays(trip, stopIndex) {
    const stops = trip.stops || [];
    const stop = stops[stopIndex];
    const n = Math.max(1, Number(stop.nights) || 1);
    let base = null;
    if (trip.startDate) {
        base = parseLocalDate(trip.startDate);
        base.setDate(base.getDate() + stops.slice(0, stopIndex).reduce((s, x) => s + (Number(x.nights) || 0), 0));
    }
    return Array.from({ length: n }, (_, d) => {
        let date = null;
        if (base) { date = new Date(base); date.setDate(base.getDate() + d); }
        return { index: d, date, weekday: date ? date.getDay() : null };
    });
}

function existingOnDays(trip, stopIndex, dayCount, skipIds = new Set()) {
    const days = Array.from({ length: dayCount }, () => ({ load: 0, fixed: [], names: [] }));
    (trip.places || []).forEach(p => {
        if (!p || p.cityIndex !== stopIndex || skipIds.has(p.id)) return;
        const d = days[Number(p.dayIndex)];
        if (!d) return;
        const mins = Number(p.duration) || 75;
        d.load += mins + 20;
        d.names.push(p.name);
        const start = toMinutes(p.time);
        if (start !== null) d.fixed.push({ start, end: start + mins, name: p.name });
    });
    days.forEach(d => d.fixed.sort((a, b) => a.start - b.start));
    return days;
}

function travelBetween(a, b) {
    if (!a) return { min: 0, mode: '' };
    if (!hasCoords(a) || !hasCoords(b)) return { min: 20, mode: 'travel' };
    const km = dist(a, b);
    if (km <= 1.2) return { min: Math.max(5, Math.round(km * 13)), mode: 'walk', km };
    const min = km <= 10 ? 12 + km * 3 : 30 + km * 1.5;
    return { min: Math.min(150, Math.round(min)), mode: 'metro / taxi', km };
}

// Order one day's places: morning ones first, evening ones last, nearest-next in between
function orderDay(list, startPoint) {
    const nearestChain = (arr, from) => {
        const left = [...arr], out = [];
        let cur = from;
        while (left.length) {
            let bi = 0;
            if (hasCoords(cur)) {
                let bd = Infinity;
                left.forEach((x, j) => { const d = hasCoords(x) ? dist(cur, x) : 1e6; if (d < bd) { bd = d; bi = j; } });
            }
            const nx = left.splice(bi, 1)[0];
            out.push(nx);
            if (hasCoords(nx)) cur = nx;
        }
        return out;
    };
    const fullDay = list.filter(i => i.minutes >= FULL_DAY);
    const rest = list.filter(i => i.minutes < FULL_DAY);
    const a = nearestChain([...fullDay, ...rest.filter(i => i.bestTime === 'morning')], startPoint);
    const b = nearestChain(rest.filter(i => i.bestTime !== 'morning' && i.bestTime !== 'evening'), a[a.length - 1] || startPoint);
    const evening = rest.filter(i => i.bestTime === 'evening');
    const late = i => ['nightlife', 'show'].includes(i.kind);
    const c = nearestChain(evening.filter(i => !late(i)), b[b.length - 1] || a[a.length - 1] || startPoint);
    const d = nearestChain(evening.filter(late), c[c.length - 1] || b[b.length - 1] || startPoint);
    return [...a, ...b, ...c, ...d];
}

function buildTimeline(dayItems, pace, fixed, startPoint, dayStart) {
    const dinnerOn = pace.end >= 19 * 60 + 30;
    // Stops with a time the user set stay at that time; the rest are fitted around them
    const timed = dayItems.filter(i => Number.isFinite(i.fixedStart));
    const flowing = dayItems.filter(i => !Number.isFinite(i.fixedStart));
    const blocks = [...fixed, ...timed.map(i => ({ start: i.fixedStart, end: i.fixedStart + i.minutes, item: i }))].sort((a, b) => a.start - b.start);
    const meals = flowing.filter(i => i.kind === 'food');
    const lunchMeal = meals.find(m => m.bestTime !== 'evening') || null;
    const dinnerMeal = meals.find(m => m !== lunchMeal) || null;
    const extraMeals = meals.filter(m => m !== lunchMeal && m !== dinnerMeal);
    const sights = orderDay(flowing.filter(i => i.kind !== 'food'), startPoint);
    const out = [];
    let t = dayStart;
    let at = startPoint;
    const mealAt = (from, to) => timed.some(i => i.kind === 'food' && i.fixedStart >= from && i.fixedStart <= to);
    let lunchDone = dayStart >= 13 * 60 + 30 || mealAt(11 * 60, 14 * 60 + 30); // arriving mid-afternoon: you'll have eaten on the way
    let dinnerDone = !dinnerOn || mealAt(17 * 60 + 30, 21 * 60 + 30);

    const clearOfFixed = (start, mins, it) => {
        let st = start, moved = true;
        while (moved) {
            moved = false;
            for (const f of blocks) if (st < f.end && st + mins > f.start) { st = f.end + (f.item && it ? Math.max(10, travelBetween(f.item, it).min) : 10); moved = true; }
        }
        return st;
    };
    const visit = (it, earliest = 0, extra = 0, note = '') => {
        const tr = travelBetween(at, it);
        const mins = it.minutes + extra;
        const start = clearOfFixed(Math.max(t + tr.min, earliest, Number.isFinite(it.opens) ? it.opens : 0), mins, it);
        const closedBy = Number.isFinite(it.closes) && start + Math.min(mins, 60) > it.closes;
        out.push({ type: 'visit', item: it, start, end: start + mins, travel: tr, note: closedBy ? `closes ${hhmm(it.closes)}` : note, late: closedBy });
        t = start + mins + pace.buffer;
        if (hasCoords(it)) at = it;
    };
    const meal = (label, mins, earliest, food) => {
        if (food) { visit(food, earliest); return; }
        const start = clearOfFixed(Math.max(t, earliest), mins);
        out.push({ type: 'meal', label, start, end: start + mins, near: at && at.name ? at.name : '' });
        t = start + mins + pace.buffer;
    };

    sights.forEach(it => {
        const tr = travelBetween(at, it);
        const arrive = t + tr.min;
        if (it.bestTime === 'evening') {
            if (!lunchDone && t > 11 * 60 + 30 && t < 15 * 60 + 30) meal('Lunch', LUNCH_MIN, 11 * 60 + 45, lunchMeal);
            lunchDone = true;
            // Shows and night views happen after dark, with dinner first
            if (!dinnerDone) { meal('Dinner', DINNER_MIN, 18 * 60, dinnerMeal); dinnerDone = true; }
            visit(it, ['show', 'nightlife'].includes(it.kind) ? 19 * 60 : 17 * 60 + 30);
            return;
        }
        // Long visits over midday (zoo, day trips, big museums): eat there
        if (!lunchDone && it.minutes >= 180 && arrive <= 12 * 60 + 15 && arrive + it.minutes >= 13 * 60 + 15 && !lunchMeal) {
            visit(it, 0, 45, 'lunch there');
            lunchDone = true;
            return;
        }
        if (!lunchDone && (t >= 12 * 60 || (t >= 11 * 60 && arrive + it.minutes > 13 * 60 + 45))) {
            meal('Lunch', LUNCH_MIN, 11 * 60 + 45, lunchMeal); lunchDone = true;
        }
        if (!dinnerDone && t >= 17 * 60 + 45) { meal('Dinner', DINNER_MIN, 18 * 60, dinnerMeal); dinnerDone = true; }
        visit(it);
    });
    if (sights.length || meals.length) {
        if (!lunchDone && ((t > 11 * 60 + 30 && t < 15 * 60 + 30) || lunchMeal)) { meal('Lunch', LUNCH_MIN, 11 * 60 + 45, lunchMeal); lunchDone = true; }
        // A named dinner place always gets its evening slot; a generic dinner break only on days that run into the evening
        if (dinnerMeal && !out.some(e => e.item === dinnerMeal)) meal('Dinner', DINNER_MIN, 18 * 60, dinnerMeal);
        else if (!dinnerDone && t >= 16 * 60 + 30) meal('Dinner', DINNER_MIN, 18 * 60 + 30, null);
        extraMeals.forEach(m => visit(m));
    }
    fixed.forEach(f => out.push({ type: 'fixed', label: f.name, start: f.start, end: f.end }));
    timed.forEach(it => {
        const s0 = it.fixedStart;
        const closedBy = Number.isFinite(it.closes) && s0 + Math.min(it.minutes, 60) > it.closes;
        const early = Number.isFinite(it.opens) && s0 < it.opens;
        out.push({ type: 'visit', item: it, start: s0, end: s0 + it.minutes, note: closedBy ? `closes ${hhmm(it.closes)}` : early ? `opens ${hhmm(it.opens)}` : '', late: closedBy || early, timed: true });
    });
    out.sort((x, y) => x.start - y.start);
    // Travel shown above each stop is from the stop before it in time order
    let from = startPoint;
    out.forEach(e => {
        if (e.type !== 'visit') return;
        e.travel = travelBetween(from, e.item);
        if (hasCoords(e.item)) from = e.item;
    });
    const end = out.length ? Math.max(...out.map(e => e.end)) : dayStart;
    const sightMins = out.filter(e => e.type === 'visit').reduce((sum, e) => sum + e.item.minutes, 0);
    // Evening plans the user asked for (shows, night views) and the dinner before them don't make a day "packed"
    const core = out.filter(e => !(e.type === 'visit' && e.item.bestTime === 'evening') && !(e.type === 'meal' && e.label === 'Dinner'));
    const coreEnd = core.length ? Math.max(...core.map(e => e.end)) : dayStart;
    return { timeline: out, end, sightMins, packed: out.some(e => e.type === 'visit') && coreEnd > pace.end + 30, start: dayStart };
}

// Pure: share the places out between the stop's days and time each day
export function buildDayPlan(trip, stopIndex, items, paceId = 'balanced') {
    const pace = DAY_PACES[paceId] || DAY_PACES.balanced;
    const stop = trip.stops[stopIndex];
    const days = stopDays(trip, stopIndex);
    const itemPlaceIds = new Set(items.filter(it => it.placeId).map(it => it.placeId));
    const existing = existingOnDays(trip, stopIndex, days.length, itemPlaceIds);
    const hotel = stop.lodging && Number.isFinite(Number(stop.lodging.lat)) && Number.isFinite(Number(stop.lodging.lon))
        ? { name: stop.lodging.name || 'your hotel', lat: Number(stop.lodging.lat), lon: Number(stop.lodging.lon) } : null;
    const center = hotel || (hasCoords(stop) ? { lat: stop.lat, lon: stop.lon } : null);

    // List entries already on the itinerary for this stop are skipped, not duplicated
    // (the ones shown as rows in the sheet need no note)
    const planned = (trip.places || []).filter(p => p && p.cityIndex === stopIndex);
    const alreadyPlanned = [];
    const pool = items.filter(it => {
        if (it.skip) return false;
        if (it.placeId || it.source === 'added') return true;
        const k = norm(it.name), q = norm(it.query);
        const hit = planned.find(p => { const n = norm(p.name); return n.length > 3 && (n === k || (k.length > 3 && (n.includes(k) || k.includes(n))) || (q.length > 3 && n.includes(q))); });
        if (hit) { if (!itemPlaceIds.has(hit.id)) alreadyPlanned.push({ item: it, day: Number(hit.dayIndex) }); return false; }
        return true;
    });

    const D = days.length;
    const dinnerOn = pace.end >= 19 * 60 + 30;
    const prevStop = stopIndex > 0 ? trip.stops[stopIndex - 1] : null;
    const arrival = prevStop && prevStop.transit ? toMinutes(prevStop.transit.arrTime) : null;
    const dayStart = days.map((d, i) => {
        if (i > 0 || !prevStop) return pace.start;
        return arrival !== null ? Math.max(pace.start, arrival + 75) : Math.max(pace.start, 13 * 60);
    });
    const cap = days.map((d, i) => Math.max(0, pace.end - dayStart[i] - (dayStart[i] < 13 * 60 ? LUNCH_MIN : 0) - (dinnerOn ? DINNER_MIN : 0) - existing[i].load));
    const load = days.map(() => 0);
    const buckets = days.map(() => []);
    const cost = it => it.minutes + TRAVEL_ALLOWANCE;
    const closed = (it, i) => days[i].weekday !== null && it.closedDays.includes(days[i].weekday);
    const put = (it, i) => { buckets[i].push(it); load[i] += cost(it); };
    const unscheduled = [];

    // 1. places the user pinned to a day
    let rest = [];
    pool.forEach(it => (it.pinDay !== null && it.pinDay < D ? put(it, it.pinDay) : rest.push(it)));

    // 2. full-day trips get a day to themselves (the emptiest day they're open)
    rest.filter(it => it.minutes >= FULL_DAY).sort((a, b) => b.minutes - a.minutes).forEach(it => {
        const open = days.map((d, i) => i).filter(i => !closed(it, i)).sort((a, b) => (cap[b] - load[b]) - (cap[a] - load[a]) || a - b);
        const i = open[0];
        if (i === undefined || load[i] + cost(it) > cap[i] + 120) { unscheduled.push(it); return; }
        put(it, i);
        load[i] = Math.max(load[i], cap[i]); // the trip out and back takes the rest of the day
    });
    rest = rest.filter(it => it.minutes < FULL_DAY);

    // If it can't all fit, keep the places higher up the list (the order you wrote them is the priority)
    let room = cap.reduce((sum, c, i) => sum + Math.max(0, c - load[i]), 0);
    rest = rest.filter(it => {
        if (cost(it) <= room) { room -= cost(it); return true; }
        unscheduled.push(it);
        return false;
    });

    // 3. group nearby places: seed each day with the far-out place left, then add its nearest neighbours
    const totalLoad = rest.reduce((s, it) => s + cost(it), 0) + load.reduce((a, b) => a + b, 0);
    const target = totalLoad / Math.max(1, cap.filter(c => c > 60).length);
    let remaining = rest.filter(hasCoords);
    const unlocated = rest.filter(it => !hasCoords(it));
    for (let i = 0; i < D && remaining.length; i++) {
        const limit = Math.min(cap[i], Math.max(target * 1.15, cap[i] * 0.5));
        if (load[i] >= limit) continue;
        let cluster = buckets[i].filter(hasCoords);
        if (!cluster.length) {
            const open = remaining.filter(it => !closed(it, i));
            if (!open.length) continue;
            const seed = center ? open.reduce((a, b) => (dist(b, center) > dist(a, center) ? b : a)) : open[0];
            if (load[i] + cost(seed) > cap[i]) continue;
            put(seed, i);
            remaining = remaining.filter(x => x !== seed);
            cluster = [seed];
        }
        while (remaining.length) {
            const c = centroid(cluster);
            const cand = remaining.filter(it => !closed(it, i)).sort((a, b) => dist(a, c) - dist(b, c))[0];
            if (!cand || load[i] + cost(cand) > limit) break;
            put(cand, i);
            remaining = remaining.filter(x => x !== cand);
            cluster.push(cand);
        }
    }

    // 4. anything left goes to the closest day that still has room
    [...remaining, ...unlocated].forEach(it => {
        const open = days.map((d, i) => i).filter(i => !closed(it, i) && load[i] + cost(it) <= cap[i]);
        if (!open.length) { unscheduled.push(it); return; }
        const score = i => { const c = centroid(buckets[i]); return hasCoords(it) && c ? dist(it, c) : load[i] / 60; };
        open.sort((a, b) => score(a) - score(b) || load[a] - load[b]);
        put(it, open[0]);
    });

    const planDays = days.map((d, i) => ({
        ...d, ...buildTimeline(buckets[i], pace, existing[i].fixed, hotel, dayStart[i]),
        existingNames: existing[i].names,
        arrivalDay: i === 0 && Boolean(prevStop)
    }));
    return { pace: paceId, days: planDays, unscheduled, alreadyPlanned, hotel };
}

/* --- UI --- */
const tripAndStop = () => {
    const trip = dp && trips.find(t => t.id === dp.tripId);
    const stop = trip && trip.stops && trip.stops[dp.stopIndex];
    return trip && stop ? { trip, stop } : null;
};
const findItem = id => dp && dp.items.find(x => x.id === id);

// Typical facts for a kind of place, from its name (and the map's type for it, when picked from search)
function applyKind(it, text) {
    const k = KINDS.find(x => x.re.test(text));
    it.kind = k ? k.kind : 'sight';
    it.category = (k && k.cat) || '● See & Do';
    it.isFood = FOOD_RE.test(text);
    it.bestTime = (k && k.time) || 'any';
    if (!it.userSet) it.minutes = k ? k.min : 90;
}

// Hotels and the arrival / departure airport or station stay as they are on the Daily tab
const isBasePlace = p => p.category === '🏨 Hotel / Base' || Boolean(hubKind(p));

// The stops already on this city's days, as editable rows next to the new suggestions
function existingItems(trip, stopIndex, dayCount) {
    return (trip.places || [])
        .filter(p => p && p.cityIndex === stopIndex && Number.isInteger(p.dayIndex) && p.dayIndex >= 0 && p.dayIndex < dayCount && !isBasePlace(p))
        .map(p => {
            const name = String(p.name || 'Place').slice(0, 80);
            const it = {
                id: 'ex_' + p.id, placeId: p.id, raw: name, name, query: searchName(name), userSet: false, closedDays: [],
                lat: hasCoords(p) ? Number(p.lat) : null, lon: hasCoords(p) ? Number(p.lon) : null, address: p.address || '',
                pinDay: p.dayIndex, origDay: p.dayIndex, fixedStart: toMinutes(p.time), skip: false, source: 'existing', dirty: false
            };
            applyKind(it, name);
            if (p.category) it.category = p.category;
            if (p.category === '🍽 Food & Drink' && it.kind === 'sight') it.kind = 'food';
            if (Number(p.duration) > 0) it.minutes = Number(p.duration);
            return it;
        });
}

export function savePlanListDraft(stopIndex, value, persist) {
    const trip = getActiveTrip();
    const stop = trip && trip.stops && trip.stops[stopIndex];
    if (!stop) return;
    stop.planList = String(value || '').slice(0, 4000);
    if (persist) saveTrips();
}

// Fill the list from the day notes the user already wrote
export function pullPlanListFromNotes(stopIndex) {
    const box = document.getElementById('day-plan-list');
    const trip = getActiveTrip();
    const stop = trip && trip.stops && trip.stops[stopIndex];
    if (!box || !stop) return;
    const days = Math.max(1, Number(stop.nights) || 1);
    const lines = [];
    for (let i = 0; i < days; i++) {
        const el = document.getElementById(`note-day-${i}`);
        String(el ? el.value : (stop.notes || [])[i] || '').split(/\n/).map(s => s.trim()).filter(Boolean).forEach(s => lines.push(s));
    }
    if (!lines.length) { showNotification('Your day notes are empty.'); return; }
    box.value = [box.value.trim(), ...lines].filter(Boolean).join('\n');
    savePlanListDraft(stopIndex, box.value, true);
    triggerHaptic('light');
}

export function plannerCardHTML(stopIndex, stop) {
    return `
        <div class="day-plan-card">
            <div class="day-plan-card-head">${icon('sparkles')}<strong>Plan my days</strong></div>
            <p class="day-plan-card-hint">List the places you want to see. Trippo estimates how long each takes, groups nearby ones and leaves time for meals. You can rename, retime or remove any stop before it goes on your days.</p>
            <textarea id="day-plan-list" class="form-control" rows="4" placeholder="The Bund&#10;Yu Garden&#10;Shanghai Museum 3h&#10;Shanghai Zoo"
                oninput="savePlanListDraft(${stopIndex}, this.value, false)" onchange="savePlanListDraft(${stopIndex}, this.value, true)">${escapeHTML(stop.planList || '')}</textarea>
            <div class="day-plan-card-actions">
                <button type="button" class="budget-link-btn" onclick="pullPlanListFromNotes(${stopIndex})">${icon('list-details')}Use my day notes</button>
                <button type="button" class="save-btn day-plan-go" onclick="openSmartDayPlan(${stopIndex})">${icon('sparkles')}Plan my days</button>
            </div>
        </div>`;
}

export async function openSmartDayPlan(stopIndex) {
    const trip = getActiveTrip();
    const stop = trip && trip.stops && trip.stops[stopIndex];
    if (!stop) return;
    const box = document.getElementById('day-plan-list');
    if (box) savePlanListDraft(stopIndex, box.value, true);
    const listItems = parsePlanList(stop.planList);
    const existing = existingItems(trip, stopIndex, stopDays(trip, stopIndex).length);
    if (!listItems.length && !existing.length) {
        showNotification('Add a few places to the list first (one per line).');
        if (box) box.focus();
        return;
    }
    const pace = DAY_PACES[safeGetStorage(PACE_KEY)] ? safeGetStorage(PACE_KEY) : (getProfilePace() || 'balanced');
    const token = ++runToken;
    dp = { tripId: trip.id, stopIndex, items: [...existing, ...listItems], pace, plan: null, writeNotes: true, done: false, seq: 0, undo: null, pending: null };
    const modal = document.getElementById('day-plan-modal');
    if (modal) modal.style.display = 'flex';
    setText('day-plan-title', `Plan my days in ${stop.name}`);
    setText('day-plan-sub', '');
    wireDayPlanBody();
    triggerHaptic('light');

    let usedAI = false;
    if (listItems.length) {
        renderLoading('Estimating visit times…');
        if (getGeminiApiKey()) {
            try {
                await enrichWithAI(listItems, stop);
                usedAI = true;
            } catch (e) {
                console.warn('[Day planner] Gemini estimate failed, using typical times:', e);
            }
        }
        if (token !== runToken) return;

        const needCoords = listItems.filter(it => !hasCoords(it));
        const ctrl = new AbortController();
        dp.abort = ctrl;
        for (let i = 0; i < needCoords.length; i++) {
            if (token !== runToken) return;
            renderLoading(`Finding places on the map… ${i + 1} of ${needCoords.length}`);
            const it = needCoords[i];
            const cached = geoCache.has(`${stop.name}|${it.query}`.toLowerCase());
            try {
                const hit = await geocode(it, stop, ctrl.signal);
                if (hit) { it.lat = hit.lat; it.lon = hit.lon; it.address = hit.address; }
            } catch (e) { return; }
            // OpenStreetMap's search asks for at most one request per second
            if (!cached && i < needCoords.length - 1) await new Promise(r => setTimeout(r, 1100));
        }
        if (token !== runToken) return;
    }
    dp.usedAI = usedAI;
    dp.hasList = listItems.length > 0;
    replanDays();
}

function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

function renderLoading(msg) {
    const body = document.getElementById('day-plan-body');
    const foot = document.getElementById('day-plan-footer');
    const pace = document.getElementById('day-plan-pace');
    if (pace) pace.innerHTML = '';
    if (foot) foot.innerHTML = '';
    if (body) body.innerHTML = `<div class="day-plan-loading"><span class="ai-btn-spinner"></span>${escapeHTML(msg)}</div>`;
}

export function closeSmartDayPlan() {
    runToken++;
    if (dp && dp.abort) dp.abort.abort();
    closeModal('day-plan-modal');
}

export function setDayPlanPace(paceId) {
    if (!dp || !DAY_PACES[paceId]) return;
    dp.pace = paceId;
    safeSetStorage(PACE_KEY, paceId);
    triggerHaptic('light');
    replanDays();
}

export function setDayPlanDuration(itemId, minutes) {
    const it = findItem(itemId);
    const m = Number(minutes);
    if (!it || !(m > 0)) return;
    it.minutes = m;
    it.userSet = true;
    it.dirty = true;
    replanDays();
}

export function setDayPlanPin(itemId, value) {
    const it = findItem(itemId);
    if (!it) return;
    it.pinDay = value === '' ? null : Number(value);
    if (it.pinDay === null) it.fixedStart = null;
    it.dirty = true;
    replanDays();
}

// The day a row is on in the current plan
function planDayOf(it) {
    const d = dp.plan && dp.plan.days.find(x => x.timeline.some(e => e.item === it));
    return d ? d.index : 0;
}

// A time the user picks stays put; the other stops are fitted around it
export function setDayPlanTime(itemId, value) {
    const it = findItem(itemId);
    if (!it) return;
    const m = toMinutes(value);
    const shown = dp.plan && dp.plan.days.flatMap(d => d.timeline).find(e => e.item === it);
    if (m === null) {
        if (it.fixedStart === null || it.fixedStart === undefined) return;
        it.fixedStart = null;
    } else {
        if (shown && shown.start === m && Number.isFinite(it.fixedStart)) return;
        if (it.pinDay === null) it.pinDay = planDayOf(it);
        it.fixedStart = m;
    }
    it.dirty = true;
    triggerHaptic('light');
    replanDays();
}

export function clearDayPlanTime(itemId) {
    const it = findItem(itemId);
    if (!it) return;
    it.fixedStart = null;
    it.dirty = true;
    replanDays();
}

export function skipDayPlanItem(itemId) {
    const it = findItem(itemId);
    if (!it) return;
    it.skip = true;
    dp.undo = { id: it.id, name: it.name, at: Date.now() };
    triggerHaptic('light');
    replanDays();
    clearTimeout(dp.undoTimer);
    dp.undoTimer = setTimeout(() => { if (dp && dp.undo && Date.now() - dp.undo.at >= 6000) { dp.undo = null; renderFooter(); } }, 6100);
}

export function undoDayPlanSkip() {
    const it = dp && dp.undo && findItem(dp.undo.id);
    if (!it) return;
    it.skip = false;
    dp.undo = null;
    triggerHaptic('light');
    replanDays();
}

export function toggleDayPlanNotes(on) {
    if (dp) dp.writeNotes = Boolean(on);
}

// Typing a new name: a picked search result brings its location; plain text is looked up on the map
function renameItem(it, text, pick) {
    const name = String(text || '').trim().slice(0, 80);
    if (!name || (name === it.name && !pick)) return false;
    it.name = name;
    it.query = searchName(name);
    it.renamed = true;
    it.dirty = true;
    it.opens = it.closes = undefined;
    it.closedDays = [];
    if (it.source !== 'list') it.userSet = false;
    applyKind(it, `${name} ${pick ? pick.type : ''}`);
    if (pick) { it.lat = pick.lat; it.lon = pick.lon; it.address = pick.address; }
    else { it.lat = it.lon = null; it.address = ''; locateItem(it); }
    return true;
}

function addItem(day, text, pick) {
    const name = String(text || '').trim().slice(0, 80);
    if (!name || !dp) return;
    const it = {
        id: `add${++dp.seq}`, raw: name, name, query: searchName(name), userSet: false, closedDays: [],
        lat: null, lon: null, address: '', pinDay: day, fixedStart: null, skip: false, source: 'added', dirty: true
    };
    applyKind(it, `${name} ${pick ? pick.type : ''}`);
    if (pick) { it.lat = pick.lat; it.lon = pick.lon; it.address = pick.address; }
    dp.items.push(it);
    if (!pick) locateItem(it);
    triggerHaptic('light');
}

async function locateItem(it) {
    const ctx = tripAndStop();
    if (!ctx) return;
    const token = runToken;
    try {
        const hit = await geocode(it, ctx.stop);
        if (token !== runToken || !dp || !hit || hasCoords(it)) return;
        it.lat = hit.lat; it.lon = hit.lon; it.address = hit.address;
        replanDays();
    } catch (e) { /* stays unlocated: it's still planned, just without travel times */ }
}

function replanDays() {
    const ctx = tripAndStop();
    if (!ctx || !dp) return;
    dp.plan = buildDayPlan(ctx.trip, dp.stopIndex, dp.items, dp.pace);
    renderDayPlan();
}

const DURATION_CHOICES = [30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 360, 480];

// What "Save" would do: new stops, edited ones and removed ones
function changeSummary() {
    const adds = [];
    dp.plan.days.forEach(d => d.timeline.forEach(e => { if (e.type === 'visit' && !e.item.placeId) adds.push({ item: e.item, day: d.index }); }));
    const removes = dp.items.filter(it => it.placeId && it.skip);
    const edits = dp.items.filter(it => it.placeId && !it.skip && it.dirty);
    return { adds, removes, edits };
}

function renderFooter() {
    const foot = document.getElementById('day-plan-footer');
    if (!foot || !dp || !dp.plan || dp.done) return;
    // Built once and then updated in place, so a tap on Save is never lost to a re-render
    if (!document.getElementById('dp-save')) {
        foot.innerHTML = `
            <div class="dp-undo" id="dp-undo" hidden><span id="dp-undo-text"></span><button type="button" onclick="undoDayPlanSkip()">Undo</button></div>
            <label class="dp-check"><input type="checkbox" ${dp.writeNotes ? 'checked' : ''} onchange="toggleDayPlanNotes(this.checked)"> Also write a summary into empty day notes</label>
            <div class="dp-actions">
                <button type="button" class="btn-secondary" onclick="closeSmartDayPlan()">Back</button>
                <button type="button" class="save-btn" id="dp-save" onclick="applyDayPlan()"></button>
            </div>`;
    }
    const { adds, removes, edits } = changeSummary();
    const save = document.getElementById('dp-save');
    const n = adds.length;
    const label = !n && !removes.length && !edits.length ? 'No changes yet'
        : !removes.length && !edits.length ? `Add ${n} to my days`
        : `Save${[n ? `${n} new` : '', edits.length ? `${edits.length} edited` : '', removes.length ? `${removes.length} removed` : ''].filter(Boolean).map((s, i) => (i ? ' · ' : ': ') + s).join('')}`;
    save.innerHTML = `${icon(n && !removes.length && !edits.length ? 'plus' : 'check')}${escapeHTML(label)}`;
    save.disabled = label === 'No changes yet';
    const undo = document.getElementById('dp-undo');
    if (undo) {
        undo.hidden = !dp.undo;
        if (dp.undo) setText('dp-undo-text', `Removed ${dp.undo.name}`);
    }
}

function renderDayPlan() {
    const ctx = tripAndStop();
    if (!ctx || !dp || !dp.plan) return;
    const { stop } = ctx;
    const plan = dp.plan;
    const scheduled = plan.days.reduce((n, d) => n + d.timeline.filter(e => e.type === 'visit').length, 0);
    setText('day-plan-sub', `${scheduled} stop${scheduled === 1 ? '' : 's'} over ${plan.days.length} day${plan.days.length === 1 ? '' : 's'} · tap a name or time to change it, swipe left to remove`);

    const paceBox = document.getElementById('day-plan-pace');
    if (paceBox) paceBox.innerHTML = Object.entries(DAY_PACES).map(([id, p]) =>
        `<button type="button" class="budget-style-chip${dp.pace === id ? ' active' : ''}" onclick="setDayPlanPace('${id}')">${p.label}</button>`).join('');

    const dayOptions = it => (it.placeId ? '' : `<option value=""${it.pinDay === null ? ' selected' : ''}>Any day</option>`) +
        plan.days.map(d => `<option value="${d.index}"${it.pinDay === d.index ? ' selected' : ''}>Day ${d.index + 1}</option>`).join('');
    const durOptions = m => [...new Set([...DURATION_CHOICES, m])].sort((a, b) => a - b)
        .map(v => `<option value="${v}"${v === m ? ' selected' : ''}>${fmtDur(v)}</option>`).join('');
    const nameInput = it => `<input type="text" class="dp-name-input" value="${escapeHTML(it.name)}" data-id="${escapeHTML(it.id)}" data-key="n:${escapeHTML(it.id)}"
        aria-label="Place" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="done">`;

    function visitRow(e, prevEnd) {
        const it = e.item;
        const sid = escapeJS(it.id);
        const timed = Number.isFinite(it.fixedStart);
        const notes = [
            e.note ? `<span class="dp-meta${e.late ? ' dp-warn' : ''}">${escapeHTML(e.note)}</span>` : '',
            prevEnd !== null && e.start < prevEnd ? '<span class="dp-meta dp-warn">overlaps the stop before</span>' : '',
            it.closedDays.length ? `<span class="dp-meta">closed ${it.closedDays.map(x => WEEKDAYS[x].slice(0, 3)).join(', ')}</span>` : ''
        ].join('');
        const travel = e.travel && e.travel.min ? `<div class="dp-travel">${icon(e.travel.mode === 'walk' ? 'walk' : 'bus')}${e.travel.min} min ${escapeHTML(e.travel.mode)}</div>` : '';
        return `${travel}
            <div class="dp-swipe" data-id="${escapeHTML(it.id)}">
                <div class="dp-swipe-bg" aria-hidden="true">${icon('trash')}Remove</div>
                <div class="dp-row dp-visit">
                    <input type="time" step="300" class="dp-time-input${timed ? ' is-set' : ''}" value="${hhmm(e.start)}" data-id="${escapeHTML(it.id)}" data-key="t:${escapeHTML(it.id)}" aria-label="Start time for ${escapeHTML(it.name)}">
                    <div class="dp-main">
                        <div class="dp-name-wrap">${nameInput(it)}${it.placeId ? '' : '<span class="dp-tag">New</span>'}</div>
                        <div class="dp-controls">
                            <select aria-label="Time at ${escapeHTML(it.name)}" onchange="setDayPlanDuration('${sid}', this.value)">${durOptions(it.minutes)}</select>
                            <select aria-label="Day for ${escapeHTML(it.name)}" onchange="setDayPlanPin('${sid}', this.value)">${dayOptions(it)}</select>
                            ${timed ? `<button type="button" class="dp-auto" onclick="clearDayPlanTime('${sid}')">${icon('clock')}Auto time</button>` : ''}
                            <button type="button" class="budget-icon-btn dp-remove" aria-label="Remove ${escapeHTML(it.name)}" onclick="skipDayPlanItem('${sid}')">${icon('trash', 'ico-only')}</button>
                        </div>
                        ${notes ? `<div class="dp-notes">${notes}</div>` : ''}
                    </div>
                </div>
            </div>`;
    }

    const dayHTML = plan.days.map(d => {
        const dateLabel = d.date ? ` · ${d.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}` : '';
        const visits = d.timeline.filter(e => e.type === 'visit');
        let lastEnd = null;
        const rows = d.timeline.map((e, idx) => {
            const prevEnd = idx > 0 ? d.timeline[idx - 1].end : null;
            const gap = prevEnd !== null ? e.start - prevEnd - (e.travel ? e.travel.min : 0) : 0;
            const free = gap >= 75 ? `<div class="dp-free">Free time · ${fmtDur(Math.round(gap / 15) * 15)} to explore or rest</div>` : '';
            let html;
            if (e.type === 'meal') html = `
                <div class="dp-row dp-meal"><span class="dp-time">${escapeHTML(formatTime(hhmm(e.start)))}</span>
                    <div class="dp-main"><strong>${e.label}</strong><span class="dp-meta">${fmtDur(e.end - e.start)}${e.near ? ` · near ${escapeHTML(e.near)}` : ''}</span></div></div>`;
            else if (e.type === 'fixed') html = `
                <div class="dp-row dp-fixed"><span class="dp-time">${escapeHTML(formatTime(hhmm(e.start)))}</span>
                    <div class="dp-main"><strong>${escapeHTML(e.label)}</strong><span class="dp-meta">on your Daily tab</span></div></div>`;
            else html = visitRow(e, lastEnd);
            if (e.type === 'visit') lastEnd = Math.max(lastEnd || 0, e.end);
            return free + html;
        }).join('');
        return `
            <section class="dp-day${d.packed ? ' packed' : ''}">
                <div class="dp-day-head">
                    <strong>Day ${d.index + 1}${dateLabel}</strong>
                    <span>${d.arrivalDay ? `Arrival day, free from ~${escapeHTML(formatTime(hhmm(d.start)))} · ` : ''}${visits.length ? `${fmtDur(d.sightMins)} of sights · done ~${escapeHTML(formatTime(hhmm(d.end)))}` : (d.arrivalDay ? 'settle in' : 'Free day')}${d.packed ? ' · packed' : ''}</span>
                </div>
                ${rows || `<p class="dp-empty">Nothing planned. Rest, wander, or add a place below.</p>`}
                <div class="dp-add">${icon('plus')}<input type="text" class="dp-add-input" data-day="${d.index}" data-key="a:${d.index}" placeholder="Add a place to Day ${d.index + 1}"
                    aria-label="Add a place to Day ${d.index + 1}" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="done"></div>
            </section>`;
    }).join('');

    const unfit = plan.unscheduled.length ? `
        <section class="dp-day dp-unfit">
            <div class="dp-day-head"><strong>Didn't fit</strong><span>Pick a day to squeeze one in, try the Packed pace, or add a night in ${escapeHTML(stop.name)}.</span></div>
            ${plan.unscheduled.map(it => `
                <div class="dp-row">
                    <div class="dp-main">
                        <div class="dp-name-wrap">${nameInput(it)}</div>
                        <div class="dp-controls"><select aria-label="Day for ${escapeHTML(it.name)}" onchange="setDayPlanPin('${escapeJS(it.id)}', this.value)">${dayOptions(it)}</select><span class="dp-meta">${fmtDur(it.minutes)}</span></div>
                    </div>
                    <button type="button" class="budget-icon-btn dp-remove" aria-label="Remove ${escapeHTML(it.name)}" onclick="skipDayPlanItem('${escapeJS(it.id)}')">${icon('trash', 'ico-only')}</button>
                </div>`).join('')}
        </section>` : '';
    const extra = unfit + (plan.alreadyPlanned.length ? `
        <div class="dp-note">${icon('check')}<span><strong>Already on your days:</strong> ${plan.alreadyPlanned.map(a => `${escapeHTML(a.item.name)} (Day ${a.day + 1})`).join(', ')}</span></div>` : '') +
        `<p class="budget-note">${!dp.hasList ? '' : dp.usedAI ? 'Visit times and locations from Gemini. ' : 'Visit times are typical averages for that kind of place. Add a Gemini key in Settings for place-specific times and closing days. '}Rows marked New are added when you save; your other stops only change if you edit them here.</p>`;

    const body = document.getElementById('day-plan-body');
    if (!body) return;
    // Keep the caret where it was if a lookup finishes while the user is typing somewhere
    const active = document.activeElement;
    const key = active && body.contains(active) ? active.dataset.key : null;
    const typed = key && active.type === 'text' ? { value: active.value, pos: active.selectionStart } : null;
    const scroller = body.closest('.modal-content');
    const top = scroller ? scroller.scrollTop : 0;
    body.innerHTML = dayHTML + extra;
    if (scroller) scroller.scrollTop = top;
    if (key) {
        const el = [...body.querySelectorAll('[data-key]')].find(x => x.dataset.key === key);
        if (el) {
            if (typed && el.value !== typed.value) { el.value = typed.value; }
            el.focus({ preventScroll: true });
            if (typed) { try { el.setSelectionRange(typed.pos, typed.pos); } catch (e) { /* not a text field */ } if (typed.value.trim().length >= 2) acQuery(el); }
        }
    }
    renderFooter();
}

/* --- typing a place: suggestions from OpenStreetMap (Photon), biased to this city; works in mainland China too --- */
const acCache = new Map();
let acTimer = null;
let acSeq = 0;

async function searchPlacesNear(q, stop) {
    const key = `${stop.name}|${q}`.toLowerCase();
    if (acCache.has(key)) return acCache.get(key);
    const near = hasCoords(stop);
    const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=10&lang=en${near ? `&lat=${stop.lat}&lon=${stop.lon}` : ''}`);
    const data = res.ok ? await res.json() : null;
    const seen = new Set();
    let list = ((data && data.features) || []).map(f => {
        const p = f.properties || {};
        const [lon, lat] = (f.geometry && f.geometry.coordinates) || [];
        const parts = [p.street && p.street !== p.name ? p.street : '', p.district || p.locality || '', p.city || p.county || '', p.country || ''];
        const sub = [...new Set(parts.filter(Boolean))].slice(0, 3).join(', ');
        return { name: p.name || p.street || '', sub, address: sub, lat: Number(lat), lon: Number(lon), type: `${p.osm_value || ''} ${p.osm_key || ''}` };
    }).filter(r => r.name && Number.isFinite(r.lat) && Number.isFinite(r.lon))
        .filter(r => { const k = `${r.name.toLowerCase()}|${r.lat.toFixed(3)},${r.lon.toFixed(3)}`; if (seen.has(k)) return false; seen.add(k); return true; });
    if (near) {
        const close = list.filter(r => getDistance(r.lat, r.lon, stop.lat, stop.lon) < 80);
        if (close.length) list = close;
    }
    list = list.slice(0, 6);
    acCache.set(key, list);
    return list;
}

function acBoxFor(input) {
    const host = input.parentElement;
    let box = host.querySelector(':scope > .dp-ac');
    if (!box) {
        box = document.createElement('div');
        box.className = 'dp-ac';
        box.setAttribute('role', 'listbox');
        host.appendChild(box);
    }
    return box;
}

function acHide(input) {
    const box = input && input.parentElement && input.parentElement.querySelector(':scope > .dp-ac');
    if (box) box.remove();
    if (input) input._ac = null;
}

function acQuery(input) {
    clearTimeout(acTimer);
    const q = input.value.trim();
    if (q.length < 2) { acHide(input); return; }
    const seq = ++acSeq;
    acTimer = setTimeout(async () => {
        const ctx = tripAndStop();
        if (!ctx) return;
        let list = [];
        try { list = await searchPlacesNear(q, ctx.stop); } catch (e) { list = []; }
        if (seq !== acSeq || document.activeElement !== input) return;
        input._ac = { list, active: -1 };
        const box = acBoxFor(input);
        box.innerHTML = list.map((r, i) => `
            <button type="button" class="dp-ac-item" data-i="${i}" role="option">${icon('map-pin')}<span><strong>${escapeHTML(r.name)}</strong>${r.sub ? `<small>${escapeHTML(r.sub)}</small>` : ''}</span></button>`).join('') +
            `<button type="button" class="dp-ac-item dp-ac-plain" data-i="-1" role="option">${icon('pencil')}<span><strong>Use “${escapeHTML(q)}”</strong><small>Trippo finds it on the map</small></span></button>`;
    }, 280);
}

function commitInput(input, pick) {
    if (!dp || !input || !input.isConnected || input._done) return;
    input._done = true;
    acHide(input);
    if (dp.pending === input) dp.pending = null;
    // Leave the field first, so the re-render doesn't put the half-typed text back
    if (document.activeElement === input) input.blur();
    if (input.classList.contains('dp-add-input')) {
        const text = pick ? pick.name : input.value;
        if (!String(text || '').trim()) { input._done = false; return; }
        input.value = '';
        addItem(Number(input.dataset.day), text, pick);
        replanDays();
        return;
    }
    const it = findItem(input.dataset.id);
    if (!it) return;
    if (renameItem(it, pick ? pick.name : input.value, pick)) replanDays();
    else input.value = it.name;
}

// Type-ahead, swipe-to-remove and time edits are wired once on the sheet's body
function wireDayPlanBody() {
    const body = document.getElementById('day-plan-body');
    if (!body || body.dataset.wired) return;
    body.dataset.wired = '1';
    const isText = el => el && el.matches && el.matches('.dp-name-input, .dp-add-input');

    body.addEventListener('focusin', e => {
        if (isText(e.target)) { e.target._done = false; if (dp) dp.pending = e.target; }
    });
    body.addEventListener('input', e => { if (isText(e.target)) acQuery(e.target); });
    body.addEventListener('focusout', e => {
        const el = e.target;
        if (isText(el)) setTimeout(() => commitInput(el), 160);
        else if (el.classList && el.classList.contains('dp-time-input')) setTimeout(() => setDayPlanTime(el.dataset.id, el.value), 0);
    });
    body.addEventListener('change', e => {
        const el = e.target;
        // Desktop pickers: commit right away; on phones the time is applied when the picker closes
        if (el.classList && el.classList.contains('dp-time-input') && document.activeElement !== el) setDayPlanTime(el.dataset.id, el.value);
    });
    body.addEventListener('keydown', e => {
        const el = e.target;
        if (el.classList && el.classList.contains('dp-time-input') && e.key === 'Enter') { e.preventDefault(); el.blur(); return; }
        if (!isText(el)) return;
        const ac = el._ac;
        const items = ac ? [...acBoxFor(el).querySelectorAll('.dp-ac-item')] : [];
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length) {
            e.preventDefault();
            ac.active = (ac.active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items.forEach((b, i) => b.classList.toggle('is-active', i === ac.active));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const i = ac && ac.active >= 0 ? Number(items[ac.active].dataset.i) : -1;
            commitInput(el, i >= 0 ? ac.list[i] : null);
        } else if (e.key === 'Escape') {
            acHide(el);
        }
    });
    // Tapping a suggestion keeps the keyboard up until the pick is made
    const keepFocus = e => { if (e.target.closest('.dp-ac')) e.preventDefault(); };
    body.addEventListener('mousedown', keepFocus);
    body.addEventListener('click', e => {
        const btn = e.target.closest('.dp-ac-item');
        if (!btn) return;
        const input = btn.closest('.dp-ac').parentElement.querySelector('.dp-name-input, .dp-add-input');
        const i = Number(btn.dataset.i);
        const pick = i >= 0 && input && input._ac ? input._ac.list[i] : null;
        commitInput(input, pick);
    });

    // Swipe a stop left to remove it
    let sw = null;
    const limit = row => Math.min(120, row.offsetWidth * 0.33);
    body.addEventListener('pointerdown', e => {
        keepFocus(e);
        const row = e.target.closest('.dp-swipe');
        if (!row || e.button > 0 || e.target.closest('select, button, .dp-ac') || e.target === document.activeElement) return;
        sw = { row, inner: row.querySelector('.dp-row'), x: e.clientX, y: e.clientY, dx: 0, on: false, id: e.pointerId };
    });
    body.addEventListener('pointermove', e => {
        if (!sw || e.pointerId !== sw.id) return;
        const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
        if (!sw.on) {
            if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { sw = null; return; }
            if (!(dx < -12 && Math.abs(dx) > Math.abs(dy) * 1.4)) return;
            sw.on = true;
            sw.row.classList.add('is-swiping');
            try { sw.row.setPointerCapture(e.pointerId); } catch (err) { /* fine without */ }
        }
        sw.dx = Math.min(0, dx);
        sw.inner.style.transform = `translateX(${sw.dx}px)`;
        sw.row.classList.toggle('will-remove', sw.dx < -limit(sw.row));
    });
    const end = () => {
        const s = sw;
        sw = null;
        if (!s || !s.on) return;
        s.row.classList.remove('is-swiping');
        body._swipedAt = Date.now();
        if (s.dx < -limit(s.row)) {
            s.row.classList.add('is-removing');
            s.inner.style.transform = 'translateX(-105%)';
            setTimeout(() => skipDayPlanItem(s.row.dataset.id), 160);
        } else {
            s.inner.style.transform = '';
            s.row.classList.remove('will-remove');
        }
    };
    body.addEventListener('pointerup', end);
    body.addEventListener('pointercancel', end);
    // A swipe that ends over a button isn't a tap on it
    body.addEventListener('click', e => { if (Date.now() - (body._swipedAt || 0) < 400) { e.stopPropagation(); e.preventDefault(); } }, true);
}

// Keep the plan list in step with the sheet, so removed or renamed places don't come back as new next time
function syncPlanList(stop) {
    if (!stop.planList) return;
    const key = s => norm(cleanName(s));
    const listItems = dp.items.filter(it => it.source === 'list');
    const removedNames = dp.items.filter(it => it.placeId && it.skip).map(it => key(it.raw)).filter(k => k.length > 3);
    const lines = String(stop.planList).split('\n');
    const out = [];
    lines.forEach(line => {
        const clean = line.replace(/^\s*(?:[-*–]|\d+[.)])\s*/, '').trim();
        const k = key(clean);
        if (!k) { out.push(line); return; }
        const it = listItems.find(x => key(x.raw) === k);
        if (it && it.skip) return;
        if (it && it.renamed) { out.push(it.name); return; }
        if (!it && removedNames.some(r => r === k || (k.length > 3 && (r.includes(k) || k.includes(r))))) return;
        out.push(line);
    });
    stop.planList = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    const box = document.getElementById('day-plan-list');
    if (box) box.value = stop.planList;
}

export function applyDayPlan() {
    const ctx = tripAndStop();
    if (!ctx || !dp || !dp.plan || dp.done) return;
    // Text still in a field (the keyboard was up when Save was tapped) counts
    if (dp.pending && dp.pending.isConnected && !dp.pending._done) commitInput(dp.pending);
    const { trip, stop } = ctx;
    const { adds, removes, edits } = changeSummary();
    if (!adds.length && !removes.length && !edits.length) return;
    if (!Array.isArray(trip.places)) trip.places = [];
    if (!Array.isArray(stop.notes)) stop.notes = [];
    const si = dp.stopIndex;
    const stamp = Date.now().toString(36);
    const byId = new Map(trip.places.map(p => [p.id, p]));
    // Only days with a change are rewritten; the others are left exactly as they were
    const touched = new Set();
    adds.forEach(a => touched.add(a.day));
    removes.forEach(it => touched.add(it.origDay));
    edits.forEach(it => { touched.add(it.origDay); touched.add(planDayOf(it)); });

    const removeIds = new Set(removes.map(it => it.placeId));
    trip.places = trip.places.filter(p => !removeIds.has(p.id));

    let notesWritten = 0;
    const order = new Map();
    dp.plan.days.forEach(d => {
        if (!touched.has(d.index)) return;
        const visits = d.timeline.filter(e => e.type === 'visit');
        const list = visits.map((e, i) => {
            const it = e.item;
            let place = it.placeId ? byId.get(it.placeId) : null;
            if (!place) {
                place = { id: `poi_plan_${stamp}_${d.index}_${i}`, cityIndex: si, category: it.category, address: it.address || '', notes: `About ${fmtDur(it.minutes)} here · from Plan my days` };
                trip.places.push(place);
            } else if (it.renamed) {
                place.category = it.category;
                place.address = it.address || '';
                delete place.localName;
            }
            const coords = hasCoords(it) ? { lat: it.lat, lon: it.lon }
                : (place.lat !== undefined && !it.renamed) ? { lat: place.lat, lon: place.lon }
                : { lat: Number((Number(stop.lat) + (Math.random() - 0.5) * 0.01).toFixed(6)), lon: Number((Number(stop.lon) + (Math.random() - 0.5) * 0.01).toFixed(6)) };
            Object.assign(place, { name: it.name, dayIndex: d.index, lat: coords.lat, lon: coords.lon, time: hhmm(e.start), duration: it.minutes });
            return place;
        });
        order.set(d.index, list);
        if (dp.writeNotes && visits.length && !String(stop.notes[d.index] || '').trim()) {
            stop.notes[d.index] = d.timeline.filter(e => e.type !== 'fixed')
                .map(e => (e.type === 'meal' ? e.label.toLowerCase() : e.item.name)).join(' → ');
            const el = document.getElementById(`note-day-${d.index}`);
            if (el) el.value = stop.notes[d.index];
            notesWritten++;
        }
    });
    // Each changed day lists its stops in the plan's order (hotel and station stops keep their place first)
    order.forEach((list, day) => {
        const inPlan = new Set(list);
        const onDay = p => p.cityIndex === si && p.dayIndex === day;
        const others = trip.places.filter(p => onDay(p) && !inPlan.has(p));
        trip.places = [...trip.places.filter(p => !onDay(p)), ...others, ...list];
    });
    syncPlanList(stop);
    dp.done = true;
    saveTrips();
    if (typeof window.renderCityPlaces === 'function') window.renderCityPlaces();
    triggerHaptic('success');

    const parts = [adds.length ? `${adds.length} added` : '', edits.length ? `${edits.length} changed` : '', removes.length ? `${removes.length} removed` : ''].filter(Boolean);
    const body = document.getElementById('day-plan-body');
    const paceBox = document.getElementById('day-plan-pace');
    if (paceBox) paceBox.innerHTML = '';
    setText('day-plan-sub', '');
    if (body) body.innerHTML = `
        <div class="dp-done">
            ${icon('check')}
            <strong>Your days in ${escapeHTML(stop.name)} are saved</strong>
            <span>${parts.join(' · ')}. ${notesWritten ? `Day notes filled in for ${notesWritten} empty day${notesWritten === 1 ? '' : 's'}. ` : ''}Days you didn't change were left as they were.</span>
        </div>`;
    const foot = document.getElementById('day-plan-footer');
    if (foot) foot.innerHTML = `
        <div class="dp-actions">
            <button type="button" class="btn-secondary" onclick="closeSmartDayPlan()">Done</button>
            <button type="button" class="save-btn" onclick="openDayPlanInDaily()">${icon('calendar-event')}See it on the Daily tab</button>
        </div>`;
}

export function openDayPlanInDaily() {
    const ctx = tripAndStop();
    if (!ctx) return;
    const stopIndex = dp.stopIndex;
    closeSmartDayPlan();
    closeModal('daily-notes-modal');
    setActivePlacesTripId(ctx.trip.id);
    setActivePlacesStopIndex(stopIndex);
    setActivePlacesDayIndex(0);
    if (window.switchTab) window.switchTab('places');
    if (window.openPlacesForTrip) window.openPlacesForTrip(ctx.trip.id);
}
