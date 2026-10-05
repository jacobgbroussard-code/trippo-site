/* ==========================================================================
   Trippo Travel Planner - Wishlists, Collections & Dropped Pins
   js/wishlist.js
   ========================================================================== */

import {
    wishlistCollections,
    setWishlistCollections,
    wishlistPins,
    setWishlistPins,
    saveWishlist,
    activeWishlistId,
    setActiveWishlistId,
    activeWishlistFilter,
    setActiveWishlistFilter,
    wishlistMinimized,
    setWishlistMinimized,
    normalizeCategory,
    getCategoryVisuals,
    showNotification,
    closeModal,
    escapeHTML,
    escapeJS,
    triggerHaptic,
    trips,
    saveTrips,
    getDistance,
    activePlacesTripId,
    activePlacesStopIndex,
    activePlacesDayIndex,
    activeTripId
} from './state.js';

import { initWishlistMap, wishlistMap, safeInvalidate, wMarkers } from './maps.js';

let droppedTempMarker = null;
export let wishlistSearchTimeout = null;
let wishlistSearchAbortController = null;

export function showWishlistDirectory() {
    cancelDroppedPin();
    setActiveWishlistId('master');
    const wishlistView = document.getElementById('wishlist-view');
    const detailView = document.getElementById('wishlist-detail-view');
    if (wishlistView) wishlistView.classList.remove('has-detail-open');
    if (detailView) detailView.classList.remove('map-expanded');
    const btn = document.getElementById('wishlist-fullscreen-btn');
    if (btn) { btn.innerHTML = '⛶ Full Map'; btn.classList.remove('active-mode'); }
    const dirView = document.getElementById('wishlist-directory-view');
    if (dirView) dirView.style.display = 'block';
    if (detailView) detailView.style.display = 'none';
    renderWishlistCollections();
}


export function renderWishlistCollections() {
    const container = document.getElementById('wishlist-collections-list');
    if (!container) return;
    container.innerHTML = wishlistCollections.map(col => {
        const count = wishlistPins.filter(p => (p.wishlistId || 'master') === col.id).length;
        const safeColId = escapeJS(col.id);
        const safeColName = escapeHTML(col.name);
        const deleteBtn = col.isMaster ? '' : `
            <button onclick="promptDeleteWishlistCollection('${safeColId}', event)" style="background:#fff0f2; border:1px solid #ffd4d9; border-radius:8px; padding:6px 10px; font-size:13px; cursor:pointer; color:var(--accent);" title="Delete List">🗑️</button>
        `;

        return `
        <div class="trip-card" onclick="openWishlistDetail('${safeColId}')">
            <div class="trip-card-content">
                <h3>${safeColName}</h3>
                <p>${count} saved locations</p>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
                ${deleteBtn}
                <div style="color: #b7c7c3; font-size:22px;">›</div>
            </div>
        </div>`;
    }).join('');
}

export function openCreateWishlistModal() {
    const modal = document.getElementById('create-wishlist-modal');
    if (modal) modal.style.display = 'flex';
    const input = document.getElementById('new-wishlist-name');
    if (input) input.value = '';
    setTimeout(() => { if (input) input.focus(); }, 150);
}

export function saveNewWishlistCollection() {
    const name = document.getElementById('new-wishlist-name')?.value.trim();
    if (!name) {
        showNotification("Please provide a wishlist name.");
        return;
    }
    const newCol = {
        id: 'wish_col_' + Date.now(),
        name: '📁 ' + name,
        isMaster: false
    };
    wishlistCollections.push(newCol);
    saveWishlist();
    closeModal('create-wishlist-modal');
    openWishlistDetail(newCol.id);
    showNotification(`Created wishlist "${name}"!`);
}

export function promptDeleteWishlistCollection(id, e) {
    if (e && e.stopPropagation) e.stopPropagation();
    const col = wishlistCollections.find(c => c.id === id);
    if (!col || col.isMaster) return;

    if (confirm(`Delete the wishlist "${col.name}"? Pins will be moved to the Master Wishlist.`)) {
        triggerHaptic('warning');
        wishlistPins.forEach(p => {
            if (p.wishlistId === id) p.wishlistId = 'master';
        });
        setWishlistCollections(wishlistCollections.filter(c => c.id !== id));
        if (activeWishlistId === id) {
            setActiveWishlistId('master');
        }
        saveWishlist();
        renderWishlistCollections();
        showNotification(`Deleted list "${col.name}".`);
    }
}

export function openWishlistDetail(colId) {
    setActiveWishlistId(colId);
    const col = wishlistCollections.find(c => c.id === colId) || wishlistCollections[0];
    const heading = document.getElementById('active-wishlist-heading');
    if (heading) heading.innerText = col.name;

    const wishlistView = document.getElementById('wishlist-view');
    if (wishlistView) wishlistView.classList.add('has-detail-open');

    const dirView = document.getElementById('wishlist-directory-view');
    const detailView = document.getElementById('wishlist-detail-view');
    if (dirView) dirView.style.display = 'none';
    if (detailView) detailView.style.display = 'flex';

    initWishlistMap();
    renderWishlistPins(true);
    [50, 150, 300, 500].forEach(d => safeInvalidate(wishlistMap, d));
}

export async function handleWishlistMapClick(e) {
    const lat = e.latlng.lat;
    const lon = e.latlng.lng;

    cancelDroppedPin();

    if (typeof L === 'undefined') return;

    const tempIcon = L.divIcon({
        className: 'custom-div-icon',
        html: `<div style="background:var(--accent);color:white;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;border:2.5px solid white;box-shadow:0 4px 12px rgba(255,71,87,0.5);">📍</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
    });

    droppedTempMarker = L.marker([lat, lon], { icon: tempIcon }).addTo(wishlistMap);
    const placeholderName = `Location (${lat.toFixed(3)}, ${lon.toFixed(3)})`;

    const popupHtml = `
        <div class="wishlist-bubble-card">
            <span style="font-size:11px; font-weight:700; color:var(--accent); text-transform:uppercase; letter-spacing:0.5px;">Drop New Pin</span>
            <input type="text" id="drop-pin-name" value="${placeholderName}" style="width:100%; padding:6px; font-size:13px; font-weight:700; border-radius:8px; border:1px solid var(--border-subtle); margin:4px 0 6px 0;">
            
            <div style="margin-bottom:6px;">
                <label style="font-size:10px; font-weight:700; color:#71837f; text-transform:uppercase;">Category</label>
                <select id="drop-pin-cat" style="width:100%; padding:4px 6px; font-size:12px; border-radius:8px; border:1px solid var(--border-subtle); margin-top:2px;">
                    <option value="Cities">🏙 Cities</option>
                    <option value="Nature">🌲 Nature</option>
                    <option value="Attractions">🏛 Attractions</option>
                    <option value="Fun">🎉 Fun</option>
                    <option value="Food">🍽 Food</option>
                </select>
            </div>

            <div style="margin-bottom:8px;">
                <label style="font-size:10px; font-weight:700; color:#71837f; text-transform:uppercase;">Notes</label>
                <textarea id="drop-pin-note" placeholder="Personal tips, why visit..." style="width:100%; height:50px; padding:6px; font-size:12px; border-radius:8px; border:1px solid var(--border-subtle); resize:none; margin-top:2px; font-family:inherit;"></textarea>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center;">
                <button onclick="saveDroppedWishlistPin(${lat}, ${lon})" style="background:var(--primary); color:white; border:none; padding:6px 14px; border-radius:8px; font-size:12px; font-weight:700; cursor:pointer;">Save Pin</button>
                <button onclick="cancelDroppedPin()" style="background:none; border:none; color:#8fa09c; font-size:11px; cursor:pointer;">Cancel</button>
            </div>
        </div>
    `;

    droppedTempMarker.bindPopup(popupHtml).openPopup();

    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10`);
        const data = await res.json();
        if (data && data.address) {
            const resolved = data.address.city || data.address.town || data.address.village || data.address.county || data.name || data.display_name.split(',')[0];
            const inputEl = document.getElementById('drop-pin-name');
            if (inputEl && resolved) inputEl.value = resolved;
        }
    } catch (err) {}
}

export function cancelDroppedPin() {
    if (droppedTempMarker && wishlistMap) {
        wishlistMap.removeLayer(droppedTempMarker);
        droppedTempMarker = null;
    }
}

export function saveDroppedWishlistPin(lat, lon) {
    const nameEl = document.getElementById('drop-pin-name');
    const catEl = document.getElementById('drop-pin-cat');
    const noteEl = document.getElementById('drop-pin-note');

    const name = (nameEl ? nameEl.value.trim() : '') || `Pin (${lat.toFixed(3)}, ${lon.toFixed(3)})`;
    const category = normalizeCategory(catEl ? catEl.value : 'Cities');
    const notes = noteEl ? noteEl.value.trim() : '';

    wishlistPins.push({
        id: `pin_${Date.now()}`,
        wishlistId: activeWishlistId || 'master',
        name: name,
        category: category,
        lat: lat,
        lon: lon,
        notes: notes
    });

    filterWishlistCategory('All');
    saveWishlist();
    cancelDroppedPin();
    renderWishlistPins(false);
    renderWishlistCollections();
    showNotification(`Dropped and saved ${name}!`);
}

export function openWishlistSearchModal() {
    const modal = document.getElementById('wishlist-search-modal');
    if (modal) modal.style.display = 'flex';
    const form = document.getElementById('wishlist-add-form');
    if (form) form.style.display = 'none';
    const input = document.getElementById('wishlist-search-input');
    if (input) input.value = '';
    const results = document.getElementById('wishlist-search-results');
    if (results) results.innerHTML = '';
    const clearBtn = document.getElementById('clear-wishlist-search-input');
    if (clearBtn) clearBtn.style.display = 'none';
    setTimeout(() => { if (input) input.focus(); }, 150);
}

export function searchWishlistLocation(query) {
    clearTimeout(wishlistSearchTimeout);
    if (wishlistSearchAbortController) {
        wishlistSearchAbortController.abort();
        wishlistSearchAbortController = null;
    }
    const resultsDiv = document.getElementById('wishlist-search-results');
    if (!resultsDiv) return;

    if (!query || query.trim().length < 2) {
        resultsDiv.innerHTML = '';
        resultsDiv.style.display = 'none';
        return;
    }

    wishlistSearchTimeout = setTimeout(async () => {
        try {
            wishlistSearchAbortController = new AbortController();
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`, {
                signal: wishlistSearchAbortController.signal
            });
            const data = await res.json();
            if (data && data.length > 0) {
                resultsDiv.innerHTML = data.map(item => {
                    const rawName = item.name || item.display_name.split(',')[0];
                    const safeName = escapeJS(rawName);
                    const displayName = escapeHTML(rawName);
                    const safeAddress = escapeHTML(item.display_name.substring(0, 50));
                    return `
                    <div class="search-result" onclick="selectWishlistLocation('${safeName}', ${item.lat}, ${item.lon})">
                        <strong>${displayName}</strong><br>
                        <small style="color:var(--text-muted, #777);">${safeAddress}...</small>
                    </div>`;
                }).join('');
                resultsDiv.style.display = 'block';
            } else {
                resultsDiv.innerHTML = `<div style="padding: 10px; font-size: 13px; color: var(--text-muted, #777); text-align: center;">No locations found for "${escapeHTML(query)}"</div>`;
                resultsDiv.style.display = 'block';
            }
        } catch (e) {
            if (e.name !== 'AbortError') {
                console.error("Wishlist search failed:", e);
            }
        }
    }, 300);
}

export function selectWishlistLocation(name, lat, lon) {
    const results = document.getElementById('wishlist-search-results');
    if (results) {
        results.innerHTML = '';
        results.style.display = 'none';
    }
    const form = document.getElementById('wishlist-add-form');
    if (form) form.style.display = 'block';

    const nameInput = document.getElementById('add-wish-name');
    const latInput = document.getElementById('add-wish-lat');
    const lonInput = document.getElementById('add-wish-lon');

    if (nameInput) nameInput.value = name;
    if (latInput) latInput.value = lat;
    if (lonInput) lonInput.value = lon;
}

export function saveWishlistPin() {
    const name = document.getElementById('add-wish-name')?.value.trim();
    const category = normalizeCategory(document.getElementById('add-wish-cat')?.value);
    const notes = document.getElementById('add-wish-notes')?.value.trim() || '';
    const lat = parseFloat(document.getElementById('add-wish-lat')?.value);
    const lon = parseFloat(document.getElementById('add-wish-lon')?.value);

    if (!name) {
        showNotification("Destination name cannot be empty.");
        return;
    }

    wishlistPins.push({
        id: `wish_${Date.now()}`,
        wishlistId: activeWishlistId || 'master',
        name: name,
        category: category,
        lat: lat,
        lon: lon,
        notes: notes
    });
    saveWishlist();
    closeModal('wishlist-search-modal');
    renderWishlistPins(false);
    renderWishlistCollections();
    showNotification(`Added ${name} to wishlist!`);
}

export function updateWishlistInlineNote(id, newNotes) {
    const pin = wishlistPins.find(p => p.id === id);
    if (pin) {
        pin.notes = newNotes;
        saveWishlist();
    }
}

export function updateWishlistCategory(id, newCat) {
    const pin = wishlistPins.find(p => p.id === id);
    if (pin) {
        pin.category = normalizeCategory(newCat);
        saveWishlist();
        renderWishlistPins(false);
    }
}

export function saveWishlistBubbleEdits(id) {
    const pin = wishlistPins.find(p => p.id === id);
    if (pin) {
        const noteEl = document.getElementById(`bubble-note-${id}`);
        const catEl = document.getElementById(`bubble-cat-${id}`);
        if (noteEl) pin.notes = noteEl.value;
        if (catEl) pin.category = normalizeCategory(catEl.value);
        saveWishlist();
        renderWishlistPins(false);
        showNotification("Pin updated!");
    }
}

export function deleteWishlistPin(id) {
    const pin = wishlistPins.find(p => p.id === id);
    const pinName = pin ? pin.name : 'this pin';
    if (!confirm(`Are you sure you want to remove "${pinName}" from your wishlist?`)) return;
    triggerHaptic('warning');
    setWishlistPins(wishlistPins.filter(p => p.id !== id));
    saveWishlist();
    renderWishlistPins(false);
    renderWishlistCollections();
    showNotification("Wishlist pin removed.");
}

export function filterWishlistCategory(cat) {
    setActiveWishlistFilter(cat);
    document.querySelectorAll('#wishlist-filter-row .day-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.category === cat);
    });
    renderWishlistPins(true);
}

export function renderWishlistPins(autoFit = true) {
    if (!wishlistMap) return;
    wMarkers.forEach(m => wishlistMap.removeLayer(m));
    wMarkers.length = 0;

    const container = document.getElementById('wishlist-pins-container');
    if (!container) return;

    const currentCollectionPins = wishlistPins.filter(p => (p.wishlistId || 'master') === (activeWishlistId || 'master'));
    const filteredPins = currentCollectionPins.filter(p => activeWishlistFilter === 'All' || normalizeCategory(p.category) === activeWishlistFilter);

    if (filteredPins.length === 0) {
        container.innerHTML = `<p style="text-align:center; color:#8fa09c; margin-top:20px; font-size:14px;">No destinations in this wishlist match this category.</p>`;
        if (autoFit) wishlistMap.setView([20, 0], 2);
        return;
    }

    container.innerHTML = filteredPins.map(p => {
        const gMapsSearchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}`;
        const allTrailsUrl = `https://www.alltrails.com/explore?b_tl_lat=${p.lat + 0.05}&b_tl_lng=${p.lon - 0.05}&b_br_lat=${p.lat - 0.05}&b_br_lng=${p.lon + 0.05}`;
        const normCat = normalizeCategory(p.category);
        const safeId = escapeJS(p.id);
        const safeName = escapeHTML(p.name);
        const safeNotes = escapeHTML(p.notes || '');

        return `
        <div class="place-item-card" style="border-left: 4px solid var(--accent); align-items: stretch; gap: 14px;">
            <div style="flex: 1; display: flex; flex-direction: column; justify-content: center;">
                <select class="form-control" style="width: auto; padding: 4px 8px; font-size: 11px; font-weight: 700; margin-bottom: 6px; background:var(--primary-light); color:var(--primary); border:none;" onchange="updateWishlistCategory('${safeId}', this.value)">
                    <option value="Cities" ${normCat === 'Cities' ? 'selected' : ''}>🏙 Cities</option>
                    <option value="Nature" ${normCat === 'Nature' ? 'selected' : ''}>🌲 Nature</option>
                    <option value="Attractions" ${normCat === 'Attractions' ? 'selected' : ''}>🏛 Attractions</option>
                    <option value="Fun" ${normCat === 'Fun' ? 'selected' : ''}>🎉 Fun</option>
                    <option value="Food" ${normCat === 'Food' ? 'selected' : ''}>🍽 Food</option>
                </select>
                <h4 style="margin: 0 0 4px 0; font-size: 16px; color: var(--primary); font-weight:700;">${safeName}</h4>
                <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:3px;">
                    <a href="${gMapsSearchUrl}" target="_blank" rel="noopener noreferrer" style="font-size:11px; font-weight:700; color:#1a73e8; text-decoration:none;">📸 Photos ›</a>
                    <a href="${allTrailsUrl}" target="_blank" rel="noopener noreferrer" style="font-size:11px; font-weight:700; color:#2b7c62; text-decoration:none;">🥾 Trails ›</a>
                    <button type="button" onclick="openAddWishlistPinToTripModal('${safeId}')" style="background:var(--primary-light); border:1px solid var(--border-subtle); border-radius:6px; padding:2px 8px; font-size:11px; font-weight:700; color:var(--primary); cursor:pointer;" title="Add this place to a trip itinerary">✈ Add to Trip ›</button>
                </div>
            </div>
            <div style="flex: 1; display: flex; align-items: center; gap: 8px;">
                <textarea class="form-control" style="height: 65px; font-size: 13px; background: var(--bg);" placeholder="Add personal notes..." oninput="updateWishlistInlineNote('${safeId}', this.value)">${safeNotes}</textarea>
                <button onclick="deleteWishlistPin('${safeId}')" style="background:#fff0f2; border:1px solid #ffd4d9; border-radius:8px; padding:8px 10px; font-size:14px; cursor:pointer; color:var(--accent); height: fit-content;" title="Remove Pin">🗑</button>
            </div>
        </div>`;
    }).join('');

    const bounds = L.latLngBounds();
    filteredPins.forEach(p => {
        const visuals = getCategoryVisuals(p.category);
        const normCat = normalizeCategory(p.category);
        const safeId = escapeJS(p.id);
        const safeName = escapeHTML(p.name);
        const safeNotes = escapeHTML(p.notes || '');

        const icon = L.divIcon({
            className: 'custom-div-icon',
            html: `<div style="background:${visuals.color};color:white;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:16px;border:2.5px solid white;box-shadow:0 3px 8px rgba(0,0,0,0.3);">${visuals.emoji}</div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });
        const marker = L.marker([p.lat, p.lon], { icon: icon }).addTo(wishlistMap);

        const gMapsSearchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}`;
        const allTrailsUrl = `https://www.alltrails.com/explore?b_tl_lat=${p.lat + 0.05}&b_tl_lng=${p.lon - 0.05}&b_br_lat=${p.lat - 0.05}&b_br_lng=${p.lon + 0.05}`;

        const popupContent = `
            <div class="wishlist-bubble-card">
                <strong style="font-size:14px; color:var(--primary); display:block; margin-bottom:6px;">${safeName}</strong>
                
                <div style="margin-bottom:6px;">
                    <label style="font-size:10px; font-weight:700; color:#71837f; text-transform:uppercase;">Category</label>
                    <select id="bubble-cat-${safeId}" style="width:100%; padding:4px 6px; font-size:12px; border-radius:8px; border:1px solid var(--border-subtle); margin-top:2px;">
                        <option value="Cities" ${normCat === 'Cities' ? 'selected' : ''}>🏙 Cities</option>
                        <option value="Nature" ${normCat === 'Nature' ? 'selected' : ''}>🌲 Nature</option>
                        <option value="Attractions" ${normCat === 'Attractions' ? 'selected' : ''}>🏛 Attractions</option>
                        <option value="Fun" ${normCat === 'Fun' ? 'selected' : ''}>🎉 Fun</option>
                        <option value="Food" ${normCat === 'Food' ? 'selected' : ''}>🍽 Food</option>
                    </select>
                </div>

                <div style="margin-bottom:8px;">
                    <label style="font-size:10px; font-weight:700; color:#71837f; text-transform:uppercase;">Notes</label>
                    <textarea id="bubble-note-${safeId}" placeholder="Type notes here..." style="width:100%; height:55px; padding:6px; font-size:12px; border-radius:8px; border:1px solid var(--border-subtle); resize:none; margin-top:2px; font-family:inherit;">${safeNotes}</textarea>
                </div>

                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <button onclick="saveWishlistBubbleEdits('${safeId}')" style="background:var(--primary); color:white; border:none; padding:5px 10px; border-radius:8px; font-size:11px; font-weight:700; cursor:pointer;">Save</button>
                    <div style="display:flex; gap:6px; align-items:center;">
                        <a href="${gMapsSearchUrl}" target="_blank" rel="noopener noreferrer" style="color:#1a73e8; font-weight:700; font-size:11px; text-decoration:none;">Photos</a>
                        <a href="${allTrailsUrl}" target="_blank" rel="noopener noreferrer" style="color:#2b7c62; font-weight:700; font-size:11px; text-decoration:none;">Trails</a>
                        <button type="button" onclick="openAddWishlistPinToTripModal('${safeId}')" style="background:var(--primary-light); color:var(--primary); border:none; padding:3px 7px; border-radius:6px; font-size:10px; font-weight:700; cursor:pointer;">✈ To Trip</button>
                    </div>
                </div>
            </div>
        `;

        marker.bindPopup(popupContent);
        wMarkers.push(marker);
        bounds.extend([p.lat, p.lon]);
    });

    if (autoFit) {
        if (filteredPins.length > 1) {
            wishlistMap.fitBounds(bounds, { padding: [60, 60], maxZoom: 4 });
        } else if (filteredPins.length === 1) {
            wishlistMap.setView([filteredPins[0].lat, filteredPins[0].lon], 3);
        } else {
            wishlistMap.setView([20, 0], 2);
        }
    }
}

export function toggleWishlistSheetSize() {
    if (typeof window !== 'undefined' && window.toggleMapMode) {
        window.toggleMapMode('wishlist');
    }
}


export function handleWishlistFileImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        const content = e.target.result;
        if (file.name.toLowerCase().endsWith('.kml')) parseKMLWishlist(content);
        event.target.value = '';
    };
    reader.readAsText(file);
}

export function parseKMLWishlist(kmlString) {
    try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(kmlString, "text/xml");
        const placemarks = xmlDoc.getElementsByTagName("Placemark");
        let added = 0;
        for (let i = 0; i < placemarks.length; i++) {
            const pm = placemarks[i];
            const name = pm.getElementsByTagName("name")[0]?.textContent.trim();
            const desc = pm.getElementsByTagName("description")[0]?.textContent.trim() || '';
            const coords = pm.getElementsByTagName("coordinates")[0]?.textContent.trim();
            if (name && coords) {
                const parts = coords.replace(/[\r\n\t]/g, ' ').split(/[\s,]+/);
                if (parts.length >= 2) {
                    const lon = parseFloat(parts[0]);
                    const lat = parseFloat(parts[1]);
                    if (!isNaN(lat) && !isNaN(lon)) {
                        wishlistPins.push({
                            id: `kml_${Date.now()}_${i}`,
                            wishlistId: activeWishlistId || 'master',
                            name,
                            lat,
                            lon,
                            category: 'Cities',
                            notes: desc
                        });
                        added++;
                    }
                }
            }
        }
        if (added > 0) {
            saveWishlist();
            renderWishlistPins(true);
            showNotification(`Imported ${added} pins to current wishlist!`);
        }
    } catch (e) {
        showNotification("Error parsing KML file.");
    }
}

export function exportWishlistKML() {
    const currentPins = wishlistPins.filter(p => (p.wishlistId || 'master') === (activeWishlistId || 'master'));
    const col = wishlistCollections.find(c => c.id === activeWishlistId) || { name: 'Master Wishlist' };

    let kml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    kml += `<kml xmlns="http://www.opengis.net/kml/2.2">\n`;
    kml += `  <Document>\n`;
    kml += `    <name>${col.name.replace(/[^a-zA-Z0-9_\-\s]/g, '')}</name>\n`;

    currentPins.forEach(pin => {
        kml += `    <Placemark>\n`;
        kml += `      <name><![CDATA[${pin.name}]]></name>\n`;
        kml += `      <description><![CDATA[${pin.notes || ''}]]></description>\n`;
        kml += `      <Point>\n`;
        kml += `        <coordinates>${pin.lon},${pin.lat},0</coordinates>\n`;
        kml += `      </Point>\n`;
        kml += `    </Placemark>\n`;
    });

    kml += `  </Document>\n`;
    kml += `</kml>`;

    const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${col.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_Wishlist.kml`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showNotification("Wishlist KML exported!");
}

// --- ADD WISHLIST PIN TO TRIP MODAL LOGIC ---
export function openAddWishlistPinToTripModal(pinId) {
    const pin = wishlistPins.find(p => String(p.id) === String(pinId));
    if (!pin) {
        showNotification("Could not find this wishlist item.");
        return;
    }

    if (!trips || trips.length === 0) {
        showNotification("No trips found! Create a trip first in the Trips tab.");
        return;
    }

    const modal = document.getElementById('add-wishlist-to-trip-modal');
    if (!modal) return;

    const idEl = document.getElementById('add-pin-to-trip-pin-id');
    const nameEl = document.getElementById('add-pin-to-trip-name');
    const notesEl = document.getElementById('add-pin-to-trip-notes');
    const catEl = document.getElementById('add-pin-to-trip-select-cat');

    if (idEl) idEl.value = pin.id;
    if (nameEl) nameEl.textContent = pin.name;
    if (notesEl) notesEl.value = pin.notes || '';

    // Smart-map category:
    if (catEl) {
        const norm = normalizeCategory(pin.category);
        if (norm === 'Food') catEl.value = '🍽 Food & Drink';
        else catEl.value = '● See & Do';
    }

    // Populate trips select
    const tripSelect = document.getElementById('add-pin-to-trip-select-trip');
    if (tripSelect) {
        tripSelect.innerHTML = trips.map(t => {
            const numStops = Array.isArray(t.stops) ? t.stops.length : 0;
            return `<option value="${escapeHTML(t.id)}">${escapeHTML(t.name)} (${numStops} stops)</option>`;
        }).join('');

        const preferredTripId = (activePlacesTripId && trips.some(t => t.id === activePlacesTripId))
            ? activePlacesTripId
            : (activeTripId && trips.some(t => t.id === activeTripId) ? activeTripId : trips[0].id);
        tripSelect.value = preferredTripId;
    }

    updateAddPinModalStops(pin);
    modal.style.display = 'flex';
}

export function updateAddPinModalStops(pin) {
    const tripSelect = document.getElementById('add-pin-to-trip-select-trip');
    const stopSelect = document.getElementById('add-pin-to-trip-select-stop');
    const daySelect = document.getElementById('add-pin-to-trip-select-day');
    const warningEl = document.getElementById('add-pin-to-trip-warning');
    const submitBtn = document.getElementById('add-pin-to-trip-submit-btn');

    if (!tripSelect || !stopSelect) return;

    const selectedTripId = tripSelect.value;
    const trip = trips.find(t => t.id === selectedTripId);

    if (!trip || !Array.isArray(trip.stops) || trip.stops.length === 0) {
        stopSelect.innerHTML = '<option value="-1">No stops in this trip</option>';
        stopSelect.disabled = true;
        if (daySelect) {
            daySelect.innerHTML = '<option value="0">Day 1</option>';
            daySelect.disabled = true;
        }
        if (warningEl) {
            warningEl.textContent = 'This trip has no stops yet. Add a stop in Route first!';
            warningEl.style.display = 'block';
        }
        if (submitBtn) submitBtn.disabled = true;
        return;
    }

    stopSelect.disabled = false;
    if (warningEl) warningEl.style.display = 'none';
    if (submitBtn) submitBtn.disabled = false;

    // Smart default: If pin has lat/lon, find the closest stop in this trip
    let bestStopIdx = 0;
    if (pin && pin.lat && pin.lon) {
        let minDist = Infinity;
        trip.stops.forEach((s, idx) => {
            if (s.lat && s.lon) {
                const d = getDistance(pin.lat, pin.lon, s.lat, s.lon);
                if (d < minDist) {
                    minDist = d;
                    bestStopIdx = idx;
                }
            }
        });
    }

    stopSelect.innerHTML = trip.stops.map((s, idx) => {
        return `<option value="${idx}" ${idx === bestStopIdx ? 'selected' : ''}>Stop ${idx + 1}: ${escapeHTML(s.name)}</option>`;
    }).join('');

    updateAddPinModalDays();
}

export function updateAddPinModalDays() {
    const tripSelect = document.getElementById('add-pin-to-trip-select-trip');
    const stopSelect = document.getElementById('add-pin-to-trip-select-stop');
    const daySelect = document.getElementById('add-pin-to-trip-select-day');

    if (!tripSelect || !stopSelect || !daySelect) return;
    const trip = trips.find(t => t.id === tripSelect.value);
    const stopIdx = parseInt(stopSelect.value, 10);

    if (!trip || !trip.stops || isNaN(stopIdx) || stopIdx < 0 || !trip.stops[stopIdx]) {
        daySelect.innerHTML = '<option value="0">Day 1</option>';
        daySelect.disabled = true;
        return;
    }

    daySelect.disabled = false;
    const stop = trip.stops[stopIdx];
    const numDays = Math.max(1, Number(stop.nights) || 1);

    let html = '';
    for (let i = 0; i < numDays; i++) {
        html += `<option value="${i}">Day ${i + 1}</option>`;
    }
    daySelect.innerHTML = html;
}

export function handleAddPinTripChange() {
    const pinId = document.getElementById('add-pin-to-trip-pin-id')?.value;
    const pin = wishlistPins.find(p => String(p.id) === String(pinId));
    updateAddPinModalStops(pin);
}

export function handleAddPinStopChange() {
    updateAddPinModalDays();
}

export function confirmAddWishlistPinToTrip() {
    const pinId = document.getElementById('add-pin-to-trip-pin-id')?.value;
    const pin = wishlistPins.find(p => String(p.id) === String(pinId));
    if (!pin) {
        showNotification("Could not find wishlist item.");
        return;
    }

    const tripSelect = document.getElementById('add-pin-to-trip-select-trip');
    const stopSelect = document.getElementById('add-pin-to-trip-select-stop');
    const daySelect = document.getElementById('add-pin-to-trip-select-day');
    const catSelect = document.getElementById('add-pin-to-trip-select-cat');
    const notesInput = document.getElementById('add-pin-to-trip-notes');

    const trip = trips.find(t => t.id === tripSelect?.value);
    const stopIdx = parseInt(stopSelect?.value, 10);
    const dayIdx = parseInt(daySelect?.value, 10) || 0;

    if (!trip || !trip.stops || isNaN(stopIdx) || stopIdx < 0 || !trip.stops[stopIdx]) {
        showNotification("Please select a valid trip stop.");
        return;
    }

    const stop = trip.stops[stopIdx];
    const category = catSelect?.value || '● See & Do';
    const notes = notesInput?.value.trim() || pin.notes || '';

    if (!Array.isArray(trip.places)) trip.places = [];

    // Duplicate safety check
    const isDuplicate = trip.places.some(p => p.cityIndex === stopIdx && p.dayIndex === dayIdx && (p.name || '').toLowerCase() === (pin.name || '').toLowerCase());
    if (isDuplicate) {
        if (!confirm(`"${pin.name}" is already on Day ${dayIdx + 1} of ${stop.name}. Add it anyway?`)) {
            return;
        }
    }

    trip.places.push({
        id: `poi_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        cityIndex: stopIdx,
        dayIndex: dayIdx,
        name: pin.name,
        category: category,
        address: pin.name,
        notes: notes,
        lat: pin.lat || stop.lat,
        lon: pin.lon || stop.lon
    });

    saveTrips();
    triggerHaptic('success');
    closeModal('add-wishlist-to-trip-modal');

    if (activePlacesTripId === trip.id && activePlacesStopIndex === stopIdx && activePlacesDayIndex === dayIdx) {
        if (typeof window.renderCityPlaces === 'function') {
            window.renderCityPlaces();
        }
    }

    showNotification(`✓ Added "${pin.name}" to ${trip.name} - ${stop.name} (Day ${dayIdx + 1})!`);
}
