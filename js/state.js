/* ==========================================================================
   Trippo Travel Planner - State Management & LocalStorage
   js/state.js
   ========================================================================== */

import { pushLocalToCloud } from './db.js';
import { safeInvalidate, plannerMap, wishlistMap, placesMap } from './maps.js';

// --- SAFE STORAGE HELPERS (Private Browsing & Mobile WebViews Resilient) ---
const memoryFallback = {};

export function safeGetStorage(key, defaultValue = null) {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            const val = window.localStorage.getItem(key);
            return val !== null ? val : defaultValue;
        }
    } catch (e) {
        console.warn(`[Trippo Storage] localStorage.getItem blocked for "${key}":`, e);
    }
    return key in memoryFallback ? memoryFallback[key] : defaultValue;
}

export function safeSetStorage(key, value) {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem(key, value);
        }
    } catch (e) {
        console.warn(`[Trippo Storage] localStorage.setItem blocked for "${key}":`, e);
    }
    memoryFallback[key] = value;
}

export function safeParseStorage(key, defaultValue) {
    const raw = safeGetStorage(key, null);
    if (!raw) return defaultValue;
    try {
        return JSON.parse(raw);
    } catch (e) {
        console.warn(`[Trippo Storage] Failed to parse JSON for "${key}":`, e);
        return defaultValue;
    }
}

// --- THEME STATE ---
export let currentTheme = safeGetStorage('trippoTheme', 'light');

// Fallback logic for old `trippoDarkMode` setting
if (!safeGetStorage('trippoTheme')) {
    if (safeGetStorage('trippoDarkMode', 'false') === 'true') {
        currentTheme = 'dark';
        safeSetStorage('trippoTheme', 'dark');
    }
}

export let isDarkMode = currentTheme === 'dark'; // kept for backwards compatibility where used

export function toggleDarkMode() { // renamed internally but exported as toggleDarkMode for backward compat in HTML
    const themes = ['light', 'dark', 'hotline'];
    let currentIndex = themes.indexOf(currentTheme);
    if (currentIndex === -1) currentIndex = 0;
    
    currentTheme = themes[(currentIndex + 1) % themes.length];
    isDarkMode = currentTheme === 'dark'; // update backward compat variable

    document.body.classList.remove('dark-mode', 'hotline-mode');
    if (currentTheme !== 'light') {
        document.body.classList.add(currentTheme + '-mode');
    }

    safeSetStorage('trippoTheme', currentTheme);
    
    const iconEl = document.getElementById('dark-mode-icon');
    const label = document.getElementById('dark-mode-label');
    
    if (iconEl) {
        if (currentTheme === 'light') iconEl.innerHTML = icon('sun', 'ico-only');
        else if (currentTheme === 'dark') iconEl.innerHTML = icon('moon', 'ico-only');
        else iconEl.innerHTML = icon('bolt', 'ico-only');
    }
    
    if (label) {
        if (currentTheme === 'light') label.innerText = 'Switch to Dark Mode';
        else if (currentTheme === 'dark') label.innerText = 'Switch to Hotline Mode';
        else label.innerText = 'Switch to Light Mode';
    }
    
    toggleSidebar(false);
}

// --- DATE UTILITIES ---
export function parseLocalDate(dateStr) {
    if (!dateStr) return new Date();
    const parts = String(dateStr).split('T')[0].split('-').map(Number);
    if (parts.length < 3 || isNaN(parts[0])) return new Date();
    return new Date(parts[0], parts[1] - 1, parts[2]);
}

export function formatLocalDate(d) {
    if (!d) return '';
    if (typeof d === 'string') {
        const parts = String(d).split('T')[0].split('-').map(Number);
        if (parts.length >= 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
            d = new Date(parts[0], parts[1] - 1, parts[2]);
        } else {
            const parsed = new Date(d);
            if (!isNaN(parsed.getTime())) d = parsed;
            else return '';
        }
    }
    if (!(d instanceof Date) || isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// --- HTML & ATTRIBUTE SANITIZERS (XSS Defense) ---
export function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function escapeJS(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, '\u2019')
        .replace(/"/g, '\u201D')
        .replace(/`/g, '\u00B4')
        .replace(/</g, '\\x3C')
        .replace(/>/g, '\\x3E')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '');
}

// --- NOTIFICATION TOAST ---
export function showNotification(msg, durationMs = 2600) {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed; top:20px; left:50%; transform:translateX(-50%); background:#1d2b29; color:white; padding:12px 22px; border-radius:14px; z-index:999999; box-shadow:0 6px 18px rgba(0,0,0,0.3); font-size:13px; font-weight:600; text-align:center; transition:opacity 0.25s ease;';
    div.innerText = msg;
    document.body.appendChild(div);
    setTimeout(() => {
        div.style.opacity = '0';
        setTimeout(() => div.remove(), 250);
    }, durationMs);
}

// --- MODALS & DRAWER ---
// Travelpayouts' affiliate tracking script runs with full access to the page (including the
// stored sign-in session) and can't be integrity-pinned, so it only loads once someone opens a
// booking or flight screen: Stays, Transit, the sidebar (Flight Hub), hotel or eSIM pop-ups.
let partnerTrackingLoaded = false;
export function loadPartnerTracking() {
    if (partnerTrackingLoaded) return;
    partnerTrackingLoaded = true;
    const script = document.createElement('script');
    script.async = true;
    script.setAttribute('data-cmp-ab', '2');
    script.src = 'https://tp-em.com/NTgxODAy.js?t=581802';
    document.head.appendChild(script);
}

export function toggleSidebar(open) {
    const drawer = document.getElementById('sidebar-drawer');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (open) {
        loadPartnerTracking();
        if (drawer) drawer.classList.add('open');
        if (backdrop) backdrop.classList.add('open');
    } else {
        if (drawer) drawer.classList.remove('open');
        if (backdrop) backdrop.classList.remove('open');
        safeInvalidate(wishlistMap, 150);
        safeInvalidate(plannerMap, 150);
        safeInvalidate(placesMap, 150);
    }
}


export function toggleSidebarTripTools() {
    const group = document.getElementById('sidebar-trip-tools-group');
    const arrow = document.getElementById('sidebar-trip-tools-arrow');
    if (!group) return;
    const isHidden = group.style.display === 'none' || !group.style.display;
    group.style.display = isHidden ? 'block' : 'none';
    if (arrow) {
        arrow.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
    }
}

export function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
        document.querySelectorAll('.flatpickr-calendar').forEach(c => c.classList.remove('open'));
    }
}

export function handleModalBackdropClick(event, modalId) {
    if (event.target.id === modalId) {
        closeModal(modalId);
    }
}

// --- CATEGORY VISUALS ---
export function normalizeCategory(catStr) {
    const raw = catStr || '';
    if (raw.includes('Cities')) return 'Cities';
    if (raw.includes('Nature')) return 'Nature';
    if (raw.includes('Attractions')) return 'Attractions';
    if (raw.includes('Fun')) return 'Fun';
    if (raw.includes('Food')) return 'Food';
    return 'Cities';
}

export function getCategoryVisuals(categoryStr) {
    const cat = normalizeCategory(categoryStr);
    if (cat === 'Cities') return { emoji: '🏙️', color: '#1a73e8' };
    if (cat === 'Nature') return { emoji: '🌲', color: '#2b7c62' };
    if (cat === 'Attractions') return { emoji: '🏛️', color: '#6c5ce7' };
    if (cat === 'Fun') return { emoji: '🎉', color: '#ff4757' };
    if (cat === 'Food') return { emoji: '🍽️', color: '#e67e22' };
    return { emoji: '🌟', color: '#ff4757' };
}

// --- STATE STORAGE & INITIALIZATION ---

function toList(value) {
    if (Array.isArray(value)) return value.filter(v => v !== null && v !== undefined);
    if (typeof value === 'string') {
        try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter(v => v !== null && v !== undefined) : []; } catch (e) { return []; }
    }
    if (value && typeof value === 'object') return Object.values(value).filter(v => v && typeof v === 'object');
    return [];
}

/**
 * Repair a trip in place so every screen can render it: data from older app versions,
 * imports or the cloud can carry text/object stops, null entries or non-text dates.
 */
export function normalizeTrip(trip) {
    if (!trip || typeof trip !== 'object') return trip;
    trip.id = String(trip.id ?? `trip_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    trip.name = typeof trip.name === 'string' && trip.name.trim() ? trip.name : 'Untitled Trip';
    trip.stops = toList(trip.stops);
    trip.places = toList(trip.places);
    if (trip.startDate instanceof Date || typeof trip.startDate === 'number') {
        const d = new Date(trip.startDate);
        trip.startDate = isNaN(d) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    } else if (typeof trip.startDate !== 'string') {
        trip.startDate = '';
    }
    if (trip.expenses !== undefined && !Array.isArray(trip.expenses)) trip.expenses = toList(trip.expenses);
    // Trips also arrive from share links and friends' live edits, so numeric fields can't be
    // trusted to be numbers; templates print them unescaped.
    trip.stops.forEach(s => {
        if (!s || typeof s !== 'object') return;
        s.nights = toNumber(s.nights, 1);
        s.lat = toNumber(s.lat, undefined);
        s.lon = toNumber(s.lon, undefined);
    });
    trip.places.forEach(p => {
        if (!p || typeof p !== 'object') return;
        p.lat = toNumber(p.lat, undefined);
        p.lon = toNumber(p.lon, undefined);
        p.cityIndex = toNumber(p.cityIndex, 0);
        p.dayIndex = toNumber(p.dayIndex, 0);
    });
    (Array.isArray(trip.expenses) ? trip.expenses : []).forEach(e => {
        if (!e || typeof e !== 'object') return;
        e.amount = toNumber(e.amount, 0);
        if (e.splitWith !== undefined && !Array.isArray(e.splitWith)) delete e.splitWith;
        ['title', 'category', 'stopId', 'paidBy', 'date'].forEach(k => { if (e[k] !== undefined && e[k] !== null && typeof e[k] !== 'string') e[k] = String(e[k]); });
    });
    if (trip.budgetPeople !== undefined) {
        trip.budgetPeople = (Array.isArray(trip.budgetPeople) ? trip.budgetPeople : [])
            .filter(p => p && typeof p === 'object' && p.id)
            .map(p => ({ id: String(p.id), name: String(p.name || 'Traveler').slice(0, 24) }));
    }
    if (trip.budgetTravelers !== undefined) trip.budgetTravelers = toNumber(trip.budgetTravelers, 2);
    return trip;
}

function toNumber(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

export let trips = safeParseStorage('myTrips', []);
if (!Array.isArray(trips)) trips = [];
trips = trips.filter(t => t && typeof t === 'object').map(normalizeTrip);

export let wishlistCollections = safeParseStorage('myWishlistCollections', [
    { id: 'master', name: '🌟 Master Wishlist', isMaster: true }
]);

let rawSavedPins = safeParseStorage('myWishlist', [
    { id: '1', wishlistId: 'master', name: 'Kyoto Bamboo Forest', lat: 35.0116, lon: 135.6767, category: 'Nature', notes: 'Must visit during early morning light.' },
    { id: '2', wishlistId: 'master', name: 'Amalfi Coast', lat: 40.6340, lon: 14.6027, category: 'Cities', notes: 'Cliffside scenic views.' }
]);

export let wishlistPins = rawSavedPins.map(p => ({
    ...p,
    wishlistId: p.wishlistId || 'master'
}));

// Sample Trip if none exist
if (trips.length === 0) {
    trips.push({
        id: "sample-trip-asia-2026",
        name: "Asia Adventure",
        startDate: "2026-11-01",
        isExample: true,
        budgetTravelers: 2,
        expenses: [
            { id: 'exp_1', title: 'Roundtrip Flights', amount: 1450.00, splitType: 'split' },
            { id: 'exp_2', title: 'Shanghai Hotel (4 Nights)', amount: 640.00, splitType: 'split' }
        ],
        stops: [
            { id: "s1", name: "Lafayette", lat: 30.2241, lon: -92.0198, nights: 1, notes: ['Departure preparation'], transit: null, lodging: null },
            { id: "s2", name: "Shanghai", lat: 31.2304, lon: 121.4737, nights: 4, notes: ['The Bund evening walk', 'Yu Garden & dumplings', 'Nanjing Road shopping', 'Maglev train excursion'], transit: null, lodging: null },
            { id: "s3", name: "Beijing", lat: 39.9042, lon: 116.4074, nights: 3, notes: ['Forbidden City & Tiananmen', 'Great Wall hike (Mutianyu)', 'Summer Palace'], transit: null, lodging: null }
        ],
        places: [
            { id: "poi_1", cityIndex: 1, dayIndex: 0, name: "The Bund", category: "● See & Do", address: "Zhongshan East 1st Rd, Huangpu, Shanghai", notes: "Best at sunset", lat: 31.2397, lon: 121.4900 },
            { id: "poi_2", cityIndex: 1, dayIndex: 1, name: "Yu Garden", category: "● See & Do", address: "279 Yuyuan Old St, Huangpu, Shanghai", notes: "Traditional pavilions and soup dumplings", lat: 31.2272, lon: 121.4921 },
            { id: "poi_3", cityIndex: 2, dayIndex: 0, name: "Forbidden City", category: "● See & Do", address: "4 Jingshan Qianjie, Dongcheng, Beijing", notes: "Book tickets online 7 days in advance", lat: 39.9163, lon: 116.3972 },
            { id: "poi_4", cityIndex: 2, dayIndex: 0, name: "Jingshan Park", category: "● See & Do", address: "44 Jingshan W St, Xicheng, Beijing", notes: "Panoramic view over the palace", lat: 39.9248, lon: 116.3980 }
        ]
    });
    safeSetStorage('myTrips', JSON.stringify(trips));
}

// Sample trip v2: hotels, transit, more daily stops and budget items so every tab has something
// to show. Only ever ADDS to the built-in sample (never removes or overwrites), once per trip.
const SAMPLE_TRIP_VERSION = 3;
const SAMPLE_EXTRAS = {
    lodging: {
        s2: { name: 'The Peninsula Shanghai', address: '32 Zhongshan East 1st Rd, Huangpu, Shanghai', checkInTime: '3:00 PM', bookingNumber: 'PEN-48213', url: 'https://www.peninsula.com/en/shanghai', notes: 'River-view room, breakfast included', lat: 31.2427, lon: 121.4893 },
        s3: { name: 'Waldorf Astoria Beijing', address: '5-15 Jinyu Hutong, Dongcheng, Beijing', checkInTime: '3:00 PM', bookingNumber: 'WA-77105', url: 'https://www.hilton.com/en/hotels/bjswawa-waldorf-astoria-beijing/', notes: 'Walkable to Wangfujing', lat: 39.9147, lon: 116.4128 }
    },
    transit: {
        s1: { method: 'plane', flightType: 'rt', bookingNumber: 'UA-8K2QX', date: '2026-11-01', returnDate: '2026-11-09', depStation: 'Lafayette (LFT)', arrStation: 'Shanghai (PVG)', depTime: '06:10', arrTime: '18:45', notes: 'Connects in Houston. Seats 32A / 32B.' },
        s2: { method: 'train', flightType: 'ow', bookingNumber: 'G7-30219', date: '2026-11-06', returnDate: '', depStation: 'Shanghai Hongqiao', arrStation: 'Beijing South', depTime: '09:00', arrTime: '13:28', notes: 'G7 high-speed train, seats 05A / 05B' }
    },
    // stopId + dayIndex instead of cityIndex, so it still lands right if the stops were reordered
    places: [
        { id: 'poi_s1', stopId: 's1', dayIndex: 0, name: 'Vermilionville', category: '● See & Do', address: '300 Fisher Rd, Lafayette, LA', notes: 'Cajun & Creole living history village', lat: 30.2063, lon: -91.9908, time: '10:00' },
        { id: 'poi_s2', stopId: 's1', dayIndex: 0, name: "Johnson's Boucaniere", category: '🍽 Food & Drink', address: '1111 St John St, Lafayette, LA', notes: 'Boudin and smoked meats before the flight', lat: 30.2283, lon: -92.0234, time: '12:30' },
        { id: 'poi_5', stopId: 's2', dayIndex: 0, name: 'Nanjing Road Pedestrian Street', category: '🛍 Shopping', address: 'Nanjing Rd, Huangpu, Shanghai', notes: 'Neon at night', lat: 31.2355, lon: 121.4747, time: '16:00' },
        { id: 'poi_6', stopId: 's2', dayIndex: 0, name: 'Lost Heaven Bund', category: '🍽 Food & Drink', address: "17 Yan'an East Rd, Huangpu, Shanghai", notes: 'Yunnan food, rooftop bar', lat: 31.2349, lon: 121.4877, time: '20:00' },
        { id: 'poi_7', stopId: 's2', dayIndex: 1, name: 'Nanxiang Steamed Bun Restaurant', category: '🍽 Food & Drink', address: '85 Yuyuan Rd, Huangpu, Shanghai', notes: 'Crab soup dumplings', lat: 31.2276, lon: 121.4918, time: '12:00' },
        { id: 'poi_8', stopId: 's2', dayIndex: 1, name: 'Tianzifang', category: '🛍 Shopping', address: 'Lane 210 Taikang Rd, Huangpu, Shanghai', notes: 'Alleyway boutiques', lat: 31.2085, lon: 121.4692, time: '15:00' },
        { id: 'poi_9', stopId: 's2', dayIndex: 1, name: 'Seesaw Coffee', category: '☕ Cafe & Chill', address: '433 Yuyuan Rd, Jing\'an, Shanghai', notes: 'Afternoon break', lat: 31.2235, lon: 121.4437, time: '17:00' },
        { id: 'poi_10', stopId: 's2', dayIndex: 2, name: 'Shanghai Tower', category: '● See & Do', address: '501 Yincheng Middle Rd, Pudong, Shanghai', notes: 'Observation deck on floor 118', lat: 31.2335, lon: 121.5055, time: '10:00' },
        { id: 'poi_11', stopId: 's2', dayIndex: 2, name: 'Maglev Train Ride', category: '● See & Do', address: 'Longyang Rd Station, Pudong, Shanghai', notes: 'Hits 300 km/h in about 2 minutes', lat: 31.2033, lon: 121.5582, time: '14:00', transitMode: 'transit' },
        { id: 'poi_12', stopId: 's2', dayIndex: 3, name: 'Zhujiajiao Water Town', category: '● See & Do', address: 'Qingpu District, Shanghai', notes: 'Canal boat ride', lat: 31.1076, lon: 121.0529, time: '09:30', transitMode: 'driving' },
        { id: 'poi_13', stopId: 's2', dayIndex: 3, name: 'Jade Buddha Temple', category: '● See & Do', address: '170 Anyuan Rd, Putuo, Shanghai', notes: 'Closes at 4:30 PM', lat: 31.2420, lon: 121.4450, time: '15:00' },
        { id: 'poi_14', stopId: 's3', dayIndex: 0, name: 'Wangfujing Snack Street', category: '🍽 Food & Drink', address: 'Wangfujing St, Dongcheng, Beijing', notes: 'Street food dinner', lat: 39.9135, lon: 116.4110, time: '19:00' },
        { id: 'poi_15', stopId: 's3', dayIndex: 1, name: 'Mutianyu Great Wall', category: '● See & Do', address: 'Huairou District, Beijing', notes: 'Cable car up, toboggan down', lat: 40.4319, lon: 116.5704, time: '08:00', transitMode: 'driving' },
        { id: 'poi_16', stopId: 's3', dayIndex: 1, name: 'Da Dong Roast Duck', category: '🍽 Food & Drink', address: '5 Dongsishitiao, Dongcheng, Beijing', notes: 'Book a table ahead', lat: 39.9330, lon: 116.4366, time: '19:30' },
        { id: 'poi_17', stopId: 's3', dayIndex: 2, name: 'Summer Palace', category: '● See & Do', address: '19 Xinjiangongmen Rd, Haidian, Beijing', notes: 'Rent a boat on Kunming Lake', lat: 39.9999, lon: 116.2755, time: '09:30' },
        { id: 'poi_18', stopId: 's3', dayIndex: 2, name: '798 Art District', category: '☕ Cafe & Chill', address: '2 Jiuxianqiao Rd, Chaoyang, Beijing', notes: 'Galleries and cafes', lat: 39.9842, lon: 116.4950, time: '14:30' },
        { id: 'poi_19', stopId: 's3', dayIndex: 2, name: 'Sanlitun Taikoo Li', category: '🛍 Shopping', address: '19 Sanlitun Rd, Chaoyang, Beijing', notes: 'Last-night shopping', lat: 39.9343, lon: 116.4540, time: '18:00' }
    ],
    expenses: [
        { id: 'exp_3', title: 'Beijing Hotel (3 Nights)', amount: 690.00, splitType: 'split' },
        { id: 'exp_4', title: 'G7 Train Tickets', amount: 180.00, splitType: 'split' },
        { id: 'exp_5', title: 'Great Wall Day Trip', amount: 120.00, splitType: 'split' },
        { id: 'exp_6', title: 'Souvenirs', amount: 85.00, splitType: 'individual' }
    ]
};

// v3: budget tracker tags (stop, category, who paid) on the sample expenses
const SAMPLE_EXPENSE_TAGS = {
    exp_1: { stopId: 's2', category: 'travel', paidBy: 'p1' },
    exp_2: { stopId: 's2', category: 'stay', paidBy: 'p1' },
    exp_3: { stopId: 's3', category: 'stay', paidBy: 'p1' },
    exp_4: { stopId: 's3', category: 'travel', paidBy: 'p2' },
    exp_5: { stopId: 's3', category: 'activities', paidBy: 'p2' },
    exp_6: { stopId: 's3', category: 'shopping', paidBy: 'p2' }
};

function upgradeSampleTrip(trip) {
    if (!trip || trip.id !== 'sample-trip-asia-2026') return false;
    const version = trip.sampleVersion || 1;
    if (version >= SAMPLE_TRIP_VERSION) return false;
    if (version < 2) addSampleExtras(trip);
    (Array.isArray(trip.expenses) ? trip.expenses : []).forEach(e => {
        const tags = e && SAMPLE_EXPENSE_TAGS[e.id];
        if (tags) Object.keys(tags).forEach(k => { if (e[k] === undefined) e[k] = tags[k]; });
    });
    if (!Array.isArray(trip.budgetPeople)) trip.budgetPeople = [{ id: 'p1', name: 'You' }, { id: 'p2', name: 'Sam' }];
    trip.sampleVersion = SAMPLE_TRIP_VERSION;
    return true;
}

function addSampleExtras(trip) {
    const stops = Array.isArray(trip.stops) ? trip.stops : [];
    stops.forEach(s => {
        if (!s.lodging && SAMPLE_EXTRAS.lodging[s.id]) s.lodging = { ...SAMPLE_EXTRAS.lodging[s.id] };
        if (!s.transit && SAMPLE_EXTRAS.transit[s.id]) s.transit = { ...SAMPLE_EXTRAS.transit[s.id] };
    });
    if (!Array.isArray(trip.places)) trip.places = [];
    const havePlaces = new Set(trip.places.map(p => p.id));
    SAMPLE_EXTRAS.places.forEach(({ stopId, ...p }) => {
        const cityIndex = stops.findIndex(s => s.id === stopId);
        if (havePlaces.has(p.id) || cityIndex < 0 || p.dayIndex >= Math.max(1, Number(stops[cityIndex].nights) || 1)) return;
        trip.places.push({ ...p, cityIndex });
    });
    if (!Array.isArray(trip.expenses)) trip.expenses = [];
    const haveExpenses = new Set(trip.expenses.map(e => e.id));
    SAMPLE_EXTRAS.expenses.forEach(e => { if (!haveExpenses.has(e.id)) trip.expenses.push({ ...e }); });
}

if (trips.map(upgradeSampleTrip).some(Boolean)) safeSetStorage('myTrips', JSON.stringify(trips));

// Same idea for the sample wishlist: a few more pins and a second list, once, only if the
// built-in sample pins are still there.
if (!safeGetStorage('trippo_sample_wishlist_v2') && wishlistPins.some(p => p.id === '1' || p.id === '2')) {
    const pinIds = new Set(wishlistPins.map(p => p.id));
    [
        { id: 'sw_3', wishlistId: 'master', name: 'Zhangjiajie National Forest Park', lat: 29.3249, lon: 110.4343, category: 'Nature', notes: 'The "Avatar" mountains, plan 2 days' },
        { id: 'sw_4', wishlistId: 'master', name: "Xi'an Terracotta Army", lat: 34.3841, lon: 109.2785, category: 'Attractions', notes: '4.5 hours by train from Beijing' },
        { id: 'sw_5', wishlistId: 'master', name: 'Hong Kong', lat: 22.3193, lon: 114.1694, category: 'Cities', notes: 'Victoria Peak at night' },
        { id: 'sw_6', wishlistId: 'sample-japan', name: 'Fushimi Inari Shrine', lat: 34.9671, lon: 135.7727, category: 'Attractions', notes: 'Go at sunrise to beat the crowds' },
        { id: 'sw_7', wishlistId: 'sample-japan', name: 'Ichiran Shibuya', lat: 35.6614, lon: 139.7010, category: 'Food', notes: 'Solo ramen booths' },
        { id: 'sw_8', wishlistId: 'sample-japan', name: 'Lake Kawaguchiko', lat: 35.5170, lon: 138.7517, category: 'Nature', notes: 'Mount Fuji views' }
    ].forEach(p => { if (!pinIds.has(p.id)) wishlistPins.push(p); });
    if (Array.isArray(wishlistCollections) && !wishlistCollections.some(c => c.id === 'sample-japan')) {
        wishlistCollections.push({ id: 'sample-japan', name: 'Japan Ideas' });
        safeSetStorage('myWishlistCollections', JSON.stringify(wishlistCollections));
    }
    safeSetStorage('myWishlist', JSON.stringify(wishlistPins));
    safeSetStorage('trippo_sample_wishlist_v2', '1');
}

// Active navigation pointers
export let activeTripId = trips.length > 0 ? trips[0].id : null;
export let activePlacesTripId = activeTripId;
export let activePlacesStopIndex = null;
export let activePlacesDayIndex = 0;
export let activeEditPlaceId = null;
export let activeStopIndex = null;
export let activeTransitIndex = null;
export let activeLodgingStopIndex = null;
export let cityWeather = null;
export let wishlistMinimized = false;
export let activeWishlistFilter = 'All';
export let activeWishlistId = 'master';

// Setters for pointers
export function setActiveTripId(id) { activeTripId = id; }
export function setActivePlacesTripId(id) { activePlacesTripId = id; }
export function setActivePlacesStopIndex(idx) { activePlacesStopIndex = idx; }
export function setActivePlacesDayIndex(idx) { activePlacesDayIndex = idx; }
export function setActiveEditPlaceId(id) { activeEditPlaceId = id; }
export function setActiveStopIndex(idx) { activeStopIndex = idx; }
export function setActiveTransitIndex(idx) { activeTransitIndex = idx; }
export function setActiveLodgingStopIndex(idx) { activeLodgingStopIndex = idx; }
export function setCityWeather(weather) { cityWeather = weather; }
export function setWishlistMinimized(val) { wishlistMinimized = val; }
export function setActiveWishlistFilter(f) { activeWishlistFilter = f; }
export function setActiveWishlistId(id) { activeWishlistId = id; }

export function setTrips(newTrips) {
    trips = (Array.isArray(newTrips) ? newTrips : []).filter(t => t && typeof t === 'object').map(normalizeTrip);
}
export function setWishlistCollections(cols) { wishlistCollections = cols; }
export function setWishlistPins(pins) { wishlistPins = pins; }

export function getActiveTrip() {
    let found = trips.find(t => t.id === activeTripId);
    if (!found && trips.length > 0) {
        activeTripId = trips[0].id;
        found = trips[0];
    }
    return found;
}

export function saveTrips() {
    safeSetStorage('myTrips', JSON.stringify(trips));
    pushLocalToCloud();
    const activeTrip = getActiveTrip();
    if (activeTrip && activeTrip.isCollaborative && typeof window.broadcastTripUpdate === 'function') {
        window.broadcastTripUpdate(activeTrip);
    }
}

export function saveWishlist() {
    safeSetStorage('myWishlist', JSON.stringify(wishlistPins));
    safeSetStorage('myWishlistCollections', JSON.stringify(wishlistCollections));
    pushLocalToCloud();
}

// --- HAPTIC FEEDBACK (Mobile-Native Feel) ---
// Line icon from the inline sprite at the top of index.html (Tabler Icons, MIT)
export function icon(name, extraClass = '') {
    return `<svg class="ico${extraClass ? ' ' + extraClass : ''}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

// --- Display preferences (Settings → Display & Motion) ---
export function getTempUnit() {
    return safeGetStorage('trippo_temp_unit', 'F') === 'C' ? 'C' : 'F';
}

export function formatTempF(tempF) {
    const n = Number(tempF);
    if (!Number.isFinite(n)) return '';
    return getTempUnit() === 'C' ? `${Math.round((n - 32) * 5 / 9)}°C` : `${Math.round(n)}°F`;
}

export function getTimeFormat() {
    return safeGetStorage('trippo_time_format', '12') === '24' ? '24' : '12';
}

// "15:30", "3:30 PM", "3:30pm" → the user's 12h/24h format. Anything else ("Morning") is returned as-is.
export function formatTime(str) {
    const raw = String(str || '').trim();
    const m = raw.match(/^(\d{1,2}):(\d{2})\s*([ap])\.?\s*m?\.?$/i) || raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return raw;
    let h = Number(m[1]);
    const min = m[2];
    if (h > 23 || Number(min) > 59) return raw;
    const ap = m[3] ? m[3].toLowerCase() : null;
    if (ap) { if (h > 12) return raw; if (h === 12) h = 0; if (ap === 'p') h += 12; }
    if (getTimeFormat() === '24') return `${String(h).padStart(2, '0')}:${min}`;
    return `${h % 12 || 12}:${min} ${h < 12 ? 'AM' : 'PM'}`;
}

export function isReducedMotion() {
    return safeGetStorage('trippo_reduce_motion', '0') === '1';
}

export function applyMotionPreference() {
    if (typeof document !== 'undefined' && document.body) document.body.classList.toggle('reduce-motion', isReducedMotion());
}

export function triggerHaptic(type = 'light') {
    try {
        if (safeGetStorage('trippo_haptics', '1') === '0') return;
        if (typeof window !== 'undefined' && 'vibrate' in navigator) {
            if (type === 'light') {
                navigator.vibrate(12);
            } else if (type === 'medium') {
                navigator.vibrate(28);
            } else if (type === 'success') {
                navigator.vibrate([18, 40, 22]);
            } else if (type === 'warning') {
                navigator.vibrate([40, 60, 40]);
            }
        }
    } catch (e) {
        // Graceful fallback if vibration is unsupported or blocked by browser policy
    }
}
// --- GEOGRAPHIC DISTANCE HELPER (Haversine km) ---
export function getDistance(lat1, lon1, lat2, lon2) {
    const p = 0.017453292519943295;
    const c = Math.cos;
    const a = 0.5 - c((lat2 - lat1) * p) / 2 + c(lat1 * p) * c(lat2 * p) * (1 - c((lon2 - lon1) * p)) / 2;
    return 12742 * Math.asin(Math.sqrt(a));
}

export function calculateTransitEstimate(lat1, lon1, lat2, lon2, preferredMode = null) {
    if (lat1 === undefined || lat1 === null || lon1 === undefined || lon1 === null ||
        lat2 === undefined || lat2 === null || lon2 === undefined || lon2 === null) return null;
    const nLat1 = Number(lat1), nLon1 = Number(lon1), nLat2 = Number(lat2), nLon2 = Number(lon2);
    if (isNaN(nLat1) || isNaN(nLon1) || isNaN(nLat2) || isNaN(nLon2)) return null;
    if ((nLat1 === 0 && nLon1 === 0) || (nLat2 === 0 && nLon2 === 0)) return null;

    const distKm = getDistance(nLat1, nLon1, nLat2, nLon2);
    if (isNaN(distKm) || distKm < 0.05) return null; // Under 50m, virtually same location

    let mode = preferredMode;
    if (!mode || (mode !== 'walking' && mode !== 'driving' && mode !== 'transit')) {
        if (distKm <= 2.0) mode = 'walking';
        else if (distKm <= 15.0) mode = 'driving';
        else mode = 'transit';
    }

    const distStr = distKm < 1 ? `${Math.round(distKm * 1000)}m` : `${distKm.toFixed(1)} km`;

    if (mode === 'walking') {
        const walkMins = Math.max(1, Math.round((distKm * 1000) / 80));
        return {
            icon: '🚶',
            text: `~${walkMins} min walk (${distStr})`,
            mins: walkMins,
            timeStr: `${walkMins} min`,
            mode: 'walking',
            distKm,
            distStr
        };
    } else if (mode === 'driving') {
        const driveMins = Math.max(2, Math.round((distKm / 30) * 60));
        return {
            icon: '🚗',
            text: `~${driveMins} min drive (${distStr})`,
            mins: driveMins,
            timeStr: `${driveMins} min`,
            mode: 'driving',
            distKm,
            distStr
        };
    } else {
        const transitMins = Math.max(5, Math.round(5 + (distKm / 30) * 60));
        const hours = Math.floor(transitMins / 60);
        const remMins = transitMins % 60;
        const timeStr = hours > 0 ? `${hours}h ${remMins}m` : `${remMins} min`;
        return {
            icon: '🚆',
            text: `~${timeStr} transit (${distStr})`,
            mins: transitMins,
            timeStr: timeStr,
            mode: 'transit',
            distKm,
            distStr
        };
    }
}

export function openDirectionsLink(lat1, lon1, lat2, lon2, mode = 'walking') {
    if (lat1 === undefined || lat1 === null || lon1 === undefined || lon1 === null ||
        lat2 === undefined || lat2 === null || lon2 === undefined || lon2 === null) return;
    const validModes = ['walking', 'driving', 'transit'];
    const travelmode = validModes.includes(mode) ? mode : 'walking';
    const url = `https://www.google.com/maps/dir/?api=1&origin=${lat1},${lon1}&destination=${lat2},${lon2}&travelmode=${travelmode}`;
    window.open(url, '_blank');
}

if (typeof window !== 'undefined') {
    window.triggerHaptic = triggerHaptic;
    window.escapeHTML = escapeHTML;
    window.escapeJS = escapeJS;
    window.getDistance = getDistance;
    window.calculateTransitEstimate = calculateTransitEstimate;
    window.openDirectionsLink = openDirectionsLink;
}
