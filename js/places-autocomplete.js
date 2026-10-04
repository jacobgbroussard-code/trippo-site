/* ==========================================================================
   Trippo Travel Planner - Google Places Autocomplete Engine
   js/places-autocomplete.js
   ========================================================================== */

import { addCityStop } from './planner.js';
import { closeModal } from './state.js';

export let cityAutocomplete = null;
export let dailyPlaceAutocomplete = null;
export let hotelAutocomplete = null;
export let wishlistAutocomplete = null;

let isInitialized = false;

/**
 * Initialize Google Places Autocomplete across Trippo's search inputs.
 * Binds place_changed listeners and sets up safety catches for Enter key navigation.
 */
export function initGooglePlacesAutocomplete() {
    if (isInitialized) return;

    if (typeof google === 'undefined' || !google.maps || !google.maps.places) {
        // Polling retry for asynchronous or delayed script load
        let attempts = 0;
        const maxAttempts = 60; // 6 seconds
        const timer = setInterval(() => {
            attempts++;
            if (typeof google !== 'undefined' && google.maps && google.maps.places) {
                clearInterval(timer);
                setupAutocompleteInstances();
            } else if (attempts >= maxAttempts) {
                clearInterval(timer);
                console.warn('[Trippo] Google Places library did not initialize within expected time.');
            }
        }, 100);
        return;
    }

    setupAutocompleteInstances();
}

function setupAutocompleteInstances() {
    if (isInitialized) return;
    if (typeof google === 'undefined' || !google.maps || !google.maps.places) return;

    isInitialized = true;

    // 1. City / Stop Search (#city-search-input)
    const cityInput = document.getElementById('city-search-input');
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
                closeModal('city-search-modal');
            });
        } catch (err) {
            console.error('[Trippo] Error initializing City Autocomplete:', err);
        }
    }

    // 2. Daily Places Search (#place-search-input)
    const placeInput = document.getElementById('place-search-input');
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

                const form = document.getElementById('place-add-form');
                if (form) form.style.display = 'block';
            });
        } catch (err) {
            console.error('[Trippo] Error initializing Daily Place Autocomplete:', err);
        }
    }

    // 3. Hotel / Lodging Address Search (#hotel-address-input)
    const hotelInput = document.getElementById('hotel-address-input');
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
            });
        } catch (err) {
            console.error('[Trippo] Error initializing Hotel Autocomplete:', err);
        }
    }

    // 4. Wishlist Search (#wishlist-search-input)
    const wishlistInput = document.getElementById('wishlist-search-input');
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

                const form = document.getElementById('wishlist-add-form');
                if (form) form.style.display = 'block';
            });
        } catch (err) {
            console.error('[Trippo] Error initializing Wishlist Autocomplete:', err);
        }
    }

    // Safety Catch: Prevent modal forms from inadvertently submitting or closing
    // if the user presses Enter while navigating Google Places autocomplete suggestions
    [cityInput, placeInput, hotelInput, wishlistInput].forEach(input => {
        if (!input) return;
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
            }
        });
    });

    console.log('[Trippo] Google Places Autocomplete initialized successfully for 4 search inputs.');
}
