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
    toggleSidebar
} from './state.js';

import { initPlannerMap, safeInvalidate, plannerMap } from './maps.js';
import { renderPlanner } from './planner.js';
import { renderPlacesMasterList, openPlacesCityView } from './places.js';
import { renderBookingsView, renderBookingsList, renderTransitView, renderTransitList } from './bookings.js';
import { showWishlistDirectory, cancelDroppedPin } from './wishlist.js';

/* --- HOME VIEW & TRIP CREATION --- */
export function renderHome() {
    const listEl = document.getElementById('trip-list');
    if (!listEl) return;
    if (trips.length === 0) {
        listEl.innerHTML = `
            <div style="text-align: center; color: #8fa39f; padding: 40px 20px;">
                <p style="font-size: 15px; font-weight: 600;">No trips yet.</p>
                <p style="font-size: 13px;">Tap "+ Create new trip" above to start your first adventure!</p>
            </div>`;
        return;
    }

    listEl.innerHTML = trips.map(trip => {
        const totalNights = trip.stops ? trip.stops.reduce((sum, stop) => sum + (Number(stop.nights) || 0), 0) : 0;
        const sDate = parseLocalDate(trip.startDate);
        const exampleBadge = trip.isExample ? `<span class="example-badge">Sample Trip</span>` : '';

        return `
        <div class="trip-card">
            <div class="trip-card-content" onclick="openTrip('${trip.id}')">
                <h3>${trip.name} ${exampleBadge}</h3>
                <p>${sDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} • ${totalNights} Nights</p>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
                <button onclick="promptDeleteTripById('${trip.id}')" style="background:#fff0f2; border:1px solid #ffd4d9; border-radius:8px; padding:8px 10px; font-size:14px; cursor:pointer; color:var(--accent);" title="Delete Trip">🗑️</button>
                <div style="color: #b7c7c3; font-size:22px; cursor:pointer;" onclick="openTrip('${trip.id}')">›</div>
            </div>
        </div>`;
    }).join('');
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
    const date = dateEl ? dateEl.value : '';

    if (name && date) {
        const roundTripEl = document.getElementById('new-trip-roundtrip');
        const isRoundTrip = roundTripEl ? roundTripEl.checked : false;
        const newTrip = {
            id: Date.now().toString(),
            name,
            startDate: date,
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
        showNotification("Please provide both trip name and start date.");
    }
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
    if (confirm(`Are you sure you want to delete "${trip.name}"? This cannot be undone.`)) {
        setTrips(trips.filter(t => t.id !== tripId));
        saveTrips();
        if (activeTripId === tripId) {
            setActiveTripId(trips.length > 0 ? trips[0].id : null);
            setActivePlacesTripId(activeTripId);
        }
        renderHome();
        switchTab('home');
        showNotification(`Deleted "${trip.name}".`);
    }
}

/* --- TAB SWITCHING --- */
export function switchTab(tabId) {
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

/* --- SMART SPLIT BUDGET TRACKER LOGIC --- */
export function getBudgetActiveTrip() {
    const selectEl = document.getElementById('budget-trip-select');
    const tripId = selectEl ? selectEl.value : activeTripId;
    return trips.find(t => t.id === tripId) || getActiveTrip();
}

export function handleBudgetTripChange(tripId) {
    const trip = trips.find(t => t.id === tripId);
    if (trip) {
        if (!trip.budgetTravelers) trip.budgetTravelers = 2;
        const countEl = document.getElementById('budget-travelers-count');
        if (countEl) countEl.value = trip.budgetTravelers;
    }
    renderBudgetCalculator();
}

export function openBudgetModal() {
    toggleSidebar(false);
    const selectEl = document.getElementById('budget-trip-select');
    if (selectEl) {
        selectEl.innerHTML = trips.map(t => `<option value="${t.id}" ${t.id === activeTripId ? 'selected' : ''}>${t.name}</option>`).join('');
    }

    const trip = getBudgetActiveTrip();
    if (trip) {
        if (!trip.budgetTravelers) trip.budgetTravelers = 2;
        if (!trip.expenses) trip.expenses = [];
        const countEl = document.getElementById('budget-travelers-count');
        if (countEl) countEl.value = trip.budgetTravelers;
    }
    renderBudgetCalculator();
    const modal = document.getElementById('budget-modal');
    if (modal) modal.style.display = 'flex';
}

export function updateTravelersCount(val) {
    const trip = getBudgetActiveTrip();
    if (!trip) return;
    trip.budgetTravelers = Math.max(1, parseInt(val, 10) || 1);
    saveTrips();
    renderBudgetCalculator();
}

export function addTripExpense() {
    const trip = getBudgetActiveTrip();
    if (!trip) return;
    const title = document.getElementById('expense-title-input')?.value.trim();
    const amount = parseFloat(document.getElementById('expense-amount-input')?.value);
    const splitType = document.getElementById('expense-split-type')?.value || 'split';

    if (!title || isNaN(amount) || amount <= 0) {
        showNotification("Please enter a valid expense name and amount.");
        return;
    }

    if (!trip.expenses) trip.expenses = [];
    trip.expenses.push({
        id: 'exp_' + Date.now(),
        title,
        amount: Number(amount) || 0,
        splitType
    });

    saveTrips();
    const titleInput = document.getElementById('expense-title-input');
    const amountInput = document.getElementById('expense-amount-input');
    if (titleInput) titleInput.value = '';
    if (amountInput) amountInput.value = '';
    renderBudgetCalculator();
    showNotification("Expense added!");
}

export function deleteTripExpense(expId) {
    const trip = getBudgetActiveTrip();
    if (!trip || !trip.expenses) return;
    trip.expenses = trip.expenses.filter(e => e.id !== expId);
    saveTrips();
    renderBudgetCalculator();
}

export function renderBudgetCalculator() {
    const trip = getBudgetActiveTrip();
    if (!trip) return;

    const travelers = Math.max(1, parseInt(trip.budgetTravelers, 10) || 1);
    const expenses = trip.expenses || [];

    let totalCombined = 0;
    let splitPool = 0;

    expenses.forEach(e => {
        const amt = Number(e.amount) || 0;
        totalCombined += amt;
        if (e.splitType === 'split') {
            splitPool += amt;
        }
    });

    const perPersonSplit = travelers > 0 ? (splitPool / travelers) : splitPool;

    const combinedEl = document.getElementById('budget-total-combined');
    const perPersonEl = document.getElementById('budget-per-person');
    if (combinedEl) combinedEl.innerText = `$${totalCombined.toFixed(2)}`;
    if (perPersonEl) perPersonEl.innerText = `$${perPersonSplit.toFixed(2)} (Split portion across ${travelers} people)`;

    const container = document.getElementById('expenses-list-container');
    if (!container) return;
    if (expenses.length === 0) {
        container.innerHTML = `<p style="text-align:center; color:#8fa09c; font-size:13px; margin:20px 0;">No expenses recorded for this trip yet.</p>`;
        return;
    }

    container.innerHTML = expenses.map(e => {
        const amt = Number(e.amount) || 0;
        const badge = e.splitType === 'split'
            ? `<span style="background:var(--primary-light); color:var(--primary); font-size:10px; font-weight:700; padding:2px 8px; border-radius:6px;">👥 Split (÷${travelers} = $${(amt / travelers).toFixed(2)}/ea)</span>`
            : `<span style="background:#fff0f2; color:var(--accent); font-size:10px; font-weight:700; padding:2px 8px; border-radius:6px;">👤 Individual</span>`;

        return `
        <div style="background:var(--card-bg); border:1px solid var(--border-subtle); border-radius:14px; padding:12px 14px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
            <div>
                <strong style="font-size:14px; display:block; margin-bottom:3px;">${e.title}</strong>
                ${badge}
            </div>
            <div style="display:flex; align-items:center; gap:12px;">
                <strong style="font-size:15px; color:var(--primary);">$${amt.toFixed(2)}</strong>
                <button onclick="deleteTripExpense('${e.id}')" style="background:#fff0f2; border:1px solid #ffd4d9; border-radius:8px; padding:6px 8px; font-size:12px; cursor:pointer; color:var(--accent);">🗑</button>
            </div>
        </div>`;
    }).join('');
}

/* --- CURRENCY CONVERTER LOGIC --- */
const mockExchangeRates = {
    USD: 1.0,
    EUR: 0.92,
    JPY: 154.5,
    GBP: 0.78,
    CNY: 7.23,
    AUD: 1.52
};

export function openCurrencyModal() {
    toggleSidebar(false);
    convertCurrency();
    const modal = document.getElementById('currency-modal');
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

    const symbols = { USD: '$', EUR: '€', JPY: '¥', GBP: '£', CNY: '¥', AUD: '$' };
    const sym = symbols[toCurr] || '';

    const resEl = document.getElementById('curr-result');
    if (resEl) resEl.innerText = `${sym}${converted.toFixed(2)} ${toCurr}`;
}

/* --- SHARE & APP BACKUP TOOLS --- */
export function openShareTripModal() {
    toggleSidebar(false);
    const selectEl = document.getElementById('share-trip-select');
    if (selectEl) {
        selectEl.innerHTML = trips.map(t => `<option value="${t.id}" ${t.id === activeTripId ? 'selected' : ''}>${t.name}</option>`).join('');
    }
    const modal = document.getElementById('share-trip-modal');
    if (modal) modal.style.display = 'flex';
}

export function confirmExportSharedTrip() {
    const tripSelect = document.getElementById('share-trip-select');
    const trip = trips.find(t => t.id === tripSelect?.value);
    if (!trip) {
        showNotification("Please select a trip to share.");
        return;
    }
    const exportPayload = {
        trippoVersion: "2.3.44",
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
    closeModal('share-trip-modal');
    showNotification(`Exported share package for "${trip.name}"!`);
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
        version: "2.3.54",
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
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = JSON.parse(e.target.result);
            if (data.trips && Array.isArray(data.trips)) {
                setTrips(data.trips);
            }
            if (data.wishlistCollections && Array.isArray(data.wishlistCollections)) {
                setWishlistCollections(data.wishlistCollections);
            }
            if (data.wishlistPins && Array.isArray(data.wishlistPins)) {
                setWishlistPins(data.wishlistPins);
            }
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
