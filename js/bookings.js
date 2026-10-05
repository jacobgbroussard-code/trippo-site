/* ==========================================================================
   Trippo Travel Planner - Stays, Lodging & Transit Management
   js/bookings.js
   ========================================================================== */

import {
    trips,
    getActiveTrip,
    saveTrips,
    activeTripId,
    setActiveTripId,
    setActivePlacesTripId,
    activeLodgingStopIndex,
    setActiveLodgingStopIndex,
    activeTransitIndex,
    setActiveTransitIndex,
    parseLocalDate,
    formatLocalDate,
    showNotification,
    closeModal,
    escapeHTML,
    escapeJS,
    triggerHaptic
} from './state.js';

import { openPlacesCityView } from './places.js';
import { drawPlannerMapRoute, getStreetViewUrl, openStreetViewModal } from './maps.js';
import { getHotelPricingInsights } from './travel-payouts.js';

export let hotelSearchTimeout = null;
let hotelSearchAbortController = null;
export let transitSearchTimeouts = { dep: null, arr: null };
let transitSearchAbortControllers = { dep: null, arr: null };

/* --- LODGING / STAYS MANAGEMENT --- */
export function jumpToDailyFromStay(stopIndex) {
    const selectEl = document.getElementById('booking-trip-select');
    const selectedTripId = selectEl ? selectEl.value : activeTripId;
    const trip = trips.find(t => t.id === selectedTripId) || getActiveTrip();

    if (!trip || !trip.stops || !trip.stops[stopIndex]) return;

    setActiveTripId(trip.id);
    setActivePlacesTripId(trip.id);

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(v => v.classList.remove('active'));

    const placesView = document.getElementById('places-view');
    const navPlaces = document.getElementById('nav-places');
    if (placesView) placesView.classList.add('active');
    if (navPlaces) navPlaces.classList.add('active');

    openPlacesCityView(stopIndex);
}

export function renderBookingsView() {
    const selectEl = document.getElementById('booking-trip-select');
    if (selectEl) {
        selectEl.innerHTML = trips.map(t => `<option value="${escapeJS(t.id)}" ${t.id === activeTripId ? 'selected' : ''}>${escapeHTML(t.name)}</option>`).join('');
    }
    renderBookingsList();
}

export function renderBookingsList() {
    const selectEl = document.getElementById('booking-trip-select');
    const trip = trips.find(t => t.id === (selectEl ? selectEl.value : activeTripId));
    const container = document.getElementById('bookings-list-container');
    if (!container) return;

    if (!trip) {
        container.innerHTML = '<p style="text-align:center; color:#8fa09c; margin-top:35px;">No trips found. Create a trip first!</p>';
        return;
    }

    const hasDate = Boolean(trip.startDate && trip.startDate.trim());
    let currentDate = hasDate ? parseLocalDate(trip.startDate) : new Date();
    let html = '';

    if (!Array.isArray(trip.stops)) trip.stops = [];

    trip.stops.forEach((stop, index) => {
        if (Number(stop.nights) === 0) return;
        const checkIn = new Date(currentDate);
        currentDate.setDate(currentDate.getDate() + (Number(stop.nights) || 0));
        const checkOut = new Date(currentDate);

        const inStr = formatLocalDate(checkIn);
        const outStr = formatLocalDate(checkOut);
        const cityEnc = encodeURIComponent(stop.name);
        const safeStopName = escapeHTML(stop.name);

        let lodgingCardHTML = '';
        if (stop.lodging && stop.lodging.name) {
            const l = stop.lodging;
            const safeLName = escapeHTML(l.name);
            const safeLConf = l.bookingNumber ? escapeHTML(l.bookingNumber) : '';
            const safeLAddr = l.address ? escapeHTML(l.address) : '';
            const safeLCheckIn = escapeHTML(l.checkInTime || '3:00 PM');
            const safeLNotes = l.notes ? escapeHTML(l.notes) : '';

            lodgingCardHTML = `
            <div class="confirmed-card" onclick="openLodgingModal(${index})">
                <div class="confirmed-header">
                    <span>🏨 CONFIRMED STAY</span>
                    <span>${safeLConf ? '#' + safeLConf : 'Details ›'}</span>
                </div>
                <div class="confirmed-title">${safeLName}</div>
                ${safeLAddr ? `<div class="confirmed-sub">📍 ${safeLAddr}</div>` : ''}
                <div class="confirmed-sub" style="margin-top:4px;">🕒 Check-in: ${safeLCheckIn}</div>
                ${safeLNotes ? `<div class="confirmed-notes">"${safeLNotes}"</div>` : ''}
                <button type="button" onclick="event.stopPropagation(); jumpToDailyFromStay(${index})" style="background:var(--card-bg); border:1.5px solid var(--primary); color:var(--primary); font-size:12px; font-weight:700; padding:6px 12px; border-radius:10px; cursor:pointer; margin-top:10px;">🗺️ View on Daily Map</button>
            </div>`;
        } else {
            lodgingCardHTML = `<button class="dashed-add-btn" style="margin-bottom: 14px;" onclick="openLodgingModal(${index})">+ Add Confirmed Stay & Notes</button>`;
        }

        const hotelInfo = getHotelPricingInsights(safeStopName, inStr, outStr);
        const dateSubStr = hasDate
            ? `${checkIn.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${checkOut.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} • ${stop.nights} nights`
            : `Dates TBD • ${stop.nights} nights`;

        html += `
        <div style="background: var(--card-bg); border-radius: 18px; padding: 20px; margin-bottom: 20px; border: 1px solid var(--border-subtle); box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 4px;">
                <h4 style="margin: 0; font-size: 18px; font-weight:700;">Stay in ${safeStopName}</h4>
                <span class="flight-deal-price-badge" style="font-size:11px;" title="Estimated nightly hotel rate">Est. ${hotelInfo.estimatedNightly}/nt</span>
            </div>
            <span style="color: #728481; font-size: 13px; display: block; margin-bottom: 16px;">${dateSubStr}</span>
            
            ${lodgingCardHTML}

            <div class="hotel-partner-row">
                <span class="hotel-partner-label">Compare Rates</span>
                <div class="hotel-partner-chips">
                    <a href="${hotelInfo.hotellookUrl}" target="_blank" rel="noopener noreferrer" class="hotel-partner-chip featured" title="Compare 50+ providers including Booking.com & Agoda">
                        🏨 Hotellook Deals ›
                    </a>
                    <a href="${hotelInfo.bookingUrl}" target="_blank" rel="noopener noreferrer" class="hotel-partner-chip" title="Search Booking.com">
                        Booking.com
                    </a>
                    <a href="${hotelInfo.tripUrl}" target="_blank" rel="noopener noreferrer" class="hotel-partner-chip" title="Search Trip.com">
                        Trip.com
                    </a>
                    <a href="${hotelInfo.expediaUrl}" target="_blank" rel="noopener noreferrer" class="hotel-partner-chip" title="Search Expedia">
                        Expedia
                    </a>
                </div>
            </div>
        </div>`;
    });

    if (trip.stops.length === 0) {
        const defaultHotelInfo = getHotelPricingInsights('Hotels');
        html = `
        <div style="text-align: center; color: #8fa09c; padding: 40px 20px;">
            <p style="font-size: 15px; font-weight: 700; margin-bottom: 4px;">No destinations added yet</p>
            <p style="font-size: 13px; margin-bottom: 16px;">Add destinations in the Planner or search accommodations directly below:</p>
            <div style="display:flex; justify-content:center; gap:8px; flex-wrap:wrap;">
                <a href="${defaultHotelInfo.hotellookUrl}" target="_blank" rel="noopener noreferrer" class="hotel-partner-chip featured" style="padding:8px 14px; font-size:12px;">🏨 Hotellook (50+ Sites) ›</a>
                <a href="${defaultHotelInfo.bookingUrl}" target="_blank" rel="noopener noreferrer" class="hotel-partner-chip" style="padding:8px 14px; font-size:12px;">Booking.com</a>
                <a href="${defaultHotelInfo.tripUrl}" target="_blank" rel="noopener noreferrer" class="hotel-partner-chip" style="padding:8px 14px; font-size:12px;">Trip.com</a>
            </div>
        </div>`;
    }
    container.innerHTML = html;

    // Dynamically personalize car rental action card
    const carLink = document.getElementById('bookings-car-link');
    if (carLink) {
        if (trip && trip.stops && trip.stops.length > 0) {
            const firstCity = trip.stops[0].name;
            const carTitle = carLink.querySelector('.action-title');
            if (carTitle) {
                carTitle.innerText = `Compare Rental Cars in ${firstCity} (DiscoverCars)`;
            }
            carLink.style.display = 'flex';
        } else {
            carLink.style.display = 'none';
        }
    }
}

export function openLodgingModal(index) {
    const trip = getActiveTrip();
    if (!trip || !trip.stops || !trip.stops[index]) return;

    setActiveLodgingStopIndex(index);
    const stop = trip.stops[index];

    const hasDate = Boolean(trip.startDate && trip.startDate.trim());
    let checkInDate = hasDate ? parseLocalDate(trip.startDate) : new Date();
    for (let i = 0; i < index; i++) checkInDate.setDate(checkInDate.getDate() + (Number(trip.stops[i].nights) || 0));
    let checkOutDate = new Date(checkInDate);
    checkOutDate.setDate(checkOutDate.getDate() + (Number(stop.nights) || 0));

    const cityEl = document.getElementById('hotel-modal-city');
    const datesEl = document.getElementById('hotel-modal-dates');
    if (cityEl) cityEl.innerText = `${stop.name} Stay Details`;
    if (datesEl) {
        datesEl.innerText = hasDate
            ? `${checkInDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${checkOutDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} • ${stop.nights} Nights`
            : `Dates TBD • ${stop.nights} Nights`;
    }

    const l = stop.lodging || { name: '', bookingNumber: '', address: '', checkInTime: '3:00 PM', url: '', notes: '', lat: stop.lat, lon: stop.lon };

    const nameInput = document.getElementById('hotel-name-input');
    const confInput = document.getElementById('hotel-conf-input');
    const timeInput = document.getElementById('hotel-checkin-time');
    const addrInput = document.getElementById('hotel-address-input');
    const urlInput = document.getElementById('hotel-url-input');
    const notesInput = document.getElementById('hotel-notes-input');
    const latInput = document.getElementById('hotel-lat-input');
    const lonInput = document.getElementById('hotel-lon-input');

    if (nameInput) nameInput.value = l.name || '';
    if (confInput) confInput.value = l.bookingNumber || '';
    if (timeInput) timeInput.value = l.checkInTime || '3:00 PM';
    if (addrInput) addrInput.value = l.address || '';
    if (urlInput) urlInput.value = l.url || '';
    if (notesInput) notesInput.value = l.notes || '';
    if (latInput) latInput.value = l.lat || stop.lat;
    if (lonInput) lonInput.value = l.lon || stop.lon;

    const svCard = document.getElementById('hotel-streetview-preview');
    const svImg = document.getElementById('hotel-streetview-img');
    const svLat = l.lat || stop.lat;
    const svLon = l.lon || stop.lon;
    if (svCard && svImg && svLat && svLon) {
        svImg.src = getStreetViewUrl(svLat, svLon, 600, 240);
        svCard.style.display = 'block';
    } else if (svCard) {
        svCard.style.display = 'none';
    }

    const clearBtn = document.getElementById('clear-hotel-address-input');
    if (clearBtn) clearBtn.style.display = (l.address && l.address.length > 0) ? 'flex' : 'none';

    const results = document.getElementById('hotel-address-results');
    if (results) results.style.display = 'none';
    const modal = document.getElementById('hotel-booking-modal');
    if (modal) modal.style.display = 'flex';
}

export function searchHotelAddress(query) {
    clearTimeout(hotelSearchTimeout);
    if (hotelSearchAbortController) {
        hotelSearchAbortController.abort();
        hotelSearchAbortController = null;
    }
    const resultsDiv = document.getElementById('hotel-address-results');
    if (!resultsDiv) return;

    if (!query || query.trim().length < 2) {
        resultsDiv.innerHTML = '';
        resultsDiv.style.display = 'none';
        return;
    }

    hotelSearchTimeout = setTimeout(async () => {
        try {
            hotelSearchAbortController = new AbortController();
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`, {
                signal: hotelSearchAbortController.signal
            });
            const data = await res.json();
            if (data && data.length > 0) {
                resultsDiv.innerHTML = data.map(item => {
                    const rawName = item.name || item.display_name.split(',')[0];
                    const safeAddr = escapeJS(item.display_name || '');
                    const displayName = escapeHTML(rawName);
                    const safeDesc = escapeHTML((item.display_name || '').substring(0, 48));
                    return `
                    <div class="autocomplete-item" onclick="selectHotelAddress('${safeAddr}', ${item.lat}, ${item.lon})">
                        <strong>${displayName}</strong><br>
                        <small style="color:var(--text-muted, #777);">${safeDesc}...</small>
                    </div>`;
                }).join('');
                resultsDiv.style.display = 'block';
            } else {
                resultsDiv.innerHTML = `<div style="padding: 10px; font-size: 13px; color: var(--text-muted, #777); text-align: center;">No addresses found for "${escapeHTML(query)}"</div>`;
                resultsDiv.style.display = 'block';
            }
        } catch (e) {
            if (e.name !== 'AbortError') {
                console.error("Hotel address search error", e);
            }
        }
    }, 300);
}

export function selectHotelAddress(addr, lat, lon) {
    const addrInput = document.getElementById('hotel-address-input');
    const latInput = document.getElementById('hotel-lat-input');
    const lonInput = document.getElementById('hotel-lon-input');
    if (addrInput) addrInput.value = addr;
    if (latInput) latInput.value = lat;
    if (lonInput) lonInput.value = lon;

    const svCard = document.getElementById('hotel-streetview-preview');
    const svImg = document.getElementById('hotel-streetview-img');
    if (svCard && svImg && lat && lon) {
        svImg.src = getStreetViewUrl(lat, lon, 600, 240);
        svCard.style.display = 'block';
    }

    const results = document.getElementById('hotel-address-results');
    if (results) results.style.display = 'none';
}

export function saveLodgingBooking() {
    const trip = getActiveTrip();
    if (!trip || activeLodgingStopIndex === null || !trip.stops || !trip.stops[activeLodgingStopIndex]) return;
    const stop = trip.stops[activeLodgingStopIndex];
    const name = document.getElementById('hotel-name-input')?.value.trim();
    const address = document.getElementById('hotel-address-input')?.value.trim();
    const lat = parseFloat(document.getElementById('hotel-lat-input')?.value) || stop.lat;
    const lon = parseFloat(document.getElementById('hotel-lon-input')?.value) || stop.lon;

    if (!name) {
        showNotification("Please enter a hotel name.");
        return;
    }

    stop.lodging = {
        name: name,
        bookingNumber: document.getElementById('hotel-conf-input')?.value.trim() || '',
        checkInTime: document.getElementById('hotel-checkin-time')?.value.trim() || '3:00 PM',
        address: address || '',
        url: document.getElementById('hotel-url-input')?.value.trim() || '',
        notes: document.getElementById('hotel-notes-input')?.value.trim() || '',
        lat: lat,
        lon: lon
    };

    saveTrips();
    closeModal('hotel-booking-modal');
    renderBookingsList();
    showNotification(`Saved stay for ${stop.name}!`);
}

export function deleteLodgingBooking() {
    const trip = getActiveTrip();
    if (!trip || activeLodgingStopIndex === null || !trip.stops || !trip.stops[activeLodgingStopIndex]) return;
    const stop = trip.stops[activeLodgingStopIndex];
    const hotelName = stop.lodging?.name || 'this lodging';
    if (!confirm(`Are you sure you want to remove ${hotelName} from your trip?`)) return;
    triggerHaptic('warning');
    trip.stops[activeLodgingStopIndex].lodging = null;
    saveTrips();
    closeModal('hotel-booking-modal');
    renderBookingsList();
    showNotification("Lodging details cleared.");
}

/* --- TRANSIT VIEW --- */
export function renderTransitView() {
    const selectEl = document.getElementById('transit-trip-select');
    if (selectEl) {
        selectEl.innerHTML = trips.map(t => `<option value="${escapeJS(t.id)}" ${t.id === activeTripId ? 'selected' : ''}>${escapeHTML(t.name)}</option>`).join('');
    }
    renderTransitList();
}

export function setTripFlightType(isRound) {
    const selectEl = document.getElementById('transit-trip-select');
    const trip = trips.find(t => t.id === (selectEl ? selectEl.value : activeTripId));
    if (!trip) return;
    trip.isRoundTrip = isRound;
    saveTrips();
    renderTransitList();
    showNotification(isRound ? "Itinerary set to Round-Trip" : "Itinerary set to One-Way / Multi-Leg");
}

export function toggleSegmentFlightType(index) {
    const selectEl = document.getElementById('transit-trip-select');
    const trip = trips.find(t => t.id === (selectEl ? selectEl.value : activeTripId));
    if (!trip) return;
    if (!Array.isArray(trip.roundTripSegments)) trip.roundTripSegments = [];
    if (!Array.isArray(trip.oneWaySegments)) trip.oneWaySegments = [];

    const isExplicitRound = trip.roundTripSegments.includes(index);
    if (isExplicitRound) {
        trip.roundTripSegments = trip.roundTripSegments.filter(idx => idx !== index);
        if (!trip.oneWaySegments.includes(index)) trip.oneWaySegments.push(index);
    } else {
        trip.oneWaySegments = trip.oneWaySegments.filter(idx => idx !== index);
        if (!trip.roundTripSegments.includes(index)) trip.roundTripSegments.push(index);
    }
    saveTrips();
    renderTransitList();
}

export function renderTransitList() {
    const selectEl = document.getElementById('transit-trip-select');
    const trip = trips.find(t => t.id === (selectEl ? selectEl.value : activeTripId));
    const container = document.getElementById('transit-list-container');
    if (!container) return;

    if (!trip) {
        container.innerHTML = '<p style="text-align:center; color:#8fa09c; margin-top:35px;">No trips found. Create a trip first!</p>';
        return;
    }

    const stops = Array.isArray(trip.stops) ? trip.stops : [];
    let html = '';

    // Itinerary flight type banner if at least 2 stops
    if (stops.length >= 2) {
        const isTripRound = Boolean(trip.isRoundTrip);
        html += `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; background:var(--card-bg); padding:12px 16px; border-radius:14px; border:1px solid var(--border-subtle); flex-wrap:wrap; gap:10px;">
            <div>
                <strong style="font-size:13px; color:var(--text); display:block;">Flight Itinerary Mode</strong>
                <span style="font-size:11px; color:#728481;">${isTripRound ? 'Round-Trip Itinerary enabled' : 'Single segments searched as One-Way'}</span>
            </div>
            <div style="display:flex; gap:6px;">
                <button type="button" class="type-pill ${!isTripRound ? 'active' : ''}" onclick="setTripFlightType(false)">➡️ One-Way Legs</button>
                <button type="button" class="type-pill ${isTripRound ? 'active' : ''}" onclick="setTripFlightType(true)">🔁 Round-Trip</button>
            </div>
        </div>`;
    }

    for (let i = 0; i < stops.length - 1; i++) {
        const stopA = stops[i];
        const stopB = stops[i + 1];

        let departureDate = parseLocalDate(trip.startDate);
        for (let k = 0; k <= i; k++) {
            departureDate.setDate(departureDate.getDate() + (Number(stops[k].nights) || 0));
        }

        const calcDateStr = formatLocalDate(departureDate);
        let returnDate = new Date(departureDate);
        returnDate.setDate(returnDate.getDate() + (Number(stopB.nights) || 0));
        const returnDateStr = formatLocalDate(returnDate);

        const origEnc = encodeURIComponent(stopA.name);
        const destEnc = encodeURIComponent(stopB.name);
        const safeStopAName = escapeHTML(stopA.name);
        const safeStopBName = escapeHTML(stopB.name);

        // Determine if this segment should search as Round-Trip or One-Way
        const isExplicitRound = Array.isArray(trip.roundTripSegments) && trip.roundTripSegments.includes(i);
        const isExplicitOneWay = Array.isArray(trip.oneWaySegments) && trip.oneWaySegments.includes(i);
        
        let isRound = false;
        if (isExplicitRound) {
            isRound = true;
        } else if (isExplicitOneWay) {
            isRound = false;
        } else {
            // A 2-stop trip marked as round-trip defaults to round-trip.
            // Multi-segment trips (>2 stops) default each single segment to ONE-WAY!
            isRound = Boolean(trip.isRoundTrip && stops.length === 2);
        }

        let tripFlightUrl = '';
        let googleFlightUrl = '';

        if (isRound) {
            tripFlightUrl = `https://us.trip.com/flights/?dcity=${origEnc}&acity=${destEnc}&ddate=${calcDateStr}&rdate=${returnDateStr}&triptype=rt`;
            googleFlightUrl = `https://www.google.com/travel/flights?q=round%20trip%20flights%20from%20${origEnc}%20to%20${destEnc}%20departing%20${calcDateStr}%20returning%20${returnDateStr}`;
        } else {
            tripFlightUrl = `https://us.trip.com/flights/?dcity=${origEnc}&acity=${destEnc}&ddate=${calcDateStr}&triptype=ow`;
            googleFlightUrl = `https://www.google.com/travel/flights?q=one%20way%20flights%20from%20${origEnc}%20to%20${destEnc}%20on%20${calcDateStr}`;
        }

        let bookingHTML = '';
        if (stopA.transit && stopA.transit.method) {
            const emojis = { plane: '✈️', train: '🚆', bus: '🚌', car: '🚗' };
            const tr = stopA.transit;
            const safeMethod = escapeHTML((tr.method || 'transit').toUpperCase());
            const safeBookingNum = tr.bookingNumber ? escapeHTML(tr.bookingNumber) : '';
            const safeDepStation = escapeHTML(tr.depStation || stopA.name);
            const safeArrStation = escapeHTML(tr.arrStation || stopB.name);
            const safeDepTime = escapeHTML(tr.depTime || '');
            const safeArrTime = escapeHTML(tr.arrTime || '');
            const safeDate = escapeHTML(tr.date || calcDateStr);
            const safeRetDate = tr.returnDate ? ' (Ret: ' + escapeHTML(tr.returnDate) + ')' : '';

            bookingHTML = `
                <div class="transit-ticket" onclick="openTransitBookingModal(${i})">
                    <div class="ticket-header">
                        <span>${emojis[tr.method] || '🎟'} ${safeMethod} CONFIRMED</span>
                        <span>${safeBookingNum ? '#' + safeBookingNum : 'Details ›'}</span>
                    </div>
                    <div class="ticket-station">${safeDepStation} ➔ ${safeArrStation}</div>
                    <div class="ticket-time">🕒 ${safeDepTime} - ${safeArrTime} • ${safeDate}${safeRetDate}</div>
                </div>`;
        } else {
            bookingHTML = `<button class="dashed-add-btn" style="margin-bottom: 14px;" onclick="openTransitBookingModal(${i})">+ Add Booking & Tickets</button>`;
        }

        html += `
        <div style="background: var(--card-bg); border-radius: 18px; padding: 20px; margin-bottom: 20px; border: 1px solid var(--border-subtle); box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px;">
                <h4 style="margin: 0; font-size: 18px; font-weight:700;">${safeStopAName} ${isRound ? '⇄' : '→'} ${safeStopBName}</h4>
                <span style="font-size:11px; font-weight:700; color:var(--primary); background:var(--primary-light); padding:3px 8px; border-radius:8px;">${isRound ? '🔁 Round-Trip' : '➡️ One-Way'}</span>
            </div>
            <span style="color: #728481; font-size: 13px; display: block; margin-bottom: 14px;">
                ${isRound ? `Outbound: ${departureDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} • Return: ${returnDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}` : `Departure Date: ${departureDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`}
            </span>
            
            ${bookingHTML}

            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <div style="font-size:11px; color:#8fa09c; text-transform:uppercase; font-weight:700; letter-spacing:0.5px;">Search Fares & Schedules</div>
                <button type="button" onclick="toggleSegmentFlightType(${i})" style="background:none; border:none; color:var(--primary); font-size:11px; font-weight:700; cursor:pointer; padding:0;">
                    ${isRound ? 'Switch to One-Way search ➔' : '🔁 Switch to Round-Trip search'}
                </button>
            </div>
            <button class="partner-btn partner-trip-flight" onclick="window.open('${tripFlightUrl}', '_blank')">
                ✈️ Trip.com Flights (${isRound ? 'Round-Trip' : 'One-Way'}) <span>Search Deals ›</span>
            </button>
            <button class="partner-btn partner-trip-train" onclick="window.open('https://us.trip.com/trains/', '_blank')">
                🚆 Trip.com Trains <span>View Schedules ›</span>
            </button>
            <button class="partner-btn partner-google-flight" onclick="window.open('${googleFlightUrl}', '_blank')">
                ✈ Google Flights (${isRound ? 'Round-Trip' : 'One-Way'}) <span>Check Deals ›</span>
            </button>
        </div>`;
    }

    if (stops.length < 2) {
        html = `
        <div style="text-align: center; color: #8fa09c; padding: 40px 20px;">
            <p style="font-size: 15px; font-weight: 700; margin-bottom: 4px;">Single Stop Trip</p>
            <p style="font-size: 13px; margin-bottom: 20px;">Add at least 2 destinations in the Planner to schedule transit routes.</p>
            <div style="max-width: 360px; margin: 0 auto; text-align: left;">
                <div style="font-size:11px; color:#8fa09c; margin-bottom:8px; text-transform:uppercase; font-weight:700; letter-spacing:0.5px;">Search Partner Schedules & Flights</div>
                <button class="partner-btn partner-trip-flight" onclick="window.open('https://us.trip.com/flights/?triptype=ow', '_blank')">✈️ Trip.com Flights (One-Way) <span>Search Deals ›</span></button>
                <button class="partner-btn partner-trip-train" onclick="window.open('https://us.trip.com/trains/', '_blank')">🚆 Trip.com Trains <span>View Schedules ›</span></button>
                <button class="partner-btn partner-google-flight" onclick="window.open('https://www.google.com/travel/flights?q=one%20way%20flights', '_blank')">✈ Google Flights (One-Way) <span>Check Deals ›</span></button>
            </div>
        </div>`;
    }
    container.innerHTML = html;

    // Dynamically personalize train & bus booking card
    const trainLink = document.getElementById('transit-train-link');
    if (trainLink) {
        if (trip && trip.stops && trip.stops.length >= 2) {
            const orig = trip.stops[0].name;
            const dest = trip.stops[1].name;
            const trainTitle = trainLink.querySelector('.action-title');
            if (trainTitle) {
                trainTitle.innerText = `Book Trains & Buses (${orig} → ${dest}) (Omio)`;
            }
            trainLink.style.display = 'flex';
        } else if (trip && trip.stops && trip.stops.length === 1) {
            const orig = trip.stops[0].name;
            const trainTitle = trainLink.querySelector('.action-title');
            if (trainTitle) {
                trainTitle.innerText = `Book Regional Trains & Buses from ${orig} (Omio)`;
            }
            trainLink.style.display = 'flex';
        } else {
            trainLink.style.display = 'none';
        }
    }
}

export function openTransitBookingModal(index) {
    const trip = getActiveTrip();
    if (!trip || !trip.stops || !trip.stops[index] || !trip.stops[index + 1]) return;
    setActiveTransitIndex(index);
    const stopA = trip.stops[index];
    const stopB = trip.stops[index + 1];

    let travelDate = parseLocalDate(trip.startDate);
    for (let i = 0; i <= index; i++) travelDate.setDate(travelDate.getDate() + (Number(trip.stops[i].nights) || 0));
    const dateStr = formatLocalDate(travelDate);

    let returnDate = new Date(travelDate);
    returnDate.setDate(returnDate.getDate() + (Number(stopB.nights) || 0));
    const returnDateStr = formatLocalDate(returnDate);

    const titleEl = document.getElementById('transit-modal-title');
    const dateEl = document.getElementById('transit-modal-date');
    if (titleEl) titleEl.innerText = `${stopA.name} → ${stopB.name}`;
    if (dateEl) dateEl.innerText = `Scheduled: ${travelDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`;

    const transit = stopA.transit || { method: 'plane', flightType: 'ow', bookingNumber: '', date: dateStr, returnDate: '', depStation: stopA.name, arrStation: stopB.name, depTime: '', arrTime: '', notes: '' };

    const methodInput = document.getElementById('transit-method');
    const numInput = document.getElementById('transit-booking-num');
    const depInput = document.getElementById('transit-dep-station');
    const arrInput = document.getElementById('transit-arr-station');
    const depTimeInput = document.getElementById('transit-dep-time');
    const arrTimeInput = document.getElementById('transit-arr-time');
    const notesInput = document.getElementById('transit-notes');
    const flightTypeInput = document.getElementById('transit-flight-type');
    const returnDateInput = document.getElementById('transit-return-date');

    if (methodInput) methodInput.value = transit.method || 'plane';
    if (numInput) numInput.value = transit.bookingNumber || '';
    if (depInput) depInput.value = transit.depStation || stopA.name;
    if (arrInput) arrInput.value = transit.arrStation || stopB.name;
    if (depTimeInput) depTimeInput.value = transit.depTime || '';
    if (arrTimeInput) arrTimeInput.value = transit.arrTime || '';
    if (notesInput) notesInput.value = transit.notes || '';

    // Flight mode default: round-trip if 2-stop trip and trip.isRoundTrip, else one-way
    const isRound = (trip.isRoundTrip && trip.stops.length === 2) || (Array.isArray(trip.roundTripSegments) && trip.roundTripSegments.includes(index));
    const activeFlightMode = transit.flightType || (isRound ? 'rt' : 'ow');
    if (flightTypeInput) flightTypeInput.value = activeFlightMode;

    if (returnDateInput) {
        if (returnDateInput._flatpickr) {
            returnDateInput._flatpickr.setDate(transit.returnDate || returnDateStr);
        } else {
            returnDateInput.value = transit.returnDate || returnDateStr;
        }
    }
    toggleTransitReturnDateField();

    const depResults = document.getElementById('dep-station-results');
    const arrResults = document.getElementById('arr-station-results');
    if (depResults) depResults.style.display = 'none';
    if (arrResults) arrResults.style.display = 'none';

    const dPicker = document.getElementById('transit-date');
    if (dPicker) {
        if (dPicker._flatpickr) {
            dPicker._flatpickr.setDate(transit.date || dateStr);
        } else {
            dPicker.value = transit.date || dateStr;
        }
    }

    const modal = document.getElementById('transit-booking-modal');
    if (modal) modal.style.display = 'flex';
}

export function toggleTransitReturnDateField() {
    const flightType = document.getElementById('transit-flight-type')?.value || 'ow';
    const returnGroup = document.getElementById('transit-return-group');
    if (returnGroup) {
        returnGroup.style.display = (flightType === 'rt') ? 'block' : 'none';
    }
}

export function saveTransitBooking() {
    const trip = getActiveTrip();
    if (!trip || activeTransitIndex === null || !trip.stops || !trip.stops[activeTransitIndex]) return;
    trip.stops[activeTransitIndex].transit = {
        method: document.getElementById('transit-method')?.value || 'plane',
        flightType: document.getElementById('transit-flight-type')?.value || 'ow',
        bookingNumber: document.getElementById('transit-booking-num')?.value.trim() || '',
        date: document.getElementById('transit-date')?.value || '',
        returnDate: document.getElementById('transit-return-date')?.value || '',
        depStation: document.getElementById('transit-dep-station')?.value.trim() || '',
        arrStation: document.getElementById('transit-arr-station')?.value.trim() || '',
        depTime: document.getElementById('transit-dep-time')?.value || '',
        arrTime: document.getElementById('transit-arr-time')?.value || '',
        notes: document.getElementById('transit-notes')?.value.trim() || ''
    };
    saveTrips();
    closeModal('transit-booking-modal');
    const plannerView = document.getElementById('planner-view');
    const transitView = document.getElementById('transit-view');
    if (plannerView && plannerView.classList.contains('active')) drawPlannerMapRoute();
    if (transitView && transitView.classList.contains('active')) renderTransitList();
    showNotification("Transit booking saved!");
}

export function deleteTransitBooking() {
    const trip = getActiveTrip();
    if (!trip || activeTransitIndex === null || !trip.stops || !trip.stops[activeTransitIndex]) return;
    if (!confirm('Are you sure you want to remove this transit booking?')) return;
    triggerHaptic('warning');
    trip.stops[activeTransitIndex].transit = null;
    saveTrips();
    closeModal('transit-booking-modal');
    const plannerView = document.getElementById('planner-view');
    const transitView = document.getElementById('transit-view');
    if (plannerView && plannerView.classList.contains('active')) drawPlannerMapRoute();
    if (transitView && transitView.classList.contains('active')) renderTransitList();
    showNotification("Transit booking cleared.");
}

export function searchTransitStation(query, type) {
    clearTimeout(transitSearchTimeouts[type]);
    if (transitSearchAbortControllers[type]) transitSearchAbortControllers[type].abort();

    const resultsDiv = document.getElementById(`${type}-station-results`);
    if (!resultsDiv) return;

    if (query.trim().length < 2) {
        resultsDiv.style.display = 'none';
        return;
    }

    transitSearchTimeouts[type] = setTimeout(async () => {
        try {
            transitSearchAbortControllers[type] = new AbortController();
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`, {
                signal: transitSearchAbortControllers[type].signal
            });
            const data = await res.json();
            if (data.length > 0) {
                resultsDiv.innerHTML = data.map(item => {
                    const rawName = item.name || item.display_name.split(',')[0];
                    const safeName = escapeJS(rawName);
                    const displayName = escapeHTML(rawName);
                    const safeDesc = escapeHTML(item.display_name.substring(0, 48));
                    const safeType = escapeJS(type);
                    return `
                    <div class="autocomplete-item" onclick="selectTransitStation('${safeName}', '${safeType}')">
                        <strong>${displayName}</strong><br>
                        <small style="color:#777;">${safeDesc}...</small>
                    </div>`;
                }).join('');
                resultsDiv.style.display = 'block';
            } else {
                resultsDiv.style.display = 'none';
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error("Transit autocomplete error", err);
            }
        }
    }, 500);
}

export function selectTransitStation(name, type) {
    const input = document.getElementById(`transit-${type}-station`);
    if (input) input.value = name;
    const results = document.getElementById(`${type}-station-results`);
    if (results) results.style.display = 'none';
}

/* --- PARTNER SEARCH HELPERS --- */
export function searchHotelOnTripCom() {
    const trip = getActiveTrip();
    let query = '';
    const nameInput = document.getElementById('hotel-name-input');
    const addrInput = document.getElementById('hotel-address-input');
    if (nameInput && nameInput.value.trim()) {
        query = nameInput.value.trim();
    } else if (addrInput && addrInput.value.trim()) {
        query = addrInput.value.trim();
    } else if (trip && activeLodgingStopIndex !== null && trip.stops && trip.stops[activeLodgingStopIndex]) {
        query = trip.stops[activeLodgingStopIndex].name;
    }
    window.open(`https://us.trip.com/hotels/list?keyword=${encodeURIComponent(query || 'hotels')}`, '_blank');
}

export function searchHotelOnBookingCom() {
    const trip = getActiveTrip();
    let query = '';
    const nameInput = document.getElementById('hotel-name-input');
    const addrInput = document.getElementById('hotel-address-input');
    if (nameInput && nameInput.value.trim()) {
        query = nameInput.value.trim();
    } else if (addrInput && addrInput.value.trim()) {
        query = addrInput.value.trim();
    } else if (trip && activeLodgingStopIndex !== null && trip.stops && trip.stops[activeLodgingStopIndex]) {
        query = trip.stops[activeLodgingStopIndex].name;
    }
    window.open(`https://www.booking.com/searchresults.html?ss=${encodeURIComponent(query || 'hotels')}`, '_blank');
}

export function searchTransitOnTripCom() {
    const dep = document.getElementById('transit-dep-station')?.value.trim() || '';
    const arr = document.getElementById('transit-arr-station')?.value.trim() || '';
    const date = document.getElementById('transit-date')?.value || '';
    const retDate = document.getElementById('transit-return-date')?.value || '';
    const method = document.getElementById('transit-method')?.value || 'plane';
    const flightType = document.getElementById('transit-flight-type')?.value || 'ow';

    if (method === 'train') {
        window.open('https://us.trip.com/trains/', '_blank');
        return;
    }

    if (flightType === 'rt' && retDate) {
        window.open(`https://us.trip.com/flights/?dcity=${encodeURIComponent(dep)}&acity=${encodeURIComponent(arr)}&ddate=${date}&rdate=${retDate}&triptype=rt`, '_blank');
    } else {
        window.open(`https://us.trip.com/flights/?dcity=${encodeURIComponent(dep)}&acity=${encodeURIComponent(arr)}&ddate=${date}&triptype=ow`, '_blank');
    }
}

export function searchTransitOnGoogleFlights() {
    const dep = document.getElementById('transit-dep-station')?.value.trim() || '';
    const arr = document.getElementById('transit-arr-station')?.value.trim() || '';
    const date = document.getElementById('transit-date')?.value || '';
    const retDate = document.getElementById('transit-return-date')?.value || '';
    const flightType = document.getElementById('transit-flight-type')?.value || 'ow';

    if (flightType === 'rt' && retDate) {
        window.open(`https://www.google.com/travel/flights?q=round%20trip%20flights%20from%20${encodeURIComponent(dep)}%20to%20${encodeURIComponent(arr)}%20departing%20${date}%20returning%20${retDate}`, '_blank');
    } else {
        window.open(`https://www.google.com/travel/flights?q=one%20way%20flights%20from%20${encodeURIComponent(dep)}%20to%20${encodeURIComponent(arr)}%20on%20${date}`, '_blank');
    }
}

