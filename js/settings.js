/* ==========================================================================
   Trippo Travel Planner - User Settings & Preferences
   js/settings.js
   ========================================================================== */

import { safeGetStorage, safeSetStorage, showNotification, closeModal, toggleSidebar, triggerHaptic } from './state.js';
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
    renderPlanner();
    showNotification(`Distance unit set to ${unit === 'mi' ? 'Miles (mi)' : 'Kilometers (km)'}`);
}

export function getShowDistances() {
    return safeGetStorage('trippo_show_distances', 'true') === 'true';
}

export function setShowDistances(show) {
    safeSetStorage('trippo_show_distances', show ? 'true' : 'false');
    triggerHaptic('light');
    updateSettingsModalUI();
    renderPlanner();
    showNotification(show ? "Route distances enabled" : "Route distances hidden");
}

export function openSettingsModal() {
    toggleSidebar(false);
    updateSettingsModalUI();
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
        originInput.value = safeGetStorage('trippo_flighthub_origin', 'LFT');
    }

    const currSelect = document.getElementById('setting-default-currency');
    if (currSelect) {
        currSelect.value = safeGetStorage('trippo_default_currency', 'USD');
    }

    const themeBtn = document.getElementById('settings-theme-toggle-btn');
    if (themeBtn) {
        const isDark = document.body.classList.contains('dark-mode');
        themeBtn.innerHTML = isDark ? '☀️ Light Mode' : '🌙 Dark Mode';
    }

    const providerSelect = document.getElementById('setting-map-provider');
    const mapboxKeyContainer = document.getElementById('mapbox-key-container');
    const mapboxKeyInput = document.getElementById('mapbox-api-key-input');
    
    if (providerSelect) {
        const currentProvider = safeGetStorage('trippo_map_provider', 'mapbox-light');
        providerSelect.value = currentProvider;
        if (mapboxKeyContainer) {
            mapboxKeyContainer.style.display = currentProvider.startsWith('mapbox') ? 'block' : 'none';
        }
    }
    
    if (mapboxKeyInput) {
        const storedKey = safeGetStorage('trippo_mapbox_key', atob('cGsuZXlKMUlqb2ljMjV2YjNCcGRIa2lMQ0poSWpvaVkyMTFlVE4xZDNFNU1ESTNNako2Y0hFNWIzbDFaamd3Y2lKOS51SnRoR0tnMmsweTJKOUtycTRvMWdB'));
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
}

export function saveHomeAirportSetting(val) {
    const clean = (val || '').toUpperCase().trim();
    if (clean) {
        safeSetStorage('trippo_flighthub_origin', clean);
        const originDisplay = document.getElementById('flighthub-origin-input');
        if (originDisplay) originDisplay.value = clean;
        showNotification(`Default airport set to ${clean}`);
    }
}

export function saveDefaultCurrencySetting(curr) {
    safeSetStorage('trippo_default_currency', curr);
    const currFrom = document.getElementById('curr-from');
    if (currFrom) currFrom.value = curr;
    showNotification(`Default currency set to ${curr}`);
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
    if (key) {
        safeSetStorage('trippo_mapbox_key', key);
        showNotification("Mapbox Key saved locally!");
        if (window.updateMapProvider) {
            window.updateMapProvider();
        }
    } else {
        localStorage.removeItem('trippo_mapbox_key');
        showNotification("Mapbox Key removed.");
    }
}

export function unlockMapboxKey() {
    const overlay = document.getElementById('mapbox-lock-overlay');
    if (overlay) overlay.style.display = 'none';
}

export function unlockGeminiKey() {
    const overlay = document.getElementById('gemini-lock-overlay');
    if (overlay) overlay.style.display = 'none';
}

window.saveMapProviderSetting = saveMapProviderSetting;
window.saveMapboxApiKey = saveMapboxApiKey;
window.unlockMapboxKey = unlockMapboxKey;
window.unlockGeminiKey = unlockGeminiKey;
