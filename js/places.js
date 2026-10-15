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
    openDirectionsLink,
    getTempUnit,
    icon,
    formatTime,
} from './state.js';

import { initPlacesMap, placesMap, safeInvalidate, drawPlacesMapRoute, getStreetViewUrl, openStreetViewModal, hasCoords } from './maps.js';
import { inMainlandChina } from './state.js';
import { ticketLink } from './travel-payouts.js';
import { plannerCardHTML, searchPlacesNear, fmtDur } from './day-planner.js';

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
        <div class="trip-card" onclick="openPlacesForTrip('${escapeJS(String(trip.id))}')">
            <div class="trip-card-content">
                <h3>☀ ${escapeHTML(trip.name)}</h3>
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
    if (btn) { btn.innerHTML = `${icon('window-maximize')}Full Map`; btn.classList.remove('active-mode'); }
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
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,weathercode&timezone=auto&temperature_unit=fahrenheit`);
        const data = await res.json();
        setCityWeather(data.daily);
    } catch (e) {
        setCityWeather(null);
    }
    renderPlacesDayTabs();
}

// --- City picker: the city name opens a small menu of the trip's cities ---
function renderCityMenu(trip, stopIndex) {
    const picker = document.getElementById('places-city-picker');
    const menu = document.getElementById('places-city-menu');
    if (!picker || !menu) return;
    setCityMenuOpen(false);
    const hasChoices = trip.stops.length > 1;
    picker.classList.toggle('has-choices', hasChoices);
    picker.disabled = !hasChoices;
    if (!hasChoices) { menu.innerHTML = ''; return; }

    let d = trip.startDate && trip.startDate.trim() ? parseLocalDate(trip.startDate) : null;
    const fmt = date => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    menu.innerHTML = trip.stops.map((s, idx) => {
        const nights = Math.max(1, Number(s.nights) || 1);
        let when = `${nights} night${nights === 1 ? '' : 's'}`;
        if (d && !isNaN(d)) {
            const end = new Date(d);
            end.setDate(end.getDate() + nights);
            when = `${fmt(d)} – ${fmt(end)} · ${when}`;
            d = end;
        }
        const current = idx === stopIndex;
        return `<button type="button" class="city-menu-item${current ? ' current' : ''}" role="option" aria-selected="${current}" onclick="chooseCityFromMenu(${idx})">
            <span class="city-menu-num">${idx + 1}</span>
            <span class="city-menu-text"><span class="city-menu-name">${escapeHTML(s.name)}</span><span class="city-menu-when">${escapeHTML(when)}</span></span>
            ${current ? '<svg class="city-menu-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}
        </button>`;
    }).join('');
}

function closeCityMenuOnOutside(e) {
    if (!e.target.closest('.city-title-wrap')) setCityMenuOpen(false);
}
function closeCityMenuOnEscape(e) {
    if (e.key === 'Escape') { setCityMenuOpen(false); document.getElementById('places-city-picker')?.focus(); }
}

function setCityMenuOpen(open) {
    const picker = document.getElementById('places-city-picker');
    const menu = document.getElementById('places-city-menu');
    if (!picker || !menu) return;
    menu.classList.toggle('open', open);
    picker.setAttribute('aria-expanded', String(open));
    document.removeEventListener('pointerdown', closeCityMenuOnOutside, true);
    document.removeEventListener('keydown', closeCityMenuOnEscape);
    if (open) {
        document.addEventListener('pointerdown', closeCityMenuOnOutside, true);
        document.addEventListener('keydown', closeCityMenuOnEscape);
    }
}

export function toggleCityMenu(e) {
    if (e) e.stopPropagation();
    const picker = document.getElementById('places-city-picker');
    const menu = document.getElementById('places-city-menu');
    if (!menu || !picker || picker.disabled) return;
    triggerHaptic('light');
    setCityMenuOpen(!menu.classList.contains('open'));
}

export function chooseCityFromMenu(index) {
    setCityMenuOpen(false);
    if (index !== activePlacesStopIndex) openPlacesCityView(index);
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
    renderCityMenu(trip, stopIndex);

    initPlacesMap();
    setCityWeather(null);
    renderPlacesDayTabs();
    fetchCityWeather(stop.lat, stop.lon);
    renderCityPlaces();

    // Dynamically personalize Local Tours & Tickets action card for this city
    const actLink = document.getElementById('places-activities-link');
    if (actLink && stop) {
        actLink.href = ticketLink('', stop.name.split(',')[0], stop.lat, stop.lon);
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
            const tF = cityWeather.temperature_2m_max[i];
            const temp = getTempUnit() === 'C' ? Math.round((tF - 32) * 5 / 9) : Math.round(tF);
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
    if (String(placeId) === HOTEL_ID) {
        // the way to the booked stay (it isn't one of the day's places)
        const stop = trip.stops && trip.stops[activePlacesStopIndex];
        if (stop && stop.lodging) {
            stop.lodging.transitMode = mode;
            saveTrips();
            renderCityPlaces();
        }
        return;
    }
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

// --- Day bases: the hotel starts every day in a city; an airport or station first on day 1 is the arrival ---
const HOTEL_ID = '__hotel__';
const HUB_PATTERNS = [
    ['plane', /\b(airport|aeropuerto|aeroporto|a[ée]roport|flughafen|airfield)\b|机场|空港/i],
    ['train', /\b(railway station|train station|rail station|high[- ]speed rail(way)? station|(north|south|east|west) (railway )?station)\b|火车站|高铁站/i],
    ['bus', /\b(bus station|bus terminal|coach station|coach terminal)\b|汽车站|客运站/i]
];
const HUB_WORDS = { plane: 'airport', train: 'station', bus: 'bus station' };

export function hubKind(place) {
    const text = `${(place && place.name) || ''} ${(place && place.localName) || ''}`;
    const hit = HUB_PATTERNS.find(([, re]) => re.test(text));
    return hit ? hit[0] : '';
}

const isHotelPlace = p => !!p && (p.category === '🏨 Hotel / Base' || detectCategory(p.name || '') === '🏨 Hotel / Base');
const simpleName = s => String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
function sameName(a, b) {
    const x = simpleName(a), y = simpleName(b);
    return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 6 && (x.includes(y) || y.includes(x))));
}

// Where the traveller sleeps in this city: the booked stay, else a hotel saved as one of the city's places
export function cityHotel(trip, cityIndex) {
    const stop = trip && trip.stops && trip.stops[cityIndex];
    if (!stop) return null;
    const cityPlaces = (trip.places || []).filter(p => p.cityIndex === cityIndex);
    const l = stop.lodging;
    if (l && l.name) {
        // a stay saved without looking up its address sits on the city center, so it has no real spot
        const located = hasCoords(l) && !(Number(l.lat) === Number(stop.lat) && Number(l.lon) === Number(stop.lon));
        const named = cityPlaces.find(p => sameName(p.name, l.name) && hasCoords(p));
        if (!located && named) return { ...named, fromPlace: true };
        return { id: HOTEL_ID, name: l.name, address: l.address || '', lat: located ? Number(l.lat) : null, lon: located ? Number(l.lon) : null, transitMode: l.transitMode, category: '🏨 Hotel / Base', fromLodging: true };
    }
    const saved = cityPlaces.find(p => isHotelPlace(p) && hasCoords(p));
    return saved ? { ...saved, fromPlace: true } : null;
}

function isTheHotel(place, hotel) {
    if (!place || !hotel) return false;
    if (hotel.fromPlace && String(place.id) === String(hotel.id)) return true;
    if (sameName(place.name, hotel.name)) return true;
    return isHotelPlace(place) && hasCoords(place) && hasCoords(hotel) && getDistance(place.lat, place.lon, hotel.lat, hotel.lon) < 0.08;
}

// A day's stops in display order: [arrival airport/station] → hotel (locked) → activities numbered 1, 2, 3…
export function buildDayStops(trip, cityIndex, dayIndex) {
    const stop = trip.stops[cityIndex];
    const numDays = Math.max(1, Number(stop.nights) || 1);
    const inLeg = cityIndex > 0 && trip.stops[cityIndex - 1] ? trip.stops[cityIndex - 1].transit : null;
    const items = (trip.places || []).filter(p => p.cityIndex === cityIndex && p.dayIndex === dayIndex).map(place => ({ place, kind: 'place' }));
    items.forEach((it, i) => {
        let hub = hubKind(it.place);
        if (!hub && i === 0 && dayIndex === 0 && inLeg && (inLeg.method === 'train' || inLeg.method === 'bus') && /station|terminal|站/i.test(it.place.name || '')) hub = inLeg.method;
        if (!hub) return;
        it.kind = 'hub';
        it.hub = hub;
        it.role = i === 0 && dayIndex === 0 ? 'arrival' : i === items.length - 1 && dayIndex === numDays - 1 ? 'departure' : '';
    });
    const lead = items.length && items[0].role === 'arrival' ? [items.shift()] : [];
    const hotel = cityHotel(trip, cityIndex);
    let base = null;
    if (hotel) {
        const at = items.findIndex(it => it.kind === 'place' && isTheHotel(it.place, hotel));
        base = at >= 0 ? items.splice(at, 1)[0] : { place: hotel, virtual: true };
        base.kind = 'hotel';
        // coming back to the hotel later in the day keeps the hotel pin
        items.forEach(it => { if (it.kind === 'place' && isTheHotel(it.place, hotel)) it.kind = 'hotel'; });
    } else if (!lead.length && items.length && items[0].kind === 'place') {
        // no hotel known: the first place is the starting base, as before
        base = items.shift();
        base.kind = 'hotel';
        base.guessed = true;
    }
    if (base) {
        base.locked = true;
        base.isBase = true;
    }
    lead.forEach(it => { it.locked = true; });
    const out = [...lead, ...(base ? [base] : []), ...items];
    let n = 0;
    out.forEach(it => { if (it.kind === 'place') it.num = ++n; });
    return out;
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

    const dayStops = trip.stops && trip.stops[activePlacesStopIndex] ? buildDayStops(trip, activePlacesStopIndex, activePlacesDayIndex) : [];
    const emptyNote = `<div class="empty-day-note">No stops planned for Day ${activePlacesDayIndex + 1} yet.</div>`;

    if (dayStops.length === 0) {
        // Keep the empty day quiet; the ✨ AI Copilot button in the header is the way into Copilot
        container.innerHTML = emptyNote;
        drawPlacesMapRoute([]);
        return;
    }

    container.innerHTML = dayStops.map((it, index) => {
        const p = it.place;
        let badge = `<span class="place-category-badge">${p.category || ''}</span>`;
        let pin = `<div class="timeline-node-pin">${it.num || index + 1}</div>`;
        let cardClass = '';
        if (it.kind === 'hotel') {
            pin = `<div class="timeline-node-pin start-pin">${icon('bed', 'ico-only')}</div>`;
            if (it.isBase) {
                badge = it.guessed
                    ? `<span class="place-category-badge is-base">${icon('home')}Starting Base</span>`
                    : `<span class="place-category-badge is-base" title="Your hotel starts every day in this city">${icon('lock')}Your hotel · starting base</span>`;
                cardClass = ' is-base-card';
            } else {
                badge = `<span class="place-category-badge is-base">${icon('bed')}Back to your hotel</span>`;
            }
        } else if (it.kind === 'hub') {
            const word = HUB_WORDS[it.hub] || 'station';
            const label = it.role === 'arrival' ? `Arrival ${word}` : it.role === 'departure' ? `Departure ${word}` : word.charAt(0).toUpperCase() + word.slice(1);
            pin = `<div class="timeline-node-pin hub-pin">${icon(it.hub, 'ico-only')}</div>`;
            badge = `<span class="place-category-badge is-hub">${icon(it.hub)}${label}</span>`;
            cardClass = ' is-hub-card';
        }

        let connectorHTML = '';
        const prev = index > 0 ? dayStops[index - 1].place : null;
        if (prev) {
            const located = hasCoords(prev) && hasCoords(p);
            const distKm = located ? getDistance(prev.lat, prev.lon, p.lat, p.lon) : 0;
            const currentMode = p.transitMode || (distKm <= 2.0 ? 'walking' : 'driving');
            const transit = located ? calculateTransitEstimate(prev.lat, prev.lon, p.lat, p.lon, currentMode) : null;
            const safePlaceId = escapeJS(p.id || p.name);

            if (transit) {
                connectorHTML = `
                <div class="transit-connector-row">
                    <div class="timeline-dash-line"></div>
                    <div class="transit-pill">
                        <div class="transit-mode-switcher">
                            <button type="button" class="mode-icon-btn ${currentMode === 'walking' ? 'active' : ''}" onclick="event.stopPropagation(); setPlaceTransitMode('${safePlaceId}', 'walking')" title="Walking directions"><svg class="ico ico-only" aria-hidden="true"><use href="#i-walk"></use></svg></button>
                            <button type="button" class="mode-icon-btn ${currentMode === 'driving' ? 'active' : ''}" onclick="event.stopPropagation(); setPlaceTransitMode('${safePlaceId}', 'driving')" title="Driving directions"><svg class="ico ico-only" aria-hidden="true"><use href="#i-car"></use></svg></button>
                            <button type="button" class="mode-icon-btn ${currentMode === 'transit' ? 'active' : ''}" onclick="event.stopPropagation(); setPlaceTransitMode('${safePlaceId}', 'transit')" title="Transit / Subway directions"><svg class="ico ico-only" aria-hidden="true"><use href="#i-train"></use></svg></button>
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
        const svButton = hasCoords(p) ? `
            <button type="button" class="streetview-btn" onclick="event.stopPropagation(); openStreetViewModal(${Number(p.lat)}, ${Number(p.lon)}, '${safePlaceName}')" title="Street View" style="background:none; border:none; padding:4px 8px; font-size:15px; cursor:pointer; color:var(--primary); opacity:0.85;"><svg class="ico ico-only" aria-hidden="true"><use href="#i-eye"></use></svg></button>` : '';
        const handle = it.locked
            ? `<div class="drag-handle is-locked-handle" title="${it.kind === 'hub' ? 'Arrival stays first' : 'Your hotel stays first every day'}">${icon('lock', 'ico-only')}</div>`
            : `<div class="drag-handle" style="color:${it.kind === 'place' ? '#b7c7c3' : 'var(--accent)'};" title="Drag to reorder">≡</div>`;
        const chips = !it.virtual && (p.ticketed || p.localName || inMainlandChina(p.lat, p.lon)) ? `<div class="place-chip-row">
                    ${p.localName || inMainlandChina(p.lat, p.lon) ? `<button type="button" class="place-chip" onclick="event.stopPropagation(); openDriverCard('${safePlaceId}')"><svg class="ico" aria-hidden="true"><use href="#i-language"></use></svg>Driver card</button>` : ''}
                    ${p.ticketed ? `<a class="place-chip" href="${escapeHTML(ticketLink(p.name, trip.stops[p.cityIndex] ? trip.stops[p.cityIndex].name : '', p.lat, p.lon))}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()"><svg class="ico" aria-hidden="true"><use href="#i-ticket"></use></svg>Tickets</a>` : ''}
                </div>` : '';

        return `
        ${connectorHTML}
        <div class="place-item-card${cardClass}${it.locked ? ' is-locked' : ''}" data-id="${escapeHTML(String(p.id || p.name))}"${it.virtual ? '' : ` data-place-id="${escapeHTML(String(p.id))}"`}>
            ${pin}
            ${handle}
            <div style="flex-grow:1;" onclick="openDayStop('${safePlaceId}')">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    ${badge}
                    ${svButton}
                </div>
                ${p.time && !it.virtual ? `<div class="place-time">${icon('clock')}${escapeHTML(formatTime(p.time))}${Number(p.duration) > 0 ? ` · ${fmtDur(Number(p.duration))}` : ''}</div>` : ''}
                <h4 style="margin: 0 0 4px 0; font-size: 16px; color: var(--primary); font-weight:700;">${escapeHTML(p.name)}</h4>
                ${p.localName ? `<span class="place-local-name">${escapeHTML(p.localName)}</span>` : ''}
                ${p.address ? `<p style="margin: 0; font-size: 12px; color: #728481;"><svg class="ico" aria-hidden="true"><use href="#i-map-pin"></use></svg>${escapeHTML(p.address.substring(0, 36))}${p.address.length > 36 ? '...' : ''}</p>` : ''}
                ${chips}
            </div>
        </div>`;
    }).join('') + (dayStops.some(it => it.kind === 'place') ? '' : emptyNote);

    if (window.placesSortable) window.placesSortable.destroy();
    if (typeof Sortable !== 'undefined') {
        window.placesSortable = Sortable.create(container, {
            handle: '.drag-handle',
            draggable: '.place-item-card:not(.is-locked)',
            // nothing goes above the arrival point or the hotel
            onMove: evt => !(evt.related && evt.related.classList.contains('is-locked')),
            animation: 160,
            delay: 150,
            delayOnTouchOnly: true,
            onEnd: function () {
                triggerHaptic('medium');
                const order = [...container.querySelectorAll('.place-item-card[data-place-id]')].map(el => el.dataset.placeId);
                const day = trip.places.filter(p => p.cityIndex === activePlacesStopIndex && p.dayIndex === activePlacesDayIndex);
                const byId = new Map(day.map(p => [String(p.id), p]));
                const sorted = order.map(id => byId.get(id)).filter(Boolean);
                day.forEach(p => { if (!sorted.includes(p)) sorted.push(p); });
                trip.places = [...trip.places.filter(p => !day.includes(p)), ...sorted];
                saveTrips();
                renderCityPlaces();
            }
        });
    }
    drawPlacesMapRoute(dayStops.map(it => ({ ...it.place, _kind: it.kind, _hub: it.hub || '', _num: it.num || 0 })));
}

// The booked stay opens its booking; a place opens its editor
export function openDayStop(placeId) {
    if (String(placeId) === HOTEL_ID) {
        if (window.openLodgingModal) window.openLodgingModal(activePlacesStopIndex);
        return;
    }
    openEditPlaceModal(placeId);
}

export function optimizeCityRoute() {
    const trip = trips.find(t => t.id === activePlacesTripId);
    if (!trip || !Array.isArray(trip.places) || !trip.stops || !trip.stops[activePlacesStopIndex]) return;
    const dayStops = buildDayStops(trip, activePlacesStopIndex, activePlacesDayIndex);
    const movable = dayStops.filter(it => it.kind === 'place' && hasCoords(it.place)).map(it => it.place);
    if (movable.length < 2) {
        showNotification("Add at least 2 places to this day to auto-optimize.");
        return;
    }

    // Start from the hotel (or whatever fixed stop comes right before the activities)
    const firstIdx = dayStops.findIndex(it => it.kind === 'place' && hasCoords(it.place));
    const start = dayStops.slice(0, firstIdx).reverse().find(it => hasCoords(it.place));
    const unvisited = [...movable];
    const optimized = start ? [] : [unvisited.shift()];
    let last = start ? start.place : optimized[0];
    while (unvisited.length > 0) {
        let nearestIdx = 0;
        let minDst = Infinity;
        unvisited.forEach((p, idx) => {
            const dst = getDistance(last.lat, last.lon, p.lat, p.lon);
            if (dst < minDst) { minDst = dst; nearestIdx = idx; }
        });
        last = unvisited.splice(nearestIdx, 1)[0];
        optimized.push(last);
    }

    // The activities take the new order; the arrival point, hotel and anything unmapped keep their slots
    let k = 0;
    const order = dayStops.filter(it => !it.virtual).map(it => (it.kind === 'place' && hasCoords(it.place) ? optimized[k++] : it.place));
    const day = trip.places.filter(p => p.cityIndex === activePlacesStopIndex && p.dayIndex === activePlacesDayIndex);
    day.forEach(p => { if (!order.includes(p)) order.push(p); });
    trip.places = [...trip.places.filter(p => !day.includes(p)), ...order];
    saveTrips();
    renderCityPlaces();
    showNotification(start && start.kind === 'hotel' ? "✨ Route optimized from your hotel!" : "✨ Route optimized from Starting Base!");
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
    // A new search starts clean (the last place's name and pin used to carry over)
    ['add-poi-name', 'add-poi-address', 'add-poi-notes', 'add-poi-lat', 'add-poi-lon', 'add-poi-time'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    fillAddPlaceDays();

    const picker = document.getElementById('place-wishlist-picker');
    if (picker) picker.style.display = 'none';
    const toggleBtn = document.getElementById('toggle-wishlist-picker-btn');
    if (toggleBtn) {
        const pinCount = Array.isArray(wishlistPins) ? wishlistPins.length : 0;
        toggleBtn.innerHTML = `<span><svg class="ico ico-only" aria-hidden="true"><use href="#i-heart"></use></svg></span> Import from Saved Wishlist (<span>${pinCount}</span>) ▾`;
        toggleBtn.style.display = pinCount > 0 ? 'inline-flex' : 'none';
    }

    setTimeout(() => { if (input) input.focus(); }, 150);
}

function fillAddPlaceDays() {
    const sel = document.getElementById('add-poi-day');
    const btn = document.getElementById('add-poi-save-btn');
    if (!sel) return;
    const trip = trips.find(t => t.id === activePlacesTripId);
    const stop = trip && trip.stops && trip.stops[activePlacesStopIndex];
    const n = Math.max(1, stop ? Number(stop.nights) || 1 : 1);
    sel.innerHTML = Array.from({ length: n }, (_, i) => `<option value="${i}"${i === activePlacesDayIndex ? ' selected' : ''}>Day ${i + 1}</option>`).join('');
    const label = () => { if (btn) btn.textContent = `Add to Day ${Number(sel.value) + 1}`; };
    sel.onchange = label;
    label();
}

// Place suggestions while typing (OpenStreetMap's Photon, biased to this city; works in mainland China too)
function attachPlaceSuggest(input, onPick) {
    if (!input || input.dataset.suggest) return;
    input.dataset.suggest = '1';
    const box = document.createElement('div');
    box.className = 'dp-ac place-suggest';
    box.style.display = 'none';
    input.insertAdjacentElement('afterend', box);
    const keep = e => e.preventDefault();
    box.addEventListener('mousedown', keep);
    box.addEventListener('pointerdown', keep);
    const hide = () => { box.style.display = 'none'; box.innerHTML = ''; };
    let timer = null, seq = 0;
    input.addEventListener('input', () => {
        clearTimeout(timer);
        const q = input.value.trim();
        if (q.length < 2) { hide(); return; }
        const my = ++seq;
        timer = setTimeout(async () => {
            const trip = trips.find(t => t.id === activePlacesTripId);
            const stop = (trip && trip.stops && trip.stops[activePlacesStopIndex]) || { name: '' };
            let list = [];
            try { list = await searchPlacesNear(q, stop); } catch (e) { list = []; }
            if (my !== seq || document.activeElement !== input) return;
            if (!list.length) { hide(); return; }
            box._list = list;
            box.innerHTML = list.map((r, i) => `<button type="button" class="dp-ac-item" data-i="${i}">${icon('map-pin')}<span><strong>${escapeHTML(r.name)}</strong>${r.sub ? `<small>${escapeHTML(r.sub)}</small>` : ''}</span></button>`).join('');
            box.style.display = 'flex';
        }, 280);
    });
    box.addEventListener('click', e => {
        const b = e.target.closest('.dp-ac-item');
        if (!b) return;
        const r = box._list[Number(b.dataset.i)];
        hide();
        if (r) onPick(r);
    });
    input.addEventListener('blur', () => setTimeout(hide, 150));
}

// A place saved without a location sits on the city centre until OpenStreetMap finds it
async function locatePlaceLater(trip, place, stop) {
    if (!hasCoords(stop) || !place.name) return;
    try {
        const box = `${stop.lon - 0.5},${Number(stop.lat) + 0.5},${Number(stop.lon) + 0.5},${stop.lat - 0.5}`;
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(place.name)}&viewbox=${box}&bounded=1`, { headers: { 'Accept-Language': 'en' } });
        const hit = res.ok ? (await res.json())[0] : null;
        if (!hit || !(trip.places || []).includes(place)) return;
        place.lat = Number(hit.lat);
        place.lon = Number(hit.lon);
        if (!place.address || place.address === stop.name) place.address = String(hit.display_name || '').split(',').slice(0, 3).join(',').trim();
        saveTrips();
        if (activePlacesTripId === trip.id) renderCityPlaces();
    } catch (e) { /* stays on the city centre; the user can still edit it */ }
}

export function togglePlaceWishlistPicker() {
    const picker = document.getElementById('place-wishlist-picker');
    const btn = document.getElementById('toggle-wishlist-picker-btn');
    if (!picker) return;

    const isHidden = picker.style.display === 'none' || !picker.style.display;
    if (isHidden) {
        populatePlaceWishlistPicker();
        picker.style.display = 'block';
        if (btn) btn.innerHTML = `<span><svg class="ico ico-only" aria-hidden="true"><use href="#i-heart"></use></svg></span> Hide Wishlist (<span>${Array.isArray(wishlistPins) ? wishlistPins.length : 0}</span>) ▴`;
    } else {
        picker.style.display = 'none';
        if (btn) btn.innerHTML = `<span><svg class="ico ico-only" aria-hidden="true"><use href="#i-heart"></use></svg></span> Import from Saved Wishlist (<span>${Array.isArray(wishlistPins) ? wishlistPins.length : 0}</span>) ▾`;
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
    if (btn) btn.innerHTML = `<span><svg class="ico ico-only" aria-hidden="true"><use href="#i-heart"></use></svg></span> Import from Saved Wishlist (<span>${wishlistPins.length}</span>) ▾`;

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

    const q = String(query || '').trim();
    if (q.length < 2) {
        resultsDiv.innerHTML = '';
        resultsDiv.style.display = 'none';
        return;
    }

    poiSearchTimeout = setTimeout(async () => {
        const ctrl = new AbortController();
        poiSearchAbortController = ctrl;
        const trip = trips.find(t => t.id === activePlacesTripId);
        const stop = trip?.stops?.[activePlacesStopIndex];
        let list = [];
        try {
            list = await searchPlacesNear(q, stop || { name: '' });
        } catch (e) {
            // Photon unreachable: one OpenStreetMap search near the city instead
            try {
                const near = stop && hasCoords(stop) ? `&viewbox=${stop.lon - 0.5},${Number(stop.lat) + 0.5},${Number(stop.lon) + 0.5},${stop.lat - 0.5}&bounded=1` : '';
                const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(q)}${near}`, { signal: ctrl.signal });
                const data = res.ok ? await res.json() : [];
                list = (Array.isArray(data) ? data : []).map(d => ({
                    name: d.name || String(d.display_name || '').split(',')[0],
                    sub: String(d.display_name || '').split(',').slice(1, 4).join(',').trim(),
                    address: d.display_name || '', lat: Number(d.lat), lon: Number(d.lon)
                }));
            } catch (err) {
                if (err.name === 'AbortError') return;
            }
        }
        if (ctrl !== poiSearchAbortController) return;
        resultsDiv.innerHTML = list.map(r => `
            <div class="search-result" onclick="selectPOI('${escapeJS(r.name)}', '${escapeJS(r.address || r.sub || '')}', ${Number(r.lat)}, ${Number(r.lon)})">
                <strong>${escapeHTML(r.name)}</strong><br>
                <small style="color:var(--text-muted, #777);">${escapeHTML(r.sub || '')}</small>
            </div>`).join('') + `
            <div class="search-result search-result-typed" onclick="addPOIAsTyped()">
                <strong>${icon('pencil')}Add “${escapeHTML(q)}” as written</strong><br>
                <small style="color:var(--text-muted, #777);">${list.length ? 'Not in the list? ' : 'No matches on the map. '}Trippo pins it as close as it can.</small>
            </div>`;
        resultsDiv.style.display = 'block';
    }, 300);
}

// Use exactly what was typed (no search result picked)
export function addPOIAsTyped() {
    const q = document.getElementById('place-search-input')?.value.trim() || '';
    if (!q) return;
    selectPOI(q, '', '', '');
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

    const located = !isNaN(rawLat) && !isNaN(rawLon) && !(rawLat === 0 && rawLon === 0);
    const finalLat = located ? rawLat : parentStop.lat;
    const finalLon = located ? rawLon : parentStop.lon;
    const pickedDay = parseInt(document.getElementById('add-poi-day')?.value, 10);
    const dayIndex = Number.isInteger(pickedDay) ? pickedDay : activePlacesDayIndex;
    const time = document.getElementById('add-poi-time')?.value || '';

    if (!Array.isArray(trip.places)) trip.places = [];
    const place = {
        id: `poi_${Date.now()}_${Math.random()}`,
        cityIndex: activePlacesStopIndex,
        dayIndex,
        name: name,
        category: document.getElementById('add-poi-category')?.value || '● See & Do',
        address: document.getElementById('add-poi-address')?.value || parentStop.name,
        notes: document.getElementById('add-poi-notes')?.value || '',
        lat: finalLat,
        lon: finalLon
    };
    if (time) place.time = time;
    trip.places.push(place);
    triggerHaptic('success');
    saveTrips();
    closeModal('place-search-modal');
    if (dayIndex !== activePlacesDayIndex) {
        setActivePlacesDayIndex(dayIndex);
        renderPlacesDayTabs();
    }
    renderCityPlaces();
    showNotification(`Added ${name} to Day ${dayIndex + 1}!`);
    if (!located) locatePlaceLater(trip, place, parentStop);
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
    if (catInput) catInput.value = place.category || '● See & Do';
    if (addrInput) addrInput.value = place.address || '';
    if (notesInput) notesInput.value = place.notes || '';
    const timeInput = document.getElementById('edit-poi-time');
    if (timeInput) timeInput.value = /^\d{1,2}:\d{2}$/.test(String(place.time || '')) ? String(place.time).padStart(5, '0') : '';
    const durSelect = document.getElementById('edit-poi-duration');
    if (durSelect) {
        const d = Number(place.duration) || 0;
        if (d && ![...durSelect.options].some(o => Number(o.value) === d)) durSelect.add(new Option(fmtDur(d), String(d)));
        durSelect.value = d ? String(d) : '';
    }
    const latInput = document.getElementById('edit-poi-lat');
    const lonInput = document.getElementById('edit-poi-lon');
    if (latInput) latInput.value = '';
    if (lonInput) lonInput.value = '';
    // Picking a suggestion renames the stop and moves its pin there
    attachPlaceSuggest(nameInput, r => {
        nameInput.value = r.name;
        const a = document.getElementById('edit-poi-address');
        if (a) a.value = r.address || r.sub || '';
        const la = document.getElementById('edit-poi-lat'), lo = document.getElementById('edit-poi-lon');
        if (la) la.value = r.lat;
        if (lo) lo.value = r.lon;
    });

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
    const time = document.getElementById('edit-poi-time')?.value || '';
    if (time) place.time = time; else delete place.time;
    const duration = parseInt(document.getElementById('edit-poi-duration')?.value, 10);
    if (duration > 0) place.duration = duration; else delete place.duration;
    const newLat = parseFloat(document.getElementById('edit-poi-lat')?.value);
    const newLon = parseFloat(document.getElementById('edit-poi-lon')?.value);
    if (Number.isFinite(newLat) && Number.isFinite(newLon)) {
        place.lat = newLat;
        place.lon = newLon;
        delete place.localName; // the local-language name belonged to the old place
    }

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

    // "Plan my days" list on top, the per-day notes below it
    let html = plannerCardHTML(index, stop) + `<div class="day-notes-heading">Day notes</div>`;
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

