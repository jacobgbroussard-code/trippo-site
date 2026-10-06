/* ==========================================================================
   Trippo Travel Planner - Trip Sharing & Realtime Co-Planning (Collaboration)
   js/collab.js
   ========================================================================== */

import {
    trips,
    setTrips,
    saveTrips,
    getActiveTrip,
    setActiveTripId,
    setActivePlacesTripId,
    showNotification,
    closeModal,
    triggerHaptic,
    escapeHTML,
    escapeJS,
    parseLocalDate
} from './state.js';

import { getSupabase, currentUser } from './db.js';

// Map of active Realtime channels: collabRoomId -> SupabaseChannel
const activeChannels = new Map();
let currentShareTripId = null;
let currentShareMode = 'copy'; // 'copy' | 'collab'
let pendingImportData = null;

// --- URL-SAFE ENCODING / DECODING ---
export function encodeTripPayload(trip) {
    try {
        const clean = {
            name: trip.name || 'Untitled Trip',
            startDate: trip.startDate || '',
            isRoundTrip: Boolean(trip.isRoundTrip),
            budgetTravelers: Number(trip.budgetTravelers) || 2,
            stops: Array.isArray(trip.stops) ? trip.stops.map(s => ({
                id: s.id,
                name: s.name,
                lat: s.lat,
                lon: s.lon,
                nights: Number(s.nights) || 0,
                notes: s.notes || [],
                transit: s.transit || null,
                lodging: s.lodging || null,
                locked: Boolean(s.locked)
            })) : [],
            places: Array.isArray(trip.places) ? trip.places.map(p => ({
                id: p.id,
                cityIndex: p.cityIndex,
                dayIndex: p.dayIndex,
                name: p.name,
                category: p.category,
                address: p.address || '',
                notes: p.notes || '',
                lat: p.lat,
                lon: p.lon
            })) : [],
            expenses: Array.isArray(trip.expenses) ? trip.expenses.map(e => ({
                id: e.id,
                title: e.title,
                amount: e.amount,
                splitType: e.splitType
            })) : []
        };
        const jsonStr = JSON.stringify(clean);
        return encodeURIComponent(btoa(unescape(encodeURIComponent(jsonStr))));
    } catch (e) {
        console.error('[Collab] Failed to encode trip payload:', e);
        return '';
    }
}

export function decodeTripPayload(encodedStr) {
    try {
        const jsonStr = decodeURIComponent(escape(atob(decodeURIComponent(encodedStr))));
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error('[Collab] Failed to decode trip payload:', e);
        return null;
    }
}

// --- SHARE MODAL CONTROLLERS ---
export function openShareTripModal(tripId) {
    const targetId = tripId || (getActiveTrip() ? getActiveTrip().id : null);
    const trip = trips.find(t => t.id === targetId) || getActiveTrip() || (trips.length > 0 ? trips[0] : null);
    if (!trip) {
        showNotification("Please select or open a trip to share.");
        return;
    }

    currentShareTripId = trip.id;
    const modal = document.getElementById('share-trip-modal');
    if (!modal) return;

    // Populate trip preview & switcher if multiple trips exist
    const titleEl = document.getElementById('share-modal-trip-name');
    const infoEl = document.getElementById('share-modal-trip-info');
    if (titleEl) {
        if (trips.length > 1) {
            titleEl.innerHTML = `
                <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
                    <select id="share-modal-trip-select" class="form-control" style="font-weight:800; font-size:15px; padding:6px 10px; border-radius:10px; cursor:pointer;" onchange="openShareTripModal(this.value)">
                        ${trips.map(t => `<option value="${t.id}" ${t.id === trip.id ? 'selected' : ''}>${escapeHTML(t.name)}</option>`).join('')}
                    </select>
                </div>
            `;
        } else {
            titleEl.innerText = trip.name;
        }
    }
    if (infoEl) {
        const totalNights = trip.stops ? trip.stops.reduce((sum, s) => sum + (Number(s.nights) || 0), 0) : 0;
        const stopsCount = trip.stops ? trip.stops.length : 0;
        infoEl.innerText = `${stopsCount} Stop${stopsCount !== 1 ? 's' : ''} • ${totalNights} Nights • ${trip.startDate ? trip.startDate : 'Flexible Dates'}`;
    }

    // Default to 'copy' mode unless trip is already collaborative
    currentShareMode = trip.isCollaborative ? 'collab' : 'copy';
    selectShareMode(currentShareMode);

    modal.style.display = 'flex';
    triggerHaptic('light');
}

export function selectShareMode(mode) {
    currentShareMode = mode;
    const trip = trips.find(t => t.id === currentShareTripId) || getActiveTrip();
    if (!trip) return;

    const copyCard = document.getElementById('share-mode-copy-card');
    const collabCard = document.getElementById('share-mode-collab-card');
    const copyRadio = document.getElementById('share-radio-copy');
    const collabRadio = document.getElementById('share-radio-collab');
    const descEl = document.getElementById('share-mode-description');
    const linkInput = document.getElementById('share-link-input');
    const actionBtn = document.getElementById('share-action-copy-btn');
    const collabBadge = document.getElementById('share-collab-active-indicator');

    if (copyCard) copyCard.classList.toggle('selected', mode === 'copy');
    if (collabCard) collabCard.classList.toggle('selected', mode === 'collab');
    if (copyRadio) copyRadio.checked = (mode === 'copy');
    if (collabRadio) collabRadio.checked = (mode === 'collab');

    const origin = window.location.origin + window.location.pathname.replace(/\/index\.html$/, '/');

    if (mode === 'copy') {
        if (descEl) {
            descEl.innerHTML = `
                <div style="font-weight:700; color:var(--text); margin-bottom:4px;">📋 Send a Private Copy</div>
                <div>Your friend gets their own complete duplicate. Edits made by either of you stay <b>100% independent and separate</b>.</div>
            `;
        }
        if (actionBtn) {
            actionBtn.innerHTML = `<span>📋</span> Copy Itinerary Link`;
        }
        if (collabBadge) collabBadge.style.display = 'none';

        const encoded = encodeTripPayload(trip);
        const link = `${origin}#trip-copy=${encoded}`;
        if (linkInput) linkInput.value = link;

    } else {
        // Mode is 'collab'
        if (!trip.collabRoomId) {
            trip.collabRoomId = 'room_' + trip.id + '_' + Math.random().toString(36).substr(2, 6);
            trip.isCollaborative = true;
            saveTrips();
            connectCollabRoom(trip);
        }

        if (descEl) {
            descEl.innerHTML = `
                <div style="font-weight:700; color:var(--primary); margin-bottom:4px;">⚡ Live Co-Planning (Real-Time)</div>
                <div>Multiple friends can co-plan together in real time! Adding stops, places, notes, or budget updates <b>syncs live across all devices</b>.</div>
            `;
        }
        if (actionBtn) {
            actionBtn.innerHTML = `<span>⚡</span> Copy Co-Plan Invite Link`;
        }
        if (collabBadge) {
            collabBadge.style.display = 'inline-flex';
            collabBadge.innerText = `🟢 Room: ${trip.collabRoomId.slice(-6).toUpperCase()}`;
        }

        const encoded = encodeTripPayload(trip);
        const link = `${origin}#collab=${trip.collabRoomId}&tripId=${trip.id}&seed=${encoded}`;
        if (linkInput) linkInput.value = link;
    }
}

export async function copyShareLink() {
    const linkInput = document.getElementById('share-link-input');
    if (!linkInput || !linkInput.value) return;

    try {
        await navigator.clipboard.writeText(linkInput.value);
        triggerHaptic('success');
        showNotification(currentShareMode === 'copy' ? "📋 Copy link copied to clipboard!" : "⚡ Co-Plan invite link copied to clipboard!");
        
        const btn = document.getElementById('share-action-copy-btn');
        if (btn) {
            const originalHTML = btn.innerHTML;
            btn.innerHTML = `<span>✓</span> Copied to Clipboard!`;
            btn.style.background = 'var(--primary)';
            btn.style.color = '#fff';
            setTimeout(() => {
                btn.innerHTML = originalHTML;
                btn.style.background = '';
                btn.style.color = '';
            }, 2200);
        }
    } catch (e) {
        linkInput.select();
        document.execCommand('copy');
        showNotification("Link copied to clipboard!");
    }
}

export function shareViaNative() {
    const linkInput = document.getElementById('share-link-input');
    const trip = trips.find(t => t.id === currentShareTripId) || getActiveTrip();
    if (!linkInput || !trip) return;

    const shareUrl = linkInput.value;
    const shareTitle = currentShareMode === 'copy' 
        ? `Trip Itinerary: ${trip.name}` 
        : `Co-Plan with me: ${trip.name} on Trippo`;
    const shareText = currentShareMode === 'copy'
        ? `Check out my itinerary for "${trip.name}" on Trippo!`
        : `Join my live trip room to plan "${trip.name}" together in real time!`;

    if (navigator.share) {
        navigator.share({
            title: shareTitle,
            text: shareText,
            url: shareUrl
        }).catch(() => {});
    } else {
        copyShareLink();
    }
}

// --- REALTIME WEBSOCKET COLLABORATION ENGINE ---
export function connectCollabRoom(trip) {
    if (!trip || !trip.isCollaborative || !trip.collabRoomId) return;
    if (activeChannels.has(trip.collabRoomId)) return; // already connected

    const client = getSupabase();
    if (!client) return;

    try {
        const channelName = `trippo_${trip.collabRoomId}`;
        const channel = client.channel(channelName, {
            config: { broadcast: { self: false } }
        });

        channel.on('broadcast', { event: 'trip_delta' }, (message) => {
            handleIncomingCollabDelta(message.payload);
        });

        channel.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log(`[Collab] Subscribed to realtime room: ${channelName}`);
                updateCollabBadge(trip.id, true);
            }
        });

        activeChannels.set(trip.collabRoomId, channel);
    } catch (e) {
        console.warn('[Collab] Failed to connect realtime channel:', e);
    }
}

export function leaveCollabRoom(collabRoomId) {
    if (!collabRoomId) return;
    const channel = activeChannels.get(collabRoomId);
    if (channel) {
        try {
            channel.unsubscribe();
        } catch (e) {}
        activeChannels.delete(collabRoomId);
        console.log(`[Collab] Left realtime room: ${collabRoomId}`);
    }
}

// Called whenever a local change is saved (debounced broadcast)
let broadcastDebounceTimer = null;
export function broadcastTripUpdate(trip) {
    if (!trip || !trip.isCollaborative || !trip.collabRoomId) return;
    
    clearTimeout(broadcastDebounceTimer);
    broadcastDebounceTimer = setTimeout(() => {
        let channel = activeChannels.get(trip.collabRoomId);
        if (!channel) {
            connectCollabRoom(trip);
            channel = activeChannels.get(trip.collabRoomId);
        }
        if (!channel) return;

        try {
            const author = currentUser?.user_metadata?.full_name || 
                           currentUser?.user_metadata?.name || 
                           (currentUser?.email ? currentUser.email.split('@')[0] : 'Collaborator');

            channel.send({
                type: 'broadcast',
                event: 'trip_delta',
                payload: {
                    tripId: trip.id,
                    collabRoomId: trip.collabRoomId,
                    timestamp: Date.now(),
                    author: author,
                    tripData: {
                        name: trip.name,
                        startDate: trip.startDate,
                        isRoundTrip: trip.isRoundTrip,
                        stops: trip.stops,
                        places: trip.places,
                        expenses: trip.expenses,
                        budgetTravelers: trip.budgetTravelers
                    }
                }
            });
            console.log(`[Collab] Broadcasted update to ${trip.collabRoomId}`);
        } catch (e) {
            console.warn('[Collab] Broadcast failed:', e);
        }
    }, 300);
}

// Handle incoming delta from another collaborator
function handleIncomingCollabDelta(payload) {
    if (!payload || !payload.collabRoomId || !payload.tripData) return;

    // Find local trip by collabRoomId
    const localTrip = trips.find(t => t.collabRoomId === payload.collabRoomId);
    if (!localTrip) return;

    console.log(`[Collab] Received live update from ${payload.author || 'collaborator'}`);

    // Update in-memory data
    localTrip.name = payload.tripData.name || localTrip.name;
    localTrip.startDate = payload.tripData.startDate !== undefined ? payload.tripData.startDate : localTrip.startDate;
    localTrip.isRoundTrip = payload.tripData.isRoundTrip !== undefined ? payload.tripData.isRoundTrip : localTrip.isRoundTrip;
    localTrip.stops = payload.tripData.stops || localTrip.stops;
    localTrip.places = payload.tripData.places || localTrip.places;
    localTrip.expenses = payload.tripData.expenses || localTrip.expenses;
    localTrip.budgetTravelers = payload.tripData.budgetTravelers || localTrip.budgetTravelers;
    localTrip.lastSyncedAt = Date.now();

    // Persist to local storage silently (without rebroadcasting)
    try {
        localStorage.setItem('myTrips', JSON.stringify(trips));
    } catch(e){}

    // Re-render UI if user is actively viewing this trip
    const activeTrip = getActiveTrip();
    if (activeTrip && activeTrip.id === localTrip.id) {
        if (window.renderPlanner) window.renderPlanner();
        if (window.renderPlacesList) window.renderPlacesList();
        if (window.drawPlannerMapRoute) window.drawPlannerMapRoute();
        showNotification(`⚡ Live update synced from ${payload.author || 'collaborator'}!`);
        triggerHaptic('light');
    }

    if (window.renderHome) window.renderHome();
}

function updateCollabBadge(tripId, isConnected) {
    const badge = document.getElementById('planner-collab-badge');
    if (!badge) return;
    const active = getActiveTrip();
    if (active && active.id === tripId && active.isCollaborative) {
        badge.style.display = 'inline-flex';
        badge.innerHTML = `<span class="collab-pulse-dot"></span> 👥 Live Co-Plan`;
    } else {
        badge.style.display = 'none';
    }
}

// Connect all collaborative trips on startup
export function initAllCollabRooms() {
    trips.forEach(t => {
        if (t.isCollaborative && t.collabRoomId) {
            connectCollabRoom(t);
        }
    });
}

// --- INCOMING LINK IMPORT LISTENER ---
export function checkIncomingShareUrl() {
    const hash = window.location.hash;
    if (!hash) return;

    if (hash.startsWith('#trip-copy=')) {
        const rawPayload = hash.replace('#trip-copy=', '');
        const data = decodeTripPayload(rawPayload);
        if (data) {
            openImportTripModal(data, 'copy');
        }
    } else if (hash.startsWith('#collab=')) {
        const params = new URLSearchParams(hash.slice(1));
        const collabRoomId = params.get('collab');
        const seed = params.get('seed');
        let data = seed ? decodeTripPayload(seed) : null;
        if (!data) {
            data = {
                name: 'Shared Adventure',
                startDate: '',
                stops: [],
                places: []
            };
        }
        data.collabRoomId = collabRoomId;
        openImportTripModal(data, 'collab');
    }
}

export function openImportTripModal(data, mode) {
    pendingImportData = { data, mode };
    const modal = document.getElementById('import-trip-modal');
    if (!modal) return;

    const titleEl = document.getElementById('import-modal-trip-name');
    const badgeEl = document.getElementById('import-modal-badge');
    const descEl = document.getElementById('import-modal-desc');
    const stopsListEl = document.getElementById('import-modal-stops-list');
    const confirmBtn = document.getElementById('import-modal-confirm-btn');

    if (titleEl) titleEl.innerText = data.name || 'Untitled Trip';

    if (mode === 'copy') {
        if (badgeEl) {
            badgeEl.className = 'import-badge copy';
            badgeEl.innerHTML = `<span>📋</span> Standalone Copy`;
        }
        if (descEl) {
            descEl.innerHTML = `This will add a <b>private duplicate</b> to your planner. You can customize and edit it completely on your own without affecting the original trip.`;
        }
        if (confirmBtn) {
            confirmBtn.innerHTML = `<span>✨</span> Add to My Trips`;
            confirmBtn.className = 'save-btn';
        }
    } else {
        if (badgeEl) {
            badgeEl.className = 'import-badge collab';
            badgeEl.innerHTML = `<span>⚡</span> Live Co-Planning`;
        }
        if (descEl) {
            descEl.innerHTML = `You've been invited to <b>plan this trip together in real time</b>! Changes you or your friends make will sync live across accounts.`;
        }
        if (confirmBtn) {
            confirmBtn.innerHTML = `<span>🚀</span> Join & Co-Plan Live`;
            confirmBtn.className = 'save-btn highlight';
        }
    }

    if (stopsListEl) {
        if (data.stops && data.stops.length > 0) {
            const stopsHtml = data.stops.map((s, idx) => `
                <div style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid var(--border-subtle, rgba(0,0,0,0.06)); font-size:13px;">
                    <span style="font-weight:700; color:var(--primary);">${idx + 1}.</span>
                    <span style="font-weight:600; color:var(--text);">${escapeHTML(s.name)}</span>
                    <span style="font-size:12px; color:var(--text-muted); margin-left:auto;">${s.nights || 0} Night${s.nights !== 1 ? 's' : ''}</span>
                </div>
            `).join('');
            stopsListEl.innerHTML = `
                <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--text-muted); margin-bottom:6px;">Itinerary Preview (${data.stops.length} stops)</div>
                ${stopsHtml}
            `;
            stopsListEl.style.display = 'block';
        } else {
            stopsListEl.style.display = 'none';
        }
    }

    modal.style.display = 'flex';
    triggerHaptic('medium');
}

export function confirmImportTrip(asPrivateCopy = false) {
    if (!pendingImportData) return;
    const { data, mode } = pendingImportData;

    const newTripId = 'trip_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    const isCollab = (mode === 'collab' && !asPrivateCopy);

    const importedTrip = {
        id: newTripId,
        name: data.name || 'Imported Trip',
        startDate: data.startDate || '',
        isRoundTrip: Boolean(data.isRoundTrip),
        budgetTravelers: Number(data.budgetTravelers) || 2,
        stops: Array.isArray(data.stops) ? data.stops : [],
        places: Array.isArray(data.places) ? data.places : [],
        expenses: Array.isArray(data.expenses) ? data.expenses : [],
        isExample: false,
        isCollaborative: isCollab,
        collabRoomId: isCollab ? (data.collabRoomId || ('room_' + newTripId)) : null,
        importedAt: Date.now()
    };

    // Add to trips list
    trips.push(importedTrip);
    saveTrips();

    if (isCollab) {
        connectCollabRoom(importedTrip);
    }

    // Clean hash
    history.replaceState(null, '', window.location.pathname);
    closeModal('import-trip-modal');
    pendingImportData = null;

    // Switch to planner view and open new trip
    setActiveTripId(newTripId);
    setActivePlacesTripId(newTripId);
    if (window.renderHome) window.renderHome();
    if (window.switchTab) window.switchTab('planner');
    
    showNotification(isCollab ? `🚀 Joined "${importedTrip.name}" live co-planning!` : `✨ Added "${importedTrip.name}" to your planner!`);
    triggerHaptic('success');
}

export function cancelImportTrip() {
    closeModal('import-trip-modal');
    pendingImportData = null;
    history.replaceState(null, '', window.location.pathname);
}
