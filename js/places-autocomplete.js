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

const googleReady = () => typeof google !== 'undefined' && google.maps &&
    (typeof google.maps.importLibrary === 'function' || google.maps.places);

/**
 * Drop-in replacement for the legacy google.maps.places.Autocomplete widget, backed by
 * Places API (New). The legacy Places API returns REQUEST_DENIED for Trippo's key, so the
 * old widget silently never produced results. Same surface the code below relies on:
 * addListener('place_changed', fn) + getPlace() → { name, formatted_address, geometry.location }.
 * Renders a .pac-container dropdown so existing CSS and the Enter-key handler keep working.
 */
class NewPlacesAutocomplete {
    constructor(input, { types } = {}) {
        this.input = input;
        this.cities = Array.isArray(types) && types.includes('(cities)');
        this.listeners = [];
        this.place = null;
        this.suggestions = [];
        this.active = -1;
        this.token = null;
        this.reqId = 0;
        this.disabled = false;

        this.box = document.createElement('div');
        this.box.className = 'pac-container trippo-pac';
        this.box.style.display = 'none';
        document.body.appendChild(this.box);
        // Keep focus in the input while tapping a suggestion
        this.box.addEventListener('pointerdown', e => e.preventDefault());
        this.box.addEventListener('mousedown', e => e.preventDefault());

        let timer = null;
        input.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => this.fetch(input.value), 220);
        });
        input.addEventListener('keydown', e => this.onKey(e));
        input.addEventListener('blur', () => setTimeout(() => this.hide(), 150));
        window.addEventListener('resize', () => this.position());
        document.addEventListener('scroll', () => this.position(), true);
    }

    addListener(evt, fn) {
        if (evt === 'place_changed') this.listeners.push(fn);
    }

    getPlace() {
        return this.place;
    }

    async fetch(query) {
        const q = (query || '').trim();
        const id = ++this.reqId;
        if (this.disabled || q.length < 2) return this.hide();
        try {
            const { AutocompleteSuggestion, AutocompleteSessionToken } = await google.maps.importLibrary('places');
            if (!this.token) this.token = new AutocompleteSessionToken();
            const request = { input: q, sessionToken: this.token };
            if (this.cities) request.includedPrimaryTypes = ['(cities)'];
            const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
            if (id !== this.reqId || document.activeElement !== this.input) return;
            this.suggestions = (suggestions || []).map(s => s.placePrediction).filter(Boolean);
            this.render();
        } catch (err) {
            // Key/API problem: stop trying and let the built-in OpenStreetMap search handle it
            console.warn('[Trippo] Google Places (New) unavailable, using OpenStreetMap search:', err?.message || err);
            this.disabled = true;
            this.hide();
        }
    }

    render() {
        this.active = -1;
        if (!this.suggestions.length) return this.hide();
        this.box.innerHTML = '';
        this.suggestions.forEach((p, i) => {
            const item = document.createElement('div');
            item.className = 'pac-item';
            const main = document.createElement('span');
            main.className = 'pac-item-query';
            main.textContent = p.mainText?.text || p.text?.text || '';
            const sub = document.createElement('span');
            sub.className = 'pac-item-secondary';
            sub.textContent = p.secondaryText?.text || '';
            item.append(main, sub);
            item.addEventListener('click', () => this.select(i));
            this.box.appendChild(item);
        });
        this.box.style.display = 'block';
        this.position();
    }

    position() {
        if (this.box.style.display === 'none') return;
        const r = this.input.getBoundingClientRect();
        if (!r.width) return this.hide();
        this.box.style.left = `${r.left + window.scrollX}px`;
        this.box.style.top = `${r.bottom + window.scrollY}px`;
        this.box.style.width = `${r.width}px`;
    }

    hide() {
        this.box.style.display = 'none';
        this.active = -1;
    }

    highlight(i) {
        const items = this.box.querySelectorAll('.pac-item');
        items.forEach(el => el.classList.remove('pac-item-selected'));
        this.active = i;
        if (items[i]) items[i].classList.add('pac-item-selected');
    }

    onKey(e) {
        if (this.box.style.display === 'none') return;
        const n = this.suggestions.length;
        if (e.key === 'ArrowDown') { e.preventDefault(); this.highlight((this.active + 1) % n); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); this.highlight((this.active - 1 + n) % n); }
        else if (e.key === 'Escape') { this.hide(); }
        else if (e.key === 'Enter' && this.active >= 0) { e.preventDefault(); this.select(this.active); }
    }

    async select(i) {
        const prediction = this.suggestions[i];
        if (!prediction) return;
        this.hide();
        try {
            const place = prediction.toPlace();
            await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
            this.token = null; // a selection ends the billing session
            this.place = {
                name: place.displayName || prediction.mainText?.text || '',
                formatted_address: place.formattedAddress || prediction.text?.text || '',
                geometry: place.location ? { location: place.location } : null
            };
            this.listeners.forEach(fn => fn());
        } catch (err) {
            console.warn('[Trippo] Could not load place details:', err?.message || err);
        }
    }
}

function createAutocomplete(input, opts) {
    if (typeof google.maps.importLibrary === 'function') return new NewPlacesAutocomplete(input, opts);
    return new google.maps.places.Autocomplete(input, opts);
}

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
        if (input.style.backgroundImage) {
            input.style.backgroundImage = 'none';
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
    armEnterKey();

    if (isInitialized) return;

    if (!googleReady()) {
        // Polling retry for asynchronous or delayed script load
        let attempts = 0;
        const maxAttempts = 200; // 20 seconds (async SDK can be slow on mobile)
        const timer = setInterval(() => {
            attempts++;
            if (googleReady()) {
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
    if (!googleReady()) return;

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
            cityAutocomplete = createAutocomplete(cityInput, {
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
                const clearBtn = document.getElementById('clear-city-search-input');
                if (clearBtn) clearBtn.style.display = 'none';
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
            dailyPlaceAutocomplete = createAutocomplete(placeInput, {
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

                const catSelect = document.getElementById('add-poi-category');
                if (catSelect && typeof window.detectCategory === 'function') {
                    catSelect.value = window.detectCategory(place.name || '', place.formatted_address || '');
                }

                const clearBtn = document.getElementById('clear-place-search-input');
                if (clearBtn) clearBtn.style.display = 'none';

                const results = document.getElementById('place-search-results');
                if (results) results.style.display = 'none';

                const form = document.getElementById('place-add-form');
                if (form) {
                    form.style.display = 'block';
                    setTimeout(() => {
                        form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }, 60);
                }
            });
        } catch (err) {
            console.warn('[Trippo] Daily Place Autocomplete fallback active:', err);
        }
    }

    // 3. Hotel / Lodging Address Search (#hotel-address-input)
    if (hotelInput) {
        try {
            hotelAutocomplete = createAutocomplete(hotelInput, {
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

                const clearBtn = document.getElementById('clear-hotel-address-input');
                if (clearBtn) clearBtn.style.display = hotelInput.value.trim().length > 0 ? 'flex' : 'none';

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
            wishlistAutocomplete = createAutocomplete(wishlistInput, {
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

                const clearBtn = document.getElementById('clear-wishlist-search-input');
                if (clearBtn) clearBtn.style.display = 'none';

                const results = document.getElementById('wishlist-search-results');
                if (results) results.style.display = 'none';

                const form = document.getElementById('wishlist-add-form');
                if (form) form.style.display = 'block';
            });
        } catch (err) {
            console.warn('[Trippo] Wishlist Autocomplete fallback active:', err);
        }
    }

    console.log('[Trippo] Places Autocomplete initialized with input protection and fallback support.');
}

let enterKeyArmed = false;

/**
 * Intelligent Enter Key Handler (always on, Google or not):
 * If a Google Places or Nominatim result is available, select it on Enter;
 * otherwise allow smooth typing without accidentally closing modals.
 */
function armEnterKey() {
    if (enterKeyArmed) return;
    enterKeyArmed = true;

    const cityInput = document.getElementById('city-search-input');
    const placeInput = document.getElementById('place-search-input');
    const hotelInput = document.getElementById('hotel-address-input');
    const wishlistInput = document.getElementById('wishlist-search-input');

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
}
