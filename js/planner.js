/* ==========================================================================
   Trippo Travel Planner - Planner & Stop Sequence Optimization
   js/planner.js
   ========================================================================== */

import {
    getActiveTrip,
    trips,
    saveTrips,
    parseLocalDate,
    formatLocalDate,
    showNotification,
    closeModal
} from './state.js';

import { drawPlannerMapRoute, plannerMap, pMarkers } from './maps.js';

export let citySearchTimeout = null;
let citySearchAbortController = null;

export function renderPlanner() {
    const trip = getActiveTrip();
    if (!trip) return;
    const titleEl = document.getElementById('planner-trip-title');
    if (titleEl) titleEl.innerText = trip.name;

    const list = document.getElementById('itinerary-list');
    if (!list) return;
    list.innerHTML = '';

    let totalNights = 0;
    let currentD = parseLocalDate(trip.startDate);

    if (!Array.isArray(trip.stops)) trip.stops = [];

    trip.stops.forEach((stop, index) => {
        if (!stop.notes) stop.notes = Array(Math.max(1, stop.nights)).fill('');
        if (stop.transit === undefined) stop.transit = null;
        if (stop.lodging === undefined) stop.lodging = null;

        const arr = new Date(currentD);
        currentD.setDate(currentD.getDate() + (Number(stop.nights) || 0));
        const dep = new Date(currentD);

        list.innerHTML += `
            <div class="stop-card">
                <div class="drag-handle">≡</div>
                <div style="flex-grow:1; cursor:pointer;" onclick="openDailyNotes(${index}, '${formatLocalDate(arr)}')">
                    <h3 style="margin: 0 0 4px 0; font-size: 16px;"><span style="color:var(--primary)">●</span> ${stop.name}</h3>
                    <p style="margin: 0; font-size: 12px; color: #728481;">${arr.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${dep.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                </div>
                <div style="display:flex; align-items:center; gap:6px;">
                    <button onclick="focusStopOnMap(event, ${index})" style="background:var(--primary-light); border:1px solid var(--border-subtle); border-radius:8px; padding:6px 8px; font-size:13px; cursor:pointer;" title="View on map">🗺️</button>
                    <div class="nights-control">
                        <button class="nights-btn" onclick="updateNights(${index}, -1)">−</button>
                        <strong style="font-size: 14px; min-width: 18px; text-align: center;">${stop.nights}</strong>
                        <button class="nights-btn" onclick="updateNights(${index}, 1)">+</button>
                    </div>
                    <button onclick="deleteStop(${index})" style="background:#fff0f2; border:1px solid #ffd4d9; border-radius:8px; padding:6px 8px; font-size:12px; cursor:pointer; color:var(--accent);" title="Delete Stop">🗑</button>
                </div>
            </div>`;
        totalNights += Number(stop.nights) || 0;
    });

    const totalEl = document.getElementById('total-nights');
    if (totalEl) totalEl.innerText = totalNights + " Nights";

    const colTripInfo = document.getElementById('planner-collapsed-trip-info');
    if (colTripInfo) colTripInfo.innerText = `${trip.name} • ${totalNights} Nights`;

    if (window.plannerSortable) window.plannerSortable.destroy();
    if (typeof Sortable !== 'undefined') {
        window.plannerSortable = Sortable.create(list, {
            handle: '.drag-handle',
            animation: 160,
            delay: 150,
            delayOnTouchOnly: true,
            onEnd: function (evt) {
                const originalStops = [...trip.stops];
                const movedStop = trip.stops.splice(evt.oldIndex, 1)[0];
                trip.stops.splice(evt.newIndex, 0, movedStop);

                if (Array.isArray(trip.places)) {
                    trip.places.forEach(p => {
                        const targetStop = originalStops[p.cityIndex];
                        if (targetStop) {
                            p.cityIndex = trip.stops.findIndex(s => s.id === targetStop.id);
                        }
                    });
                }

                saveTrips();
                renderPlanner();
            }
        });
    }
    drawPlannerMapRoute();
}

export function updateNights(index, delta) {
    const trip = getActiveTrip();
    if (!trip || !trip.stops || !trip.stops[index]) return;
    const stop = trip.stops[index];
    stop.nights = Math.max(0, (Number(stop.nights) || 0) + delta);
    if (!Array.isArray(stop.notes)) stop.notes = [];
    if (stop.notes.length < Math.max(1, stop.nights)) {
        stop.notes.push(...Array(Math.max(1, stop.nights) - stop.notes.length).fill(''));
    }
    saveTrips();
    renderPlanner();
}

export function focusStopOnMap(event, index) {
    if (event) event.stopPropagation();
    const trip = getActiveTrip();
    if (!trip || !trip.stops || !trip.stops[index] || !plannerMap) return;
    const stop = trip.stops[index];
    if (stop.lat === 0 && stop.lon === 0) return;

    plannerMap.flyTo([stop.lat, stop.lon], 11, { duration: 1.2 });
    if (pMarkers && pMarkers[index]) {
        setTimeout(() => {
            if (pMarkers[index] && typeof pMarkers[index].openPopup === 'function') {
                pMarkers[index].openPopup();
            }
        }, 1250);
    }
}

export function deleteStop(index) {
    const trip = getActiveTrip();
    if (!trip || !trip.stops || !trip.stops[index]) return;
    if (confirm(`Remove ${trip.stops[index].name} from itinerary?`)) {
        trip.stops.splice(index, 1);
        if (Array.isArray(trip.places)) {
            trip.places = trip.places
                .filter(p => p.cityIndex !== index)
                .map(p => {
                    if (p.cityIndex > index) p.cityIndex--;
                    return p;
                });
        }
        saveTrips();
        renderPlanner();
        showNotification("Stop removed.");
    }
}

export function optimizeTripRoute() {
    const trip = getActiveTrip();
    if (!trip || !trip.stops || trip.stops.length < 3) {
        showNotification("Add at least 3 stops to auto-optimize.");
        return;
    }

    let startStop = trip.stops[0];
    let unvisited = trip.stops.slice(1);
    let optimized = [startStop];

    while (unvisited.length > 0) {
        let last = optimized[optimized.length - 1];
        let nearestIdx = 0;
        let minDst = Infinity;
        unvisited.forEach((s, idx) => {
            let dst = getDistance(last.lat, last.lon, s.lat, s.lon);
            if (dst < minDst) { minDst = dst; nearestIdx = idx; }
        });
        optimized.push(unvisited.splice(nearestIdx, 1)[0]);
    }

    trip.stops = optimized;
    saveTrips();
    renderPlanner();
    showNotification("✨ Trip route optimized!");
}

function getDistance(lat1, lon1, lat2, lon2) {
    const p = 0.017453292519943295;
    const c = Math.cos;
    const a = 0.5 - c((lat2 - lat1) * p) / 2 + c(lat1 * p) * c(lat2 * p) * (1 - c((lon2 - lon1) * p)) / 2;
    return 12742 * Math.asin(Math.sqrt(a));
}

export function openCitySearchModal() {
    const modal = document.getElementById('city-search-modal');
    if (modal) modal.style.display = 'flex';
    const input = document.getElementById('city-search-input');
    if (input) input.value = '';
    const results = document.getElementById('city-search-results');
    if (results) results.innerHTML = '';
    setTimeout(() => { if (input) input.focus(); }, 150);
}

export function searchCity(query) {
    // Deprecated Nominatim handler - disabled in favor of Google Places Autocomplete
    clearTimeout(citySearchTimeout);
    if (citySearchAbortController) {
        citySearchAbortController.abort();
        citySearchAbortController = null;
    }
    const resultsDiv = document.getElementById('city-search-results');
    if (resultsDiv) {
        resultsDiv.innerHTML = '';
        resultsDiv.style.display = 'none';
    }
}

export function addCityStop(name, lat, lon) {
    const trip = getActiveTrip();
    if (!trip) {
        showNotification("Please select or create a trip first.");
        return;
    }
    if (!Array.isArray(trip.stops)) trip.stops = [];
    if (!Array.isArray(trip.places)) trip.places = [];
    trip.stops.push({
        id: `stop_${Date.now()}`,
        name,
        lat: parseFloat(lat) || 0,
        lon: parseFloat(lon) || 0,
        nights: 2,
        notes: ['', ''],
        transit: null,
        lodging: null
    });
    closeModal('city-search-modal');
    saveTrips();
    renderPlanner();
    showNotification(`Added ${name} to itinerary!`);
}

export function exportTripICS() {
    const trip = getActiveTrip();
    if (!trip || !trip.stops || trip.stops.length === 0) {
        showNotification("No stops to export.");
        return;
    }
    let ics = "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Trippo App//EN\n";
    let currentDate = parseLocalDate(trip.startDate);

    trip.stops.forEach((stop) => {
        if (Number(stop.nights) === 0) return;
        const checkInDate = new Date(currentDate);
        const checkInStr = formatLocalDate(checkInDate).replace(/-/g, '');
        currentDate.setDate(currentDate.getDate() + (Number(stop.nights) || 0));
        const checkOutDate = new Date(currentDate);
        const checkOutStr = formatLocalDate(checkOutDate).replace(/-/g, '');

        ics += "BEGIN:VEVENT\n";
        ics += `SUMMARY:Stay in ${stop.lodging?.name || stop.name}\n`;
        ics += `DTSTART;VALUE=DATE:${checkInStr}\n`;
        ics += `DTEND;VALUE=DATE:${checkOutStr}\n`;
        ics += `DESCRIPTION:${stop.nights} nights.\n`;
        ics += "END:VEVENT\n";
    });
    ics += "END:VCALENDAR";

    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${trip.name.replace(/\s+/g, '_')}_Itinerary.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

export function handleFileImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        const content = e.target.result;
        if (file.name.toLowerCase().endsWith('.ics')) {
            parseICS(content);
        } else if (file.name.toLowerCase().endsWith('.json')) {
            try {
                const data = JSON.parse(content);
                let incomingTrip = data.trip || (data.trips && data.trips[0]) || data;
                if (incomingTrip && incomingTrip.name && Array.isArray(incomingTrip.stops)) {
                    incomingTrip.id = 'trip_' + Date.now();
                    if (!Array.isArray(incomingTrip.places)) incomingTrip.places = [];
                    if (!Array.isArray(incomingTrip.expenses)) incomingTrip.expenses = [];
                    trips.push(incomingTrip);
                    saveTrips();
                    if (window.openTrip) window.openTrip(incomingTrip.id);
                    showNotification(`Imported ${incomingTrip.name}!`);
                }
            } catch (err) {
                showNotification("Error importing JSON file.");
            }
        }
        event.target.value = '';
    };
    reader.readAsText(file);
}

export function parseICS(icsString) {
    const events = icsString.split('BEGIN:VEVENT');
    const trip = getActiveTrip();
    if (!trip) {
        showNotification("Please create or open a trip first.");
        return;
    }
    if (!Array.isArray(trip.stops)) trip.stops = [];
    let imported = 0;
    for (let i = 1; i < events.length; i++) {
        const ev = events[i];
        const summaryMatch = ev.match(/SUMMARY:(.*)/);
        if (summaryMatch) {
            const summary = summaryMatch[1].trim();
            trip.stops.push({
                id: `imp_${Date.now()}_${i}`,
                name: summary,
                lat: 0,
                lon: 0,
                nights: 1,
                notes: ['Imported stop'],
                transit: null,
                lodging: null
            });
            imported++;
        }
    }
    if (imported > 0) {
        saveTrips();
        renderPlanner();
        showNotification(`Imported ${imported} stops!`);
    }
}
