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
    closeModal
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
        const deleteBtn = col.isMaster ? '' : `
            <button onclick="promptDeleteWishlistCollection('${col.id}', event)" style="background:#fff0f2; border:1px solid #ffd4d9; border-radius:8px; padding:6px 10px; font-size:13px; cursor:pointer; color:var(--accent);" title="Delete List">🗑️</button>
        `;

        return `
        <div class="trip-card" onclick="openWishlistDetail('${col.id}')">
            <div class="trip-card-content">
                <h3>${col.name}</h3>
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
    setTimeout(() => { if (input) input.focus(); }, 150);
}

export function searchWishlistLocation(query) {
    // Deprecated Nominatim handler - disabled in favor of Google Places Autocomplete
    clearTimeout(wishlistSearchTimeout);
    if (wishlistSearchAbortController) {
        wishlistSearchAbortController.abort();
        wishlistSearchAbortController = null;
    }
    const resultsDiv = document.getElementById('wishlist-search-results');
    if (resultsDiv) {
        resultsDiv.innerHTML = '';
        resultsDiv.style.display = 'none';
    }
}

export function selectWishlistLocation(name, lat, lon) {
    const results = document.getElementById('wishlist-search-results');
    if (results) results.innerHTML = '';
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

        return `
        <div class="place-item-card" style="border-left: 4px solid var(--accent); align-items: stretch; gap: 14px;">
            <div style="flex: 1; display: flex; flex-direction: column; justify-content: center;">
                <select class="form-control" style="width: auto; padding: 4px 8px; font-size: 11px; font-weight: 700; margin-bottom: 6px; background:var(--primary-light); color:var(--primary); border:none;" onchange="updateWishlistCategory('${p.id}', this.value)">
                    <option value="Cities" ${normCat === 'Cities' ? 'selected' : ''}>🏙 Cities</option>
                    <option value="Nature" ${normCat === 'Nature' ? 'selected' : ''}>🌲 Nature</option>
                    <option value="Attractions" ${normCat === 'Attractions' ? 'selected' : ''}>🏛 Attractions</option>
                    <option value="Fun" ${normCat === 'Fun' ? 'selected' : ''}>🎉 Fun</option>
                    <option value="Food" ${normCat === 'Food' ? 'selected' : ''}>🍽 Food</option>
                </select>
                <h4 style="margin: 0 0 4px 0; font-size: 16px; color: var(--primary); font-weight:700;">${p.name}</h4>
                <div style="display:flex; gap:10px; margin-top:2px;">
                    <a href="${gMapsSearchUrl}" target="_blank" style="font-size:11px; font-weight:700; color:#1a73e8; text-decoration:none;">📸 Google Photos ›</a>
                    <a href="${allTrailsUrl}" target="_blank" style="font-size:11px; font-weight:700; color:#2b7c62; text-decoration:none;">🥾 AllTrails ›</a>
                </div>
            </div>
            <div style="flex: 1; display: flex; align-items: center; gap: 8px;">
                <textarea class="form-control" style="height: 65px; font-size: 13px; background: var(--bg);" placeholder="Add personal notes..." oninput="updateWishlistInlineNote('${p.id}', this.value)">${p.notes || ''}</textarea>
                <button onclick="deleteWishlistPin('${p.id}')" style="background:#fff0f2; border:1px solid #ffd4d9; border-radius:8px; padding:8px 10px; font-size:14px; cursor:pointer; color:var(--accent); height: fit-content;" title="Remove Pin">🗑</button>
            </div>
        </div>`;
    }).join('');

    const bounds = L.latLngBounds();
    filteredPins.forEach(p => {
        const visuals = getCategoryVisuals(p.category);
        const normCat = normalizeCategory(p.category);

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
                <strong style="font-size:14px; color:var(--primary); display:block; margin-bottom:6px;">${p.name}</strong>
                
                <div style="margin-bottom:6px;">
                    <label style="font-size:10px; font-weight:700; color:#71837f; text-transform:uppercase;">Category</label>
                    <select id="bubble-cat-${p.id}" style="width:100%; padding:4px 6px; font-size:12px; border-radius:8px; border:1px solid var(--border-subtle); margin-top:2px;">
                        <option value="Cities" ${normCat === 'Cities' ? 'selected' : ''}>🏙 Cities</option>
                        <option value="Nature" ${normCat === 'Nature' ? 'selected' : ''}>🌲 Nature</option>
                        <option value="Attractions" ${normCat === 'Attractions' ? 'selected' : ''}>🏛 Attractions</option>
                        <option value="Fun" ${normCat === 'Fun' ? 'selected' : ''}>🎉 Fun</option>
                        <option value="Food" ${normCat === 'Food' ? 'selected' : ''}>🍽 Food</option>
                    </select>
                </div>

                <div style="margin-bottom:8px;">
                    <label style="font-size:10px; font-weight:700; color:#71837f; text-transform:uppercase;">Notes</label>
                    <textarea id="bubble-note-${p.id}" placeholder="Type notes here..." style="width:100%; height:55px; padding:6px; font-size:12px; border-radius:8px; border:1px solid var(--border-subtle); resize:none; margin-top:2px; font-family:inherit;">${p.notes || ''}</textarea>
                </div>

                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <button onclick="saveWishlistBubbleEdits('${p.id}')" style="background:var(--primary); color:white; border:none; padding:5px 10px; border-radius:8px; font-size:11px; font-weight:700; cursor:pointer;">Save</button>
                    <div style="display:flex; gap:6px;">
                        <a href="${gMapsSearchUrl}" target="_blank" style="color:#1a73e8; font-weight:700; font-size:11px; text-decoration:none;">Photos</a>
                        <a href="${allTrailsUrl}" target="_blank" style="color:#2b7c62; font-weight:700; font-size:11px; text-decoration:none;">Trails</a>
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
