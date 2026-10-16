/* ==========================================================================
   Trippo Travel Planner - Tools, Home & Budget Architecture
   js/tools.js
   ========================================================================== */

import {
    trips,
    setTrips,
    wishlistCollections,
    setWishlistCollections,
    wishlistPins,
    setWishlistPins,
    getActiveTrip,
    saveTrips,
    saveWishlist,
    activeTripId,
    setActiveTripId,
    activePlacesTripId,
    setActivePlacesTripId,
    activePlacesStopIndex,
    parseLocalDate,
    formatLocalDate,
    showNotification,
    closeModal,
    toggleSidebar,
    triggerHaptic,
    escapeHTML,
    escapeJS,
    loadPartnerTracking,
    formatTime,
    icon,
} from './state.js';

import { initPlannerMap, safeInvalidate, plannerMap } from './maps.js';
import { renderPlanner } from './planner.js';
import { renderPlacesMasterList, openPlacesCityView } from './places.js';
import { renderBookingsView, renderBookingsList, renderTransitView, renderTransitList } from './bookings.js';
import { showWishlistDirectory, cancelDroppedPin } from './wishlist.js';
import { getCheapFlightDeals, partnerLink } from './travel-payouts.js';

/* --- HOME VIEW & TRIP CREATION --- */
export function renderHome() {
    const listEl = document.getElementById('trip-list');
    if (!listEl) return;
    if (window.renderHomeTodayCard) window.renderHomeTodayCard();
    if (window.renderFareWatchCard) window.renderFareWatchCard();
    if (trips.length === 0) {
        listEl.innerHTML = `
            <div style="text-align: center; color: #8fa39f; padding: 40px 20px;">
                <p style="font-size: 15px; font-weight: 600;">No trips yet.</p>
                <p style="font-size: 13px;">Tap "+ Create new trip" above to start your first adventure!</p>
            </div>`;
        return;
    }

    // Each card renders independently: one malformed trip must not blank the whole list
    listEl.innerHTML = trips.map(trip => { try {
        const totalNights = trip.stops ? trip.stops.reduce((sum, stop) => sum + (Number(stop.nights) || 0), 0) : 0;
        const hasDate = Boolean(trip.startDate && trip.startDate.trim());
        const sDate = hasDate ? parseLocalDate(trip.startDate) : null;
        const exampleBadge = trip.isExample ? `<span class="example-badge">Sample Trip</span>` : '';
        const safeName = escapeHTML(trip.name);
        const safeTripId = escapeJS(trip.id);

        let dateDisplay = '';
        let countdownBadge = '';

        if (hasDate && sDate) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tripDate = new Date(sDate);
            tripDate.setHours(0, 0, 0, 0);
            const diffTime = tripDate.getTime() - today.getTime();
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays > 1) {
                countdownBadge = `<span class="trip-countdown-badge upcoming"><svg class="ico" aria-hidden="true"><use href="#i-clock"></use></svg>Departs in ${diffDays} days</span>`;
            } else if (diffDays === 1) {
                countdownBadge = `<span class="trip-countdown-badge upcoming"><svg class="ico" aria-hidden="true"><use href="#i-clock"></use></svg>Departs Tomorrow!</span>`;
            } else if (diffDays === 0) {
                countdownBadge = `<span class="trip-countdown-badge today"><svg class="ico" aria-hidden="true"><use href="#i-plane-departure"></use></svg>Departs Today!</span>`;
            } else if (diffDays < 0 && Math.abs(diffDays) < (totalNights || 1)) {
                countdownBadge = `<span class="trip-countdown-badge in-progress"><svg class="ico" aria-hidden="true"><use href="#i-map-pin"></use></svg>Day ${Math.abs(diffDays) + 1} of ${totalNights}</span>`;
            } else if (totalNights > 0 && Math.abs(diffDays) >= totalNights) {
                countdownBadge = `<span class="trip-countdown-badge completed"><svg class="ico" aria-hidden="true"><use href="#i-check"></use></svg>Completed</span>`;
            }

            dateDisplay = `${sDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} • ${totalNights} Nights`;
        } else {
            dateDisplay = `<svg class="ico" aria-hidden="true"><use href="#i-calendar-question"></use></svg>Flexible Dates • ${totalNights} Nights`;
            countdownBadge = `<span class="trip-countdown-badge tbd"><svg class="ico" aria-hidden="true"><use href="#i-calendar-question"></use></svg>Dates TBD</span>`;
        }

        const collabChip = trip.isCollaborative ? `<span class="trip-countdown-badge" style="background:rgba(59,130,246,0.12); color:#2563eb; border:1px solid rgba(59,130,246,0.25);"><svg class="ico" aria-hidden="true"><use href="#i-user-plus"></use></svg>Plan with Friends</span>` : '';

        return `
        <div class="trip-card">
            <div class="trip-card-content" onclick="openTrip('${safeTripId}')">
                <h3>${safeName} ${exampleBadge}</h3>
                <p>${dateDisplay}</p>
                <div style="margin-top:2px; display:flex; gap:6px; flex-wrap:wrap;">
                    ${countdownBadge}
                    ${collabChip}
                </div>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
                <button class="trip-card-share-btn" onclick="event.stopPropagation(); openShareTripModal('${safeTripId}')" title="Share Trip or Co-Plan with Friends" aria-label="Share Trip">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
                        <polyline points="16 6 12 2 8 6"></polyline>
                        <line x1="12" y1="2" x2="12" y2="15"></line>
                    </svg>
                </button>
                <button onclick="event.stopPropagation(); openEditTripModal('${safeTripId}')" style="background:var(--primary-light); border:1px solid var(--border-subtle); border-radius:8px; padding:7px 9px; font-size:14px; cursor:pointer; color:var(--primary);" title="Edit Trip Details & Dates"><svg class="ico ico-only" aria-hidden="true"><use href="#i-pencil"></use></svg></button>
                <button onclick="event.stopPropagation(); promptDeleteTripById('${safeTripId}')" style="background:#fff0f2; border:1px solid #ffd4d9; border-radius:8px; padding:7px 9px; font-size:14px; cursor:pointer; color:var(--accent);" title="Delete or Leave Trip"><svg class="ico ico-only" aria-hidden="true"><use href="#i-trash"></use></svg></button>
                <div style="color: #b7c7c3; font-size:22px; cursor:pointer;" onclick="openTrip('${safeTripId}')">›</div>
            </div>
        </div>`;
    } catch (err) {
        console.error('[Trippo] Could not render trip card:', trip, err);
        try {
            const log = JSON.parse(localStorage.getItem('trippo_auth_log') || '[]');
            log.push(`${new Date().toISOString()} Trip card error (${trip && trip.id}): ${err && err.message}`);
            localStorage.setItem('trippo_auth_log', JSON.stringify(log.slice(-15)));
        } catch (e) {}
        return `
        <div class="trip-card">
            <div class="trip-card-content" onclick="openTrip('${escapeJS(trip && trip.id)}')">
                <h3>${escapeHTML((trip && trip.name) || 'Untitled Trip')}</h3>
                <p>⚠️ Some details couldn't be displayed — tap to open</p>
            </div>
        </div>`;
    } }).join('');
}

export function openCreateTripModal() {
    const nameInput = document.getElementById('new-trip-name');
    if (nameInput) nameInput.value = '';
    const dInput = document.getElementById('new-trip-date');
    if (dInput) {
        if (dInput._flatpickr) {
            dInput._flatpickr.clear();
        } else {
            dInput.value = '';
        }
    }
    const roundTripInput = document.getElementById('new-trip-roundtrip');
    if (roundTripInput) roundTripInput.checked = false;
    const modal = document.getElementById('create-trip-modal');
    if (modal) modal.style.display = 'flex';
}

export function saveNewTrip() {
    const nameEl = document.getElementById('new-trip-name');
    const dateEl = document.getElementById('new-trip-date');
    const name = nameEl ? nameEl.value.trim() : '';
    const date = dateEl ? dateEl.value.trim() : '';

    if (name) {
        const roundTripEl = document.getElementById('new-trip-roundtrip');
        const isRoundTrip = roundTripEl ? roundTripEl.checked : false;
        const newTrip = {
            id: Date.now().toString(),
            name,
            startDate: date || '',
            isExample: false,
            isRoundTrip: isRoundTrip,
            stops: [],
            places: [],
            budgetTravelers: 2,
            expenses: []
        };
        trips.push(newTrip);
        saveTrips();
        closeModal('create-trip-modal');
        if (nameEl) nameEl.value = '';
        if (roundTripEl) roundTripEl.checked = false;
        if (dateEl) {
            if (dateEl._flatpickr) dateEl._flatpickr.clear();
            else dateEl.value = '';
        }
        openTrip(newTrip.id);
    } else {
        showNotification("Please provide a trip name.");
    }
}

let currentEditingTripId = null;

export function openEditTripModal(tripId) {
    const targetId = tripId || activeTripId;
    const trip = trips.find(t => t.id === targetId) || getActiveTrip();
    if (!trip) {
        showNotification("No trip found to edit.");
        return;
    }

    currentEditingTripId = trip.id;
    const nameInput = document.getElementById('edit-trip-name');
    if (nameInput) nameInput.value = trip.name || '';

    const dateInput = document.getElementById('edit-trip-date');
    if (dateInput) {
        if (!dateInput._flatpickr && typeof window !== 'undefined' && window.initDatePickers) {
            window.initDatePickers();
        }
        if (dateInput._flatpickr) {
            if (trip.startDate) {
                dateInput._flatpickr.setDate(trip.startDate, true);
            } else {
                dateInput._flatpickr.clear();
            }
        } else {
            dateInput.value = trip.startDate || '';
        }
    }

    const roundTripInput = document.getElementById('edit-trip-roundtrip');
    if (roundTripInput) roundTripInput.checked = Boolean(trip.isRoundTrip);

    const modal = document.getElementById('edit-trip-modal');
    if (modal) modal.style.display = 'flex';
}

export function clearEditTripDate() {
    const dateInput = document.getElementById('edit-trip-date');
    if (dateInput) {
        if (dateInput._flatpickr) dateInput._flatpickr.clear();
        dateInput.value = '';
    }
    showNotification("Date cleared (Flexible / TBD). Tap 'Save Changes' to apply.");
}

export function saveEditedTrip() {
    const trip = trips.find(t => t.id === currentEditingTripId) || getActiveTrip();
    if (!trip) return;

    const nameEl = document.getElementById('edit-trip-name');
    const dateEl = document.getElementById('edit-trip-date');
    const roundTripEl = document.getElementById('edit-trip-roundtrip');

    const name = nameEl ? nameEl.value.trim() : '';
    const date = dateEl ? dateEl.value.trim() : '';

    if (!name) {
        showNotification("Please provide a trip name.");
        return;
    }

    trip.name = name;
    trip.startDate = date || '';
    if (roundTripEl) trip.isRoundTrip = roundTripEl.checked;

    saveTrips();
    closeModal('edit-trip-modal');

    // Re-render UI
    if (window.renderPlanner) window.renderPlanner();
    renderHome();
    if (document.getElementById('bookings-view')?.classList.contains('active')) {
        renderBookingsView();
    }
    if (document.getElementById('transit-view')?.classList.contains('active')) {
        renderTransitView();
    }
    showNotification("Trip details saved!");
}

export function openTrip(id) {
    setActiveTripId(id);
    setActivePlacesTripId(id);
    switchTab('planner');
    [50, 150, 300, 500].forEach(d => {
        setTimeout(() => {
            if (plannerMap) {
                plannerMap.invalidateSize();
                if (plannerMap._pendingBounds) {
                    try { plannerMap.fitBounds(plannerMap._pendingBounds, { padding: [40, 40], maxZoom: 14 }); } catch(e){}
                }
            }
        }, d);
    });
}

export function promptDeleteTripById(tripId) {
    const trip = trips.find(t => t.id === tripId);
    if (!trip) return;

    let confirmMsg = `Are you sure you want to delete "${trip.name}"? This cannot be undone.`;
    if (trip.isCollaborative) {
        confirmMsg = `Remove Shared Trip: Are you sure you want to remove "${trip.name}" from your planner? Other collaborators will still keep their copy.`;
    }

    if (confirm(confirmMsg)) {
        triggerHaptic('warning');
        if (trip.isCollaborative && typeof window.leaveCollabRoom === 'function') {
            window.leaveCollabRoom(trip.collabRoomId);
        }
        setTrips(trips.filter(t => t.id !== tripId));
        saveTrips();
        if (activeTripId === tripId) {
            setActiveTripId(trips.length > 0 ? trips[0].id : null);
            setActivePlacesTripId(activeTripId);
        }
        renderHome();
        switchTab('home');
        showNotification(trip.isCollaborative ? `Removed "${trip.name}" from your planner.` : `Deleted "${trip.name}".`);
    }
}

/* --- TAB SWITCHING --- */
// In-app history of visited tabs so the universal back button returns to the previous page.
// Each entry is mirrored by a browser history entry, so Android's back gesture / button walks
// the same history instead of closing the app.
const tabHistory = [];
let currentTab = 'home';
let browserHistoryWorks = true;

function stepBack() {
    let prev = tabHistory.pop();
    while (prev === currentTab) prev = tabHistory.pop();
    switchTab(prev || 'home', { fromBack: true });
}

export function goBack() {
    if (browserHistoryWorks && tabHistory.length > 0) history.back(); // handled by popstate below
    else stepBack();
}

window.addEventListener('popstate', () => {
    // Hash links (#collab=, #trip-copy=) are handled elsewhere.
    if (location.hash) return;
    // Back with a pop-up open closes the pop-up and keeps the tab (re-adding the consumed entry).
    const openModal = [...document.querySelectorAll('.modal')].find(m => m.style.display === 'flex' || m.style.display === 'block');
    if (openModal) {
        openModal.style.display = 'none';
        try { history.pushState({ trippoTab: currentTab }, ''); } catch (e) {}
        return;
    }
    if (tabHistory.length > 0 || currentTab !== 'home') stepBack();
});

export function switchTab(tabId, opts = {}) {
    triggerHaptic('light');
    if (!opts.fromBack && tabId !== currentTab) {
        tabHistory.push(currentTab);
        try { history.pushState({ trippoTab: tabId }, ''); } catch (e) { browserHistoryWorks = false; }
    }
    currentTab = tabId;
    document.body.classList.toggle('has-back', tabId !== 'home');
    document.querySelectorAll('.view').forEach(v => {
        v.classList.remove('active');
    });
    document.querySelectorAll('.nav-item').forEach(v => v.classList.remove('active'));

    cancelDroppedPin();

    const targetView = document.getElementById(tabId + '-view');
    const targetNav = document.getElementById('nav-' + tabId);
    if (targetView) targetView.classList.add('active');
    if (targetNav) targetNav.classList.add('active');

    if (tabId === 'home') renderHome();
    if (tabId === 'planner') {
        if (!activeTripId && trips.length > 0) setActiveTripId(trips[0].id);
        initPlannerMap();
        renderPlanner();
        [50, 150, 300, 500].forEach(d => safeInvalidate(plannerMap, d));
    }
    if (tabId === 'places') {
        const targetTripId = activePlacesTripId || activeTripId || (trips.length > 0 ? trips[0].id : null);
        if (targetTripId) {
            setActivePlacesTripId(targetTripId);
            const targetTrip = trips.find(t => t.id === targetTripId);
            if (targetTrip && Array.isArray(targetTrip.stops) && targetTrip.stops.length > 0) {
                const stopIdx = (activePlacesStopIndex >= 0 && activePlacesStopIndex < targetTrip.stops.length) ? activePlacesStopIndex : 0;
                openPlacesCityView(stopIdx);
            } else {
                renderPlacesMasterList();
            }
        } else {
            renderPlacesMasterList();
        }
    }
    if (tabId === 'bookings' || tabId === 'transit') loadPartnerTracking();
    if (tabId === 'bookings') renderBookingsView();
    if (tabId === 'transit') renderTransitView();
    if (tabId === 'wishlist') {
        showWishlistDirectory();
    }
}

export function syncSelectedTrip(tripId, origin) {
    setActiveTripId(tripId);
    setActivePlacesTripId(tripId);
    const bSelect = document.getElementById('booking-trip-select');
    const tSelect = document.getElementById('transit-trip-select');
    if (bSelect) bSelect.value = tripId;
    if (tSelect) tSelect.value = tripId;

    if (origin === 'bookings') renderBookingsList();
    else if (origin === 'transit') renderTransitList();
}

/* Trip Budget modal: js/budget-tracker.js */

/* --- CURRENCY CONVERTER LOGIC --- */
const mockExchangeRates = {
    USD: 1.0,
    EUR: 0.92,
    JPY: 155.0,
    GBP: 0.79,
    CNY: 7.24,
    AUD: 1.52,
    CAD: 1.38,
    MXN: 19.3,
    THB: 35.8
};

export function openCurrencyModal() {
    toggleSidebar(false);
    convertCurrency();
    const modal = document.getElementById('currency-modal');
    if (modal) modal.style.display = 'flex';
}

export function openEsimModal() {
    toggleSidebar(false);
    const modal = document.getElementById('esim-modal');
    loadPartnerTracking();
    if (modal) modal.style.display = 'flex';
}

export function convertCurrency() {
    const amountInput = document.getElementById('curr-amount')?.value;
    const amount = amountInput === "" ? 0 : parseFloat(amountInput) || 0;
    const fromCurr = document.getElementById('curr-from')?.value || 'USD';
    const toCurr = document.getElementById('curr-to')?.value || 'JPY';

    const rateFromUSD = mockExchangeRates[fromCurr] || 1.0;
    const rateToUSD = mockExchangeRates[toCurr] || 1.0;

    const amountInUSD = amount / rateFromUSD;
    const converted = amountInUSD * rateToUSD;

    const symbols = { USD: '$', EUR: '€', JPY: '¥', GBP: '£', CNY: '¥', AUD: '$', CAD: '$', MXN: '$', THB: '฿' };
    const sym = symbols[toCurr] || '';

    const resEl = document.getElementById('curr-result');
    if (resEl) resEl.innerText = `${sym}${converted.toFixed(2)} ${toCurr}`;
}

/* --- SHARE & APP BACKUP TOOLS --- */
export function openExportTripFileModal(tripId) {
    toggleSidebar(false);
    if (window.openShareTripModal) {
        window.openShareTripModal(tripId);
    }
}

export function confirmExportSharedTrip(tripId) {
    const targetId = tripId || (getActiveTrip() ? getActiveTrip().id : (trips.length > 0 ? trips[0].id : null));
    const trip = trips.find(t => t.id === targetId) || getActiveTrip();
    if (!trip) {
        showNotification("Please select a trip to export.");
        return;
    }
    const exportPayload = {
        trippoVersion: "2.4.56",
        exportedAt: new Date().toISOString(),
        trip: trip
    };
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Trippo_${trip.name.replace(/\s+/g, '_')}_Share.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showNotification(`Exported backup file for "${trip.name}"!`);
}

export function importSharedTripJSON(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = JSON.parse(e.target.result);
            let incomingTrip = data.trip || (data.trips && data.trips[0]) || data;
            if (incomingTrip && incomingTrip.name && Array.isArray(incomingTrip.stops)) {
                incomingTrip.id = 'shared_' + Date.now();
                incomingTrip.isExample = false;
                if (!Array.isArray(incomingTrip.places)) incomingTrip.places = [];
                if (!Array.isArray(incomingTrip.expenses)) incomingTrip.expenses = [];
                trips.push(incomingTrip);
                saveTrips();
                renderHome();
                toggleSidebar(false);
                openTrip(incomingTrip.id);
                showNotification(`Shared trip "${incomingTrip.name}" imported successfully!`);
            } else {
                showNotification("Invalid trip file structure.");
            }
        } catch (err) {
            showNotification("Failed to parse trip JSON.");
        }
        event.target.value = '';
    };
    reader.readAsText(file);
}

export function exportAppDataJSON() {
    const backup = {
        version: "2.4.56",
        exportDate: new Date().toISOString(),
        trips: trips,
        wishlistCollections: wishlistCollections,
        wishlistPins: wishlistPins
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Trippo_Backup_${formatLocalDate(new Date())}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toggleSidebar(false);
    showNotification("💾 Backup downloaded successfully!");
}

export function importAppDataJSON(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!confirm("Restoring a backup will replace your current trips and saved wishlist locations. Do you want to proceed?")) {
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = JSON.parse(e.target.result);
            if (!data || typeof data !== 'object') {
                throw new Error("Invalid payload format");
            }

            let restoredCount = 0;
            if (data.trips && Array.isArray(data.trips)) {
                const validatedTrips = data.trips
                    .filter(t => t && typeof t === 'object' && t.name)
                    .map(t => ({
                        ...t,
                        id: String(t.id || Date.now() + Math.random()),
                        stops: Array.isArray(t.stops) ? t.stops : [],
                        places: Array.isArray(t.places) ? t.places : [],
                        expenses: Array.isArray(t.expenses) ? t.expenses : []
                    }));
                setTrips(validatedTrips);
                restoredCount++;
            }

            if (data.wishlistCollections && Array.isArray(data.wishlistCollections)) {
                const validatedCols = data.wishlistCollections
                    .filter(c => c && typeof c === 'object' && c.name && c.id)
                    .map(c => ({ ...c, id: String(c.id) }));
                if (validatedCols.length > 0) {
                    setWishlistCollections(validatedCols);
                    restoredCount++;
                }
            }

            if (data.wishlistPins && Array.isArray(data.wishlistPins)) {
                const validatedPins = data.wishlistPins
                    .filter(p => p && typeof p === 'object' && p.name && !isNaN(p.lat) && !isNaN(p.lon))
                    .map(p => ({
                        ...p,
                        id: String(p.id || Date.now() + Math.random()),
                        lat: Number(p.lat),
                        lon: Number(p.lon)
                    }));
                setWishlistPins(validatedPins);
                restoredCount++;
            }

            if (restoredCount === 0) {
                showNotification("No recognizable Trippo data found in file.");
                event.target.value = '';
                return;
            }

            triggerHaptic('success');
            saveTrips();
            saveWishlist();
            toggleSidebar(false);
            switchTab('home');
            showNotification("📂 Data successfully restored!");
        } catch (err) {
            showNotification("Invalid backup file format.");
        }
        event.target.value = '';
    };
    reader.readAsText(file);
}

export async function forceAppRefresh() {
    showNotification("Clearing cache and updating app...");
    if ('serviceWorker' in navigator) {
        try {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const reg of registrations) {
                await reg.unregister();
            }
        } catch (e) {
            console.warn('SW unregister error:', e);
        }
    }
    if ('caches' in window) {
        try {
            const keys = await caches.keys();
            for (const key of keys) {
                await caches.delete(key);
            }
        } catch (e) {
            console.warn('Caches delete error:', e);
        }
    }
    setTimeout(() => {
        window.location.reload();
    }, 300);
}

/* --- SEARCH CLEAR BUTTON HELPERS --- */
export function clearSearchField(inputId, resultsId) {
    triggerHaptic('light');
    const input = document.getElementById(inputId);
    if (input) {
        input.value = '';
        input.focus();
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const clearBtn = document.getElementById('clear-' + inputId);
    if (clearBtn) clearBtn.style.display = 'none';

    if (resultsId) {
        const results = document.getElementById(resultsId);
        if (results) {
            results.innerHTML = '';
            results.style.display = 'none';
        }
    }
    if (inputId === 'place-search-input') {
        const form = document.getElementById('place-add-form');
        if (form) form.style.display = 'none';
    }
    if (inputId === 'wishlist-search-input') {
        const form = document.getElementById('wishlist-add-form');
        if (form) form.style.display = 'none';
    }
    if (inputId === 'hotel-address-input') {
        const svPreview = document.getElementById('hotel-streetview-preview');
        if (svPreview) svPreview.style.display = 'none';
    }
}

export function initSearchClearButtons() {
    const searchInputs = [
        { inputId: 'city-search-input', resultsId: 'city-search-results' },
        { inputId: 'place-search-input', resultsId: 'place-search-results' },
        { inputId: 'hotel-address-input', resultsId: 'hotel-address-results' },
        { inputId: 'wishlist-search-input', resultsId: 'wishlist-search-results' }
    ];

    searchInputs.forEach(({ inputId, resultsId }) => {
        const input = document.getElementById(inputId);
        const clearBtn = document.getElementById('clear-' + inputId);
        if (!input || !clearBtn) return;

        const updateVisibility = () => {
            clearBtn.style.display = input.value.trim().length > 0 ? 'flex' : 'none';
        };

        input.addEventListener('input', updateVisibility);
        input.addEventListener('change', updateVisibility);
        input.addEventListener('focus', updateVisibility);
        updateVisibility();
    });
}

if (typeof window !== 'undefined') {
    window.clearSearchField = clearSearchField;
    window.initSearchClearButtons = initSearchClearButtons;
}

/* ==========================================================================
   SMART PACKING CHECKLIST (NON-INTRUSIVE TRIP TOOL)
   ========================================================================== */
export const DEFAULT_PACKING_ITEMS = [
    // Documents & Money
    { id: 'p1', category: 'Documents', text: 'Passport (valid > 6 months)', checked: false },
    { id: 'p2', category: 'Documents', text: 'Visa / ETA entry approval', checked: false },
    { id: 'p3', category: 'Documents', text: 'Driver’s License / ID', checked: false },
    { id: 'p4', category: 'Documents', text: 'Travel Insurance policy', checked: false },
    { id: 'p5', category: 'Documents', text: 'Credit / Debit cards (notify bank)', checked: false },
    { id: 'p6', category: 'Documents', text: 'Emergency cash in local currency', checked: false },
    
    // Electronics
    { id: 'p7', category: 'Electronics', text: 'Universal travel adapter plug', checked: false },
    { id: 'p8', category: 'Electronics', text: 'Phone & charging cable', checked: false },
    { id: 'p9', category: 'Electronics', text: 'Portable power bank battery', checked: false },
    { id: 'p10', category: 'Electronics', text: 'Earbuds / Headphones', checked: false },
    
    // Health & Meds
    { id: 'p11', category: 'Health', text: 'Prescription medications (with labels)', checked: false },
    { id: 'p12', category: 'Health', text: 'Pain reliever / Ibuprofen', checked: false },
    { id: 'p13', category: 'Health', text: 'Band-aids & antiseptic wipes', checked: false },
    { id: 'p14', category: 'Health', text: 'Motion sickness pills', checked: false },

    // Toiletries
    { id: 'p15', category: 'Toiletries', text: 'Toothbrush & toothpaste', checked: false },
    { id: 'p16', category: 'Toiletries', text: 'Deodorant', checked: false },
    { id: 'p17', category: 'Toiletries', text: 'Sunscreen & lip balm', checked: false },
    { id: 'p18', category: 'Toiletries', text: 'TSA-friendly liquids (< 100ml / 3.4oz)', checked: false },

    // Clothing & Gear
    { id: 'p19', category: 'Clothing', text: 'Comfortable walking shoes', checked: false },
    { id: 'p20', category: 'Clothing', text: 'Light rain jacket or travel umbrella', checked: false },
    { id: 'p21', category: 'Clothing', text: 'Sunglasses', checked: false },
    { id: 'p22', category: 'Clothing', text: 'Weather-appropriate layers', checked: false }
];

let activePackingFilter = 'All';

export function openPackingModal() {
    const trip = getActiveTrip();
    if (!trip) {
        showNotification("Please select or create a trip first.");
        return;
    }

    if (!Array.isArray(trip.packingList) || trip.packingList.length === 0) {
        trip.packingList = DEFAULT_PACKING_ITEMS.map(i => ({ ...i }));
        saveTrips();
    }

    activePackingFilter = 'All';
    renderPackingList();

    const titleEl = document.getElementById('packing-modal-trip-name');
    if (titleEl) titleEl.innerText = trip.name;

    const modal = document.getElementById('packing-modal');
    if (modal) modal.style.display = 'flex';
    toggleSidebar(false);
}

export function setPackingFilter(cat) {
    activePackingFilter = cat;
    renderPackingList();
}

export function renderPackingList() {
    const trip = getActiveTrip();
    if (!trip || !Array.isArray(trip.packingList)) return;

    const listEl = document.getElementById('packing-items-list');
    const pillsEl = document.getElementById('packing-category-pills');
    const progressEl = document.getElementById('packing-progress-bar');
    const progressTextEl = document.getElementById('packing-progress-text');

    const total = trip.packingList.length;
    const packed = trip.packingList.filter(i => i.checked).length;
    const percent = total > 0 ? Math.round((packed / total) * 100) : 0;

    if (progressEl) progressEl.style.width = `${percent}%`;
    if (progressTextEl) progressTextEl.innerText = `${packed} of ${total} items packed (${percent}%)`;

    // Render filter pills
    const categories = ['All', 'Documents', 'Electronics', 'Health', 'Toiletries', 'Clothing', 'Custom'];
    if (pillsEl) {
        pillsEl.innerHTML = categories.map(cat => {
            const isActive = activePackingFilter === cat;
            return `<button class="packing-pill ${isActive ? 'active' : ''}" onclick="setPackingFilter('${cat}')">${cat}</button>`;
        }).join('');
    }

    // Filter items
    const filtered = activePackingFilter === 'All'
        ? trip.packingList
        : trip.packingList.filter(i => i.category.toLowerCase() === activePackingFilter.toLowerCase());

    if (!listEl) return;

    if (filtered.length === 0) {
        listEl.innerHTML = `
            <div style="text-align:center; padding:30px 10px; color:var(--text-light); font-size:13px;">
                No items in this category. Tap "+ Add" below to add custom items!
            </div>`;
        return;
    }

    listEl.innerHTML = filtered.map(item => {
        const safeId = escapeJS(item.id);
        const safeText = escapeHTML(item.text);
        const safeCat = escapeHTML(item.category);
        const isChecked = item.checked ? 'checked' : '';
        const cardClass = item.checked ? 'packing-item-card is-checked' : 'packing-item-card';

        return `
            <div class="${cardClass}">
                <input type="checkbox" class="packing-checkbox" ${isChecked} onchange="togglePackingItem('${safeId}')">
                <span class="packing-item-text" onclick="togglePackingItem('${safeId}')">${safeText}</span>
                <span class="packing-category-tag">${safeCat}</span>
                <button class="packing-delete-btn" onclick="deletePackingItem('${safeId}')" title="Delete item">✕</button>
            </div>
        `;
    }).join('');
}

export function togglePackingItem(itemId) {
    const trip = getActiveTrip();
    if (!trip || !Array.isArray(trip.packingList)) return;

    const item = trip.packingList.find(i => i.id === itemId);
    if (item) {
        item.checked = !item.checked;
        triggerHaptic(item.checked ? 'success' : 'light');
        saveTrips();
        renderPackingList();
    }
}

export function addCustomPackingItem() {
    const trip = getActiveTrip();
    if (!trip) return;

    const input = document.getElementById('packing-new-item-input');
    const catSelect = document.getElementById('packing-new-item-category');
    if (!input) return;

    const text = input.value.trim();
    if (!text) {
        showNotification("Please enter an item name.");
        return;
    }

    const category = (catSelect && catSelect.value) ? catSelect.value : 'Custom';
    const newItem = {
        id: 'c_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        category: category,
        text: text,
        checked: false
    };

    if (!Array.isArray(trip.packingList)) trip.packingList = [];
    trip.packingList.push(newItem);
    input.value = '';
    saveTrips();
    renderPackingList();
    triggerHaptic('light');
    showNotification(`Added "${text}" to packing checklist.`);
}

export function deletePackingItem(itemId) {
    const trip = getActiveTrip();
    if (!trip || !Array.isArray(trip.packingList)) return;

    trip.packingList = trip.packingList.filter(i => i.id !== itemId);
    saveTrips();
    renderPackingList();
    triggerHaptic('light');
}

export function resetPackingList() {
    const trip = getActiveTrip();
    if (!trip) return;

    if (confirm("Reset packing checklist to standard essentials?")) {
        trip.packingList = DEFAULT_PACKING_ITEMS.map(i => ({ ...i }));
        saveTrips();
        renderPackingList();
        triggerHaptic('medium');
        showNotification("Checklist reset to default travel essentials.");
    }
}

export function toggleAllPacking(checked) {
    const trip = getActiveTrip();
    if (!trip || !Array.isArray(trip.packingList)) return;

    trip.packingList.forEach(i => i.checked = checked);
    saveTrips();
    renderPackingList();
    triggerHaptic('medium');
}

/* ==========================================================================
   UNIVERSAL .ICS CALENDAR EXPORT
   ========================================================================== */
export function exportTripToICS() {
    const trip = getActiveTrip();
    if (!trip || !trip.stops || trip.stops.length === 0) {
        showNotification("Please select or create a trip with stops first.");
        return;
    }
    if (!trip.startDate || !trip.startDate.trim()) {
        showNotification("Please set a departure date to export calendar (.ics) events.");
        openEditTripModal(trip.id);
        return;
    }

    const pad = (n) => String(n).padStart(2, '0');
    const formatICSDate = (d) => {
        return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
    };
    const formatICSAllDay = (d) => {
        return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    };
    const escapeICS = (str) => {
        if (!str) return '';
        return String(str)
            .replace(/\\/g, '\\\\')
            .replace(/;/g, '\\;')
            .replace(/,/g, '\\,')
            .replace(/\n/g, '\\n');
    };

    const nowStr = formatICSDate(new Date());
    let icsContent = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Trippo Travel Planner//trippo.top//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `X-WR-CALNAME:${escapeICS(trip.name)} - Itinerary`,
        'X-WR-TIMEZONE:UTC'
    ];

    let currentDate = parseLocalDate(trip.startDate) || new Date();

    trip.stops.forEach((stop, index) => {
        const nights = Number(stop.nights) || 1;
        const stopStart = new Date(currentDate);
        const stopEnd = new Date(currentDate);
        stopEnd.setDate(stopEnd.getDate() + nights);

        const uidBase = `trippo-${trip.id}-stop-${index}`;

        // 1. Destination Stay All-Day Event
        icsContent.push('BEGIN:VEVENT');
        icsContent.push(`UID:${uidBase}-stay@trippo.top`);
        icsContent.push(`DTSTAMP:${nowStr}`);
        icsContent.push(`DTSTART;VALUE=DATE:${formatICSAllDay(stopStart)}`);
        icsContent.push(`DTEND;VALUE=DATE:${formatICSAllDay(stopEnd)}`);
        icsContent.push(`SUMMARY:${escapeICS(`Trip: ${stop.name} (${nights} night${nights > 1 ? 's' : ''})`)}`);
        icsContent.push(`DESCRIPTION:${escapeICS(`Trip: ${trip.name}\\nDestination: ${stop.name}\\nDuration: ${nights} nights${stop.notes ? `\\nNotes: ${stop.notes}` : ''}`)}`);
        icsContent.push(`LOCATION:${escapeICS(stop.name)}`);
        icsContent.push('STATUS:CONFIRMED');
        icsContent.push('END:VEVENT');

        // 2. Hotel / Lodging Booking Event (if present)
        if (stop.lodging && (stop.lodging.name || stop.lodging.address)) {
            const hStart = new Date(stopStart);
            hStart.setHours(15, 0, 0); // Check-in 3:00 PM
            const hEnd = new Date(stopEnd);
            hEnd.setHours(11, 0, 0); // Check-out 11:00 AM

            icsContent.push('BEGIN:VEVENT');
            icsContent.push(`UID:${uidBase}-hotel@trippo.top`);
            icsContent.push(`DTSTAMP:${nowStr}`);
            icsContent.push(`DTSTART:${formatICSDate(hStart)}`);
            icsContent.push(`DTEND:${formatICSDate(hEnd)}`);
            icsContent.push(`SUMMARY:${escapeICS(`🏨 Hotel Check-In: ${stop.lodging.name || 'Lodging in ' + stop.name}`)}`);
            let desc = `Hotel: ${stop.lodging.name || 'Accommodations'}\\nLocation: ${stop.name}`;
            if (stop.lodging.address) desc += `\\nAddress: ${stop.lodging.address}`;
            if (stop.lodging.notes) desc += `\\nNotes / Confirmation: ${stop.lodging.notes}`;
            icsContent.push(`DESCRIPTION:${escapeICS(desc)}`);
            if (stop.lodging.address) icsContent.push(`LOCATION:${escapeICS(stop.lodging.address)}`);
            icsContent.push('STATUS:CONFIRMED');
            icsContent.push('END:VEVENT');
        }

        // 3. Transit Event (if present)
        const tr = stop.transit ? normalizeTransitFields(stop.transit) : null;
        if (tr && (tr.type || tr.carrier || tr.departureTime || tr.confirmation)) {
            // Transit is saved on the stop you leave from: its own date, else the end of the stay
            let tDate = tr.date ? new Date(`${tr.date}T00:00:00`) : new Date(stopEnd);
            if (isNaN(tDate)) tDate = new Date(stopEnd);
            const depParts = (tr.departureTime || '09:00').split(':');
            tDate.setHours(Number(depParts[0]) || 9, Number(depParts[1]) || 0, 0);
            
            const arrDate = new Date(tDate);
            if (tr.arrivalTime) {
                const arrParts = tr.arrivalTime.split(':');
                arrDate.setHours(Number(arrParts[0]) || 12, Number(arrParts[1]) || 0, 0);
                if (arrDate < tDate) arrDate.setDate(arrDate.getDate() + 1);
            } else {
                arrDate.setHours(arrDate.getHours() + 2);
            }

            const transitType = (tr.type || 'Transit').toUpperCase();
            const fromCity = tr.depStation || stop.name;
            const toCity = tr.arrStation || (trip.stops[index + 1] ? trip.stops[index + 1].name : 'Home');
            icsContent.push('BEGIN:VEVENT');
            icsContent.push(`UID:${uidBase}-transit@trippo.top`);
            icsContent.push(`DTSTAMP:${nowStr}`);
            icsContent.push(`DTSTART:${formatICSDate(tDate)}`);
            icsContent.push(`DTEND:${formatICSDate(arrDate)}`);
            icsContent.push(`SUMMARY:${escapeICS(`✈️ ${transitType}: ${fromCity} ➔ ${toCity}`)}`);
            let tDesc = `Transit: ${transitType}\\nRoute: ${fromCity} to ${toCity}`;
            if (tr.carrier) tDesc += `\\nCarrier: ${tr.carrier}`;
            if (tr.confirmation) tDesc += `\\nConfirmation: ${tr.confirmation}`;
            if (tr.notes) tDesc += `\\nNotes: ${tr.notes}`;
            icsContent.push(`DESCRIPTION:${escapeICS(tDesc)}`);
            icsContent.push(`LOCATION:${escapeICS(`${fromCity} to ${toCity}`)}`);
            icsContent.push('STATUS:CONFIRMED');
            icsContent.push('END:VEVENT');
        }

        currentDate.setDate(currentDate.getDate() + nights);
    });

    icsContent.push('END:VCALENDAR');
    const icsString = icsContent.join('\r\n');

    const blob = new Blob([icsString], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${trip.name.replace(/[^a-zA-Z0-9_-]/g, '_')}-Itinerary.ics`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toggleSidebar(false);
    showNotification("📅 Calendar file (.ics) downloaded! Open to add to Google/Apple Calendar.");
}

/* ==========================================================================
   1-TAP PRINTABLE / PDF POCKET ITINERARY
   ========================================================================== */
export function printPocketItinerary() {
    const trip = getActiveTrip();
    if (!trip || !trip.stops || trip.stops.length === 0) {
        showNotification("Please select or create a trip with stops first.");
        return;
    }

    let printContainer = document.getElementById('printable-itinerary-container');
    if (!printContainer) {
        printContainer = document.createElement('div');
        printContainer.id = 'printable-itinerary-container';
        document.body.appendChild(printContainer);
    }

    const totalNights = trip.stops.reduce((sum, s) => sum + (Number(s.nights) || 0), 0);
    const hasDate = Boolean(trip.startDate && trip.startDate.trim());
    const sDate = hasDate ? parseLocalDate(trip.startDate) : null;
    const dateRangeStr = (hasDate && sDate) ? `${formatLocalDate(sDate)} (${totalNights} Nights)` : `Flexible Dates • ${totalNights} Nights`;

    let html = `
        <div class="print-itinerary-sheet">
            <div class="print-header">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <div>
                        <h1 style="margin:0 0 4px 0; font-size:26px; color:#124b43; font-weight:800;">${escapeHTML(trip.name)}</h1>
                        <p style="margin:0; font-size:14px; color:#4b5563; font-weight:600;">📅 ${escapeHTML(dateRangeStr)} • ${trip.stops.length} Destination${trip.stops.length > 1 ? 's' : ''}</p>
                    </div>
                    <div style="text-align:right;">
                        <span style="font-size:16px; font-weight:800; color:#124b43;">TRIPPO</span>
                        <div style="font-size:10px; color:#6b7280;">trippo.top</div>
                    </div>
                </div>
            </div>

            <!-- ROUTE SUMMARY -->
            <div class="print-card" style="margin-bottom:18px;">
                <h3 style="margin:0 0 8px 0; font-size:14px; color:#124b43; text-transform:uppercase; letter-spacing:0.5px;">🗺️ Route Overview</h3>
                <div style="font-size:13px; font-weight:600; color:#374151;">
                    ${trip.stops.map((s, idx) => `<span>${idx + 1}. <strong>${escapeHTML(s.name)}</strong> (${s.nights || 1}n)</span>`).join(' <span style="color:#9ca3af; margin:0 4px;">➔</span> ')}
                </div>
            </div>
    `;

    // DAY-BY-DAY / STOP BREAKDOWN
    let runningDate = (hasDate && sDate) ? new Date(sDate) : null;
    let runningDay = 1;
    html += `<h3 style="margin:20px 0 10px 0; font-size:15px; color:#124b43; border-bottom:1.5px solid #e5e7eb; padding-bottom:6px;">📍 Stops & Itinerary Details</h3>`;

    trip.stops.forEach((stop, sIdx) => {
        const nights = Number(stop.nights) || 1;
        let dateSnippet = '';
        if (runningDate) {
            const stopStartDate = new Date(runningDate);
            const stopEndDate = new Date(runningDate);
            stopEndDate.setDate(stopEndDate.getDate() + nights);
            dateSnippet = `${formatLocalDate(stopStartDate)} – ${formatLocalDate(stopEndDate)} (${nights} Night${nights > 1 ? 's' : ''})`;
            runningDate = stopEndDate;
        } else {
            dateSnippet = (nights <= 1) ? `Day ${runningDay} (${nights} Night)` : `Days ${runningDay}–${runningDay + nights} (${nights} Nights)`;
            runningDay += nights;
        }

        html += `
            <div class="print-card">
                <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:8px;">
                    <h4 style="margin:0; font-size:15px; color:#111827;">Stop ${sIdx + 1}: <strong>${escapeHTML(stop.name)}</strong></h4>
                    <span style="font-size:12px; font-weight:600; color:#4b5563;">${dateSnippet}</span>
                </div>
        `;

        if (stop.notes) {
            html += `<p style="margin:0 0 8px 0; font-size:12px; color:#4b5563; font-style:italic;">Notes: ${escapeHTML(stop.notes)}</p>`;
        }

        // Transit details
        const ptr = stop.transit ? normalizeTransitFields(stop.transit) : null;
        if (ptr && (ptr.type || ptr.carrier || ptr.confirmation || ptr.departureTime)) {
            html += `
                <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; padding:6px 10px; margin-bottom:8px; font-size:12px;">
                    <strong>✈️ Onward travel:</strong> ${escapeHTML((ptr.type || 'Travel').toUpperCase())}
                    ${ptr.carrier ? `• ${escapeHTML(ptr.carrier)}` : ''}
                    ${ptr.departureTime ? `• Dep: ${escapeHTML(formatTime(ptr.departureTime))}` : ''}
                    ${ptr.arrivalTime ? `• Arr: ${escapeHTML(formatTime(ptr.arrivalTime))}` : ''}
                    ${ptr.confirmation ? `• <strong>Ref: ${escapeHTML(ptr.confirmation)}</strong>` : ''}
                </div>
            `;
        }

        // Lodging details
        if (stop.lodging && (stop.lodging.name || stop.lodging.address)) {
            html += `
                <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:6px; padding:6px 10px; margin-bottom:8px; font-size:12px;">
                    <strong>🏨 Accommodations:</strong> <strong>${escapeHTML(stop.lodging.name || 'Reserved Lodging')}</strong>
                    ${stop.lodging.address ? `<br>📍 Address: ${escapeHTML(stop.lodging.address)}` : ''}
                    ${stop.lodging.notes ? `<br>ℹ️ Info: ${escapeHTML(stop.lodging.notes)}` : ''}
                </div>
            `;
        }

        // Daily attractions/places in this stop
        const cityPlaces = trip.places ? trip.places.filter(p => p.cityIndex === sIdx || (p.cityIndex === undefined && sIdx === 0)) : [];
        if (cityPlaces.length > 0) {
            html += `<div style="margin-top:8px;">
                <div style="font-size:12px; font-weight:700; color:#374151; margin-bottom:4px;">Planned Sightseeing & Activities:</div>
                <ul style="margin:0; padding-left:18px; font-size:12px; color:#4b5563;">
                    ${cityPlaces.map(p => `
                        <li style="margin-bottom:3px;">
                            <strong>${escapeHTML(p.name)}</strong>
                            ${p.time ? ` <span style="color:#6b7280;">(${escapeHTML(formatTime(p.time))})</span>` : ''}
                            ${p.notes ? ` — <em>${escapeHTML(p.notes)}</em>` : ''}
                        </li>
                    `).join('')}
                </ul>
            </div>`;
        }

        html += `</div>`;
        runningDate.setDate(runningDate.getDate() + nights);
    });

    // EMERGENCY / OFFLINE NOTES SECTION
    html += `
        <div class="print-card" style="margin-top:16px;">
            <h4 style="margin:0 0 6px 0; font-size:13px; color:#124b43; text-transform:uppercase;">🚨 Emergency & Offline Contacts</h4>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; font-size:11px; color:#4b5563;">
                <div style="border-bottom:1px dashed #d1d5db; padding-bottom:6px;">Local Embassy / Consulate: __________________</div>
                <div style="border-bottom:1px dashed #d1d5db; padding-bottom:6px;">Travel Insurance Policy #: __________________</div>
                <div style="border-bottom:1px dashed #d1d5db; padding-bottom:6px;">Emergency Medical Assistance: __________________</div>
                <div style="border-bottom:1px dashed #d1d5db; padding-bottom:6px;">Bank / Card Freeze Line: __________________</div>
            </div>
        </div>
        <div style="text-align:center; font-size:10px; color:#9ca3af; margin-top:20px;">
            Generated by Trippo Travel Planner • https://trippo.top
        </div>
    </div>`;

    printContainer.innerHTML = html;
    toggleSidebar(false);
    window.print();
}

if (typeof window !== 'undefined') {
    window.openPackingModal = openPackingModal;
    window.setPackingFilter = setPackingFilter;
    window.togglePackingItem = togglePackingItem;
    window.addCustomPackingItem = addCustomPackingItem;
    window.deletePackingItem = deletePackingItem;
    window.resetPackingList = resetPackingList;
    window.toggleAllPacking = toggleAllPacking;
    window.exportTripToICS = exportTripToICS;
    window.printPocketItinerary = printPocketItinerary;
    window.handleFlightHubOriginInput = handleFlightHubOriginInput;
    window.selectFlightHubChip = selectFlightHubChip;
    window.saveDefaultFlightHubOrigin = saveDefaultFlightHubOrigin;
    window.updateFlightHubLinks = updateFlightHubLinks;
    window.initFlightHub = initFlightHub;
    window.renderFlightHubDeals = renderFlightHubDeals;
    window.refreshFlightHubDeals = refreshFlightHubDeals;
    window.switchFlightHubTab = switchFlightHubTab;
    window.openEsimModal = openEsimModal;
    window.openCurrencyModal = openCurrencyModal;
    window.convertCurrency = convertCurrency;
    window.openEditTripModal = openEditTripModal;
    window.clearEditTripDate = clearEditTripDate;
    window.saveEditedTrip = saveEditedTrip;
}

/* ==========================================================================
   EXPLORE EVERYWHERE & ROUTE HUB (SIDEBAR FLIGHT TOOL)
   ========================================================================== */
export const FLIGHT_HUB_DEFAULT_AIRPORT = 'LFT';
export const FLIGHT_HUB_AFFILIATE_MARKER = '785709'; // Travelpayouts account ID (links go through tp.media)

export function getFlightHubOrigin() {
    let stored = null;
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            stored = window.localStorage.getItem('trippo_home_airport');
        }
    } catch (e) {
        console.warn(e);
    }
    if (stored && stored.length >= 3) {
        const first = stored.split(',')[0].trim().substring(0, 3);
        return first.toUpperCase();
    }
    return FLIGHT_HUB_DEFAULT_AIRPORT;
}

export function updateFlightHubLinks(origin) {
    const code = (origin || getFlightHubOrigin()).toUpperCase();
    const codeLower = code.toLowerCase();

    let dateStr = '';
    const dateInput = document.getElementById('flight-hub-date');
    if (dateInput && dateInput.value) {
        dateStr = dateInput.value; // YYYY-MM-DD
    }

    const skyscanner = document.getElementById('flighthub-skyscanner');
    if (skyscanner) {
        skyscanner.href = dateStr
            ? `https://www.skyscanner.com/transport/flights-from/${codeLower}/${dateStr.substring(2).replace(/-/g, '')}/`
            : `https://www.skyscanner.com/transport/flights-from/${codeLower}/`;
    }

    const gflights = document.getElementById('flighthub-googleflights');
    if (gflights) {
        gflights.href = dateStr
            ? `https://www.google.com/travel/flights?q=flights+from+${code}+to+anywhere+on+${dateStr}`
            : `https://www.google.com/travel/flights?q=flights+from+${code}+to+anywhere`;
    }

    const flightconn = document.getElementById('flighthub-flightconnections');
    if (flightconn) {
        flightconn.href = `https://www.flightconnections.com/flights-from-${codeLower}`;
    }

    const kayak = document.getElementById('flighthub-kayak');
    if (kayak) {
        kayak.href = dateStr
            ? `https://www.kayak.com/explore/${code}/${dateStr.replace(/-/g, '')}`
            : `https://www.kayak.com/explore/${code}`;
    }

    const aviasales = document.getElementById('flighthub-aviasales');
    if (aviasales) {
        aviasales.href = partnerLink('aviasales', dateStr
            ? `https://www.aviasales.com/search?origin=${code}&destination=anywhere&depart_date=${dateStr}`
            : `https://www.aviasales.com/search?origin=${code}&destination=anywhere`);
    }

    // Update active highlight on quick chips
    document.querySelectorAll('.flight-hub-chip').forEach(chip => {
        if (chip.innerText.trim().toUpperCase() === code) {
            chip.classList.add('active');
        } else {
            chip.classList.remove('active');
        }
    });

    // Render cheap getaways for selected airport & date
    renderFlightHubDeals(code, dateStr);
}

export async function renderFlightHubDeals(origin, dateStr = '') {
    const listEl = document.getElementById('flight-hub-deals-list');
    if (!listEl) return;

    try {
        const deals = await getCheapFlightDeals(origin, dateStr);
        if (!deals || deals.length === 0) {
            listEl.innerHTML = `<div style="font-size:11px; color:#8fa09c; padding:4px 0;">No cheap deals found for ${escapeHTML(origin)}.</div>`;
            return;
        }

        listEl.innerHTML = deals.map(deal => `
            <a href="${String(deal.link).startsWith('https://') ? escapeHTML(deal.link) : '#'}" target="_blank" rel="noopener noreferrer" class="flight-deal-item" title="View flights to ${escapeHTML(deal.city)} on Aviasales">
                <div class="flight-deal-dest">
                    <span class="flight-deal-city">${escapeHTML(deal.city)} (${escapeHTML(deal.code)})</span>
                    <span class="flight-deal-airline">${escapeHTML(deal.airline)}${deal.via ? ` · from ${escapeHTML(deal.via)}` : ''}</span>
                </div>
                <div class="flight-deal-price-badge">
                    <span title="${deal.typical ? 'Typical round-trip fare, not a live price' : 'Recent fare found on Aviasales'}">${deal.typical ? 'About' : 'From'} $${Number(deal.price) || 0}</span>
                    <span style="font-size:9px;">↗</span>
                </div>
            </a>
        `).join('');
    } catch (e) {
        console.warn('Error rendering flight deals:', e);
    }
}

export function refreshFlightHubDeals() {
    const origin = getFlightHubOrigin();
    const dateInput = document.getElementById('flight-hub-date');
    const dateStr = (dateInput && dateInput.value) || '';
    renderFlightHubDeals(origin, dateStr);
    triggerHaptic('light');
    showNotification(`↻ Refreshed cheap flights from ${origin}`);
}

export function switchFlightHubTab(tab) {
    const dealsTab = document.getElementById('flighthub-tab-deals');
    const toolsTab = document.getElementById('flighthub-tab-tools');
    const dealsCont = document.getElementById('flight-hub-deals-container');
    const launchersCont = document.getElementById('flight-hub-launchers-container');

    if (tab === 'deals') {
        if (dealsTab) dealsTab.classList.add('active');
        if (toolsTab) toolsTab.classList.remove('active');
        if (dealsCont) dealsCont.style.display = 'block';
        if (launchersCont) launchersCont.style.display = 'none';
    } else {
        if (toolsTab) toolsTab.classList.add('active');
        if (dealsTab) dealsTab.classList.remove('active');
        if (dealsCont) dealsCont.style.display = 'none';
        if (launchersCont) launchersCont.style.display = 'flex';
    }
    triggerHaptic('light');
}

export function handleFlightHubOriginInput(event) {
    const input = (event && event.target) || document.getElementById('flight-hub-origin');
    if (!input) return;
    let clean = input.value.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 3);
    input.value = clean;
    if (clean.length === 3) {
        updateFlightHubLinks(clean);
    }
}

export function selectFlightHubChip(code) {
    const input = document.getElementById('flight-hub-origin');
    if (input) input.value = code;
    updateFlightHubLinks(code);
    triggerHaptic('light');
}

export function saveDefaultFlightHubOrigin() {
    const input = document.getElementById('flight-hub-origin');
    const code = (input ? input.value : '').trim().toUpperCase();
    if (!code || code.length !== 3) {
        showNotification("Please enter a valid 3-letter airport code (e.g. LFT, MSY, IAH).");
        return;
    }
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem('trippo_home_airport', code);
        }
    } catch (e) {
        console.warn(e);
    }
    const btn = document.getElementById('flight-hub-save-btn');
    if (btn) {
        const origText = btn.innerText;
        btn.innerText = 'Saved! ✓';
        btn.classList.add('saved');
        setTimeout(() => {
            btn.innerText = origText;
            btn.classList.remove('saved');
        }, 1600);
    }
    triggerHaptic('success');
    showNotification(`✈️ Default home airport saved: ${code}`);
}

export function initFlightHub() {
    initFlightHubChips();
    const origin = getFlightHubOrigin();
    const input = document.getElementById('flight-hub-origin');
    if (input) input.value = origin;
    updateFlightHubLinks(origin);
}

export function initFlightHubChips() {
    const container = document.getElementById('flight-hub-chips-container');
    if (!container) return;
    
    let stored = null;
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            stored = window.localStorage.getItem('trippo_home_airport');
        }
    } catch (e) {
        console.warn(e);
    }
    
    let airports = ['LFT', 'MSY', 'IAH', 'DFW', 'ATL']; // Defaults
    if (stored && stored.length >= 3) {
        airports = stored.split(',').map(s => s.trim().substring(0, 3).toUpperCase()).filter(s => s.length === 3);
    }
    
    container.innerHTML = '';
    airports.forEach(code => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'flight-hub-chip';
        btn.onclick = () => selectFlightHubChip(code);
        btn.innerText = code;
        container.appendChild(btn);
    });
}
window.initFlightHubChips = initFlightHubChips;




// The transit form saves method/depTime/arrTime/bookingNumber; older data used type/departureTime/...
function normalizeTransitFields(t) {
    return {
        type: t.method || t.type || '',
        carrier: t.carrier || '',
        departureTime: t.depTime || t.departureTime || '',
        arrivalTime: t.arrTime || t.arrivalTime || '',
        confirmation: t.bookingNumber || t.confirmation || '',
        date: t.date || '',
        depStation: t.depStation || '',
        arrStation: t.arrStation || '',
        notes: t.notes || ''
    };
}
