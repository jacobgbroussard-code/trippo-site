/* ==========================================================================
   Trippo Travel Planner - Application Bootstrap & Module Aggregation
   js/app.js
   ========================================================================== */

import * as state from './state.js';
import * as db from './db.js';
import * as maps from './maps.js';
import * as planner from './planner.js';
import * as places from './places.js';
import * as bookings from './bookings.js';
import * as wishlist from './wishlist.js';
import * as tools from './tools.js';

// Expose all public module APIs to window for zero-breakage HTML onclick handlers
Object.assign(window, {
    ...state,
    ...db,
    ...maps,
    ...planner,
    ...places,
    ...bookings,
    ...wishlist,
    ...tools
});

// Define dynamic live getters on window for reactive state, maps and search timeouts
Object.defineProperties(window, {
    trips: { get: () => state.trips, set: (v) => state.setTrips(v), configurable: true },
    wishlistCollections: { get: () => state.wishlistCollections, set: (v) => state.setWishlistCollections(v), configurable: true },
    wishlistPins: { get: () => state.wishlistPins, set: (v) => state.setWishlistPins(v), configurable: true },
    activeTripId: { get: () => state.activeTripId, set: (v) => state.setActiveTripId(v), configurable: true },
    activePlacesTripId: { get: () => state.activePlacesTripId, set: (v) => state.setActivePlacesTripId(v), configurable: true },
    activePlacesStopIndex: { get: () => state.activePlacesStopIndex, set: (v) => state.setActivePlacesStopIndex(v), configurable: true },
    activePlacesDayIndex: { get: () => state.activePlacesDayIndex, set: (v) => state.setActivePlacesDayIndex(v), configurable: true },
    activeEditPlaceId: { get: () => state.activeEditPlaceId, set: (v) => state.setActiveEditPlaceId(v), configurable: true },
    activeStopIndex: { get: () => state.activeStopIndex, set: (v) => state.setActiveStopIndex(v), configurable: true },
    activeTransitIndex: { get: () => state.activeTransitIndex, set: (v) => state.setActiveTransitIndex(v), configurable: true },
    activeLodgingStopIndex: { get: () => state.activeLodgingStopIndex, set: (v) => state.setActiveLodgingStopIndex(v), configurable: true },
    plannerMap: { get: () => maps.plannerMap, set: (v) => maps.setPlannerMap(v), configurable: true },
    placesMap: { get: () => maps.placesMap, set: (v) => maps.setPlacesMap(v), configurable: true },
    wishlistMap: { get: () => maps.wishlistMap, set: (v) => maps.setWishlistMap(v), configurable: true },
    currentUser: { get: () => db.currentUser, set: (v) => db.setCurrentUser(v), configurable: true },
    citySearchTimeout: { get: () => planner.citySearchTimeout, configurable: true },
    poiSearchTimeout: { get: () => places.poiSearchTimeout, configurable: true },
    hotelSearchTimeout: { get: () => bookings.hotelSearchTimeout, configurable: true },
    wishlistSearchTimeout: { get: () => wishlist.wishlistSearchTimeout, configurable: true }
});

// Flatpickr initialization helper
export function initDatePickers() {
    if (typeof flatpickr === 'undefined') return;
    document.querySelectorAll('.date-picker').forEach(input => {
        if (input._flatpickr) {
            input._flatpickr.destroy();
        }
    });
    flatpickr(".date-picker", {
        altInput: true,
        altFormat: "F j, Y",
        dateFormat: "Y-m-d",
        static: false,
        appendTo: document.body
    });
}
window.initDatePickers = initDatePickers;

// Register Service Worker for offline asset caching
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('[Trippo SW] Registered with scope:', reg.scope))
            .catch(err => console.warn('[Trippo SW] Registration failed:', err));
    });
}

// Global Keyboard & Touch Listeners
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal').forEach(m => state.closeModal(m.id));
        wishlist.cancelDroppedPin();
        state.toggleSidebar(false);
    }
});

// Safe modal drag dismissal with input element exclusions
let modalTouchStartY = 0;
let isTopScrolled = false;
document.querySelectorAll('.modal-content').forEach(content => {
    content.addEventListener('touchstart', (e) => {
        if (['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(e.target.tagName)) return;
        modalTouchStartY = e.touches[0].clientY;
        isTopScrolled = (content.scrollTop <= 0);
    }, { passive: true });

    content.addEventListener('touchend', (e) => {
        if (['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(e.target.tagName)) return;
        const diffY = e.changedTouches[0].clientY - modalTouchStartY;
        if (isTopScrolled && diffY > 120) {
            const modal = content.closest('.modal');
            if (modal) state.closeModal(modal.id);
        }
    }, { passive: true });
});

// Initialize on DOM Ready
window.addEventListener('DOMContentLoaded', () => {
    initDatePickers();

    const isDark = localStorage.getItem('trippoDarkMode') === 'true';
    if (isDark) {
        document.body.classList.add('dark-mode');
        const icon = document.getElementById('dark-mode-icon');
        const label = document.getElementById('dark-mode-label');
        if (icon) icon.innerText = '☀️';
        if (label) label.innerText = 'Disable Dark Mode';
    }

    // Default entry view
    tools.switchTab('home');

    setTimeout(() => {
        db.checkAuthSession();
    }, 150);
});
