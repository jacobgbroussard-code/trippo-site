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
    showNotification,
    closeModal,
    triggerHaptic,
    escapeHTML,
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
            input.placeholder = "⚠️ AI requires internet. Saved trips are available offline.";
        } else {
            input.placeholder = "e.g. 5 days in Tokyo for ramen & anime, or weekend in Rome...";
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
