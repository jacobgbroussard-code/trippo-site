/* ==========================================================================
   Trippo Travel Planner - Daily Places & City Itinerary Management
   js/places.js
   ========================================================================== */

import {
    trips,
    saveTrips,
    activePlacesTripId,
    setActivePlacesTripId,
    activePlacesStopIndex,
    setActivePlacesStopIndex,
    activePlacesDayIndex,
    setActivePlacesDayIndex,
    activeEditPlaceId,
    setActiveEditPlaceId,
    activeStopIndex,
    setActiveStopIndex,
    cityWeather,
    setCityWeather,
    showNotification,
    closeModal,
    parseLocalDate,
    getActiveTrip
} from './state.js';

import { initPlacesMap, placesMap, safeInvalidate, drawPlacesMapRoute } from './maps.js';

export let poiSearchTimeout = null;
let poiSearchAbortController = null;

export function renderPlacesMasterList() {
    if (window.placesSortable) {
        window.placesSortable.destroy();
        window.placesSortable = null;
    }
    const masterList = document.getElementById('places-master-list');
    const tripDetail = document.getElementById('places-trip-detail-list');
    const cityView = document.getElementById('places-city-view');

    if (masterList) masterList.style.display = 'block';
    if (tripDetail) tripDetail.style.display = 'none';
    if (cityView) cityView.style.display = 'none';

    const listEl = document.getElementById('places-trip-list');
    if (!listEl) return;

    if (!trips || trips.length === 0) {
        listEl.innerHTML = `<p style="text-align:center; color:#8fa09c; margin-top:40px; font-size:14px;">No trips created yet.<br>Go to Trips to create your first trip!</p>`;
        return;
    }

    listEl.innerHTML = trips.map(trip => `
        <div class="trip-card" onclick="openPlacesForTrip('${trip.id}')">
            <div class="trip-card-content">
                <h3>☀ ${trip.name}</h3>
                <p>${trip.stops ? trip.stops.length : 0} Cities • ${trip.places ? trip.places.length : 0} Saved Places</p>
            </div>
            <div style="color: #b7c7c3; font-size:22px;">›</div>
        </div>
    `).join('');
}

export function openPlacesForTrip(tripId) {
    if (window.placesSortable) {
        window.placesSortable.destroy();
        window.placesSortable = null;
    }
    setActivePlacesTripId(tripId);
    const trip = trips.find(t => t.id === tripId);
    if (!trip) {
        showPlacesMasterList();
        return;
    }
    if (!Array.isArray(trip.stops) || trip.stops.length === 0) {
        showNotification("This trip has no cities yet. Add a stop in Route!");
        if (window.switchTab) window.switchTab('planner');
        return;
    }
    const stopIdx = (activePlacesStopIndex >= 0 && activePlacesStopIndex < trip.stops.length) ? activePlacesStopIndex : 0;
    openPlacesCityView(stopIdx);
}

export function openPlacesTripDetail(tripId) {
    openPlacesForTrip(tripId);
}

export function showPlacesMasterList() {
    const placesView = document.getElementById('places-view');
    const cityView = document.getElementById('places-city-view');
    if (placesView) placesView.classList.remove('has-city-open');
    if (cityView) cityView.classList.remove('map-expanded');
    const btn = document.getElementById('places-fullscreen-btn');
    if (btn) { btn.innerHTML = '⛶ Full Map'; btn.classList.remove('active-mode'); }
    renderPlacesMasterList();
}

export function showPlacesTripDetailList() {
    showPlacesMasterList();
}

export function getWeatherEmoji(code) {
    if ([0].includes(code)) return '☀';
    if ([1, 2, 3].includes(code)) return '⛅';
    if ([45, 48].includes(code)) return '🌫️';
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '🌧';
    if ([71, 73, 75, 77, 85, 86].includes(code)) return '❄';
    if ([95, 96, 99].includes(code)) return '⛈';
    return '🌥';
}

export async function fetchCityWeather(lat, lon) {
    try {
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,weathercode&timezone=auto`);
        const data = await res.json();
        setCityWeather(data.daily);
    } catch (e) {
        setCityWeather(null);
    }
    renderPlacesDayTabs();
}

export function openPlacesCityView(stopIndex) {
    const trip = trips.find(t => t.id === activePlacesTripId);
    if (!trip || !trip.stops || !trip.stops[stopIndex]) {
        if (trip && trip.stops && trip.stops.length > 0) {
            stopIndex = 0;
        } else {
            showPlacesMasterList();
            return;
        }
    }
    setActivePlacesStopIndex(stopIndex);
    setActivePlacesDayIndex(0);

    const placesView = document.getElementById('places-view');
    if (placesView) placesView.classList.add('has-city-open');

    // CRITICAL: Hide master list AND trip detail list to prevent visual overlap
    const masterList = document.getElementById('places-master-list');
    const tripDetail = document.getElementById('places-trip-detail-list');
    const cityView = document.getElementById('places-city-view');

    if (masterList) masterList.style.display = 'none';
    if (tripDetail) tripDetail.style.display = 'none';
    if (cityView) cityView.style.display = 'flex';

    const stop = trip.stops[stopIndex];
    const cityTitle = document.getElementById('places-city-title');
    if (cityTitle) cityTitle.innerText = stop.name;

    const colCityName = document.getElementById('places-collapsed-city-name');
    if (colCityName) colCityName.innerText = stop.name;

    // City selector dropdown if multiple stops
    const citySelect = document.getElementById('places-city-select');
    if (citySelect) {
        if (trip.stops.length > 1) {
            citySelect.style.display = 'inline-block';
            citySelect.innerHTML = trip.stops.map((s, idx) => `
                <option value="${idx}" ${idx === stopIndex ? 'selected' : ''}>📍 ${s.name}</option>
            `).join('');
        } else {
            citySelect.style.display = 'none';
        }
    }

    initPlacesMap();
    setCityWeather(null);
    renderPlacesDayTabs();
    fetchCityWeather(stop.lat, stop.lon);
    renderCityPlaces();
    [50, 150, 300, 500].forEach(d => safeInvalidate(placesMap, d));
}

export function renderPlacesDayTabs() {
    const trip = trips.find(t => t.id === activePlacesTripId);
    if (!trip || !trip.stops || !trip.stops[activePlacesStopIndex]) return;
    const stop = trip.stops[activePlacesStopIndex];
    const numDays = Math.max(1, Number(stop.nights) || 1);

    let tabsHTML = '';
    for (let i = 0; i < numDays; i++) {
        let weatherStr = '';
        if (cityWeather && cityWeather.temperature_2m_max && cityWeather.temperature_2m_max[i] !== undefined) {
            const temp = Math.round(cityWeather.temperature_2m_max[i]);
            const emoji = getWeatherEmoji(cityWeather.weathercode[i]);
            weatherStr = `<span style="font-weight:normal; margin-left:6px; opacity:0.8;">${emoji} ${temp}°</span>`;
        }
        tabsHTML += `<button class="day-tab ${i === activePlacesDayIndex ? 'active' : ''}" onclick="switchPlacesDay(${i})">Day ${i + 1}${weatherStr}</button>`;
    }
    const tabsContainer = document.getElementById('places-day-tabs');
    if (tabsContainer) tabsContainer.innerHTML = tabsHTML;
}

export function switchPlacesDay(dayIndex) {
    setActivePlacesDayIndex(dayIndex);
    renderPlacesDayTabs();
    renderCityPlaces();
}

export function renderCityPlaces() {
    const trip = trips.find(t => t.id === activePlacesTripId);
    if (!trip) return;
    if (!Array.isArray(trip.places)) trip.places = [];
    const container = document.getElementById('saved-places-container');
    if (!container) return;

    const dayPlaces = trip.places.filter(p => p.cityIndex === activePlacesStopIndex && p.dayIndex === activePlacesDayIndex);

    if (dayPlaces.length === 0) {
        container.innerHTML = `<p style="text-align:center; color:#8fa09c; margin-top:35px; font-size:14px;">No places added for Day ${activePlacesDayIndex + 1} yet.<br>Tap '+ Add Place' above to start routing.</p>`;
        drawPlacesMapRoute([]);
        return;
    }

    container.innerHTML = dayPlaces.map((p, index) => {
        const isStart = index === 0;
        const badge = isStart ? `<span class="place-category-badge" style="background:var(--accent); color:white;">📍 Starting Base</span>` : `<span class="place-category-badge">${p.category}</span>`;

        return `
        <div class="place-item-card" data-id="${p.id || p.name}" ${isStart ? 'style="border-left: 4px solid var(--accent);"' : ''}>
            <div class="drag-handle" style="color:${isStart ? 'var(--accent)' : '#b7c7c3'};">≡</div>
            <div style="flex-grow:1;" onclick="openEditPlaceModal('${p.id || p.name}')">
                ${badge}
                <h4 style="margin: 0 0 4px 0; font-size: 16px; color: var(--primary); font-weight:700;">${p.name}</h4>
                <p style="margin: 0; font-size: 12px; color: #728481;">📍 ${p.address ? p.address.substring(0, 36) : ''}...</p>
            </div>
        </div>`;
    }).join('');

    if (window.placesSortable) window.placesSortable.destroy();
    if (typeof Sortable !== 'undefined') {
        window.placesSortable = Sortable.create(container, {
            handle: '.drag-handle',
            animation: 160,
            delay: 150,
            delayOnTouchOnly: true,
            onEnd: function (evt) {
                let matchingPlaces = [];
                let otherPlaces = [];
                trip.places.forEach(p => {
                    if (p.cityIndex === activePlacesStopIndex && p.dayIndex === activePlacesDayIndex) {
                        matchingPlaces.push(p);
                    } else {
                        otherPlaces.push(p);
                    }
                });
                const movedItem = matchingPlaces.splice(evt.oldIndex, 1)[0];
                matchingPlaces.splice(evt.newIndex, 0, movedItem);
                trip.places = [...otherPlaces, ...matchingPlaces];
                saveTrips();
                renderCityPlaces();
            }
        });
    }
    drawPlacesMapRoute(dayPlaces);
}

function getDistance(lat1, lon1, lat2, lon2) {
    const p = 0.017453292519943295;
    const c = Math.cos;
    const a = 0.5 - c((lat2 - lat1) * p) / 2 + c(lat1 * p) * c(lat2 * p) * (1 - c((lon2 - lon1) * p)) / 2;
    return 12742 * Math.asin(Math.sqrt(a));
}

export function optimizeCityRoute() {
    const trip = trips.find(t => t.id === activePlacesTripId);
    if (!trip || !Array.isArray(trip.places)) return;
    let dayPlaces = trip.places.filter(p => p.cityIndex === activePlacesStopIndex && p.dayIndex === activePlacesDayIndex);
    if (dayPlaces.length < 3) {
        showNotification("Add at least 3 places to this day to auto-optimize.");
        return;
    }

    let unvisited = [...dayPlaces];
    let optimized = [unvisited.shift()];

    while (unvisited.length > 0) {
        let last = optimized[optimized.length - 1];
        let nearestIdx = 0;
        let minDst = Infinity;
        unvisited.forEach((p, idx) => {
            let dst = getDistance(last.lat, last.lon, p.lat, p.lon);
            if (dst < minDst) { minDst = dst; nearestIdx = idx; }
        });
        optimized.push(unvisited.splice(nearestIdx, 1)[0]);
    }

    let otherPlaces = trip.places.filter(p => !(p.cityIndex === activePlacesStopIndex && p.dayIndex === activePlacesDayIndex));
    trip.places = [...otherPlaces, ...optimized];
    saveTrips();
    renderCityPlaces();
    showNotification("✨ Route optimized from Starting Base!");
}

export function openPlaceSearchModal() {
    const modal = document.getElementById('place-search-modal');
    if (modal) modal.style.display = 'flex';
    const form = document.getElementById('place-add-form');
    if (form) form.style.display = 'none';
    const input = document.getElementById('place-search-input');
    if (input) input.value = '';
    const results = document.getElementById('place-search-results');
    if (results) results.innerHTML = '';
    setTimeout(() => { if (input) input.focus(); }, 150);
}

export function searchPOI(query) {
    // Deprecated Nominatim handler - disabled in favor of Google Places Autocomplete
    clearTimeout(poiSearchTimeout);
    if (poiSearchAbortController) {
        poiSearchAbortController.abort();
        poiSearchAbortController = null;
    }
    const resultsDiv = document.getElementById('place-search-results');
    if (resultsDiv) {
        resultsDiv.innerHTML = '';
        resultsDiv.style.display = 'none';
    }
}

export function selectPOI(name, address, lat, lon) {
    const results = document.getElementById('place-search-results');
    if (results) results.innerHTML = '';
    const form = document.getElementById('place-add-form');
    if (form) form.style.display = 'block';

    const nameInput = document.getElementById('add-poi-name');
    const addrInput = document.getElementById('add-poi-address');
    const latInput = document.getElementById('add-poi-lat');
    const lonInput = document.getElementById('add-poi-lon');

    if (nameInput) nameInput.value = name;
    if (addrInput) addrInput.value = address;
    if (latInput) latInput.value = lat;
    if (lonInput) lonInput.value = lon;
}

export function saveNewPlaceToTrip() {
    const trip = trips.find(t => t.id === activePlacesTripId);
    if (!trip) return;
    const nameEl = document.getElementById('add-poi-name');
    const name = nameEl ? nameEl.value.trim() : '';
    if (!name) {
        showNotification("Place name cannot be empty.");
        return;
    }

    const rawLat = parseFloat(document.getElementById('add-poi-lat')?.value);
    const rawLon = parseFloat(document.getElementById('add-poi-lon')?.value);
    const parentStop = (trip.stops && trip.stops[activePlacesStopIndex]) || { lat: 0, lon: 0, name: '' };

    const finalLat = (!isNaN(rawLat) && rawLat !== 0) ? rawLat : parentStop.lat;
    const finalLon = (!isNaN(rawLon) && rawLon !== 0) ? rawLon : parentStop.lon;

    if (!Array.isArray(trip.places)) trip.places = [];
    trip.places.push({
        id: `poi_${Date.now()}_${Math.random()}`,
        cityIndex: activePlacesStopIndex,
        dayIndex: activePlacesDayIndex,
        name: name,
        category: document.getElementById('add-poi-category')?.value || '● See & Do',
        address: document.getElementById('add-poi-address')?.value || parentStop.name,
        notes: document.getElementById('add-poi-notes')?.value || '',
        lat: finalLat,
        lon: finalLon
    });
    saveTrips();
    closeModal('place-search-modal');
    renderCityPlaces();
    showNotification(`Added ${name} to Day ${activePlacesDayIndex + 1}!`);
}

export function openEditPlaceModal(placeIdentifier) {
    const trip = trips.find(t => t.id === activePlacesTripId);
    if (!trip || !Array.isArray(trip.places)) return;
    const place = trip.places.find(p => (String(p.id) === String(placeIdentifier) || p.name === placeIdentifier));
    if (!place) return;
    setActiveEditPlaceId(place.id || place.name);

    const stop = trip.stops && trip.stops[activePlacesStopIndex];
    let daySelectHTML = '';
    const numDays = Math.max(1, stop ? Number(stop.nights) || 1 : 1);
    for (let i = 0; i < numDays; i++) {
        daySelectHTML += `<option value="${i}" ${place.dayIndex === i ? 'selected' : ''}>Day ${i + 1}</option>`;
    }
    const daySelect = document.getElementById('edit-poi-day');
    if (daySelect) daySelect.innerHTML = daySelectHTML;

    const nameInput = document.getElementById('edit-poi-name');
    const catInput = document.getElementById('edit-poi-category');
    const addrInput = document.getElementById('edit-poi-address');
    const notesInput = document.getElementById('edit-poi-notes');

    if (nameInput) nameInput.value = place.name;
    if (catInput) catInput.value = place.category;
    if (addrInput) addrInput.value = place.address;
    if (notesInput) notesInput.value = place.notes || '';

    const modal = document.getElementById('edit-place-modal');
    if (modal) modal.style.display = 'flex';
}

export function savePlaceEdits() {
    const trip = trips.find(t => t.id === activePlacesTripId);
    if (!trip || !Array.isArray(trip.places)) return;
    const place = trip.places.find(p => (String(p.id) === String(activeEditPlaceId) || p.name === activeEditPlaceId));
    if (!place) return;

    const name = document.getElementById('edit-poi-name')?.value.trim();
    if (!name) {
        showNotification("Place name cannot be empty.");
        return;
    }

    place.name = name;
    place.category = document.getElementById('edit-poi-category')?.value;
    const targetDay = parseInt(document.getElementById('edit-poi-day')?.value, 10);
    place.dayIndex = targetDay;
    place.address = document.getElementById('edit-poi-address')?.value || '';
    place.notes = document.getElementById('edit-poi-notes')?.value || '';

    setActivePlacesDayIndex(targetDay);
    saveTrips();
    closeModal('edit-place-modal');
    renderPlacesDayTabs();
    renderCityPlaces();
}

export function deletePlaceFromEdit() {
    const trip = trips.find(t => t.id === activePlacesTripId);
    if (!trip || !Array.isArray(trip.places)) return;
    trip.places = trip.places.filter(p => !(String(p.id) === String(activeEditPlaceId) || p.name === activeEditPlaceId));
    saveTrips();
    closeModal('edit-place-modal');
    renderCityPlaces();
    showNotification("Place removed.");
}

export function openDailyNotes(index, startDateStr) {
    setActiveStopIndex(index);
    const trip = getActiveTrip();
    if (!trip || !trip.stops || !trip.stops[index]) return;
    const stop = trip.stops[index];

    const titleEl = document.getElementById('notes-city-title');
    if (titleEl) titleEl.innerText = `${stop.name} Planner`;

    let html = '';
    let currentD = parseLocalDate(startDateStr);
    const displayDays = Math.max(1, Number(stop.nights) || 1);
    if (!Array.isArray(stop.notes)) stop.notes = [];

    for (let i = 0; i < displayDays; i++) {
        html += `
        <div class="form-group" style="margin-bottom: 18px;">
            <label style="color:var(--primary);">Day ${i + 1} • ${currentD.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</label>
            <textarea id="note-day-${i}" class="form-control" placeholder="What's planned for today in ${stop.name}?">${stop.notes[i] || ''}</textarea>
        </div>`;
        currentD.setDate(currentD.getDate() + 1);
    }
    const container = document.getElementById('daily-notes-container');
    if (container) container.innerHTML = html;
    const modal = document.getElementById('daily-notes-modal');
    if (modal) modal.style.display = 'flex';
}

export function saveDailyNotes() {
    const trip = getActiveTrip();
    if (!trip || activeStopIndex === null || !trip.stops || !trip.stops[activeStopIndex]) return;
    const stop = trip.stops[activeStopIndex];
    const displayDays = Math.max(1, Number(stop.nights) || 1);
    if (!Array.isArray(stop.notes)) stop.notes = [];
    for (let i = 0; i < displayDays; i++) {
        const el = document.getElementById(`note-day-${i}`);
        stop.notes[i] = el ? el.value : '';
    }
    saveTrips();
    closeModal('daily-notes-modal');
    showNotification("Daily activities saved!");
}
