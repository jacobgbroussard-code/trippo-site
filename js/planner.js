/* ==========================================================================
   Trippo Travel Planner - Planner & Stop Sequence Optimization
   js/planner.js
   ========================================================================== */

import { ticketLink } from './travel-payouts.js';
import {
    getActiveTrip,
    trips,
    saveTrips,
    parseLocalDate,
    formatLocalDate,
    showNotification,
    closeModal,
    escapeHTML,
    escapeJS,
    triggerHaptic,
    normalizeTrip,
    formatTempF, isReducedMotion, icon, searchOSM,
} from './state.js';

import { drawPlannerMapRoute, plannerMap, pMarkers, hasCoords, highlightPlannerLeg } from './maps.js';
import { getDestinationWeather } from './weather.js';
import { getDistanceUnit, getShowDistances } from './settings.js';

export let citySearchTimeout = null;
let citySearchAbortController = null;

export function getStopFlag(stop) {
    if (!stop || !stop.name) return '📍';
    const name = stop.name.toLowerCase();

    // Check if name already has an emoji flag
    const flagRegex = /[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]/;
    const existing = stop.name.match(flagRegex);
    if (existing) return existing[0];

    const cityFlags = {
        'houston': '🇺🇸', 'new york': '🇺🇸', 'los angeles': '🇺🇸', 'chicago': '🇺🇸', 'miami': '🇺🇸',
        'lafayette': '🇺🇸', 'new orleans': '🇺🇸', 'san francisco': '🇺🇸', 'las vegas': '🇺🇸',
        'seattle': '🇺🇸', 'boston': '🇺🇸', 'atlanta': '🇺🇸', 'dallas': '🇺🇸', 'austin': '🇺🇸',
        'tokyo': '🇯🇵', 'kyoto': '🇯🇵', 'osaka': '🇯🇵', 'hiroshima': '🇯🇵', 'sapporo': '🇯🇵', 'fukuoka': '🇯🇵',
        'shanghai': '🇨🇳', 'beijing': '🇨🇳', 'guangzhou': '🇨🇳', 'shenzhen': '🇨🇳', 'chengdu': '🇨🇳',
        'hong kong': '🇭🇰', 'macau': '🇲🇴', 'taipei': '🇹🇼',
        'london': '🇬🇧', 'edinburgh': '🇬🇧', 'manchester': '🇬🇧',
        'paris': '🇫🇷', 'nice': '🇫🇷', 'lyon': '🇫🇷', 'marseille': '🇫🇷',
        'rome': '🇮🇹', 'florence': '🇮🇹', 'venice': '🇮🇹', 'milan': '🇮🇹', 'naples': '🇮🇹',
        'barcelona': '🇪🇸', 'madrid': '🇪🇸', 'seville': '🇪🇸', 'valencia': '🇪🇸',
        'berlin': '🇩🇪', 'munich': '🇩🇪', 'frankfurt': '🇩🇪', 'hamburg': '🇩🇪',
        'amsterdam': '🇳🇱', 'rotterdam': '🇳🇱', 'brussels': '🇧🇪', 'bruges': '🇧🇪',
        'vienna': '🇦🇹', 'salzburg': '🇦🇹', 'zurich': '🇨🇭', 'geneva': '🇨🇭', 'lucerne': '🇨🇭',
        'athens': '🇬🇷', 'santorini': '🇬🇷', 'mykonos': '🇬🇷', 'dublin': '🇮🇪',
        'lisbon': '🇵🇹', 'porto': '🇵🇹', 'bangkok': '🇹🇭', 'chiang mai': '🇹🇭', 'phuket': '🇹🇭',
        'singapore': '🇸🇬', 'seoul': '🇰🇷', 'busan': '🇰🇷', 'sydney': '🇦🇺', 'melbourne': '🇦🇺',
        'auckland': '🇳🇿', 'toronto': '🇨🇦', 'vancouver': '🇨🇦', 'montreal': '🇨🇦',
        'mexico city': '🇲🇽', 'cancun': '🇲🇽', 'dubai': '🇦🇪', 'abu dhabi': '🇦🇪',
        'cairo': '🇪🇬', 'cape town': '🇿🇦', 'reykjavik': '🇮🇸', 'oslo': '🇳🇴', 'stockholm': '🇸🇪'
    };

    for (const [city, flag] of Object.entries(cityFlags)) {
        if (name.includes(city)) return flag;
    }

    const countryFlags = {
        'united states': '🇺🇸', 'usa': '🇺🇸', 'japan': '🇯🇵', 'china': '🇨🇳', 'france': '🇫🇷',
        'italy': '🇮🇹', 'spain': '🇪🇸', 'united kingdom': '🇬🇧', 'uk': '🇬🇧', 'germany': '🇩🇪',
        'netherlands': '🇳🇱', 'switzerland': '🇨🇭', 'greece': '🇬🇷', 'thailand': '🇹🇭',
        'korea': '🇰🇷', 'singapore': '🇸🇬', 'australia': '🇦🇺', 'canada': '🇨🇦', 'mexico': '🇲🇽',
        'taiwan': '🇹🇼', 'hong kong': '🇭🇰', 'ireland': '🇮🇪', 'portugal': '🇵🇹', 'austria': '🇦🇹'
    };
    for (const [country, flag] of Object.entries(countryFlags)) {
        if (name.includes(country)) return flag;
    }

    return '●';
}

export function getDistanceBetweenStops(stop1, stop2, unit = 'km') {
    if (!stop1 || !stop2) return null;
    const lat1 = Number(stop1.lat);
    const lon1 = Number(stop1.lon);
    const lat2 = Number(stop2.lat);
    const lon2 = Number(stop2.lon);
    if (isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) return null;
    if (lat1 === 0 && lon1 === 0) return null;
    if (lat2 === 0 && lon2 === 0) return null;

    const R = unit === 'mi' ? 3958.8 : 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
}

export function renderPlanner(opts = {}) {
    const trip = getActiveTrip();
    if (!trip) return;
    const tripSelect = document.getElementById('planner-trip-select');
    if (tripSelect) {
        tripSelect.innerHTML = trips.map(t =>
            `<option value="${escapeHTML(String(t.id))}">${escapeHTML(t.name || 'Untitled Trip')}</option>`
        ).join('');
        tripSelect.value = String(trip.id);
    }

    const hasDate = Boolean(trip.startDate && trip.startDate.trim());
    const dateChip = document.getElementById('planner-date-chip');
    const dateChipText = document.getElementById('planner-date-chip-text');
    if (dateChip && dateChipText) {
        if (hasDate) {
            const sDate = parseLocalDate(trip.startDate);
            dateChipText.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#i-calendar-event"></use></svg>Departs ${sDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
            dateChip.classList.remove('tbd');
            dateChip.title = "Departure date set. Click to change or clear.";
        } else {
            dateChipText.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#i-calendar-question"></use></svg>Dates TBD • Set start date`;
            dateChip.classList.add('tbd');
            dateChip.title = "No departure date set. Click to set a date.";
        }
    }

    const collabBadge = document.getElementById('planner-collab-badge');
    if (collabBadge) {
        if (trip.isCollaborative) {
            collabBadge.style.display = 'inline-flex';
            collabBadge.innerHTML = `<span class="collab-pulse-dot"></span> <svg class="ico" aria-hidden="true"><use href="#i-user-plus"></use></svg>Plan with Friends`;
        } else {
            collabBadge.style.display = 'none';
        }
    }

    const list = document.getElementById('itinerary-list');
    if (!list) return;
    list.innerHTML = '';

    let totalNights = 0;
    let currentD = hasDate ? parseLocalDate(trip.startDate) : null;
    let runningDay = 1;

    const unit = getDistanceUnit();
    const showDistances = getShowDistances();

    if (!Array.isArray(trip.stops)) trip.stops = [];

    trip.stops.forEach((stop, index) => {
        if (!stop.id) stop.id = `stop_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 5)}`;
        if (stop.locked === undefined) stop.locked = false;
        if (!stop.notes) stop.notes = Array(Math.max(1, stop.nights)).fill('');
        if (stop.transit === undefined) stop.transit = null;
        if (stop.lodging === undefined) stop.lodging = null;

        const nights = Number(stop.nights) || 0;
        let dateSubtitle = '';
        let notesDateParam = '';

        if (hasDate && currentD) {
            const arr = new Date(currentD);
            if (nights === 0) {
                dateSubtitle = `${arr.toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short' })} - Stopover`;
            } else {
                currentD.setDate(currentD.getDate() + nights);
                const dep = new Date(currentD);
                dateSubtitle = `${arr.toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short' })} - ${dep.toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short' })}`;
            }
            notesDateParam = formatLocalDate(arr);
        } else {
            if (nights === 0) {
                dateSubtitle = `Day ${runningDay} - Stopover`;
            } else if (nights === 1) {
                dateSubtitle = `Day ${runningDay} (1 night)`;
                runningDay += 1;
            } else {
                dateSubtitle = `Days ${runningDay}–${runningDay + nights} (${nights} nights)`;
                runningDay += nights;
            }
            notesDateParam = '';
        }

        const isFirst = index === 0;
        const flagIcon = getStopFlag(stop);
        const nodeBadgeHTML = isFirst
            ? `<button type="button" class="stop-node-badge is-base" onclick="focusStopOnMap(event, ${index})" title="Starting Base / Home (Tap to view on map)">⌂</button>`
            : `<button type="button" class="stop-node-badge" onclick="focusStopOnMap(event, ${index})" title="Stop #${index + 1} (Tap to view on map)">${index + 1}</button>`;

        let distDividerHTML = '';
        if (index < trip.stops.length - 1) {
            if (showDistances) {
                const nextStop = trip.stops[index + 1];
                const dist = getDistanceBetweenStops(stop, nextStop, unit);
                const distDisplay = dist !== null ? `${dist.toLocaleString()} ${unit}` : `Direct route`;
                distDividerHTML = `
                    <div class="route-distance-divider">
                        <button type="button" class="route-distance-badge" onclick="focusSegmentOnMap(event, ${index}, ${index + 1})" title="Tap to zoom map to this segment">
                            <span class="route-distance-icon"><svg class="ico ico-only" aria-hidden="true"><use href="#i-search"></use></svg></span>
                            <span>${distDisplay}</span>
                        </button>
                    </div>`;
            } else {
                distDividerHTML = `<div style="height: 1px; background: var(--border-subtle); margin: 6px 18px; opacity: 0.6;"></div>`;
            }
        }

        // Each stop + its distance divider is one draggable row, so Sortable indices map 1:1 to trip.stops
        list.innerHTML += `
            <div class="stop-row">
            <div class="stop-card ${stop.locked ? 'is-locked' : ''}">
                <div class="drag-handle" title="Drag to reorder (or long-press the card)">≡</div>
                ${nodeBadgeHTML}
                <div style="flex-grow:1; min-width:0; cursor:pointer;" onclick="openDailyNotes(${index}, '${notesDateParam}')">
                    <h3 style="margin: 0 0 2px 0; font-size: 16px; font-weight: 800; display:flex; align-items:center; gap:6px; overflow:hidden;">
                        <span class="stop-flag">${flagIcon}</span>
                        <span style="overflow:hidden; text-align:left; text-overflow:ellipsis; white-space:nowrap; color:var(--text);">${escapeHTML(stop.name)}</span>
                        <button type="button" onclick="toggleStopLock(event, ${index})" class="stop-inline-lock-btn ${stop.locked ? 'locked' : ''}" title="${stop.locked ? 'Stop locked in place (Click to unlock)' : 'Lock stop to prevent auto-reordering'}">${stop.locked ? icon('lock', 'ico-only') : icon('lock-open', 'ico-only')}</button>
                    </h3>
                    <p style="margin: 0; font-size: 13px; color: #728481; font-weight: 500;">${dateSubtitle}</p>
                    <div id="stop-weather-${index}" class="stop-weather-chip" style="display:none;"></div>
                </div>
                <div class="sleek-nights-stepper">
                    <div class="sleek-stepper-row">
                        <button type="button" class="sleek-stepper-btn" onclick="updateNights(${index}, -1)" title="${stop.nights === 0 ? 'Click past zero to delete stop' : 'Decrease nights'}">−</button>
                        <span class="sleek-stepper-val">${stop.nights}</span>
                        <button type="button" class="sleek-stepper-btn" onclick="updateNights(${index}, 1)" title="Increase nights">+</button>
                    </div>
                    <span class="sleek-stepper-label">${stop.nights === 1 ? 'night' : 'nights'}</span>
                </div>
            </div>
            ${distDividerHTML}
            </div>`;
        totalNights += nights;
    });

    // Asynchronously load weather for stops
    trip.stops.forEach((stop, idx) => {
        loadStopWeather(idx, stop.lat, stop.lon);
    });

    const totalEl = document.getElementById('total-nights');
    if (totalEl) totalEl.innerText = totalNights + " Nights";

    const colTripInfo = document.getElementById('planner-collapsed-trip-info');
    if (colTripInfo) colTripInfo.innerText = `${trip.name} • ${totalNights} Nights`;

    // Empty trip: say what to do next instead of showing a blank list
    if (trip.stops.length === 0) {
        list.innerHTML = `
            <div class="route-empty">
                <strong>Where are you headed?</strong>
                <span>Add the cities you'll visit, in order. You can drag to reorder them any time.</span>
                <button type="button" class="save-btn" onclick="openCitySearchModal()">+ Add your first stop</button>
                <button type="button" class="budget-link-btn" onclick="planEmptyTripWithAI()">${icon('sparkles')}Or let AI plan it</button>
            </div>`;
    }
    const toolsRow = document.getElementById('planner-tools-row');
    if (toolsRow) toolsRow.style.display = trip.stops.length >= 2 ? 'flex' : 'none';
    const addNextBtn = document.getElementById('planner-add-next-btn');
    if (addNextBtn) addNextBtn.style.display = trip.stops.length >= 1 ? '' : 'none';
    const checkupBtn = document.getElementById('planner-checkup-btn');
    if (checkupBtn) checkupBtn.style.display = trip.stops.length >= 1 ? '' : 'none';

    const allLocked = trip.stops.length > 0 && trip.stops.every(s => s.locked);
    const lockAllBtn = document.getElementById('toggle-lock-all-btn');
    if (lockAllBtn) {
        lockAllBtn.innerHTML = allLocked ? '<svg class="ico" aria-hidden="true"><use href="#i-lock-open"></use></svg>Unlock All' : '<svg class="ico" aria-hidden="true"><use href="#i-lock"></use></svg>Lock All';
        lockAllBtn.title = allLocked ? 'Unlock all stops to allow re-ordering' : 'Lock all stops to prevent auto-reordering';
    }

    if (window.plannerSortable) window.plannerSortable.destroy();
    if (typeof Sortable !== 'undefined') {
        window.plannerSortable = Sortable.create(list, {
            draggable: '.stop-row',
            // Whole card is draggable: long-press on touch, instant from the ≡ handle (see listener below).
            // Moving the finger before the long-press fires cancels the drag, so normal scrolling still works.
            delay: 260,
            delayOnTouchOnly: true,
            touchStartThreshold: 8,
            // Buttons inside the card keep working as taps and never start a drag
            filter: 'button, .sleek-nights-stepper',
            preventOnFilter: false,
            // Fallback (non-HTML5) dragging behaves consistently on iOS/Android and follows the thumb
            forceFallback: true,
            fallbackOnBody: true,
            fallbackTolerance: 4,
            // Auto-scroll the sheet when dragging near its top/bottom edge
            scroll: true,
            bubbleScroll: true,
            scrollSensitivity: 90,
            scrollSpeed: 16,
            animation: 180,
            easing: 'cubic-bezier(0.2, 0, 0, 1)',
            ghostClass: 'stop-row-ghost',
            chosenClass: 'stop-row-chosen',
            fallbackClass: 'stop-row-dragging',
            onChoose: () => triggerHaptic('light'),
            onStart: () => {
                document.body.classList.add('is-reordering-stops');
                triggerHaptic('medium');
            },
            onEnd: function (evt) {
                document.body.classList.remove('is-reordering-stops');
                const oldIndex = evt.oldDraggableIndex ?? evt.oldIndex;
                const newIndex = evt.newDraggableIndex ?? evt.newIndex;
                if (oldIndex === newIndex) return;
                triggerHaptic('light');

                const originalStops = [...trip.stops];
                const movedStop = trip.stops.splice(oldIndex, 1)[0];
                trip.stops.splice(newIndex, 0, movedStop);

                if (Array.isArray(trip.places)) {
                    trip.places.forEach(p => {
                        const targetStop = originalStops[p.cityIndex];
                        if (targetStop) {
                            p.cityIndex = trip.stops.findIndex(s => s.id === targetStop.id);
                        }
                    });
                }

                saveTrips();
                renderPlanner({ keepMapView: true });
            }
        });

        // The ≡ handle drags immediately; the rest of the card needs a long-press. Capture phase runs
        // before Sortable's own pointerdown/touchstart listener on the same list, so it sees the new delay.
        if (!list.dataset.dragDelayHook) {
            list.dataset.dragDelayHook = '1';
            const setDelay = (e) => {
                const s = window.plannerSortable;
                if (s) s.option('delay', e.target.closest('.drag-handle') ? 0 : 260);
            };
            list.addEventListener('pointerdown', setDelay, { capture: true });
            list.addEventListener('touchstart', setDelay, { capture: true, passive: true });
            list.addEventListener('mousedown', setDelay, { capture: true });
        }
    }
    // Dynamically personalize Find Tours & Activities action card
    const actLink = document.getElementById('planner-activities-link');
    if (actLink) {
        if (trip.stops && trip.stops.length > 0) {
            // Use the longest stay (not the departure/origin stop) as the featured destination
            const featuredStop = trip.stops.reduce((best, s) => ((s.nights || 0) > (best.nights || 0) ? s : best), trip.stops[0]);
            const destCity = featuredStop.name;
            actLink.href = ticketLink('', destCity.split(',')[0], featuredStop.lat, featuredStop.lon);
            const actTitle = actLink.querySelector('.action-title');
            if (actTitle) {
                actTitle.innerText = `Find Tours & Activities in ${destCity}`;
            }
            actLink.style.display = 'flex';
        } else {
            actLink.style.display = 'none';
        }
    }

    drawPlannerMapRoute(opts);
}

export function toggleStopLock(event, index) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    const trip = getActiveTrip();
    if (!trip || !trip.stops || !trip.stops[index]) return;
    const stop = trip.stops[index];
    stop.locked = !stop.locked;
    triggerHaptic('light');
    saveTrips();
    renderPlanner();
    showNotification(stop.locked ? `🔒 Locked ${stop.name} in place` : `🔓 Unlocked ${stop.name}`);
}

export function toggleLockAllStops() {
    const trip = getActiveTrip();
    if (!trip || !trip.stops || trip.stops.length === 0) return;
    const allLocked = trip.stops.every(s => s.locked);
    const newStatus = !allLocked;
    trip.stops.forEach(s => { s.locked = newStatus; });
    triggerHaptic('medium');
    saveTrips();
    renderPlanner();
    showNotification(newStatus ? "🔒 All stops locked in place" : "🔓 All stops unlocked");
}

export function updateNights(index, delta) {
    const trip = getActiveTrip();
    if (!trip || !trip.stops || !trip.stops[index]) return;
    const stop = trip.stops[index];
    const currentNights = Number(stop.nights) || 0;

    if (delta < 0 && currentNights === 0) {
        // User clicked past zero nights!
        deleteStop(index);
        return;
    }

    triggerHaptic('light');
    stop.nights = Math.max(0, currentNights + delta);
    if (!Array.isArray(stop.notes)) stop.notes = [];
    if (stop.notes.length < Math.max(1, stop.nights)) {
        stop.notes.push(...Array(Math.max(1, stop.nights) - stop.notes.length).fill(''));
    }
    // Places planned on a day that no longer exists move to the new last day instead of vanishing from Daily
    const days = Math.max(1, stop.nights);
    const orphaned = (trip.places || []).filter(p => p.cityIndex === index && Number.isInteger(p.dayIndex) && p.dayIndex >= days);
    orphaned.forEach(p => { p.dayIndex = days - 1; });
    saveTrips();
    renderPlanner();
    if (orphaned.length) showNotification(`${orphaned.length} planned stop${orphaned.length === 1 ? '' : 's'} moved to Day ${days} in ${stop.name}`);
}

export function focusStopOnMap(event, index) {
    if (event) event.stopPropagation();
    const trip = getActiveTrip();
    if (!trip || !trip.stops || !trip.stops[index] || !plannerMap) return;
    const stop = trip.stops[index];
    if (!hasCoords(stop)) return;

    if (isReducedMotion()) plannerMap.setView([stop.lat, stop.lon], 11, { animate: false });
    else plannerMap.flyTo([stop.lat, stop.lon], 11, { duration: 1.2 });
    const marker = (pMarkers || []).find(m => m.stopIndex === index);
    if (marker) {
        setTimeout(() => {
            if (typeof marker.openPopup === 'function') marker.openPopup();
        }, 1250);
    }
}

export function focusSegmentOnMap(event, idx1, idx2) {
    if (event) event.stopPropagation();
    const trip = getActiveTrip();
    if (!trip || !trip.stops || !plannerMap) return;
    const s1 = trip.stops[idx1];
    const s2 = trip.stops[idx2];
    if (!s1 || !s2 || (s1.lat === 0 && s1.lon === 0) || (s2.lat === 0 && s2.lon === 0)) return;

    if (typeof L !== 'undefined' && L.latLngBounds) {
        const bounds = L.latLngBounds([
            [s1.lat, s1.lon],
            [s2.lat, s2.lon]
        ]);
        plannerMap.fitBounds(bounds, { padding: [60, 60], maxZoom: 10 });
    }
    highlightPlannerLeg(idx1);
    const unit = getDistanceUnit();
    const dist = getDistanceBetweenStops(s1, s2, unit);
    const distStr = dist !== null ? `${dist.toLocaleString()} ${unit}` : '';
    showNotification(`📍 Route: ${s1.name} ➔ ${s2.name} (${distStr})`);
}

export function deleteStop(index) {
    const trip = getActiveTrip();
    if (!trip || !trip.stops || !trip.stops[index]) return;
    const planned = (trip.places || []).filter(p => p.cityIndex === index).length;
    if (confirm(`Remove ${trip.stops[index].name} from itinerary?${planned ? `\n\nIts ${planned} planned stop${planned === 1 ? '' : 's'} on the Daily tab ${planned === 1 ? 'goes' : 'go'} too.` : ''}`)) {
        triggerHaptic('warning');
        trip.stops.splice(index, 1);
        // Round-trip legs after the removed stop move up one
        if (Array.isArray(trip.roundTripSegments)) {
            trip.roundTripSegments = trip.roundTripSegments.filter(i => i !== index).map(i => (i > index ? i - 1 : i));
        }
        if (Array.isArray(trip.places)) {
            trip.places = trip.places
                .filter(p => p.cityIndex !== index)
                .map(p => {
                    if (p.cityIndex > index) p.cityIndex--;
                    return p;
                });
        }
        saveTrips();
        renderPlanner();
        showNotification("Stop removed.");
    }
}

export function optimizeTripRoute() {
    const trip = getActiveTrip();
    if (!trip || !trip.stops || trip.stops.length < 3) {
        showNotification("Add at least 3 stops to auto-optimize.");
        return;
    }

    trip.stops.forEach((stop, index) => {
        if (!stop.id) stop.id = `stop_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 5)}`;
        if (stop.locked === undefined) stop.locked = false;
    });

    const originalStops = [...trip.stops];
    const lockedCount = trip.stops.filter(s => s.locked).length;
    const unlockedCount = trip.stops.length - lockedCount;

    if (unlockedCount === 0) {
        showNotification("All stops are locked 🔒. Unlock stops to optimize.");
        return;
    }
    if (unlockedCount < 2) {
        showNotification("Only 1 stop is unlocked. Unlock at least 2 stops to optimize.");
        return;
    }

    let optimized;

    if (lockedCount === 0) {
        // Standard unconstrained nearest-neighbor TSP starting from trip.stops[0]
        let startStop = trip.stops[0];
        let unvisited = trip.stops.slice(1);
        optimized = [startStop];

        while (unvisited.length > 0) {
            let last = optimized[optimized.length - 1];
            let nearestIdx = 0;
            let minDst = Infinity;
            unvisited.forEach((s, idx) => {
                let dst = getDistance(last.lat, last.lon, s.lat, s.lon);
                if (dst < minDst) { minDst = dst; nearestIdx = idx; }
            });
            optimized.push(unvisited.splice(nearestIdx, 1)[0]);
        }
    } else {
        // Constrained TSP: locked stops stay in their exact index slots
        optimized = new Array(trip.stops.length);
        trip.stops.forEach((s, i) => {
            if (s.locked) optimized[i] = s;
        });

        let available = trip.stops.filter(s => !s.locked);

        for (let i = 0; i < optimized.length; i++) {
            if (optimized[i]) continue; // slot already filled by locked stop

            // Find closest preceding anchor
            let refStop = null;
            for (let prev = i - 1; prev >= 0; prev--) {
                if (optimized[prev]) { refStop = optimized[prev]; break; }
            }
            // If no previous anchor, look forward for next anchor
            if (!refStop) {
                for (let next = i + 1; next < optimized.length; next++) {
                    if (optimized[next]) { refStop = optimized[next]; break; }
                }
            }

            let bestIdx = 0;
            if (refStop) {
                let minDst = Infinity;
                available.forEach((cand, cIdx) => {
                    let d = getDistance(refStop.lat, refStop.lon, cand.lat, cand.lon);
                    if (d < minDst) {
                        minDst = d;
                        bestIdx = cIdx;
                    }
                });
            }
            optimized[i] = available.splice(bestIdx, 1)[0];
        }
    }

    trip.stops = optimized;

    // Preserve place-to-city association by matching stop.id
    if (Array.isArray(trip.places)) {
        trip.places.forEach(p => {
            const targetStop = originalStops[p.cityIndex];
            if (targetStop) {
                p.cityIndex = trip.stops.findIndex(s => s.id === targetStop.id);
            }
        });
    }

    saveTrips();
    renderPlanner({ keepMapView: true });
    showNotification(lockedCount > 0 ? "✨ Unlocked stops optimized around locked stops!" : "✨ Trip route optimized!");
}

function getDistance(lat1, lon1, lat2, lon2) {
    const p = 0.017453292519943295;
    const c = Math.cos;
    const a = 0.5 - c((lat2 - lat1) * p) / 2 + c(lat1 * p) * c(lat2 * p) * (1 - c((lon2 - lon1) * p)) / 2;
    return 12742 * Math.asin(Math.sqrt(a));
}

export function openCitySearchModal() {
    const modal = document.getElementById('city-search-modal');
    if (modal) modal.style.display = 'flex';
    const input = document.getElementById('city-search-input');
    if (input) input.value = '';
    const clearBtn = document.getElementById('clear-city-search-input');
    if (clearBtn) clearBtn.style.display = 'none';
    const results = document.getElementById('city-search-results');
    if (results) results.innerHTML = '';
    setTimeout(() => { if (input) input.focus(); }, 150);
}

export function searchCity(query) {
    clearTimeout(citySearchTimeout);
    if (citySearchAbortController) {
        citySearchAbortController.abort();
        citySearchAbortController = null;
    }
    const resultsDiv = document.getElementById('city-search-results');
    if (!resultsDiv) return;

    if (!query || query.trim().length < 2) {
        resultsDiv.innerHTML = '';
        resultsDiv.style.display = 'none';
        return;
    }

    citySearchTimeout = setTimeout(async () => {
        try {
            citySearchAbortController = new AbortController();
            // Cities near the end of the route come first
            const trip = getActiveTrip();
            const stops = (trip && trip.stops) || [];
            const near = stops[stops.length - (endsAtHome(trip) ? 2 : 1)] || null;
            const data = await searchOSM(query, { cities: true, limit: 5, near, signal: citySearchAbortController.signal });
            if (data && data.length > 0) {
                resultsDiv.innerHTML = data.map(item => {
                    const rawName = item.name || item.display_name.split(',')[0];
                    const safeName = escapeJS(rawName);
                    const safeAddr = escapeHTML(item.display_name.substring(0, 48));
                    return `
                    <div class="search-result" onclick="addCityStop('${safeName}', ${Number(item.lat)}, ${Number(item.lon)})">
                        <strong>${escapeHTML(rawName)}</strong><br>
                        <small style="color:var(--text-muted, #777);">${safeAddr}...</small>
                    </div>`;
                }).join('');
                resultsDiv.style.display = 'block';
            } else {
                resultsDiv.innerHTML = `<div style="padding: 12px; font-size: 13px; color: var(--text-muted, #777); text-align: center;">No cities found for "${escapeHTML(query)}"</div>`;
                resultsDiv.style.display = 'block';
            }
        } catch (e) {
            if (e.name !== 'AbortError') {
                console.error("City search failed:", e);
            }
        }
    }, 300);
}

// From the empty-trip card: open the AI planner with the trip's name as a starting idea
export function planEmptyTripWithAI() {
    const trip = getActiveTrip();
    if (window.openAITripSearchModal) window.openAITripSearchModal();
    const input = document.getElementById('ai-trip-input');
    if (input && !input.value.trim() && trip && trip.name) input.value = trip.name;
}

// A trip that ends back where it started (the flight home), so new cities go before that last stop
export function endsAtHome(trip) {
    const stops = (trip && trip.stops) || [];
    if (stops.length < 3) return false;
    const first = stops[0], last = stops[stops.length - 1];
    if (hasCoords(first) && hasCoords(last)) return getDistance(Number(first.lat), Number(first.lon), Number(last.lat), Number(last.lon)) < 25;
    return String(first.name || '').trim().toLowerCase() === String(last.name || '').trim().toLowerCase();
}

// The travel form pre-fills the date and stations, so only a booking number, times or a paid price mean it's booked
const isBookedLeg = (trip, stop) => {
    const t = stop && stop.transit;
    if (!t) return false;
    if (t.bookingNumber || t.depTime || t.arrTime) return true;
    return (trip.expenses || []).some(e => e.id === `bk_travel_${stop.id}` && Number(e.amount) > 0);
};

// Put a new stop into the route right after stop afterIdx (-1 = first). The trip's places, round-trip
// legs and the travel leg that left the stop before all follow along. Returns false if the user cancels.
export function insertStop(trip, newStop, afterIdx) {
    if (!Array.isArray(trip.stops)) trip.stops = [];
    if (!Array.isArray(trip.places)) trip.places = [];
    afterIdx = Math.max(-1, Math.min(trip.stops.length - 1, afterIdx));
    const prev = afterIdx >= 0 ? trip.stops[afterIdx] : null;
    const next = trip.stops[afterIdx + 1] || null;
    const booked = isBookedLeg(trip, prev);
    if (prev && next && booked &&
        !confirm(`Your booked ${prev.transit.method === 'plane' ? 'flight' : prev.transit.method || 'transport'} from ${prev.name} to ${next.name} will move to the ${newStop.name} → ${next.name} leg, so check its date and station.\n\nAdd ${newStop.name} after ${prev.name}?`)) return false;

    const originalStops = [...trip.stops];
    trip.stops.splice(afterIdx + 1, 0, newStop);
    // Places follow their stop (same as drag-reordering stops)
    trip.places.forEach(p => {
        const target = originalStops[p.cityIndex];
        if (target) p.cityIndex = trip.stops.indexOf(target);
    });
    if (Array.isArray(trip.roundTripSegments)) {
        const from = prev ? afterIdx : 0;
        trip.roundTripSegments = trip.roundTripSegments.map(i => (i >= from ? i + 1 : i));
    }
    // A booked leg now leaves the new stop, toward the same next city; an unbooked one just keeps
    // its way of travel on both new legs (its pre-filled date and stations belonged to the old leg)
    if (prev && next && prev.transit) {
        if (booked) {
            newStop.transit = prev.transit;
            prev.transit = null;
            const moved = prev.id && (trip.expenses || []).find(e => e.id === `bk_travel_${prev.id}`);
            if (moved) moved.id = `bk_travel_${newStop.id}`;
        } else {
            const way = { method: prev.transit.method, flightType: prev.transit.flightType || 'ow' };
            prev.transit = { ...way };
            newStop.transit = { ...way };
        }
    }
    return true;
}

export function addCityStop(name, lat, lon) {
    const trip = getActiveTrip();
    if (!trip) {
        showNotification("Please select or create a trip first.");
        return;
    }
    if (!Array.isArray(trip.stops)) trip.stops = [];
    const newStop = {
        id: `stop_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        name,
        lat: parseFloat(lat) || 0,
        lon: parseFloat(lon) || 0,
        nights: 2,
        notes: ['', ''],
        transit: null,
        lodging: null,
        locked: false
    };
    // Added at the end of the route, but before the trip's return home
    const home = endsAtHome(trip);
    if (!insertStop(trip, newStop, trip.stops.length - (home ? 2 : 1))) return;
    closeModal('city-search-modal');
    saveTrips();
    renderPlanner();
    showNotification(home ? `Added ${name} before ${trip.stops[trip.stops.length - 1].name}` : `Added ${name} to itinerary!`);
}

export function exportTripICS() {
    const trip = getActiveTrip();
    if (!trip || !trip.stops || trip.stops.length === 0) {
        showNotification("No stops to export.");
        return;
    }
    if (!trip.startDate || !trip.startDate.trim()) {
        showNotification("Please set a departure date to export calendar (.ics) events.");
        if (window.openEditTripModal) window.openEditTripModal(trip.id);
        return;
    }
    let ics = "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Trippo App//EN\n";
    let currentDate = parseLocalDate(trip.startDate);

    trip.stops.forEach((stop) => {
        if (Number(stop.nights) === 0) return;
        const checkInDate = new Date(currentDate);
        const checkInStr = formatLocalDate(checkInDate).replace(/-/g, '');
        currentDate.setDate(currentDate.getDate() + (Number(stop.nights) || 0));
        const checkOutDate = new Date(currentDate);
        const checkOutStr = formatLocalDate(checkOutDate).replace(/-/g, '');

        ics += "BEGIN:VEVENT\n";
        ics += `SUMMARY:Stay in ${stop.lodging?.name || stop.name}\n`;
        ics += `DTSTART;VALUE=DATE:${checkInStr}\n`;
        ics += `DTEND;VALUE=DATE:${checkOutStr}\n`;
        ics += `DESCRIPTION:${stop.nights} nights.\n`;
        ics += "END:VEVENT\n";
    });
    ics += "END:VCALENDAR";

    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${trip.name.replace(/\s+/g, '_')}_Itinerary.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

export function handleFileImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        const content = e.target.result;
        if (file.name.toLowerCase().endsWith('.ics')) {
            parseICS(content);
        } else if (file.name.toLowerCase().endsWith('.json')) {
            try {
                const data = JSON.parse(content);
                let incomingTrip = data.trip || (data.trips && data.trips[0]) || data;
                if (incomingTrip && incomingTrip.name && Array.isArray(incomingTrip.stops)) {
                    incomingTrip.id = 'trip_' + Date.now();
                    if (!Array.isArray(incomingTrip.places)) incomingTrip.places = [];
                    if (!Array.isArray(incomingTrip.expenses)) incomingTrip.expenses = [];
                    trips.push(normalizeTrip(incomingTrip));
                    saveTrips();
                    if (window.openTrip) window.openTrip(incomingTrip.id);
                    showNotification(`Imported ${incomingTrip.name}!`);
                }
            } catch (err) {
                showNotification("Error importing JSON file.");
            }
        }
        event.target.value = '';
    };
    reader.readAsText(file);
}

export function parseICS(icsString) {
    const events = icsString.split('BEGIN:VEVENT');
    const trip = getActiveTrip();
    if (!trip) {
        showNotification("Please create or open a trip first.");
        return;
    }
    if (!Array.isArray(trip.stops)) trip.stops = [];
    let imported = 0;
    for (let i = 1; i < events.length; i++) {
        const ev = events[i];
        const summaryMatch = ev.match(/SUMMARY:(.*)/);
        if (summaryMatch) {
            const summary = summaryMatch[1].trim();
            trip.stops.push({
                id: `imp_${Date.now()}_${i}`,
                name: summary,
                lat: 0,
                lon: 0,
                nights: 1,
                notes: ['Imported stop'],
                transit: null,
                lodging: null
            });
            imported++;
        }
    }
    if (imported > 0) {
        saveTrips();
        renderPlanner();
        showNotification(`Imported ${imported} stops!`);
    }
}

export async function loadStopWeather(index, lat, lon) {
    if (!lat || !lon || (lat === 0 && lon === 0)) return;
    const weatherEl = document.getElementById(`stop-weather-${index}`);
    if (!weatherEl) return;
    try {
        const info = await getDestinationWeather(lat, lon);
        if (info && weatherEl) {
            weatherEl.innerHTML = `<span>${info.icon}</span> <span>${formatTempF(info.tempF)}</span> • <span style="color:var(--text-light);">${info.condition}</span>`;
            weatherEl.title = `Packing Tip: ${info.advice}`;
            weatherEl.style.display = 'inline-flex';
        }
    } catch (e) {
        console.debug('Weather fetch error:', e);
    }
}

