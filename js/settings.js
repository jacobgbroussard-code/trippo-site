/* ==========================================================================
   Trippo Travel Planner - User Settings & Preferences
   js/settings.js
   ========================================================================== */

import { safeGetStorage, safeSetStorage, showNotification, closeModal, toggleSidebar, triggerHaptic, getTempUnit, getTimeFormat, isReducedMotion, applyMotionPreference } from './state.js';
import { renderPlanner } from './planner.js';
import { exportAppDataJSON, exportTripToICS, forceAppRefresh } from './tools.js';

export function getDistanceUnit() {
    return safeGetStorage('trippo_distance_unit', 'mi'); // 'mi' or 'km'
}

export function setDistanceUnit(unit) {
    if (unit !== 'mi' && unit !== 'km') unit = 'mi';
    safeSetStorage('trippo_distance_unit', unit);
    triggerHaptic('light');
    updateSettingsModalUI();
    renderPlanner({ keepMapView: true });
    showNotification(`Distance unit set to ${unit === 'mi' ? 'Miles (mi)' : 'Kilometers (km)'}`);
}

export function getShowDistances() {
    return safeGetStorage('trippo_show_distances', 'true') === 'true';
}

export function setShowDistances(show) {
    safeSetStorage('trippo_show_distances', show ? 'true' : 'false');
    triggerHaptic('light');
    updateSettingsModalUI();
    renderPlanner({ keepMapView: true });
    showNotification(show ? "Route distances enabled" : "Route distances hidden");
}

export function openSettingsModal() {
    toggleSidebar(false);
    updateSettingsModalUI();
    if (window.renderMembershipsSettings) window.renderMembershipsSettings();
    const modal = document.getElementById('settings-modal');
    if (modal) {
        modal.style.display = 'flex';
        modal.classList.add('active');
    }
}

export function closeSettingsModal() {
    closeModal('settings-modal');
}

export function updateSettingsModalUI() {
    const unit = getDistanceUnit();
    const miBtn = document.getElementById('unit-btn-mi');
    const kmBtn = document.getElementById('unit-btn-km');
    if (miBtn && kmBtn) {
        if (unit === 'mi') {
            miBtn.classList.add('active');
            kmBtn.classList.remove('active');
        } else {
            kmBtn.classList.add('active');
            miBtn.classList.remove('active');
        }
    }

    const showDistCheck = document.getElementById('setting-toggle-distance');
    if (showDistCheck) {
        showDistCheck.checked = getShowDistances();
    }

    const originInput = document.getElementById('setting-home-airport');
    if (originInput) {
        originInput.value = safeGetStorage('trippo_home_airport', 'LFT');
    }

    const currSelect = document.getElementById('setting-default-currency');
    if (currSelect) {
        currSelect.value = safeGetStorage('trippo_default_currency', 'USD');
    }

    const themeBtn = document.getElementById('settings-theme-toggle-btn');
    if (themeBtn) {
        const isHotline = document.body.classList.contains('hotline-mode');
        const isDark = document.body.classList.contains('dark-mode');
        
        if (isHotline) themeBtn.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-sun"></use></svg>Light Mode';
        else if (isDark) themeBtn.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-bolt"></use></svg>Hotline Mode';
        else themeBtn.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-moon"></use></svg>Dark Mode';
    }

    const providerSelect = document.getElementById('setting-map-provider');
    const mapboxKeyContainer = document.getElementById('mapbox-key-container');
    const mapboxKeyInput = document.getElementById('mapbox-api-key-input');
    
    if (providerSelect) {
        const currentProvider = safeGetStorage('trippo_map_provider', 'carto-positron');
        providerSelect.value = currentProvider;
        if (mapboxKeyContainer) {
            mapboxKeyContainer.style.display = currentProvider.startsWith('mapbox') ? 'block' : 'none';
        }
    }
    
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = v; };
    setVal('setting-map-default-view', safeGetStorage('trippo_map_default_view', 'fit'));
    setVal('setting-temp-unit', getTempUnit());
    setVal('setting-time-format', getTimeFormat());
    setChk('setting-haptics', safeGetStorage('trippo_haptics', '1') !== '0');
    setChk('setting-reduce-motion', isReducedMotion());

    const overlayPrefs = window.getOverlayButtonPrefs ? window.getOverlayButtonPrefs() : {};
    ['trains', 'trails', 'alltrails'].forEach(k => {
        const box = document.getElementById(`setting-overlay-btn-${k}`);
        if (box) box.checked = overlayPrefs[k] !== false;
    });

    if (mapboxKeyInput) {
        const storedKey = window.userMapboxKey ? window.userMapboxKey() : '';
        mapboxKeyInput.value = storedKey;
        
        const overlay = document.getElementById('mapbox-lock-overlay');
        if (overlay) {
            overlay.style.display = storedKey ? 'flex' : 'none';
        }
    }
    
    const geminiKeyInput = document.getElementById('gemini-api-key-input');
    if (geminiKeyInput) {
        const storedGeminiKey = localStorage.getItem('trippoGeminiApiKey') || '';
        geminiKeyInput.value = storedGeminiKey;
        
        const geminiOverlay = document.getElementById('gemini-lock-overlay');
        if (geminiOverlay) {
            geminiOverlay.style.display = storedGeminiKey ? 'flex' : 'none';
        }
    }

    const gmapsKeyInput = document.getElementById('gmaps-api-key-input');
    if (gmapsKeyInput) {
        const storedGmapsKey = localStorage.getItem('trippo_google_maps_key') || '';
        gmapsKeyInput.value = storedGmapsKey;
        
        const gmapsOverlay = document.getElementById('gmaps-lock-overlay');
        if (gmapsOverlay) {
            gmapsOverlay.style.display = storedGmapsKey ? 'flex' : 'none';
        }
    }
}

export function saveHomeAirportSetting(val) {
    const clean = (val || '').toUpperCase().trim();
    if (clean) {
        safeSetStorage('trippo_home_airport', clean);
        
        // Update flight hub input if it exists
        const originDisplay = document.getElementById('flight-hub-origin');
        if (originDisplay) {
            const firstAirport = clean.split(',')[0].trim().substring(0, 3);
            originDisplay.value = firstAirport;
            if (window.updateFlightHubLinks) window.updateFlightHubLinks(firstAirport);
        }
        
        // Re-init flight hub chips if the function is available
        if (window.initFlightHubChips) window.initFlightHubChips();
        
        showNotification(`Default airport(s) set to ${clean}`);
    }
}

export function saveDefaultCurrencySetting(curr) {
    safeSetStorage('trippo_default_currency', curr);
    const currFrom = document.getElementById('curr-from');
    if (currFrom) currFrom.value = curr;
    showNotification(`Default currency set to ${curr}`);
}

export function saveMapDefaultViewSetting(view) {
    safeSetStorage('trippo_map_default_view', ['fit', 'location', 'world'].includes(view) ? view : 'fit');
    showNotification(view === 'location' ? 'Maps will open on your location' : view === 'world' ? 'Maps will open on the whole world' : 'Maps will fit your trip');
}

export function saveTempUnitSetting(unit) {
    safeSetStorage('trippo_temp_unit', unit === 'C' ? 'C' : 'F');
    rerenderVisibleViews();
    showNotification(`Temperatures in °${unit === 'C' ? 'C' : 'F'}`);
}

export function saveTimeFormatSetting(fmt) {
    safeSetStorage('trippo_time_format', fmt === '24' ? '24' : '12');
    rerenderVisibleViews();
    showNotification(fmt === '24' ? '24-hour time' : '12-hour time');
}

export function saveHapticsSetting(on) {
    safeSetStorage('trippo_haptics', on ? '1' : '0');
    if (on) triggerHaptic('light');
}

export function saveReduceMotionSetting(on) {
    safeSetStorage('trippo_reduce_motion', on ? '1' : '0');
    applyMotionPreference();
    showNotification(on ? 'Reduced motion on (maps update on next open)' : 'Animations back on');
}

// Redraw whatever is showing so unit/format changes appear right away
function rerenderVisibleViews() {
    const active = document.querySelector('.view.active');
    const id = active ? active.id : '';
    try {
        if (id === 'planner-view') renderPlanner({ keepMapView: true });
        else if (id === 'places-view' && window.renderPlacesDayTabs) window.renderPlacesDayTabs();
        else if (id === 'bookings-view' && window.renderBookingsList) window.renderBookingsList();
        else if (id === 'transit-view' && window.renderTransitList) window.renderTransitList();
    } catch (e) { /* the next normal render picks it up */ }
}

export function saveMapProviderSetting(provider) {
    safeSetStorage('trippo_map_provider', provider);
    updateSettingsModalUI();
    
    if (window.updateMapProvider) {
        window.updateMapProvider();
    }
    showNotification(`Map provider set to ${provider}`);
}

export function saveMapboxApiKey() {
    const key = document.getElementById('mapbox-api-key-input')?.value.trim();
    localStorage.removeItem('trippo_mapbox_down'); // try Mapbox again with this key
    if (key) {
        safeSetStorage('trippo_mapbox_key', key);
        showNotification("Mapbox Key saved locally!");
    } else {
        localStorage.removeItem('trippo_mapbox_key');
        showNotification("Mapbox Key removed. Mapbox styles show as CARTO until you add one.");
    }
    if (window.updateMapProvider) window.updateMapProvider();
}

export function unlockMapboxKey() {
    const overlay = document.getElementById('mapbox-lock-overlay');
    if (overlay) overlay.style.display = 'none';
}

export function unlockGeminiKey() {
    const overlay = document.getElementById('gemini-lock-overlay');
    if (overlay) overlay.style.display = 'none';
}

export function saveGoogleMapsApiKey() {
    const key = document.getElementById('gmaps-api-key-input')?.value.trim();
    if (key) {
        localStorage.setItem('trippo_google_maps_key', key);
        showNotification("Google Maps API Key saved! Reloading to apply...");
        setTimeout(() => window.location.reload(), 1500);
    } else {
        localStorage.removeItem('trippo_google_maps_key');
        showNotification("Google Maps API Key removed. Reloading...");
        setTimeout(() => window.location.reload(), 1500);
    }
}

export function unlockGoogleMapsKey() {
    const overlay = document.getElementById('gmaps-lock-overlay');
    if (overlay) overlay.style.display = 'none';
}

window.saveMapProviderSetting = saveMapProviderSetting;
window.saveMapboxApiKey = saveMapboxApiKey;
window.unlockMapboxKey = unlockMapboxKey;
window.unlockGeminiKey = unlockGeminiKey;
window.saveGoogleMapsApiKey = saveGoogleMapsApiKey;
window.unlockGoogleMapsKey = unlockGoogleMapsKey;
