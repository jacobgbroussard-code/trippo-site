/* ==========================================================================
   Trippo Travel Planner - Google Places Autocomplete Engine
   js/places-autocomplete.js
   Robust hybrid search engine with input armor & resilient fallback
   ========================================================================== */

import { addCityStop } from './planner.js';
import { closeModal } from './state.js';

export let cityAutocomplete = null;
export let dailyPlaceAutocomplete = null;
export let hotelAutocomplete = null;
export let wishlistAutocomplete = null;

let isInitialized = false;

/**
 * Protect a search input from being disabled or styled with error backgrounds
 * if Google Maps API throws an auth/activation error.
 */
export function protectSearchInput(input) {
    if (!input) return;

    // 1. Intercept 'disabled' property to prevent external scripts from locking the field
    try {
        Object.defineProperty(input, 'disabled', {
            get() { return false; },
            set(val) {
                // Ignore attempts to disable search inputs
            },
            configurable: true
        });
    } catch (e) {}

    // 2. Observer to immediately clean error attributes & classes
    const cleanErrors = () => {
        if (input.classList.contains('gm-err-autocomplete')) {
            input.classList.remove('gm-err-autocomplete');
        }
        if (input.hasAttribute('disabled')) {
            input.removeAttribute('disabled');
        }
    };

    const observer = new MutationObserver(() => cleanErrors());
    observer.observe(input, { attributes: true, attributeFilter: ['disabled', 'class'] });
    cleanErrors();
}

/**
 * Initialize Google Places Autocomplete across Trippo's search inputs.
 * Binds place_changed listeners and arms search fields against failure.
 */
export function initGooglePlacesAutocomplete() {
    // Always arm the inputs immediately, regardless of Google API load state
    const cityInput = document.getElementById('city-search-input');
    const placeInput = document.getElementById('place-search-input');
    const hotelInput = document.getElementById('hotel-address-input');
    const wishlistInput = document.getElementById('wishlist-search-input');

    [cityInput, placeInput, hotelInput, wishlistInput].forEach(protectSearchInput);

    if (isInitialized) return;

    if (typeof google === 'undefined' || !google.maps || !google.maps.places) {
        // Polling retry for asynchronous or delayed script load
        let attempts = 0;
        const maxAttempts = 50; // 5 seconds
        const timer = setInterval(() => {
            attempts++;
            if (typeof google !== 'undefined' && google.maps && google.maps.places) {
                clearInterval(timer);
                setupAutocompleteInstances();
            } else if (attempts >= maxAttempts) {
                clearInterval(timer);
                console.warn('[Trippo] Google Places library not active. Built-in OpenStreetMap search active.');
            }
        }, 100);
        return;
    }

    setupAutocompleteInstances();
}

function setupAutocompleteInstances() {
    if (isInitialized) return;
    if (typeof google === 'undefined' || !google.maps || !google.maps.places) return;

    const cityInput = document.getElementById('city-search-input');
    const placeInput = document.getElementById('place-search-input');
    const hotelInput = document.getElementById('hotel-address-input');
    const wishlistInput = document.getElementById('wishlist-search-input');

    // Double check armor on all inputs
    [cityInput, placeInput, hotelInput, wishlistInput].forEach(protectSearchInput);

    isInitialized = true;

    // 1. City / Stop Search (#city-search-input)
    if (cityInput) {
        try {
            cityAutocomplete = new google.maps.places.Autocomplete(cityInput, {
                types: ['(cities)'],
                fields: ['name', 'formatted_address', 'geometry']
            });

            cityAutocomplete.addListener('place_changed', () => {
                const place = cityAutocomplete.getPlace();
                if (!place || !place.geometry || !place.geometry.location) return;

                const name = place.name || (place.formatted_address ? place.formatted_address.split(',')[0].trim() : 'City Stop');
                const lat = place.geometry.location.lat();
                const lon = place.geometry.location.lng();

                addCityStop(name, lat, lon);
                cityInput.value = '';
                const results = document.getElementById('city-search-results');
                if (results) results.style.display = 'none';
                closeModal('city-search-modal');
            });
        } catch (err) {
            console.warn('[Trippo] City Autocomplete fallback active:', err);
        }
    }

    // 2. Daily Places Search (#place-search-input)
    if (placeInput) {
        try {
            dailyPlaceAutocomplete = new google.maps.places.Autocomplete(placeInput, {
                fields: ['name', 'formatted_address', 'geometry']
            });

            dailyPlaceAutocomplete.addListener('place_changed', () => {
                const place = dailyPlaceAutocomplete.getPlace();
                if (!place || !place.geometry || !place.geometry.location) return;

                const nameInput = document.getElementById('add-poi-name');
                const addrInput = document.getElementById('add-poi-address');
                const latInput = document.getElementById('add-poi-lat');
                const lonInput = document.getElementById('add-poi-lon');

                if (nameInput) nameInput.value = place.name || '';
                if (addrInput) addrInput.value = place.formatted_address || place.name || '';
                if (latInput) latInput.value = place.geometry.location.lat();
                if (lonInput) lonInput.value = place.geometry.location.lng();

                const results = document.getElementById('place-search-results');
                if (results) results.style.display = 'none';

                const form = document.getElementById('place-add-form');
                if (form) form.style.display = 'block';
            });
        } catch (err) {
            console.warn('[Trippo] Daily Place Autocomplete fallback active:', err);
        }
    }

    // 3. Hotel / Lodging Address Search (#hotel-address-input)
    if (hotelInput) {
        try {
            hotelAutocomplete = new google.maps.places.Autocomplete(hotelInput, {
                fields: ['name', 'formatted_address', 'geometry']
            });

            hotelAutocomplete.addListener('place_changed', () => {
                const place = hotelAutocomplete.getPlace();
                if (!place) return;

                if (place.formatted_address) {
                    hotelInput.value = place.formatted_address;
                } else if (place.name) {
                    hotelInput.value = place.name;
                }

                if (place.geometry && place.geometry.location) {
                    const latInput = document.getElementById('hotel-lat-input');
                    const lonInput = document.getElementById('hotel-lon-input');
                    if (latInput) latInput.value = place.geometry.location.lat();
                    if (lonInput) lonInput.value = place.geometry.location.lng();
                }

                const nameInput = document.getElementById('hotel-name-input');
                if (nameInput && !nameInput.value.trim() && place.name) {
                    nameInput.value = place.name;
                }

                const results = document.getElementById('hotel-address-results');
                if (results) results.style.display = 'none';
            });
        } catch (err) {
            console.warn('[Trippo] Hotel Autocomplete fallback active:', err);
        }
    }

    // 4. Wishlist Search (#wishlist-search-input)
    if (wishlistInput) {
        try {
            wishlistAutocomplete = new google.maps.places.Autocomplete(wishlistInput, {
                fields: ['name', 'formatted_address', 'geometry']
            });

            wishlistAutocomplete.addListener('place_changed', () => {
                const place = wishlistAutocomplete.getPlace();
                if (!place) return;

                const nameInput = document.getElementById('add-wish-name');
                const latInput = document.getElementById('add-wish-lat');
                const lonInput = document.getElementById('add-wish-lon');

                const destName = place.name || (place.formatted_address ? place.formatted_address.split(',')[0].trim() : '');
                if (nameInput) nameInput.value = destName;

                if (place.geometry && place.geometry.location) {
                    if (latInput) latInput.value = place.geometry.location.lat();
                    if (lonInput) lonInput.value = place.geometry.location.lng();
                }

                const results = document.getElementById('wishlist-search-results');
                if (results) results.style.display = 'none';

                const form = document.getElementById('wishlist-add-form');
                if (form) form.style.display = 'block';
            });
        } catch (err) {
            console.warn('[Trippo] Wishlist Autocomplete fallback active:', err);
        }
    }

    // Intelligent Enter Key Handler:
    // If a Google Places or Nominatim result is available, select it on Enter;
    // otherwise allow smooth typing without accidentally closing modals.
    const setupEnterNav = (input, resultsContainerId) => {
        if (!input) return;
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const resultsContainer = document.getElementById(resultsContainerId);
                const firstResult = resultsContainer ? resultsContainer.querySelector('.search-result, .autocomplete-item') : null;
                const hasPacSelected = !!document.querySelector('.pac-container .pac-item-selected');

                if (hasPacSelected) {
                    // Let Google Places Autocomplete select its highlighted item
                    return;
                }

                if (firstResult && resultsContainer && resultsContainer.style.display !== 'none') {
                    e.preventDefault();
                    firstResult.click();
                } else {
                    e.preventDefault();
                }
            }
        });
    };

    setupEnterNav(cityInput, 'city-search-results');
    setupEnterNav(placeInput, 'place-search-results');
    setupEnterNav(hotelInput, 'hotel-address-results');
    setupEnterNav(wishlistInput, 'wishlist-search-results');

    console.log('[Trippo] Places Autocomplete initialized with input protection and fallback support.');
}
