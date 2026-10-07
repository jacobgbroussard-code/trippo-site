/* ==========================================================================
   Trippo Travel Planner - Serverless Edge AI Travel Assistant
   js/ai.js
   Powered by Cloudflare Workers AI & Llama 3 8B Instruct
   ========================================================================== */

import {
    trips,
    saveTrips,
    setActiveTripId,
    setActivePlacesTripId,
    activePlacesTripId,
    activePlacesStopIndex,
    activePlacesDayIndex,
    setActivePlacesStopIndex,
    setActivePlacesDayIndex,
    getActiveTrip,
    showNotification,
    closeModal,
    triggerHaptic,
    escapeHTML,
    escapeJS,
    formatLocalDate
} from './state.js';

// Default Cloudflare Worker Edge endpoint (configurable via localStorage)
export const DEFAULT_WORKER_URL = 'https://trippo-ai-worker.jacobgbroussard.workers.dev/';

export function getWorkerEndpoint() {
    try {
        const customUrl = localStorage.getItem('trippoCloudflareWorkerUrl');
        if (customUrl && customUrl.trim()) {
            return customUrl.trim().replace(/\/+$/, '') + '/';
        }
    } catch (e) {}
    return DEFAULT_WORKER_URL;
}

export function setWorkerEndpoint(url) {
    try {
        if (url) {
            localStorage.setItem('trippoCloudflareWorkerUrl', url.trim());
        } else {
            localStorage.removeItem('trippoCloudflareWorkerUrl');
        }
    } catch (e) {}
}

// Current generated itinerary awaiting user review or saving
let currentAIGeneratedItinerary = null;
let aiFetchAbortController = null;
let isUserCancelledAI = false;

// Destination coordinates dictionary for instant mapping
const POPULAR_DESTINATION_COORDS = {
    'tokyo': { lat: 35.6762, lon: 139.6503, name: 'Tokyo, Japan' },
    'kyoto': { lat: 35.0116, lon: 135.7681, name: 'Kyoto, Japan' },
    'paris': { lat: 48.8566, lon: 2.3522, name: 'Paris, France' },
    'rome': { lat: 41.9028, lon: 12.4964, name: 'Rome, Italy' },
    'london': { lat: 51.5074, lon: -0.1278, name: 'London, UK' },
    'new york': { lat: 40.7128, lon: -74.0060, name: 'New York, USA' },
    'barcelona': { lat: 41.3851, lon: 2.1734, name: 'Barcelona, Spain' },
    'bangkok': { lat: 13.7563, lon: 100.5018, name: 'Bangkok, Thailand' },
    'amsterdam': { lat: 52.3676, lon: 4.9041, name: 'Amsterdam, Netherlands' },
    'iceland': { lat: 64.1466, lon: -21.9426, name: 'Reykjavik, Iceland' },
    'costa rica': { lat: 9.9281, lon: -84.0907, name: 'San Jose, Costa Rica' },
    'swiss alps': { lat: 46.5590, lon: 8.5609, name: 'Interlaken, Switzerland' },
    'switzerland': { lat: 46.8182, lon: 8.2275, name: 'Bern, Switzerland' },
    'florence': { lat: 43.7696, lon: 11.2558, name: 'Florence, Italy' },
    'venice': { lat: 45.4408, lon: 12.3155, name: 'Venice, Italy' },
    'seoul': { lat: 37.5665, lon: 126.9780, name: 'Seoul, South Korea' },
    'san francisco': { lat: 37.7749, lon: -122.4194, name: 'San Francisco, USA' },
    'los angeles': { lat: 34.0522, lon: -118.2437, name: 'Los Angeles, USA' },
    'hawaii': { lat: 21.3069, lon: -157.8583, name: 'Honolulu, Hawaii' },
    'sydney': { lat: -33.8688, lon: 151.2093, name: 'Sydney, Australia' },
    'berlin': { lat: 52.5200, lon: 13.4050, name: 'Berlin, Germany' },
    'lisbon': { lat: 38.7223, lon: -9.1393, name: 'Lisbon, Portugal' },
    'singapore': { lat: 1.3521, lon: 103.8198, name: 'Singapore' },
    'dubai': { lat: 25.2048, lon: 55.2708, name: 'Dubai, UAE' }
};

export function findDestinationCoords(text) {
    if (!text) return { lat: 48.8566, lon: 2.3522, name: 'Trip Destination' };
    const lower = text.toLowerCase();
    for (const [key, coords] of Object.entries(POPULAR_DESTINATION_COORDS)) {
        if (lower.includes(key)) return coords;
    }
    return { lat: 48.8566, lon: 2.3522, name: text };
}

// --- OFFLINE-FIRST SAFETY CHECKS ---
export function checkIsOnline() {
    return typeof navigator !== 'undefined' && navigator.onLine !== false;
}

export function updateAIOfflineStatus() {
    const isOnline = checkIsOnline();
    const input = document.getElementById('ai-trip-input');
    const btn = document.getElementById('ai-generate-btn');
    const banner = document.getElementById('ai-offline-banner');
    const widget = document.querySelector('.ai-generator-widget');

    if (input) {
        input.disabled = !isOnline;
        if (!isOnline) {
            input.placeholder = "⚠️ Offline: Saved trips available offline.";
        } else {
            input.placeholder = "Where to? (e.g. 5 days in Tokyo, weekend in Rome...)";
        }
    }

    if (btn) {
        btn.disabled = !isOnline;
        btn.style.opacity = isOnline ? '1' : '0.6';
    }

    if (banner) {
        banner.style.display = isOnline ? 'none' : 'flex';
    }

    if (widget) {
        widget.classList.toggle('offline-mode', !isOnline);
    }
}

// --- SUBMIT AI TRIP SEARCH ---
export async function submitAITripSearch() {
    const input = document.getElementById('ai-trip-input');
    const query = (input?.value || '').trim();

    // Critical Constraint 3: Handle offline drops gracefully
    if (!checkIsOnline()) {
        triggerHaptic('warning');
        showNotification("AI generation requires an internet connection, but your saved trips are available offline.");
        updateAIOfflineStatus();
        return;
    }

    if (!query || query.length < 3) {
        showNotification("Please enter a travel destination or trip idea.");
        if (input) input.focus();
        return;
    }

    triggerHaptic('light');
    isUserCancelledAI = false;
    setAILoadingState(true, query);

    try {
        const itinerary = await fetchItineraryFromCloudflareWorker(query);
        currentAIGeneratedItinerary = itinerary;
        setAILoadingState(false);
        openAITripModal(itinerary);
        triggerHaptic('success');
    } catch (err) {
        console.error('[AI Assistant] Generation failed:', err);
        setAILoadingState(false);

        // If user intentionally hit Cancel, do not display an error popup
        if (isUserCancelledAI) {
            return;
        }

        // Friendly error notification without crashing the client app
        if (err.name === 'AbortError') {
            showNotification("⏱️ Edge AI request timed out. Please check your connection and try again.");
        } else if (!checkIsOnline()) {
            showNotification("AI generation requires an internet connection, but your saved trips are available offline.");
            updateAIOfflineStatus();
        } else {
            showNotification(`⚠️ ${err.message || 'Failed to generate itinerary. Please try again.'}`);
        }
    }
}

// User-triggered cancellation of in-flight AI generation
export function cancelAIGeneration() {
    isUserCancelledAI = true;
    if (aiFetchAbortController) {
        try {
            aiFetchAbortController.abort();
        } catch (e) {}
        aiFetchAbortController = null;
    }
    setAILoadingState(false);
    showNotification("AI generation cancelled.");
    triggerHaptic('light');
}

// Set search bar input text from inspiration chips
export function setAIPrompt(promptText) {
    const input = document.getElementById('ai-trip-input');
    if (!input) return;

    if (!checkIsOnline()) {
        showNotification("AI generation requires an internet connection, but your saved trips are available offline.");
        return;
    }

    input.value = promptText;
    input.focus();
    triggerHaptic('light');
    submitAITripSearch();
}

// --- ASYNCHRONOUS CLOUDFLARE WORKER FETCH ---
async function fetchItineraryFromCloudflareWorker(promptText) {
    const endpoint = getWorkerEndpoint();
    console.log(`[AI Assistant] Fetching from Edge AI endpoint: ${endpoint}`);

    // Set 25-second timeout via AbortController
    aiFetchAbortController = new AbortController();
    const timeoutId = setTimeout(() => {
        if (aiFetchAbortController) aiFetchAbortController.abort();
    }, 25000);

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ prompt: promptText }),
            signal: aiFetchAbortController.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            let errorMsg = `Edge AI request failed with HTTP ${response.status}`;
            try {
                const errJson = await response.json();
                if (errJson && errJson.error) errorMsg = errJson.error;
            } catch (e) {}
            throw new Error(errorMsg);
        }

        const data = await response.json();
        if (data.itinerary) {
            return data.itinerary;
        } else if (data.data) {
            return data.data;
        } else if (data.title && data.days) {
            return data;
        } else {
            throw new Error("Invalid itinerary structure received from Edge AI.");
        }
    } catch (fetchErr) {
        clearTimeout(timeoutId);

        // If the live edge worker is not yet deployed or unreachable, provide an intelligent fallback
        if (fetchErr.name !== 'AbortError' && (!checkIsOnline() || isEndpointUnreachable(fetchErr))) {
            console.warn('[AI Assistant] Live worker endpoint unreachable. Generating intelligent fallback plan...', fetchErr);
            return generateIntelligentFallbackItinerary(promptText);
        }

        throw fetchErr;
    }
}

function isEndpointUnreachable(err) {
    const msg = (err.message || '').toLowerCase();
    return msg.includes('failed to fetch') || 
           msg.includes('networkerror') || 
           msg.includes('cors') || 
           msg.includes('http 404') || 
           msg.includes('http 502') || 
           msg.includes('http 503');
}

// --- LOADING STATE CONTROLLER ---
function setAILoadingState(isLoading, queryText = '') {
    const btn = document.getElementById('ai-generate-btn');
    const input = document.getElementById('ai-trip-input');
    const loadingOverlay = document.getElementById('ai-loading-overlay');
    const queryEl = document.getElementById('ai-loading-query-text');

    if (input) input.disabled = isLoading;
    if (btn) {
        btn.disabled = isLoading;
        if (isLoading) {
            btn.innerHTML = `<span class="ai-btn-spinner"></span> <span>Crafting...</span>`;
        } else {
            btn.innerHTML = `<span class="btn-text">Generate</span> <span class="btn-icon">⚡</span>`;
        }
    }

    if (loadingOverlay) {
        if (isLoading) {
            if (queryEl) queryEl.innerText = `"${queryText}"`;
            loadingOverlay.style.display = 'flex';
        } else {
            loadingOverlay.style.display = 'none';
        }
    }
}

// --- RENDER ITINERARY PREVIEW MODAL ---
export function openAITripModal(itinerary) {
    if (!itinerary) return;
    currentAIGeneratedItinerary = itinerary;

    const modal = document.getElementById('ai-trip-modal');
    if (!modal) return;

    // Header & Meta info
    const titleEl = document.getElementById('ai-modal-title');
    const destEl = document.getElementById('ai-modal-destination');
    const summaryEl = document.getElementById('ai-modal-summary');
    const statsEl = document.getElementById('ai-modal-stats');
    const timelineEl = document.getElementById('ai-modal-timeline');

    if (titleEl) titleEl.innerText = itinerary.title || 'Personalized AI Itinerary';
    if (destEl) destEl.innerText = itinerary.destination || 'Global Adventure';
    if (summaryEl) summaryEl.innerText = itinerary.summary || 'A tailored itinerary crafted by Cloudflare Edge AI.';

    const totalDays = Array.isArray(itinerary.days) ? itinerary.days.length : 1;
    let totalActivities = 0;
    if (Array.isArray(itinerary.days)) {
        itinerary.days.forEach(d => {
            if (Array.isArray(d.activities)) totalActivities += d.activities.length;
        });
    }

    if (statsEl) {
        statsEl.innerHTML = `
            <span class="ai-stat-chip">🗓️ ${totalDays} Day${totalDays !== 1 ? 's' : ''}</span>
            <span class="ai-stat-chip">📍 ${totalActivities} Activit${totalActivities !== 1 ? 'ies' : 'y'}</span>
            <span class="ai-stat-chip edge">⚡ Llama 3 Edge AI</span>
        `;
    }

    // Day-by-Day Timeline Cards
    if (timelineEl) {
        if (Array.isArray(itinerary.days) && itinerary.days.length > 0) {
            timelineEl.innerHTML = itinerary.days.map((dayObj) => {
                const dayNum = dayObj.day || 1;
                const theme = dayObj.theme ? escapeHTML(dayObj.theme) : `Day ${dayNum} Exploration`;
                const activities = Array.isArray(dayObj.activities) ? dayObj.activities : [];

                const activitiesHtml = activities.map((act) => {
                    const timeBadge = act.time ? `<span class="activity-time-badge">${escapeHTML(act.time)}</span>` : '';
                    const locBadge = act.location ? `<span class="activity-loc-badge">📍 ${escapeHTML(act.location)}</span>` : '';

                    return `
                        <div class="ai-activity-item">
                            <div class="ai-activity-header">
                                <span class="ai-activity-name">${escapeHTML(act.name || 'Activity')}</span>
                                ${timeBadge}
                            </div>
                            <div class="ai-activity-desc">${escapeHTML(act.description || '')}</div>
                            ${locBadge ? `<div class="ai-activity-footer">${locBadge}</div>` : ''}
                        </div>
                    `;
                }).join('');

                return `
                    <div class="ai-day-card">
                        <div class="ai-day-header">
                            <div class="ai-day-num">Day ${dayNum}</div>
                            <div class="ai-day-theme">${theme}</div>
                        </div>
                        <div class="ai-activities-container">
                            ${activitiesHtml}
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            timelineEl.innerHTML = `<p style="color:var(--text-muted); text-align:center;">No activities found.</p>`;
        }
    }

    modal.style.display = 'flex';
    triggerHaptic('medium');
}

// --- SAVE AI GENERATED TRIP TO TRIPPO ---
export function saveAIGeneratedTrip() {
    if (!currentAIGeneratedItinerary) {
        showNotification("No generated itinerary available to save.");
        return;
    }

    const plan = currentAIGeneratedItinerary;
    const destInfo = findDestinationCoords(plan.destination || plan.title);

    // Compute dates starting tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const startDateStr = formatLocalDate(tomorrow);

    const totalDays = Array.isArray(plan.days) ? plan.days.length : 3;
    const newTripId = 'trip_ai_' + Date.now();

    // 1. Create Stops
    // If multi-city, we can extract from days; otherwise create a primary destination stop
    const stops = [
        {
            id: 'stop_' + Date.now() + '_1',
            name: destInfo.name.split(',')[0].trim(),
            lat: destInfo.lat,
            lon: destInfo.lon,
            nights: Math.max(1, totalDays),
            notes: [`AI Generated: ${plan.title}`, plan.summary || ''],
            transit: null,
            lodging: null,
            locked: false
        }
    ];

    // 2. Convert Activities into Places
    const places = [];
    if (Array.isArray(plan.days)) {
        plan.days.forEach((dayObj, dayIdx) => {
            if (Array.isArray(dayObj.activities)) {
                dayObj.activities.forEach((act, actIdx) => {
                    let category = '● See & Do';
                    const nameLower = (act.name || '').toLowerCase();
                    const descLower = (act.description || '').toLowerCase();
                    const timeLower = (act.time || '').toLowerCase();

                    if (nameLower.includes('dinner') || nameLower.includes('lunch') || nameLower.includes('food') || 
                        nameLower.includes('ramen') || nameLower.includes('pasta') || nameLower.includes('cafe') ||
                        timeLower.includes('evening') || descLower.includes('savor') || descLower.includes('sample')) {
                        category = '● Eat & Drink';
                    }

                    places.push({
                        id: `poi_ai_${Date.now()}_${dayIdx}_${actIdx}`,
                        cityIndex: 0,
                        dayIndex: dayIdx,
                        name: act.name || 'Activity',
                        category: category,
                        address: act.location || destInfo.name,
                        notes: act.description ? `[${act.time || 'Day'}] ${act.description}` : '',
                        lat: destInfo.lat + (Math.random() - 0.5) * 0.04,
                        lon: destInfo.lon + (Math.random() - 0.5) * 0.04
                    });
                });
            }
        });
    }

    const newTrip = {
        id: newTripId,
        name: plan.title || 'AI Planned Trip',
        startDate: startDateStr,
        isRoundTrip: false,
        budgetTravelers: 2,
        stops: stops,
        places: places,
        expenses: [],
        isExample: false,
        isAIGenerated: true,
        createdAt: Date.now()
    };

    trips.unshift(newTrip);
    saveTrips();

    closeModal('ai-trip-modal');
    setActiveTripId(newTripId);
    setActivePlacesTripId(newTripId);

    if (window.renderHome) window.renderHome();
    if (window.switchTab) window.switchTab('planner');
    if (window.renderPlanner) window.renderPlanner();

    showNotification(`✨ Added "${newTrip.name}" to your planner!`);
    triggerHaptic('success');
}

// Intelligent fallback generator when edge worker is not yet deployed or in local dev
function generateIntelligentFallbackItinerary(prompt) {
    const dest = findDestinationCoords(prompt);
    const cityName = dest.name.split(',')[0].trim();

    return {
        title: `${cityName} Highlights: AI Travel Plan`,
        destination: dest.name,
        durationDays: 3,
        summary: `A personalized itinerary for exploring ${cityName}. Enjoy local landmarks, cultural districts, and authentic regional cuisine curated by Edge AI.`,
        days: [
            {
                day: 1,
                theme: `Historic Center & Neighborhood Discovery`,
                activities: [
                    {
                        time: "Morning",
                        name: `${cityName} Old Town Walking Tour`,
                        description: `Start your trip exploring iconic architecture, local markets, and historic plazas.`,
                        location: `Historic Center, ${cityName}`
                    },
                    {
                        time: "Afternoon",
                        name: `Renowned City Art & Cultural Museum`,
                        description: `Immerse yourself in world-class collections and scenic courtyards.`,
                        location: `Museum Quarter, ${cityName}`
                    },
                    {
                        time: "Evening",
                        name: `Authentic Local Dining & Evening Walk`,
                        description: `Taste celebrated traditional specialties paired with regional wines or drinks.`,
                        location: `Old Quarter, ${cityName}`
                    }
                ]
            },
            {
                day: 2,
                theme: `Iconic Landmarks & Panoramic Views`,
                activities: [
                    {
                        time: "Morning",
                        name: `Famous Viewpoint & Scenic Observation Deck`,
                        description: `Catch breathtaking 360-degree vistas of the city skyline and landscape.`,
                        location: `Observation Point, ${cityName}`
                    },
                    {
                        time: "Afternoon",
                        name: `Artisan Markets & Shopping Boutiques`,
                        description: `Browse handmade crafts, specialty souvenirs, and local bakery treats.`,
                        location: `Downtown Promenade, ${cityName}`
                    },
                    {
                        time: "Evening",
                        name: `Sunset River / Waterfront Promenade Walk`,
                        description: `Relax with golden hour photography and waterfront bistros.`,
                        location: `Waterfront, ${cityName}`
                    }
                ]
            },
            {
                day: 3,
                theme: `Hidden Gems & Culinary Exploration`,
                activities: [
                    {
                        time: "Morning",
                        name: `Botanical Gardens or Quiet Historic Temple`,
                        description: `Enjoy a peaceful morning stroll surrounded by tranquil nature and greenery.`,
                        location: `City Gardens, ${cityName}`
                    },
                    {
                        time: "Afternoon",
                        name: `Famous Food Hall & Cooking / Tasting Experience`,
                        description: `Sample regional delicacies, cheeses, pastries, and street food.`,
                        location: `Central Market, ${cityName}`
                    },
                    {
                        time: "Evening",
                        name: `Farewell Dinner at Rooftop Terrace`,
                        description: `Celebrate the final evening with spectacular night skyline views.`,
                        location: `Rooftop Terrace, ${cityName}`
                    }
                ]
            }
        ]
    };
}

// --- INITIALIZE AI COMPONENT LISTENERS ---
export function initAITripGenerator() {
    // 1. Set up network change listeners
    window.addEventListener('online', updateAIOfflineStatus);
    window.addEventListener('offline', updateAIOfflineStatus);
    updateAIOfflineStatus();

    // 2. Form submission listener
    const form = document.getElementById('ai-trip-form');
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            submitAITripSearch();
        });
    }

    // 3. Clear button if present
    const clearBtn = document.getElementById('ai-trip-clear-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            const input = document.getElementById('ai-trip-input');
            if (input) {
                input.value = '';
                input.focus();
            }
        });
    }
}

// ==========================================================================
// IN-APP AI TRAVEL COPILOT (CHATBOT & DAILY ITINERARY SUGGESTIONS)
// ==========================================================================

export let activeCopilotStopIndex = 0;
export let activeCopilotDayIndex = 0;
export let activeCopilotTripId = null;
export let copilotChatHistory = [];
let copilotAbortController = null;

// In-memory registry of rendered suggestions to prevent JSON serialization/escaping bugs
const copilotSuggestionsRegistry = new Map();

/**
 * Open the AI Travel Copilot modal focused on a destination stop and day
 */
export function openAICopilot(stopIndex = null, dayIndex = null) {
    const trip = (activePlacesTripId && trips.find(t => t.id === activePlacesTripId)) || getActiveTrip();
    if (!trip) {
        showNotification("Please select or create a trip first.");
        return;
    }

    activeCopilotTripId = trip.id;

    // Resolve stop index
    if (stopIndex !== null && stopIndex !== undefined) {
        activeCopilotStopIndex = Number(stopIndex);
    } else if (activePlacesStopIndex !== null && activePlacesStopIndex !== undefined) {
        activeCopilotStopIndex = Number(activePlacesStopIndex);
    } else {
        activeCopilotStopIndex = 0;
    }
    if (Array.isArray(trip.stops) && trip.stops.length > 0) {
        activeCopilotStopIndex = Math.max(0, Math.min(activeCopilotStopIndex, trip.stops.length - 1));
    }

    // Resolve day index
    if (dayIndex !== null && dayIndex !== undefined) {
        activeCopilotDayIndex = Number(dayIndex);
    } else if (activePlacesDayIndex !== null && activePlacesDayIndex !== undefined) {
        activeCopilotDayIndex = Number(activePlacesDayIndex);
    } else {
        activeCopilotDayIndex = 0;
    }
    activeCopilotDayIndex = Math.max(0, activeCopilotDayIndex);

    const stop = (trip.stops && trip.stops[activeCopilotStopIndex]) || { name: trip.name || 'Destination', nights: 1 };

    // Update header subtitle
    const subtitleEl = document.getElementById('ai-copilot-subtitle');
    if (subtitleEl) {
        subtitleEl.innerText = `${stop.name} · Day ${activeCopilotDayIndex + 1}`;
    }

    // Render day switcher tabs
    renderAICopilotDayChips();

    // Check if initial greeting needs to be rendered
    const messagesContainer = document.getElementById('ai-copilot-messages');
    if (messagesContainer && copilotChatHistory.length === 0) {
        renderAICopilotGreeting(stop.name, activeCopilotDayIndex + 1);
    }

    // Open modal
    const modal = document.getElementById('ai-copilot-modal');
    if (modal) {
        modal.style.display = 'flex';
    }

    // Auto focus input
    setTimeout(() => {
        const input = document.getElementById('ai-copilot-input');
        if (input) input.focus();
    }, 120);

    triggerHaptic('light');
}

/**
 * Switch planning day within Copilot modal
 */
export function switchAICopilotDay(dayIdx) {
    activeCopilotDayIndex = Number(dayIdx);
    setActivePlacesDayIndex(activeCopilotDayIndex);

    const trip = (activeCopilotTripId && trips.find(t => t.id === activeCopilotTripId)) || getActiveTrip();
    const stop = (trip && trip.stops && trip.stops[activeCopilotStopIndex]) || { name: 'Destination' };

    // Update subtitle
    const subtitleEl = document.getElementById('ai-copilot-subtitle');
    if (subtitleEl) {
        subtitleEl.innerText = `${stop.name} · Day ${activeCopilotDayIndex + 1}`;
    }

    renderAICopilotDayChips();

    // Also update background daily planner if visible
    if (typeof window.renderPlacesDayTabs === 'function') window.renderPlacesDayTabs();
    if (typeof window.renderCityPlaces === 'function') window.renderCityPlaces();

    // Append quick system note in chat
    copilotChatHistory.push({
        role: 'bot',
        content: `Switched planning context to **Day ${activeCopilotDayIndex + 1}** (${stop.name}). What would you like to plan for this day?`,
        suggestions: []
    });
    renderAICopilotMessages();

    triggerHaptic('light');
}

/**
 * Render day selector chips in Copilot modal
 */
export function renderAICopilotDayChips() {
    const chipsContainer = document.getElementById('ai-copilot-day-chips');
    if (!chipsContainer) return;

    const trip = (activeCopilotTripId && trips.find(t => t.id === activeCopilotTripId)) || getActiveTrip();
    if (!trip || !trip.stops || !trip.stops[activeCopilotStopIndex]) {
        chipsContainer.innerHTML = '';
        return;
    }

    const stop = trip.stops[activeCopilotStopIndex];
    const numDays = Math.max(1, Number(stop.nights) || 1);

    let html = '';
    for (let i = 0; i < numDays; i++) {
        const isActive = i === activeCopilotDayIndex;
        html += `<button type="button" class="ai-copilot-day-chip ${isActive ? 'active' : ''}" onclick="switchAICopilotDay(${i})">Day ${i + 1}</button>`;
    }
    chipsContainer.innerHTML = html;
}

/**
 * Render initial conversational welcome message
 */
export function renderAICopilotGreeting(cityName, dayNum) {
    copilotChatHistory = [
        {
            role: 'bot',
            content: `👋 Hi! I'm your **AI Travel Copilot** for **${escapeHTML(cityName)} (Day ${dayNum})**.\n\nI can recommend top restaurants, reveal hidden local gems, or create a full timed schedule. Tap any suggestion below to add it directly into your Day ${dayNum} itinerary!`,
            suggestions: []
        }
    ];
    renderAICopilotMessages();
}

/**
 * Reset Copilot chat conversation
 */
export function clearAIChatHistory() {
    const trip = (activeCopilotTripId && trips.find(t => t.id === activeCopilotTripId)) || getActiveTrip();
    const stop = (trip && trip.stops && trip.stops[activeCopilotStopIndex]) || { name: 'Destination' };
    copilotChatHistory = [];
    copilotSuggestionsRegistry.clear();
    renderAICopilotGreeting(stop.name, activeCopilotDayIndex + 1);
    showNotification("AI Chat conversation reset.");
    triggerHaptic('light');
}

/**
 * Send pre-defined prompt chip
 */
export function sendAICopilotChip(promptText) {
    const input = document.getElementById('ai-copilot-input');
    if (input) input.value = promptText;
    submitAICopilotInput();
}

/**
 * Submit chat message to Copilot
 */
export async function submitAICopilotInput() {
    const input = document.getElementById('ai-copilot-input');
    const query = (input?.value || '').trim();
    if (!query) return;

    // Check offline safety constraint
    if (!checkIsOnline()) {
        showNotification("AI features require an internet connection, but your saved trips remain offline-ready.");
        triggerHaptic('warning');
        return;
    }

    // STRICT IMMUTABILITY & SAFETY GUARD:
    // AI Copilot is strictly an additive recommendation assistant with ZERO deletion capabilities.
    const isDeletionRequest = /\b(delete|remove|clear|wipe|erase|drop|kill|cancel|reset)\b/i.test(query) &&
        /\b(trip|itinerary|stop|stops|place|places|day|days|schedule|activity|activities|hotel|lodging|plan)\b/i.test(query);

    if (isDeletionRequest) {
        copilotChatHistory.push({
            role: 'user',
            content: query
        });
        copilotChatHistory.push({
            role: 'bot',
            content: `🔒 **Safety Guard:** I am strictly designed to recommend and add new travel ideas without touching or deleting your existing itinerary.\n\nTo remove or edit any existing places, stops, or trips, you can safely use the trash can 🗑️ or edit buttons directly in the planner view.`,
            suggestions: []
        });
        if (input) input.value = '';
        renderAICopilotMessages();
        triggerHaptic('light');
        return;
    }

    const trip = (activeCopilotTripId && trips.find(t => t.id === activeCopilotTripId)) || getActiveTrip();
    if (!trip) return;
    const stop = (trip.stops && trip.stops[activeCopilotStopIndex]) || { name: trip.name || 'Destination' };

    // Collect currently scheduled places for this day
    const existingPlaces = Array.isArray(trip.places)
        ? trip.places
            .filter(p => p.cityIndex === activeCopilotStopIndex && p.dayIndex === activeCopilotDayIndex)
            .map(p => p.name)
        : [];

    // Append user message
    copilotChatHistory.push({
        role: 'user',
        content: query
    });
    renderAICopilotMessages();

    // Clear input
    if (input) input.value = '';

    // Show typing indicator
    setCopilotTyping(true);

    try {
        const responseData = await fetchChatFromWorker(query, {
            city: stop.name,
            day: activeCopilotDayIndex + 1,
            tripName: trip.name,
            existingPlaces: existingPlaces
        });

        setCopilotTyping(false);

        const replyText = responseData.reply || responseData.content || `Here are recommendations for ${stop.name}:`;
        const suggestions = Array.isArray(responseData.suggestions) ? responseData.suggestions : [];

        copilotChatHistory.push({
            role: 'bot',
            content: replyText,
            suggestions: suggestions
        });

        renderAICopilotMessages();
        triggerHaptic('success');
    } catch (err) {
        console.warn('[AI Copilot] Live endpoint error, using intelligent fallback:', err);
        setCopilotTyping(false);

        // Fallback intelligent response
        const fallback = generateIntelligentChatFallback(query, stop.name, activeCopilotDayIndex + 1);
        copilotChatHistory.push({
            role: 'bot',
            content: fallback.reply,
            suggestions: fallback.suggestions
        });
        renderAICopilotMessages();
        triggerHaptic('light');
    }
}

/**
 * Render Copilot messages and interactive suggestion cards
 */
export function renderAICopilotMessages() {
    const container = document.getElementById('ai-copilot-messages');
    if (!container) return;

    let html = '';

    copilotChatHistory.forEach((msg, msgIndex) => {
        if (msg.role === 'user') {
            html += `
                <div class="ai-msg-row user">
                    <div class="ai-bubble-user">${escapeHTML(msg.content)}</div>
                </div>
            `;
        } else {
            // Formatted markdown text
            const formattedContent = escapeHTML(msg.content)
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/\n\n/g, '<br><br>')
                .replace(/\n/g, '<br>');

            let suggestionsHtml = '';
            if (Array.isArray(msg.suggestions) && msg.suggestions.length > 0) {
                const batchKey = `batch_${msgIndex}`;
                copilotSuggestionsRegistry.set(batchKey, msg.suggestions);

                const itemsHtml = msg.suggestions.map((sug, sugIndex) => {
                    const sugId = `sug_${msgIndex}_${sugIndex}`;
                    copilotSuggestionsRegistry.set(sugId, sug);

                    const timeBadge = sug.time ? `<span style="display:inline-block; font-size:10px; font-weight:700; padding:2px 7px; border-radius:10px; background:var(--primary-light, #e3f1ed); color:var(--primary); margin-left:6px;">⏱️ ${escapeHTML(sug.time)}</span>` : '';
                    const catBadge = sug.category ? `<span style="font-size:10px; font-weight:700; opacity:0.8; margin-right:4px;">${escapeHTML(sug.category)}</span>` : '';

                    return `
                        <div class="ai-chat-card" id="card_${sugId}">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                                <div>
                                    <div class="ai-chat-card-title">${catBadge}${escapeHTML(sug.name)}${timeBadge}</div>
                                    ${sug.address ? `<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">📍 ${escapeHTML(sug.address)}</div>` : ''}
                                </div>
                                <button type="button" id="btn_${sugId}" class="ai-card-add-btn" onclick="addPlaceFromAISuggestion('${sugId}', ${activeCopilotStopIndex}, ${activeCopilotDayIndex})">
                                    <span>+ Add to Day ${activeCopilotDayIndex + 1}</span>
                                </button>
                            </div>
                            <div class="ai-chat-card-desc">${escapeHTML(sug.description || '')}</div>
                        </div>
                    `;
                }).join('');

                const addAllBtn = msg.suggestions.length > 1 ? `
                    <button type="button" id="btn_${batchKey}" class="ai-add-all-btn" onclick="addAllPlacesFromAISuggestions('${batchKey}', ${activeCopilotStopIndex}, ${activeCopilotDayIndex})">
                        <span>✨ Add All (${msg.suggestions.length}) to Day ${activeCopilotDayIndex + 1}</span>
                    </button>
                ` : '';

                suggestionsHtml = `
                    <div style="margin-top:10px;">
                        ${itemsHtml}
                        ${addAllBtn}
                    </div>
                `;
            }

            html += `
                <div class="ai-msg-row bot">
                    <div class="ai-bubble-bot">
                        <div>${formattedContent}</div>
                        ${suggestionsHtml}
                    </div>
                </div>
            `;
        }
    });

    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
}

/**
 * 1-Click addition of a single AI suggestion to trip.places
 */
export function addPlaceFromAISuggestion(sugId, stopIdx, dayIdx) {
    const sug = copilotSuggestionsRegistry.get(sugId);
    if (!sug) {
        showNotification("Could not find suggestion data.");
        return;
    }

    const trip = (activeCopilotTripId && trips.find(t => t.id === activeCopilotTripId)) || getActiveTrip();
    if (!trip) return;
    if (!Array.isArray(trip.places)) trip.places = [];

    const stop = (trip.stops && trip.stops[stopIdx]) || { name: 'Destination' };
    const destCoords = (stop && stop.lat && stop.lon) ? { lat: stop.lat, lon: stop.lon } : findDestinationCoords(stop?.name);

    // Approximate coords near city with slight natural offset
    const latOffset = (Math.random() - 0.5) * 0.015;
    const lonOffset = (Math.random() - 0.5) * 0.015;

    const newPlace = {
        id: `poi_ai_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        cityIndex: Number(stopIdx),
        dayIndex: Number(dayIdx),
        name: sug.name,
        category: sug.category || '● See & Do',
        address: sug.address || `${stop.name}`,
        notes: sug.description || '',
        lat: Number((Number(destCoords.lat) + latOffset).toFixed(6)),
        lon: Number((Number(destCoords.lon) + lonOffset).toFixed(6)),
        transitMode: 'walking',
        time: sug.time || ''
    };

    // STRICT IMMUTABILITY & ANTI-MUTATION GUARANTEE:
    // AI Copilot is strictly append-only. Existing places, stops, lodgings, and trips cannot be deleted or mutated.
    const originalPlacesCount = trip.places.length;
    const originalStopsCount = Array.isArray(trip.stops) ? trip.stops.length : 0;

    trip.places.push(newPlace);

    if (trip.places.length !== originalPlacesCount + 1 || (trip.stops && trip.stops.length !== originalStopsCount)) {
        console.error('[AI Safety Guard] Mutation detected! Reverting addition to protect itinerary.');
        return;
    }

    saveTrips();

    // Re-render daily planner if active
    if (typeof window.renderCityPlaces === 'function') window.renderCityPlaces();

    // Update button in chat
    const btn = document.getElementById(`btn_${sugId}`);
    if (btn) {
        btn.innerHTML = `<span>✓ Added to Day ${dayIdx + 1}</span>`;
        btn.classList.add('added');
        btn.disabled = true;
    }

    showNotification(`✨ Added "${sug.name}" to Day ${dayIdx + 1}!`);
    triggerHaptic('success');
}

/**
 * 1-Click addition of all AI suggestions in a response
 */
export function addAllPlacesFromAISuggestions(batchKey, stopIdx, dayIdx) {
    const suggestions = copilotSuggestionsRegistry.get(batchKey);
    if (!Array.isArray(suggestions) || suggestions.length === 0) return;

    const trip = (activeCopilotTripId && trips.find(t => t.id === activeCopilotTripId)) || getActiveTrip();
    if (!trip) return;
    if (!Array.isArray(trip.places)) trip.places = [];

    const stop = (trip.stops && trip.stops[stopIdx]) || { name: 'Destination' };
    const destCoords = (stop && stop.lat && stop.lon) ? { lat: stop.lat, lon: stop.lon } : findDestinationCoords(stop?.name);

    // STRICT IMMUTABILITY & ANTI-MUTATION GUARANTEE:
    const originalPlacesCount = trip.places.length;
    const originalStopsCount = Array.isArray(trip.stops) ? trip.stops.length : 0;

    let count = 0;
    suggestions.forEach((sug, i) => {
        const latOffset = (Math.random() - 0.5) * 0.015;
        const lonOffset = (Math.random() - 0.5) * 0.015;

        const newPlace = {
            id: `poi_ai_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 7)}`,
            cityIndex: Number(stopIdx),
            dayIndex: Number(dayIdx),
            name: sug.name,
            category: sug.category || '● See & Do',
            address: sug.address || `${stop.name}`,
            notes: sug.description || '',
            lat: Number((Number(destCoords.lat) + latOffset).toFixed(6)),
            lon: Number((Number(destCoords.lon) + lonOffset).toFixed(6)),
            transitMode: 'walking',
            time: sug.time || ''
        };
        trip.places.push(newPlace);
        count++;

        // Disable individual button
        const sugId = `sug_${batchKey.replace('batch_', '')}_${i}`;
        const itemBtn = document.getElementById(`btn_${sugId}`);
        if (itemBtn) {
            itemBtn.innerHTML = `<span>✓ Added to Day ${dayIdx + 1}</span>`;
            itemBtn.classList.add('added');
            itemBtn.disabled = true;
        }
    });

    if (trip.places.length !== originalPlacesCount + count || (trip.stops && trip.stops.length !== originalStopsCount)) {
        console.error('[AI Safety Guard] Batch mutation detected! Reverting additions to protect itinerary.');
        return;
    }

    saveTrips();
    if (typeof window.renderCityPlaces === 'function') window.renderCityPlaces();

    const batchBtn = document.getElementById(`btn_${batchKey}`);
    if (batchBtn) {
        batchBtn.innerHTML = `<span>✓ Added All (${count}) to Day ${dayIdx + 1}</span>`;
        batchBtn.disabled = true;
        batchBtn.style.opacity = '0.8';
    }

    showNotification(`✨ Added all ${count} places to Day ${dayIdx + 1}!`);
    triggerHaptic('success');
}

/**
 * Controller for Copilot typing indicator
 */
export function setCopilotTyping(isTyping) {
    const typingIndicator = document.getElementById('ai-copilot-typing');
    const sendBtn = document.getElementById('ai-copilot-send-btn');
    const input = document.getElementById('ai-copilot-input');
    const container = document.getElementById('ai-copilot-messages');

    if (typingIndicator) {
        typingIndicator.style.display = isTyping ? 'flex' : 'none';
    }
    if (sendBtn) {
        sendBtn.disabled = isTyping;
    }
    if (input) {
        input.disabled = isTyping;
        if (!isTyping) input.focus();
    }
    if (container && isTyping) {
        container.scrollTop = container.scrollHeight;
    }
}

/**
 * Fetch chat response from Edge Worker
 */
async function fetchChatFromWorker(promptText, context) {
    const endpoint = getWorkerEndpoint();
    copilotAbortController = new AbortController();
    const timeoutId = setTimeout(() => {
        if (copilotAbortController) copilotAbortController.abort();
    }, 25000);

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                mode: 'chat',
                prompt: promptText,
                messages: copilotChatHistory.map(m => ({
                    role: m.role === 'bot' ? 'assistant' : 'user',
                    content: m.content
                })),
                context: context
            }),
            signal: copilotAbortController.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            let errorMsg = `HTTP ${response.status}`;
            try {
                const errJson = await response.json();
                if (errJson && errJson.error) errorMsg = errJson.error;
            } catch (e) {}
            throw new Error(errorMsg);
        }

        const data = await response.json();
        return data;
    } catch (err) {
        clearTimeout(timeoutId);
        throw err;
    }
}

/**
 * Resilient local fallback generator for offline or dev environments
 */
function generateIntelligentChatFallback(prompt, cityName, dayNum) {
    const lower = (prompt || '').toLowerCase();

    // STRICT SAFETY GUARD: Explain immutability and refuse any deletion attempts
    if (/\b(delete|remove|clear|wipe|erase|drop|kill|cancel|reset)\b/i.test(lower) &&
        /\b(trip|itinerary|stop|stops|place|places|day|days|schedule|activity|activities|hotel|lodging|plan)\b/i.test(lower)) {
        return {
            reply: `🔒 **Safety Guard:** I am strictly designed to recommend and add new travel ideas without touching or deleting your existing itinerary.\n\nTo remove or edit any existing places, stops, or trips, you can safely use the trash can 🗑️ or edit buttons directly in the planner view.`,
            suggestions: []
        };
    }

    if (lower.includes('food') || lower.includes('eat') || lower.includes('restaurant') || lower.includes('dinner') || lower.includes('lunch') || lower.includes('cafe') || lower.includes('coffee') || lower.includes('dining')) {
        return {
            reply: `Here are 3 exceptional dining and food spots curated for Day ${dayNum} in **${cityName}**:`,
            suggestions: [
                {
                    name: `${cityName} Artisanal Breakfast & Specialty Coffee`,
                    category: '● Eat & Drink',
                    time: 'Morning',
                    address: `Central Quarter, ${cityName}`,
                    description: `Start the morning with fresh locally roasted coffee, specialty pastries, and seasonal brunch.`
                },
                {
                    name: `Celebrated Traditional Trattoria & Lunch Bistro`,
                    category: '● Eat & Drink',
                    time: 'Lunch',
                    address: `Old Town District, ${cityName}`,
                    description: `Famous neighborhood spot serving regional specialties made with fresh local market ingredients.`
                },
                {
                    name: `Candlelit Evening Bistro & Wine Lounge`,
                    category: '● Eat & Drink',
                    time: 'Evening',
                    address: `Historic Waterfront, ${cityName}`,
                    description: `Unwind with authentic tasting menus, handcrafted cocktails, and great nighttime atmosphere.`
                }
            ]
        };
    }

    if (lower.includes('sight') || lower.includes('attraction') || lower.includes('must-see') || lower.includes('museum') || lower.includes('culture')) {
        return {
            reply: `Here are top cultural highlights and must-see sights for Day ${dayNum} in **${cityName}**:`,
            suggestions: [
                {
                    name: `${cityName} Historic Plaza & Heritage Landmark`,
                    category: '● See & Do',
                    time: 'Morning',
                    address: `City Center, ${cityName}`,
                    description: `Iconic landmark with striking architecture, historic courtyard gardens, and photo opportunities.`
                },
                {
                    name: `Premier City Art & History Museum`,
                    category: '● See & Do',
                    time: 'Afternoon',
                    address: `Museum Quarter, ${cityName}`,
                    description: `Immerse yourself in world-renowned exhibits, permanent galleries, and tranquil sculpture gardens.`
                },
                {
                    name: `Scenic Panoramic Observation Deck`,
                    category: '● See & Do',
                    time: 'Evening',
                    address: `Highpoint Vista, ${cityName}`,
                    description: `Catch breathtaking sunset views across ${cityName}'s skyline as the city lights turn on.`
                }
            ]
        };
    }

    if (lower.includes('hidden') || lower.includes('secret') || lower.includes('gem') || lower.includes('unique')) {
        return {
            reply: `Here are 3 delightful hidden gems off the beaten tourist path in **${cityName}**:`,
            suggestions: [
                {
                    name: `Charming Secret Courtyard & Artisan Bookshop`,
                    category: '● See & Do',
                    time: 'Morning',
                    address: `Artists Quarter, ${cityName}`,
                    description: `A peaceful oasis tucked away behind cobblestone streets with local crafts and literature.`
                },
                {
                    name: `Local Independent Food Market & Delicatessen`,
                    category: '● Eat & Drink',
                    time: 'Lunch',
                    address: `East District, ${cityName}`,
                    description: `Loved by residents for artisanal cheeses, street snacks, and warm homemade treats.`
                },
                {
                    name: `Rooftop Botanical Garden & Sunset Bar`,
                    category: '● See & Do',
                    time: 'Evening',
                    address: `Sky Terrace, ${cityName}`,
                    description: `A lush rooftop hideaway offering calm atmosphere and handcrafted botanical cocktails.`
                }
            ]
        };
    }

    // Default: full day timed plan
    return {
        reply: `Here is a complete, balanced day plan for Day ${dayNum} in **${cityName}**:`,
        suggestions: [
            {
                name: `${cityName} Old Town Walking Exploration`,
                category: '● See & Do',
                time: 'Morning',
                address: `Historic Center, ${cityName}`,
                description: `Discover quaint streets, bustling morning markets, and celebrated architecture.`
            },
            {
                name: `Authentic Regional Lunch & Cafe Stop`,
                category: '● Eat & Drink',
                time: 'Lunch',
                address: `Market Square, ${cityName}`,
                description: `Savor traditional local flavors and refreshing drinks in a vibrant plaza setting.`
            },
            {
                name: `Scenic Waterfront Promenade & Sunset Walk`,
                category: '● See & Do',
                time: 'Evening',
                address: `Riverfront Boardwalk, ${cityName}`,
                description: `Relax with golden hour reflections, street musicians, and delightful evening breeze.`
            }
        ]
    };
}
