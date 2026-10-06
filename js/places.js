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
    getActiveTrip,
    triggerHaptic,
    escapeHTML,
    escapeJS,
    wishlistPins,
    getCategoryVisuals,
    getDistance,
    calculateTransitEstimate,
    openDirectionsLink
} from './state.js';

import { initPlacesMap, placesMap, safeInvalidate, drawPlacesMapRoute, getStreetViewUrl, openStreetViewModal } from './maps.js';

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
    const trip = trips.find(t => t.id === activePlacesTripId) || getActiveTrip();
    if (!trip) {
        showPlacesMasterList();
        return;
    }
    setActivePlacesTripId(trip.id);
    if (!trip.stops || !trip.stops[stopIndex]) {
        if (trip.stops && trip.stops.length > 0) {
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

    // Dynamically personalize Local Tours & Tickets action card for this city
    const actLink = document.getElementById('places-activities-link');
    if (actLink && stop) {
        actLink.href = `https://www.getyourguide.com/s/?q=${encodeURIComponent(stop.name)}`;
        const actTitle = actLink.querySelector('.action-title');
        if (actTitle) {
            actTitle.innerText = `Find Tours & Tickets in ${stop.name}`;
        }
    }

    [50, 150, 300, 500].forEach(d => safeInvalidate(placesMap, d));
}

export function renderPlacesDayTabs() {
    const trip = trips.find(t => t.id === activePlacesTripId) || getActiveTrip();
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
    triggerHaptic('light');
    setActivePlacesDayIndex(dayIndex);
    renderPlacesDayTabs();
    renderCityPlaces();
}

export { calculateTransitEstimate, openDirectionsLink };

export function setPlaceTransitMode(placeId, mode) {
    const trip = trips.find(t => t.id === activePlacesTripId);
    if (!trip || !Array.isArray(trip.places)) return;
    const normalizedId = String(placeId).replace(/\u2019/g, "'");
    const place = trip.places.find(p => (p.cityIndex === activePlacesStopIndex && p.dayIndex === activePlacesDayIndex) && (String(p.id) === String(placeId) || p.name === placeId || p.name === normalizedId))
        || trip.places.find(p => String(p.id) === String(placeId) || p.name === placeId || p.name === normalizedId);
    if (place) {
        place.transitMode = mode;
        saveTrips();
        triggerHaptic('light');
        renderCityPlaces();
        showNotification(`Commute set to ${mode === 'walking' ? 'Walking 🚶' : (mode === 'driving' ? 'Driving 🚗' : 'Transit 🚆')}`);
    }
}

export function renderCityPlaces() {
    const trip = trips.find(t => t.id === activePlacesTripId) || getActiveTrip();
    if (!trip) return;
    if (!Array.isArray(trip.places)) trip.places = [];

    // Ensure all places have stable unique IDs
    let hasGeneratedId = false;
    trip.places.forEach((p, idx) => {
        if (!p.id) {
            p.id = `poi_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 7)}`;
            hasGeneratedId = true;
        }
    });
    if (hasGeneratedId) saveTrips();

    const container = document.getElementById('saved-places-container');
    if (!container) return;

    const dayPlaces = trip.places.filter(p => p.cityIndex === activePlacesStopIndex && p.dayIndex === activePlacesDayIndex);

    if (dayPlaces.length === 0) {
        container.innerHTML = `
            <div class="ai-empty-day-card">
                <div class="ai-empty-day-sparkle">✨</div>
                <div class="ai-empty-day-title">Plan Day ${activePlacesDayIndex + 1} with AI Copilot</div>
                <div class="ai-empty-day-desc">Get personalized dining recommendations, sightseeing highlights, or a complete timed schedule for this day.</div>
                <button type="button" class="ai-empty-day-action-btn" onclick="openAICopilot(${activePlacesStopIndex}, ${activePlacesDayIndex})">
                    <span>🤖 Open AI Travel Copilot</span>
                </button>
            </div>
        `;
        drawPlacesMapRoute([]);
        return;
    }

    container.innerHTML = dayPlaces.map((p, index) => {
        const isStart = index === 0;
        const badge = isStart ? `<span class="place-category-badge" style="background:var(--accent); color:white;">📍 Starting Base</span>` : `<span class="place-category-badge">${p.category}</span>`;

        let connectorHTML = '';
        if (index > 0) {
            const prev = dayPlaces[index - 1];
            const distKm = getDistance(prev.lat, prev.lon, p.lat, p.lon);
            const currentMode = p.transitMode || (distKm <= 2.0 ? 'walking' : 'driving');
            const transit = calculateTransitEstimate(prev.lat, prev.lon, p.lat, p.lon, currentMode);
            const safePlaceId = escapeJS(p.id || p.name);

            if (transit) {
                connectorHTML = `
                <div class="transit-connector-row">
                    <div class="timeline-dash-line"></div>
                    <div class="transit-pill">
                        <div class="transit-mode-switcher">
                            <button type="button" class="mode-icon-btn ${currentMode === 'walking' ? 'active' : ''}" onclick="event.stopPropagation(); setPlaceTransitMode('${safePlaceId}', 'walking')" title="Walking directions">🚶</button>
                            <button type="button" class="mode-icon-btn ${currentMode === 'driving' ? 'active' : ''}" onclick="event.stopPropagation(); setPlaceTransitMode('${safePlaceId}', 'driving')" title="Driving directions">🚗</button>
                            <button type="button" class="mode-icon-btn ${currentMode === 'transit' ? 'active' : ''}" onclick="event.stopPropagation(); setPlaceTransitMode('${safePlaceId}', 'transit')" title="Transit / Subway directions">🚆</button>
                        </div>
                        <div class="transit-estimate-link" onclick="event.stopPropagation(); openDirectionsLink(${prev.lat}, ${prev.lon}, ${p.lat}, ${p.lon}, '${currentMode}')" title="Open Google Maps in ${currentMode} mode">
                            <span>${transit.text}</span>
                            <span style="font-size:10px; opacity:0.7;">↗</span>
                        </div>
                    </div>
                    <div class="timeline-dash-line"></div>
                </div>`;
            } else {
                connectorHTML = `
                <div class="transit-connector-row mini-connector">
                    <div class="timeline-dash-line short"></div>
                </div>`;
            }
        }

        const safePlaceId = escapeJS(p.id || p.name);
        const safePlaceName = escapeJS(p.name || '');
        const svButton = (p.lat && p.lon) ? `
            <button type="button" class="streetview-btn" onclick="event.stopPropagation(); openStreetViewModal(${Number(p.lat)}, ${Number(p.lon)}, '${safePlaceName}')" title="Street View" style="background:none; border:none; padding:4px 8px; font-size:15px; cursor:pointer; color:var(--primary); opacity:0.85;">👁</button>` : '';

        return `
        ${connectorHTML}
        <div class="place-item-card" data-id="${escapeHTML(p.id || p.name)}" ${isStart ? 'style="border-left: 4px solid var(--accent);"' : ''}>
            <div class="timeline-node-pin ${isStart ? 'start-pin' : ''}">${isStart ? '🏨' : (index + 1)}</div>
            <div class="drag-handle" style="color:${isStart ? 'var(--accent)' : '#b7c7c3'};" title="Drag to reorder">≡</div>
            <div style="flex-grow:1;" onclick="openEditPlaceModal('${safePlaceId}')">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    ${badge}
                    ${svButton}
                </div>
                <h4 style="margin: 0 0 4px 0; font-size: 16px; color: var(--primary); font-weight:700;">${escapeHTML(p.name)}</h4>
                <p style="margin: 0; font-size: 12px; color: #728481;">📍 ${escapeHTML(p.address ? p.address.substring(0, 36) : '')}...</p>
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
                triggerHaptic('medium');
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
    const clearBtn = document.getElementById('clear-place-search-input');
    if (clearBtn) clearBtn.style.display = 'none';
    const results = document.getElementById('place-search-results');
    if (results) results.innerHTML = '';

    const picker = document.getElementById('place-wishlist-picker');
    if (picker) picker.style.display = 'none';
    const toggleBtn = document.getElementById('toggle-wishlist-picker-btn');
    if (toggleBtn) {
        const pinCount = Array.isArray(wishlistPins) ? wishlistPins.length : 0;
        toggleBtn.innerHTML = `<span>🌟</span> Import from Saved Wishlist (<span>${pinCount}</span>) ▾`;
        toggleBtn.style.display = pinCount > 0 ? 'inline-flex' : 'none';
    }

    setTimeout(() => { if (input) input.focus(); }, 150);
}

export function togglePlaceWishlistPicker() {
    const picker = document.getElementById('place-wishlist-picker');
    const btn = document.getElementById('toggle-wishlist-picker-btn');
    if (!picker) return;

    const isHidden = picker.style.display === 'none' || !picker.style.display;
    if (isHidden) {
        populatePlaceWishlistPicker();
        picker.style.display = 'block';
        if (btn) btn.innerHTML = `<span>🌟</span> Hide Wishlist (<span>${Array.isArray(wishlistPins) ? wishlistPins.length : 0}</span>) ▴`;
    } else {
        picker.style.display = 'none';
        if (btn) btn.innerHTML = `<span>🌟</span> Import from Saved Wishlist (<span>${Array.isArray(wishlistPins) ? wishlistPins.length : 0}</span>) ▾`;
    }
}

export function populatePlaceWishlistPicker() {
    const picker = document.getElementById('place-wishlist-picker');
    if (!picker) return;

    if (!wishlistPins || wishlistPins.length === 0) {
        picker.innerHTML = `<div style="padding:10px; font-size:12px; color:#8fa09c; text-align:center;">No saved wishlist places found. Save pins in the Wishlist tab!</div>`;
        return;
    }

    const trip = trips.find(t => t.id === activePlacesTripId);
    const stop = trip && trip.stops && trip.stops[activePlacesStopIndex];
    let sortedPins = [...wishlistPins];
    if (stop && stop.lat && stop.lon) {
        sortedPins.sort((a, b) => {
            const dA = (a.lat && a.lon) ? getDistance(stop.lat, stop.lon, a.lat, a.lon) : 99999;
            const dB = (b.lat && b.lon) ? getDistance(stop.lat, stop.lon, b.lat, b.lon) : 99999;
            return dA - dB;
        });
    }

    picker.innerHTML = sortedPins.map(p => {
        const visuals = getCategoryVisuals(p.category);
        const displayName = escapeHTML(p.name);
        const safeId = escapeJS(p.id);
        const safeNotes = escapeHTML(p.notes || '');

        return `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border-bottom:1px solid var(--border-subtle); gap:8px;">
            <div style="flex:1; min-width:0;">
                <div style="font-weight:700; font-size:13px; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    ${visuals.emoji} ${displayName}
                </div>
                ${safeNotes ? `<div style="font-size:11px; color:#8fa09c; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${safeNotes}</div>` : ''}
            </div>
            <button type="button" onclick="selectWishlistPinForPlace('${safeId}')" style="background:var(--primary); color:white; border:none; padding:5px 12px; border-radius:8px; font-size:11px; font-weight:700; cursor:pointer; flex-shrink:0;">Use ›</button>
        </div>`;
    }).join('');
}

export function selectWishlistPinForPlace(pinId) {
    const pin = wishlistPins.find(p => String(p.id) === String(pinId));
    if (!pin) return;

    selectPOI(pin.name, pin.name, pin.lat || 0, pin.lon || 0);

    const notesInput = document.getElementById('add-poi-notes');
    if (notesInput && pin.notes) {
        notesInput.value = pin.notes;
    }

    const catSelect = document.getElementById('add-poi-category');
    if (catSelect) {
        if (pin.category === 'Food') catSelect.value = '🍽 Food & Drink';
        else catSelect.value = '● See & Do';
    }

    const picker = document.getElementById('place-wishlist-picker');
    if (picker) picker.style.display = 'none';
    const btn = document.getElementById('toggle-wishlist-picker-btn');
    if (btn) btn.innerHTML = `<span>🌟</span> Import from Saved Wishlist (<span>${wishlistPins.length}</span>) ▾`;

    showNotification(`Selected "${pin.name}" from wishlist!`);
}

export function searchPOI(query) {
    clearTimeout(poiSearchTimeout);
    if (poiSearchAbortController) {
        poiSearchAbortController.abort();
        poiSearchAbortController = null;
    }
    const resultsDiv = document.getElementById('place-search-results');
    if (!resultsDiv) return;

    if (!query || query.trim().length < 2) {
        resultsDiv.innerHTML = '';
        resultsDiv.style.display = 'none';
        return;
    }

    poiSearchTimeout = setTimeout(async () => {
        try {
            poiSearchAbortController = new AbortController();
            const trip = trips.find(t => t.id === activePlacesTripId);
            const stop = trip?.stops?.[activePlacesStopIndex];
            
            // Search query with stop name context if available, fallback to pure query
            let searchUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=6`;
            if (stop && stop.name && !query.toLowerCase().includes(stop.name.toLowerCase())) {
                searchUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ' ' + stop.name)}&limit=6`;
            }

            let res = await fetch(searchUrl, { signal: poiSearchAbortController.signal });
            let data = await res.json();

            // If contextual search returned nothing, fallback to global query
            if ((!data || data.length === 0) && stop && stop.name) {
                res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=6`, {
                    signal: poiSearchAbortController.signal
                });
                data = await res.json();
            }

            if (data && data.length > 0) {
                resultsDiv.innerHTML = data.map(item => {
                    const rawName = item.name || item.display_name.split(',')[0];
                    const safeName = escapeJS(rawName);
                    const safeAddr = escapeJS(item.display_name || '');
                    return `
                    <div class="search-result" onclick="selectPOI('${safeName}', '${safeAddr}', ${Number(item.lat)}, ${Number(item.lon)})">
                        <strong>${escapeHTML(rawName)}</strong><br>
                        <small style="color:var(--text-muted, #777);">${escapeHTML(item.display_name.substring(0, 52))}...</small>
                    </div>`;
                }).join('');
                resultsDiv.style.display = 'block';
            } else {
                resultsDiv.innerHTML = `
                    <div style="padding: 12px 16px; font-size: 13px; color: var(--text-muted, #777); text-align: center;">
                        No matches found for "${escapeHTML(query)}". You can fill in the details manually below.
                    </div>`;
                resultsDiv.style.display = 'block';
                const form = document.getElementById('place-add-form');
                if (form) {
                    form.style.display = 'block';
                    const nameInput = document.getElementById('add-poi-name');
                    if (nameInput && !nameInput.value) nameInput.value = query;
                }
            }
        } catch (e) {
            if (e.name !== 'AbortError') {
                console.error("POI search failed:", e);
            }
        }
    }, 300);
}

export function detectCategory(name = '', address = '') {
    const text = `${name} ${address}`.toLowerCase();
    if (/\b(cafe|café|coffee|espresso|bakery|bakehouse|roast|tea|matcha|boba|pastry|patisserie|gelato|ice cream|dessert)\b/i.test(text)) {
        return '☕ Cafe & Chill';
    }
    if (/\b(hotel|hostel|inn|resort|motel|suites|lodge|bed and breakfast|b&b|airbnb|guesthouse|ryokan|stay)\b/i.test(text)) {
        return '🏨 Hotel / Base';
    }
    if (/\b(restaurant|food|bistro|diner|ramen|sushi|pizza|burger|bar|pub|grill|bbq|taco|taqueria|noodles|steak|steakhouse|cantina|brewery|wine|tavern|izakaya|kitchen|brasserie|eatery)\b/i.test(text)) {
        return '🍽 Food & Drink';
    }
    if (/\b(shop|store|mall|market|bazaar|boutique|outlet|supermarket|dept|department store|souvenir|grocer|plaza)\b/i.test(text)) {
        return '🛍 Shopping';
    }
    return '● See & Do';
}
if (typeof window !== 'undefined') {
    window.detectCategory = detectCategory;
}

export function selectPOI(name, address, lat, lon) {
    const results = document.getElementById('place-search-results');
    if (results) {
        results.innerHTML = '';
        results.style.display = 'none';
    }
    const form = document.getElementById('place-add-form');
    if (form) {
        form.style.display = 'block';
        setTimeout(() => {
            form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 60);
    }

    const nameInput = document.getElementById('add-poi-name');
    const addrInput = document.getElementById('add-poi-address');
    const latInput = document.getElementById('add-poi-lat');
    const lonInput = document.getElementById('add-poi-lon');
    const catSelect = document.getElementById('add-poi-category');

    if (nameInput) nameInput.value = name;
    if (addrInput) addrInput.value = address;
    if (latInput) latInput.value = lat;
    if (lonInput) lonInput.value = lon;
    if (catSelect) catSelect.value = detectCategory(name, address);
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
    triggerHaptic('success');
    saveTrips();
    closeModal('place-search-modal');
    renderCityPlaces();
    showNotification(`Added ${name} to Day ${activePlacesDayIndex + 1}!`);
}

export function openEditPlaceModal(placeIdentifier) {
    const trip = trips.find(t => t.id === activePlacesTripId);
    if (!trip || !Array.isArray(trip.places)) return;
    const normalized = String(placeIdentifier).replace(/\u2019/g, "'");
    const place = trip.places.find(p => (String(p.id) === String(placeIdentifier) || p.name === placeIdentifier || p.name === normalized));
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

    // Commute mode from previous stop
    const modeSelect = document.getElementById('edit-poi-transit-mode');
    const modeGroup = document.getElementById('edit-poi-transit-mode-group');
    if (modeSelect && modeGroup) {
        const dayPlaces = trip.places.filter(p => p.cityIndex === activePlacesStopIndex && p.dayIndex === activePlacesDayIndex);
        const isFirst = dayPlaces.length > 0 && (String(dayPlaces[0].id) === String(place.id) || dayPlaces[0].name === place.name);
        if (isFirst) {
            modeGroup.style.display = 'none';
        } else {
            modeGroup.style.display = 'block';
            modeSelect.value = place.transitMode || 'auto';
        }
    }

    // Street View preview in Edit Place Modal
    const svCard = document.getElementById('place-streetview-preview');
    const svImg = document.getElementById('place-streetview-img');
    const svBtn = document.getElementById('place-streetview-full-btn');
    if (svCard && svImg && place.lat && place.lon) {
        svImg.src = getStreetViewUrl(place.lat, place.lon, 600, 240);
        svCard.style.display = 'block';
        if (svBtn) {
            svBtn.onclick = () => openStreetViewModal(place.lat, place.lon, place.name);
        }
    } else if (svCard) {
        svCard.style.display = 'none';
    }

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

    const modeSelect = document.getElementById('edit-poi-transit-mode');
    if (modeSelect && modeSelect.value) {
        if (modeSelect.value === 'auto') {
            delete place.transitMode;
        } else {
            place.transitMode = modeSelect.value;
        }
    }

    setActivePlacesDayIndex(targetDay);
    saveTrips();
    closeModal('edit-place-modal');
    renderPlacesDayTabs();
    renderCityPlaces();
}

export function deletePlaceFromEdit() {
    const trip = trips.find(t => t.id === activePlacesTripId);
    if (!trip || !Array.isArray(trip.places)) return;
    const place = trip.places.find(p => (String(p.id) === String(activeEditPlaceId) || p.name === activeEditPlaceId));
    const placeName = place ? place.name : 'this stop';
    if (!confirm(`Remove "${placeName}" from this day's itinerary?`)) return;
    triggerHaptic('warning');
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
    const hasDate = Boolean(startDateStr && startDateStr.trim());
    let currentD = hasDate ? parseLocalDate(startDateStr) : null;
    const displayDays = Math.max(1, Number(stop.nights) || 1);
    if (!Array.isArray(stop.notes)) stop.notes = [];

    for (let i = 0; i < displayDays; i++) {
        const dayLabel = (hasDate && currentD)
            ? `Day ${i + 1} • ${currentD.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
            : `Day ${i + 1}`;
        html += `
        <div class="form-group" style="margin-bottom: 18px;">
            <label style="color:var(--primary);">${dayLabel}</label>
            <textarea id="note-day-${i}" class="form-control" placeholder="What's planned for Day ${i + 1} in ${escapeHTML(stop.name)}?">${escapeHTML(stop.notes[i] || '')}</textarea>
        </div>`;
        if (currentD) currentD.setDate(currentD.getDate() + 1);
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

if (typeof window !== 'undefined') {
    window.setPlaceTransitMode = setPlaceTransitMode;
}

