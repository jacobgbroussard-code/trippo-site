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

// --- DARK MODE STATE ---
export let isDarkMode = safeGetStorage('trippoDarkMode', 'false') === 'true';

export function toggleDarkMode() {
    isDarkMode = !isDarkMode;
    document.body.classList.toggle('dark-mode', isDarkMode);
    safeSetStorage('trippoDarkMode', isDarkMode);
    const icon = document.getElementById('dark-mode-icon');
    const label = document.getElementById('dark-mode-label');
    if (icon) icon.innerText = isDarkMode ? '☀️' : '🌙';
    if (label) label.innerText = isDarkMode ? 'Disable Dark Mode' : 'Toggle Dark Mode';
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
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// --- NOTIFICATION TOAST ---
export function showNotification(msg) {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed; top:20px; left:50%; transform:translateX(-50%); background:#1d2b29; color:white; padding:12px 22px; border-radius:14px; z-index:999999; box-shadow:0 6px 18px rgba(0,0,0,0.3); font-size:13px; font-weight:600; text-align:center; transition:opacity 0.25s ease;';
    div.innerText = msg;
    document.body.appendChild(div);
    setTimeout(() => {
        div.style.opacity = '0';
        setTimeout(() => div.remove(), 250);
    }, 2600);
}

// --- MODALS & DRAWER ---
export function toggleSidebar(open) {
    const drawer = document.getElementById('sidebar-drawer');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (open) {
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

export function toggleSidebarSettings() {
    const group = document.getElementById('sidebar-settings-group');
    const arrow = document.getElementById('sidebar-settings-arrow');
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
export let trips = safeParseStorage('myTrips', []);

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

export function setTrips(newTrips) { trips = newTrips; }
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
}

export function saveWishlist() {
    safeSetStorage('myWishlist', JSON.stringify(wishlistPins));
    safeSetStorage('myWishlistCollections', JSON.stringify(wishlistCollections));
    pushLocalToCloud();
}
