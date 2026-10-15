/* ==========================================================================
   Trippo Travel Planner - Serverless Edge AI Travel Assistant
   js/ai.js
   Powered by Cloudflare Workers AI & Llama 3.1 8B Instruct
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
    formatLocalDate,
    formatTime,
    safeGetStorage,
    safeSetStorage,
    toggleSidebar,
    getDistance,
    parseLocalDate,
} from './state.js';
import { buildAviasalesFlightUrl, ticketLink, getLiveFares, hasLiveFlightPrices } from './travel-payouts.js';
import { getTravelProfileText } from './travel-profile.js';

// Real AI runs on each user's own Gemini API key (Settings → AI). There is no shared default
// worker, so nobody can run up the owner's quota; a self-hosted worker URL can still be set in
// localStorage ('trippoCloudflareWorkerUrl') for testing.
export const DEFAULT_WORKER_URL = '';

// Thrown when there is no Gemini key and no worker configured; callers fall back to templates.
export class NoAIKeyError extends Error {
    constructor() { super('No Gemini API key set'); this.name = 'NoAIKeyError'; }
}

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
    'osaka': { lat: 34.6937, lon: 135.5023, name: 'Osaka, Japan' },
    'hiroshima': { lat: 34.3853, lon: 132.4553, name: 'Hiroshima, Japan' },
    'guangzhou': { lat: 23.1291, lon: 113.2644, name: 'Guangzhou, China' },
    'guilin': { lat: 25.2736, lon: 110.2902, name: 'Guilin, China' },
    'yangshuo': { lat: 24.7784, lon: 110.4950, name: 'Yangshuo, China' },
    'shenzhen': { lat: 22.5431, lon: 114.0579, name: 'Shenzhen, China' },
    'hong kong': { lat: 22.3193, lon: 114.1694, name: 'Hong Kong' },
    'macau': { lat: 22.1987, lon: 113.5439, name: 'Macau' },
    'beijing': { lat: 39.9042, lon: 116.4074, name: 'Beijing, China' },
    'shanghai': { lat: 31.2304, lon: 121.4737, name: 'Shanghai, China' },
    'xian': { lat: 34.3416, lon: 108.9398, name: "Xi'an, China" },
    'xi\'an': { lat: 34.3416, lon: 108.9398, name: "Xi'an, China" },
    'chengdu': { lat: 30.5728, lon: 104.0668, name: 'Chengdu, China' },
    'paris': { lat: 48.8566, lon: 2.3522, name: 'Paris, France' },
    'nice': { lat: 43.7102, lon: 7.2620, name: 'Nice, France' },
    'rome': { lat: 41.9028, lon: 12.4964, name: 'Rome, Italy' },
    'florence': { lat: 43.7696, lon: 11.2558, name: 'Florence, Italy' },
    'venice': { lat: 45.4408, lon: 12.3155, name: 'Venice, Italy' },
    'milan': { lat: 45.4642, lon: 9.1900, name: 'Milan, Italy' },
    'london': { lat: 51.5074, lon: -0.1278, name: 'London, UK' },
    'edinburgh': { lat: 55.9533, lon: -3.1883, name: 'Edinburgh, UK' },
    'new york': { lat: 40.7128, lon: -74.0060, name: 'New York, USA' },
    'barcelona': { lat: 41.3851, lon: 2.1734, name: 'Barcelona, Spain' },
    'madrid': { lat: 40.4168, lon: -3.7038, name: 'Madrid, Spain' },
    'bangkok': { lat: 13.7563, lon: 100.5018, name: 'Bangkok, Thailand' },
    'chiang mai': { lat: 18.7883, lon: 98.9853, name: 'Chiang Mai, Thailand' },
    'phuket': { lat: 7.8804, lon: 98.3923, name: 'Phuket, Thailand' },
    'amsterdam': { lat: 52.3676, lon: 4.9041, name: 'Amsterdam, Netherlands' },
    'iceland': { lat: 64.1466, lon: -21.9426, name: 'Reykjavik, Iceland' },
    'costa rica': { lat: 9.9281, lon: -84.0907, name: 'San Jose, Costa Rica' },
    'swiss alps': { lat: 46.5590, lon: 8.5609, name: 'Interlaken, Switzerland' },
    'switzerland': { lat: 46.8182, lon: 8.2275, name: 'Bern, Switzerland' },
    'seoul': { lat: 37.5665, lon: 126.9780, name: 'Seoul, South Korea' },
    'busan': { lat: 35.1796, lon: 129.0756, name: 'Busan, South Korea' },
    'san francisco': { lat: 37.7749, lon: -122.4194, name: 'San Francisco, USA' },
    'los angeles': { lat: 34.0522, lon: -118.2437, name: 'Los Angeles, USA' },
    'hawaii': { lat: 21.3069, lon: -157.8583, name: 'Honolulu, Hawaii' },
    'sydney': { lat: -33.8688, lon: 151.2093, name: 'Sydney, Australia' },
    'berlin': { lat: 52.5200, lon: 13.4050, name: 'Berlin, Germany' },
    'lisbon': { lat: 38.7223, lon: -9.1393, name: 'Lisbon, Portugal' },
    'porto': { lat: 41.1579, lon: -8.6291, name: 'Porto, Portugal' },
    'singapore': { lat: 1.3521, lon: 103.8198, name: 'Singapore' },
    'dubai': { lat: 25.2048, lon: 55.2708, name: 'Dubai, UAE' }
};

export function findDestinationCoords(text) {
    if (!text) return { lat: 48.8566, lon: 2.3522, name: 'Trip Destination' };
    const lower = text.toLowerCase();
    for (const [key, coords] of Object.entries(POPULAR_DESTINATION_COORDS)) {
        if (lower.includes(key)) return coords;
    }
    return { lat: 48.8566, lon: 2.3522, name: text, unknown: true }; // caller should look it up
}

/**
 * Extracts requested duration in days from user prompt (e.g. "7 days in southern china", "2 weeks in japan", "weekend in rome")
 */
export function extractDurationDays(prompt) {
    if (!prompt) return 3;
    const lower = prompt.toLowerCase();

    // 1. Check for weeks (e.g. "2 weeks", "a week", "1 week")
    const weekMatch = lower.match(/(\d+)\s*(?:[- ]?week|weeks|wk|wks)\b/i);
    if (weekMatch) {
        const weeks = parseInt(weekMatch[1], 10);
        if (weeks > 0 && weeks <= 4) return Math.min(14, weeks * 7);
    }
    if (/\b(?:a|one)\s+week\b/i.test(lower)) return 7;

    // 2. Check for explicit number of days (e.g. "7 days", "10-day", "3d", "5 days")
    const dayMatch = lower.match(/(\d+)\s*(?:[- ]?days?|d\b)/i);
    if (dayMatch) {
        const days = parseInt(dayMatch[1], 10);
        if (days >= 1 && days <= 21) return days;
    }

    // 3. Spelled numbers ("three days", "five days", "seven days")
    const wordNums = {
        'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
        'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
        'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14
    };
    for (const [word, val] of Object.entries(wordNums)) {
        const re = new RegExp(`\\b${word}\\s+(?:days?)\\b`, 'i');
        if (re.test(lower)) return val;
    }

    // 4. Weekend check
    if (/\bweekend\b/i.test(lower)) return 3;

    return 4; // Default pleasant trip length if unspecified
}

/**
 * Multi-city & Regional Route Registry:
 * Resolves regional queries ("Southern China", "Northern Italy", "Golden Route Japan", etc.)
 * into distinct stop cities with coordinates and day distributions.
 */
const REGIONAL_ROUTES = [
    {
        keywords: ['southern china', 'south china', 'guangdong', 'guangxi', 'lingnan'],
        regionName: 'Southern China',
        stops: [
            {
                name: 'Guangzhou',
                country: 'China',
                lat: 23.1291,
                lon: 113.2644,
                share: 0.30,
                themes: ['Dim Sum Culture & Shamian Island Heritage', 'Canton Tower & Pearl River Waterfront'],
                places: [
                    { name: 'Shamian Island Historic District', category: '● See & Do', time: 'Morning', location: 'Shamian Island, Guangzhou', description: 'Stroll shady avenues lined with European colonial architecture and traditional banyan trees.' },
                    { name: 'Dim Sum at Panxi Restaurant', category: '● Eat & Drink', time: 'Lunch', location: 'Liwan District, Guangzhou', description: 'Feast on handcrafted har gow, siu mai, and char siu bao beside scenic lake gardens.' },
                    { name: 'Canton Tower Observation & Pearl River Cruise', category: '● See & Do', time: 'Evening', location: 'Haizhu District, Guangzhou', description: 'Marvel at panoramic skyline views and take an illuminated evening boat ride along the Pearl River.' }
                ]
            },
            {
                name: 'Guilin & Yangshuo',
                country: 'China',
                lat: 24.7784,
                lon: 110.4950,
                share: 0.40,
                themes: ['Li River Karst Peaks Cruise', 'Yangshuo Countryside & Yulong River Bamboo Rafting', 'West Street & Impression Sanjie Liu'],
                places: [
                    { name: 'Li River Karst Mountain Cruise', category: '● See & Do', time: 'Morning', location: 'Li River, Guilin to Yangshuo', description: 'Drift past world-famous limestone karst mountains depicted on the 20-yuan banknote.' },
                    { name: 'Guilin Rice Noodles at Chunji', category: '● Eat & Drink', time: 'Lunch', location: 'Central Guilin', description: 'Sample beloved local sour-spicy rice noodles topped with crispy pork and pickled vegetables.' },
                    { name: 'Yulong River Bamboo Rafting', category: '● See & Do', time: 'Afternoon', location: 'Yulong River, Yangshuo', description: 'Glide along emerald waters surrounded by picturesque rice paddies and ancient bridges.' },
                    { name: 'Impression Sanjie Liu Light Show', category: '● See & Do', time: 'Evening', location: 'Yangshuo', description: 'Mesmerizing theatrical performance staged directly on the Li River by director Zhang Yimou.' }
                ]
            },
            {
                name: 'Hong Kong & Shenzhen',
                country: 'China',
                lat: 22.3193,
                lon: 114.1694,
                share: 0.30,
                themes: ['Victoria Peak & Star Ferry Crossing', 'Neon Markets & Roast Goose Delicacies'],
                places: [
                    { name: 'Victoria Peak & Peak Tram', category: '● See & Do', time: 'Morning', location: 'Central, Hong Kong', description: 'Ride the iconic historic funicular railway for world-class panoramic views across Victoria Harbour.' },
                    { name: 'Kam\'s Roast Goose', category: '● Eat & Drink', time: 'Lunch', location: 'Wan Chai, Hong Kong', description: 'Michelin-starred succulent roast goose with crispy skin and fragrant plum sauce.' },
                    { name: 'Star Ferry & Tsim Sha Tsui Promenade', category: '● See & Do', time: 'Evening', location: 'Tsim Sha Tsui, Hong Kong', description: 'Enjoy the Symphony of Lights skyline show and atmospheric harbour breeze.' }
                ]
            }
        ]
    },
    {
        keywords: ['golden route', 'japan classic', 'tokyo and kyoto', 'japan tour'],
        regionName: 'Japan Golden Route',
        stops: [
            {
                name: 'Tokyo',
                country: 'Japan',
                lat: 35.6762,
                lon: 139.6503,
                share: 0.45,
                themes: ['Historic Asakusa & Akihabara', 'Shibuya Crossing & Meiji Shrine', 'Shinjuku Skyscraper Lights'],
                places: [
                    { name: 'Senso-ji Temple & Nakamise-dori', category: '● See & Do', time: 'Morning', location: 'Asakusa, Tokyo', description: 'Tokyo\'s oldest temple surrounded by bustling craft and street snack stalls.' },
                    { name: 'Meiji Jingu Shrine & Yoyogi Forest', category: '● See & Do', time: 'Afternoon', location: 'Shibuya, Tokyo', description: 'Serene forested cedar shrine dedicated to Emperor Meiji.' },
                    { name: 'Shibuya Sky & Scramble Crossing', category: '● See & Do', time: 'Evening', location: 'Shibuya, Tokyo', description: 'Rooftop observatory overlooking the busiest intersection in the world.' }
                ]
            },
            {
                name: 'Kyoto',
                country: 'Japan',
                lat: 35.0116,
                lon: 135.7681,
                share: 0.35,
                themes: ['Fushimi Inari Torii Gates & Gion Geisha District', 'Arashiyama Bamboo Grove & Golden Pavilion'],
                places: [
                    { name: 'Fushimi Inari Shrine', category: '● See & Do', time: 'Morning', location: 'Fushimi, Kyoto', description: 'Walk through thousands of vermilion torii gates winding up sacred Mount Inari.' },
                    { name: 'Kinkaku-ji (Golden Pavilion)', category: '● See & Do', time: 'Afternoon', location: 'Kita Ward, Kyoto', description: 'Stunning Zen Buddhist temple whose top two floors are completely covered in gold leaf.' },
                    { name: 'Gion Historic Tea Houses & Pontocho Alley', category: '● Eat & Drink', time: 'Evening', location: 'Gion, Kyoto', description: 'Atmospheric lantern-lit alleyways renowned for traditional kaiseki dining.' }
                ]
            },
            {
                name: 'Osaka',
                country: 'Japan',
                lat: 34.6937,
                lon: 135.5023,
                share: 0.20,
                themes: ['Osaka Castle & Dotonbori Street Food Feast'],
                places: [
                    { name: 'Osaka Castle & Park Gardens', category: '● See & Do', time: 'Morning', location: 'Chuo Ward, Osaka', description: 'Grand historic fortress surrounded by massive stone walls and moats.' },
                    { name: 'Dotonbori Street Food (Takoyaki & Okonomiyaki)', category: '● Eat & Drink', time: 'Evening', location: 'Dotonbori, Osaka', description: 'Vibrant canal district packed with neon signs, giant mechanical crabs, and sizzling snacks.' }
                ]
            }
        ]
    },
    {
        keywords: ['italy', 'northern italy', 'italian classic', 'rome florence venice'],
        regionName: 'Classic Italy',
        stops: [
            {
                name: 'Rome',
                country: 'Italy',
                lat: 41.9028,
                lon: 12.4964,
                share: 0.40,
                themes: ['Colosseum & Roman Forum Ancient Empire', 'Vatican Museums, St. Peter\'s & Trastevere'],
                places: [
                    { name: 'Colosseum & Roman Forum', category: '● See & Do', time: 'Morning', location: 'Piazza del Colosseo, Rome', description: 'Walk the footsteps of gladiators and senators through ancient Rome\'s monumental heart.' },
                    { name: 'Pantheon & Piazza Navona', category: '● See & Do', time: 'Afternoon', location: 'Centro Storico, Rome', description: 'Marvel at the ancient Roman dome and Bernini\'s famous fountains.' },
                    { name: 'Trastevere Trattoria Dinner', category: '● Eat & Drink', time: 'Evening', location: 'Trastevere, Rome', description: 'Savor cacio e pepe and carbonara in lively cobblestone squares.' }
                ]
            },
            {
                name: 'Florence',
                country: 'Italy',
                lat: 43.7696,
                lon: 11.2558,
                share: 0.35,
                themes: ['Duomo Cathedral & Uffizi Renaissance Art', 'Ponte Vecchio & Piazzale Michelangelo Sunset'],
                places: [
                    { name: 'Florence Duomo & Giotto\'s Bell Tower', category: '● See & Do', time: 'Morning', location: 'Piazza del Duomo, Florence', description: 'Brunelleschi\'s engineering masterpiece towering over the city.' },
                    { name: 'Uffizi Gallery', category: '● See & Do', time: 'Afternoon', location: 'Piazzale degli Uffizi, Florence', description: 'World-renowned museum housing Botticelli\'s Birth of Venus and Da Vinci masterworks.' },
                    { name: 'Sunset at Piazzale Michelangelo', category: '● See & Do', time: 'Evening', location: 'Oltrarno, Florence', description: 'Breathtaking golden-hour panoramic vista across the Arno River.' }
                ]
            },
            {
                name: 'Venice',
                country: 'Italy',
                lat: 45.4408,
                lon: 12.3155,
                share: 0.25,
                themes: ['St. Mark\'s Basilica & Grand Canal Gondola Ride'],
                places: [
                    { name: 'St. Mark\'s Square & Doge\'s Palace', category: '● See & Do', time: 'Morning', location: 'Piazza San Marco, Venice', description: 'Opulent Venetian Gothic architecture and gold-adorned basilica.' },
                    { name: 'Grand Canal & Rialto Bridge', category: '● See & Do', time: 'Afternoon', location: 'Rialto, Venice', description: 'Glide along Venice\'s primary water thoroughfare past historic palazzi.' },
                    { name: 'Cicchetti & Spritz in Cannaregio', category: '● Eat & Drink', time: 'Evening', location: 'Cannaregio, Venice', description: 'Traditional Venetian tapas bars along quiet, charming canals.' }
                ]
            }
        ]
    },
    {
        keywords: ['thailand', 'thai tour', 'bangkok and islands'],
        regionName: 'Thailand Highlights',
        stops: [
            {
                name: 'Bangkok',
                country: 'Thailand',
                lat: 13.7563,
                lon: 100.5018,
                share: 0.40,
                themes: ['Grand Palace & Wat Pho', 'Chao Phraya River & Night Food Markets'],
                places: [
                    { name: 'The Grand Palace & Wat Phra Kaew', category: '● See & Do', time: 'Morning', location: 'Phra Nakhon, Bangkok', description: 'Exquisite royal complex with the revered Emerald Buddha.' },
                    { name: 'Wat Pho Reclining Buddha', category: '● See & Do', time: 'Afternoon', location: 'Bangkok', description: 'Massive gold-leaf covered Buddha and birthplace of traditional Thai massage.' },
                    { name: 'Yaowarat Chinatown Street Food', category: '● Eat & Drink', time: 'Evening', location: 'Chinatown, Bangkok', description: 'World-famous buzzing food hub with seafood, noodle soups, and mango sticky rice.' }
                ]
            },
            {
                name: 'Chiang Mai',
                country: 'Thailand',
                lat: 18.7883,
                lon: 98.9853,
                share: 0.35,
                themes: ['Old City Temples & Mountain Vistas', 'Elephant Sanctuary & Night Bazaar'],
                places: [
                    { name: 'Wat Phra That Doi Suthep', category: '● See & Do', time: 'Morning', location: 'Doi Suthep, Chiang Mai', description: 'Sacred mountain temple offering panoramic vistas over the valley.' },
                    { name: 'Khao Soi Lam Duan Lunch', category: '● Eat & Drink', time: 'Lunch', location: 'Fa Ham, Chiang Mai', description: 'Rich northern coconut curry egg noodle soup with crispy toppings.' },
                    { name: 'Sunday Walking Street Market', category: '● See & Do', time: 'Evening', location: 'Old City, Chiang Mai', description: 'Vibrant open-air market with local northern handicrafts and live music.' }
                ]
            },
            {
                name: 'Phuket',
                country: 'Thailand',
                lat: 7.8804,
                lon: 98.3923,
                share: 0.25,
                themes: ['Andaman Sea Beaches & Island Cruise'],
                places: [
                    { name: 'Phang Nga Bay Island Speedboat Tour', category: '● See & Do', time: 'Morning', location: 'Phang Nga Bay, Phuket', description: 'Explore limestone cliffs, hidden lagoons, and emerald waters.' },
                    { name: 'Kata Noi Beach Sunset', category: '● See & Do', time: 'Evening', location: 'Karon, Phuket', description: 'Relaxed pristine beach with golden sand and sea breeze.' }
                ]
            }
        ]
    }
];

/**
 * Resolves destination context and stop breakdown for any prompt and duration.
 */
export function resolveTripDestinations(prompt, totalDays) {
    const lower = (prompt || '').toLowerCase();

    // Check regional route registry first
    for (const route of REGIONAL_ROUTES) {
        if (route.keywords.some(k => lower.includes(k))) {
            let remainingDays = totalDays;
            const stopsAllocated = [];

            route.stops.forEach((st, idx) => {
                let stopDays;
                if (idx === route.stops.length - 1) {
                    stopDays = Math.max(1, remainingDays);
                } else {
                    stopDays = Math.max(1, Math.round(totalDays * st.share));
                    if (stopDays >= remainingDays) stopDays = Math.max(1, remainingDays - 1);
                }
                remainingDays -= stopDays;

                stopsAllocated.push({
                    name: st.name,
                    fullName: `${st.name}, ${st.country}`,
                    lat: st.lat,
                    lon: st.lon,
                    nights: stopDays,
                    themes: st.themes,
                    presetPlaces: st.places
                });
            });

            return {
                isMultiCity: true,
                regionName: route.regionName,
                stops: stopsAllocated
            };
        }
    }

    // Single destination fallback
    const dest = findDestinationCoords(prompt);
    const cityName = dest.name.split(',')[0].trim();
    return {
        isMultiCity: false,
        regionName: cityName,
        stops: [
            {
                name: cityName,
                fullName: dest.name,
                lat: dest.lat,
                lon: dest.lon,
                nights: totalDays,
                themes: [],
                presetPlaces: []
            }
        ]
    };
}

// --- SAVE AI GENERATED TRIP TO TRIPPO ---
// --- AI plan helpers (v2 plans have "stops" with coordinates; older/template plans only "days") ---
const AI_CATEGORY = { 'see & do': '● See & Do', 'food & drink': '🍽 Food & Drink', shopping: '🛍 Shopping', cafe: '☕ Cafe & Chill', nature: '● See & Do' };
const SLOT_TIMES = { morning: '09:00', breakfast: '08:00', 'late morning': '11:00', lunch: '12:30', afternoon: '14:00', 'late afternoon': '16:30', evening: '19:00', dinner: '19:00', night: '21:00' };

function validCoord(lat, lon) {
    const la = Number(lat), lo = Number(lon);
    return Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180 && !(la === 0 && lo === 0);
}

function normalizeAITime(t) {
    const str = String(t || '').trim();
    const m = str.match(/^(\d{1,2}):(\d{2})\s*([ap])?\.?\s*m?\.?$/i);
    if (m) {
        let h = Number(m[1]) % 24;
        if (m[3]) h = (h % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0);
        return `${String(h).padStart(2, '0')}:${m[2]}`;
    }
    return SLOT_TIMES[str.toLowerCase()] || '';
}

function mapAICategory(cat, name) {
    const key = String(cat || '').replace(/^[^a-z]+/i, '').trim().toLowerCase();
    if (AI_CATEGORY[key]) return AI_CATEGORY[key];
    if (/eat|food|drink|dinner|lunch|restaurant/i.test(`${cat} ${name}`)) return '🍽 Food & Drink';
    if (/cafe|café|coffee|tea|dessert/i.test(`${cat} ${name}`)) return '☕ Cafe & Chill';
    if (/shop|market|mall/i.test(`${cat} ${name}`)) return '🛍 Shopping';
    return '● See & Do';
}

// Clean up whatever came back so the preview, library, compare view and save all get the same shape
export function normalizeAIItinerary(plan) {
    if (!plan || typeof plan !== 'object') return plan;
    if (!Array.isArray(plan.days)) plan.days = [];
    plan.days.forEach((d, i) => {
        if (!d || typeof d !== 'object') return;
        if (!d.day) d.day = i + 1;
        if (!Array.isArray(d.activities)) d.activities = [];
        d.activities = d.activities.filter(act => !(act && TRAVEL_ACTIVITY.test(String(act.name || ''))));
        d.activities.forEach(act => {
            if (!act || typeof act !== 'object') return;
            const clock = normalizeAITime(act.time);
            if (clock) { act.slot = act.time; act.time = clock; }
        });
        d.activities.sort((x, y) => String(x.time || '99').localeCompare(String(y.time || '99')));
    });
    if (Array.isArray(plan.stops)) {
        plan.stops = plan.stops.filter(st => st && typeof st.name === 'string' && st.name.trim());
        plan.stops.forEach(st => { st.hotels = Array.isArray(st.hotels) ? st.hotels.filter(h => h && typeof h.name === 'string' && h.name.trim()).slice(0, 3) : []; });
    }
    const out = plan.flights && plan.flights.outbound;
    if (!out || !/^[A-Z]{3}$/i.test(String(out.from || '')) || !/^[A-Z]{3}$/i.test(String(out.to || ''))) plan.flights = null;
    else if (plan.flights.return && !/^[A-Z]{3}$/i.test(String(plan.flights.return.from || ''))) plan.flights.return = null;
    if (!plan.durationDays) plan.durationDays = plan.days.length;
    return plan;
}

const fmtMinutes = m => { m = Math.round(Number(m)); return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`; };
const TRAVEL_ACTIVITY = /^\s*((take (the )?)?(train|bus|flight|ferry|transfer|travel|return|head back)\s+(to|back|from)\b|check[ -]?(in|out)\b)/i;
const isDayTripTheme = theme => /^\s*(day\s*-?\s*trip|excursion|side trip)\b/i.test(String(theme || ''));

function finishAITripSave(newTrip, label) {
    trips.unshift(newTrip);
    saveTrips();
    closeModal('ai-trip-modal');
    closeModal('ai-trip-search-modal');
    setActiveTripId(newTrip.id);
    setActivePlacesTripId(newTrip.id);
    setActivePlacesStopIndex(0);
    setActivePlacesDayIndex(0);
    if (window.renderHome) window.renderHome();
    if (window.switchTab) window.switchTab('planner');
    if (window.renderPlanner) window.renderPlanner();
    showNotification(`✨ Added "${newTrip.name}" (${label}) to your planner!`);
    triggerHaptic('success');
    fixMissingAIStopCoords(newTrip.id);
}

// Stops whose city Gemini/registry couldn't place get looked up on the map after saving
async function fixMissingAIStopCoords(tripId) {
    const trip = trips.find(t => t.id === tripId);
    if (!trip) return;
    const missing = trip.stops.map((st, i) => ({ st, i })).filter(x => x.st.needsGeocode);
    for (const { st, i } of missing) {
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(st.geocodeQuery || st.name)}`, { headers: { 'Accept-Language': 'en' } });
            const hit = res.ok ? (await res.json())[0] : null;
            if (hit) {
                const lat = Number(hit.lat), lon = Number(hit.lon);
                const oldLat = st.lat, oldLon = st.lon;
                st.lat = lat; st.lon = lon;
                // Places that were only guessed around the old point move with the stop
                (trip.places || []).forEach(pl => {
                    if (pl.cityIndex === i && pl.approxLocation) { pl.lat = lat + (pl.lat - oldLat); pl.lon = lon + (pl.lon - oldLon); }
                });
            }
        } catch (e) { /* stays where it is; the user can fix it on the map */ }
        delete st.needsGeocode;
        delete st.geocodeQuery;
        await new Promise(r => setTimeout(r, 1100));
    }
    if (missing.length) {
        saveTrips();
        if (window.renderPlanner) window.renderPlanner();
    }
}

function saveStructuredAITrip(plan) {
    const now = Date.now();
    const days = Array.isArray(plan.days) ? plan.days : [];
    const inStops = plan.stops.slice(0, 15);
    const key = v => String(v || '').toLowerCase().split(',')[0].trim();

    // Which stop each day belongs to (day trips stay on their base city)
    let current = 0;
    const dayStop = days.map(d => {
        let i = inStops.findIndex(st => key(st.name) === key(d.stop));
        if (i < 0 && d.theme && !d.dayTrip && !isDayTripTheme(d.theme)) i = inStops.findIndex(st => key(st.name) === key(String(d.theme).split(':')[0]));
        if (i >= 0 && !d.dayTrip) current = i;
        return d.dayTrip || i < 0 ? current : i;
    });

    const stops = inStops.map((st, i) => {
        const dayCount = dayStop.filter(x => x === i).length;
        const nights = Math.max(1, dayCount, Math.min(30, Math.round(Number(st.nights) || 0)));
        let lat = Number(st.lat), lon = Number(st.lon), needsGeocode = false;
        if (!validCoord(lat, lon)) {
            const acts = days.filter((d, di) => dayStop[di] === i && !d.dayTrip).flatMap(d => d.activities || []).filter(x => validCoord(x.lat, x.lon));
            if (acts.length) {
                lat = acts.reduce((sum, x) => sum + Number(x.lat), 0) / acts.length;
                lon = acts.reduce((sum, x) => sum + Number(x.lon), 0) / acts.length;
            } else {
                const known = findDestinationCoords(st.name);
                lat = known.lat; lon = known.lon; needsGeocode = Boolean(known.unknown);
            }
        }
        const stop = {
            id: `stop_${now}_${i + 1}`,
            name: st.name.split(',')[0].trim(),
            lat, lon, nights,
            notes: Array(nights).fill(''),
            transit: null, lodging: null, locked: false
        };
        if (needsGeocode) { stop.needsGeocode = true; stop.geocodeQuery = [st.name, st.country].filter(Boolean).join(', '); }
        const ideas = (st.hotels || []).map(h => ({
            name: String(h.name).slice(0, 80),
            area: String(h.area || '').slice(0, 60),
            tier: String(h.tier || '').slice(0, 12),
            price: Math.round(Number(h.pricePerNightUSD)) || null
        }));
        if (ideas.length) stop.hotelIdeas = ideas;
        return stop;
    });

    // Day notes: the day's theme, plus where to stay and how you got here on the first day
    const seen = stops.map(() => 0);
    const places = [];
    days.forEach((d, di) => {
        const si = dayStop[di];
        const stop = stops[si];
        if (!stop) return;
        const local = Math.min(seen[si]++, stop.nights - 1);
        const theme = String(d.theme || '').replace(/^[^:]{1,40}:\s*/, '');
        const lines = [d.dayTrip ? `Day trip: ${theme}` : theme];
        if (local === 0) {
            const src = inStops[si];
            if (src.stayArea) lines.push(`Stay: ${src.stayArea}`);
            const prev = inStops[si - 1] && inStops[si - 1].transitToNext;
            if (prev && (prev.details || prev.method)) {
                lines.push(`Getting here: ${[prev.details || prev.method, prev.durationMinutes ? `${prev.durationMinutes} min` : '', prev.costUSD ? `~$${prev.costUSD} pp` : ''].filter(Boolean).join(', ')}${prev.from ? ` (${prev.from} → ${prev.to || stop.name})` : ''}`);
            }
        }
        stop.notes[local] = [stop.notes[local], ...lines].filter(Boolean).join('\n');

        (d.activities || []).forEach((act, ai) => {
            if (!act || !act.name) return;
            const exact = validCoord(act.lat, act.lon) && getDistance(Number(act.lat), Number(act.lon), stop.lat, stop.lon) < (d.dayTrip ? 250 : 120);
            const mins = Number(act.durationMinutes);
            const cost = Number(act.costUSD);
            const place = {
                id: `poi_ai_${now}_${di}_${ai}`,
                cityIndex: si,
                dayIndex: local,
                name: String(act.name).slice(0, 90),
                category: mapAICategory(act.category, act.name),
                address: act.address || act.location || stop.name,
                notes: [act.description, Number.isFinite(cost) ? (cost > 0 ? `~$${Math.round(cost)} pp` : 'Free') : '', act.tip].filter(Boolean).join(' · '),
                lat: exact ? Number(act.lat) : Number((stop.lat + (Math.random() - 0.5) * 0.02).toFixed(6)),
                lon: exact ? Number(act.lon) : Number((stop.lon + (Math.random() - 0.5) * 0.02).toFixed(6)),
                time: normalizeAITime(act.time)
            };
            if (mins >= 10 && mins <= 720) place.duration = Math.round(mins);
            if (!exact) place.approxLocation = true;
            if (act.localName && String(act.localName).trim() !== place.name) place.localName = String(act.localName).trim().slice(0, 80);
            if (act.bookable === true) place.ticketed = true;
            places.push(place);
        });
    });

    const start = /^\d{4}-\d{2}-\d{2}$/.test(String(plan.startDate || '')) && parseLocalDate(plan.startDate) >= new Date(new Date().toDateString()) ? plan.startDate : '';
    const fallbackStart = new Date(); fallbackStart.setDate(fallbackStart.getDate() + 1);
    const travelers = Math.round(Number(plan.travelers));
    const totalNights = stops.reduce((n, st) => n + st.nights, 0);
    const newTrip = {
        id: 'trip_ai_' + now,
        name: plan.title || 'AI Planned Trip',
        startDate: start || formatLocalDate(fallbackStart),
        isRoundTrip: false,
        budgetTravelers: travelers >= 1 && travelers <= 20 ? travelers : 2,
        stops,
        places,
        expenses: [],
        isExample: false,
        isAIGenerated: true,
        createdAt: now
    };

    const fl = plan.flights && plan.flights.outbound ? plan.flights : null;
    const overnightOut = Boolean(fl && fl.outbound.arrivesNextDay);
    const cityLabel = `${stops.length} ${stops.length === 1 ? 'city' : 'cities'}, ${totalNights} nights`;

    // Travel legs: the suggested train/flight shows on the map line and its cost goes into the Trip Budget plan
    let nightsSoFar = overnightOut ? 1 : 0;
    stops.forEach((stop, i) => {
        nightsSoFar += stop.nights;
        const leg = inStops[i].transitToNext;
        if (!leg || i >= stops.length - 1) return;
        const how = `${leg.method || ''} ${leg.details || ''}`;
        const method = /fl(y|ight)|plane|air/i.test(how) ? 'plane' : /bus|coach/i.test(how) ? 'bus' : /car|drive|taxi/i.test(how) ? 'car' : 'train';
        const date = parseLocalDate(newTrip.startDate);
        date.setDate(date.getDate() + nightsSoFar);
        stop.transit = {
            method, flightType: 'ow', bookingNumber: '',
            date: formatLocalDate(date), returnDate: '',
            depStation: String(leg.from || '').slice(0, 80), arrStation: String(leg.to || '').slice(0, 80),
            depTime: '', arrTime: '',
            notes: `AI suggestion: ${[leg.details || leg.method, leg.durationMinutes ? `about ${leg.durationMinutes} min` : ''].filter(Boolean).join(', ')}`
        };
        const pp = Number(leg.costUSD);
        if (window.setTravelEstimate && Number.isFinite(pp) && pp > 0) window.setTravelEstimate(newTrip, i + 1, pp * newTrip.budgetTravelers);
    });

    // Hotel ideas: the first one's nightly price becomes the stay estimate
    stops.forEach(stop => {
        const price = stop.hotelIdeas && stop.hotelIdeas[0] && stop.hotelIdeas[0].price;
        if (price > 0) {
            if (!newTrip.budgetPlan) newTrip.budgetPlan = { style: 'mid', lines: {} };
            newTrip.budgetPlan.lines[`${stop.id}:stay`] = { rate: price };
        }
    });

    // Flights: the airport they leave from becomes the first stop (like a hand-made "Houston, 0 nights"),
    // with the flight on its travel leg. An overnight flight gets that stop 1 night so hotel dates line up.
    if (fl) {
        const out = fl.outbound, back = fl.return || null;
        let lat = Number(fl.departLat), lon = Number(fl.departLon), needsGeocode = false;
        if (!validCoord(lat, lon)) {
            const known = findDestinationCoords(fl.departCity || out.from);
            lat = known.lat; lon = known.lon; needsGeocode = Boolean(known.unknown);
        }
        const legText = l => [
            `${String(l.from).toUpperCase()} → ${String(l.to).toUpperCase()}`,
            l.depTime ? `departs ${normalizeAITime(l.depTime) || l.depTime}` : '',
            l.arrTime ? `lands ${normalizeAITime(l.arrTime) || l.arrTime}${l.arrivesNextDay ? ' next day' : ''}` : '',
            l.airlines || '',
            Number(l.durationMinutes) ? `about ${fmtMinutes(l.durationMinutes)}` : ''
        ].filter(Boolean).join(', ');
        const homeDate = parseLocalDate(newTrip.startDate);
        homeDate.setDate(homeDate.getDate() + (overnightOut ? 1 : 0) + totalNights);
        const dep = {
            id: `stop_${now}_0`,
            name: String(fl.departCity || out.from).split(',')[0].trim().slice(0, 60),
            lat, lon,
            nights: overnightOut ? 1 : 0,
            notes: [[`Fly ${legText(out)}`, fl.driveNote || '', overnightOut ? 'Overnight on the plane' : ''].filter(Boolean).join('\n')],
            transit: {
                method: 'plane', flightType: 'rt', bookingNumber: '',
                date: newTrip.startDate, returnDate: back ? formatLocalDate(homeDate) : '',
                depStation: String(out.from).toUpperCase(), arrStation: String(out.to).toUpperCase(),
                depTime: normalizeAITime(out.depTime), arrTime: normalizeAITime(out.arrTime),
                notes: `AI suggestion, check real fares: ${legText(out)}${back ? `. Home: ${legText(back)}` : ''}`
            },
            lodging: null, locked: false
        };
        if (overnightOut) dep.overnightFlight = true;
        if (needsGeocode) { dep.needsGeocode = true; dep.geocodeQuery = fl.departCity || out.from; }
        if (back && stops.length) {
            const last = stops[stops.length - 1];
            const li = last.notes.length - 1;
            const when = homeDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            last.notes[li] = [last.notes[li], `Flight home ${when}: ${legText(back)}`].filter(Boolean).join('\n');
        }
        stops.unshift(dep);
        places.forEach(pl => { pl.cityIndex += 1; });
        const fare = Number(fl.fareUSDPerPerson);
        if (window.setTravelEstimate && Number.isFinite(fare) && fare > 0) window.setTravelEstimate(newTrip, 1, fare * newTrip.budgetTravelers);
    }
    finishAITripSave(newTrip, cityLabel + (fl ? `, flights from ${fl.departAirport || fl.outbound.from}` : ''));
}

export function saveAIGeneratedTrip() {
    if (!currentAIGeneratedItinerary) {
        showNotification("No generated itinerary available to save.");
        return;
    }

    const plan = currentAIGeneratedItinerary;
    if (Array.isArray(plan.stops) && plan.stops.some(st => st && st.name)) {
        saveStructuredAITrip(plan);
        return;
    }
    const totalDays = Array.isArray(plan.days) ? plan.days.length : (plan.durationDays || 3);
    let resolved = resolveTripDestinations(plan.destination || plan.title || '', totalDays);

    // Dynamic Multi-City Discovery:
    // If resolved wasn't in our hardcoded registry but days feature distinct cities (e.g. "Munich: ...", "Nuremberg: ...")
    if (!resolved.isMultiCity && Array.isArray(plan.days) && plan.days.length > 1) {
        const discoveredCityDays = [];
        plan.days.forEach((d) => {
            let cityName = null;
            if (d.theme && d.theme.includes(':') && !isDayTripTheme(d.theme)) {
                cityName = d.theme.split(':')[0].trim();
            } else if (isDayTripTheme(d.theme)) {
                cityName = discoveredCityDays[discoveredCityDays.length - 1] || null;
            } else if (Array.isArray(d.activities) && d.activities.length > 0 && d.activities[0].location) {
                const parts = d.activities[0].location.split(',');
                if (parts.length > 1) cityName = parts[parts.length - 1].trim();
            }
            discoveredCityDays.push(cityName);
        });

        const uniqueCities = [...new Set(discoveredCityDays.filter(Boolean))];
        if (uniqueCities.length >= 2) {
            const discoveredStops = uniqueCities.map((cName) => {
                const nightsCount = discoveredCityDays.filter(c => c === cName).length;
                const coords = findDestinationCoords(cName);
                return {
                    unknown: Boolean(coords.unknown),
                    name: cName,
                    fullName: coords.name || cName,
                    lat: coords.lat,
                    lon: coords.lon,
                    nights: Math.max(1, nightsCount),
                    themes: [],
                    presetPlaces: []
                };
            });

            resolved = {
                isMultiCity: true,
                regionName: plan.destination || uniqueCities.join(' & '),
                stops: discoveredStops
            };
        }
    }

    // Compute dates starting tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const startDateStr = formatLocalDate(tomorrow);

    const newTripId = 'trip_ai_' + Date.now();

    // 1. Build Stops
    let stops = [];
    if (resolved.isMultiCity && resolved.stops.length > 0) {
        stops = resolved.stops.map((st, sIdx) => ({
            id: `stop_${Date.now()}_${sIdx + 1}`,
            name: st.name,
            lat: st.lat,
            lon: st.lon,
            nights: st.nights,
            notes: [`AI Planned Stop ${sIdx + 1}: ${st.nights} nights in ${st.name}`],
            transit: null,
            lodging: null,
            locked: false,
            ...(st.unknown ? { needsGeocode: true } : {})
        }));
    } else {
        const destInfo = findDestinationCoords(plan.destination || plan.title);
        stops = [
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
    }

    // Map each day number (1..N) to its corresponding city stop index
    const dayToStopIndex = {};
    let cumDay = 1;
    stops.forEach((st, sIdx) => {
        for (let d = 0; d < st.nights; d++) {
            dayToStopIndex[cumDay] = sIdx;
            cumDay++;
        }
    });

    // 2. Convert Activities into Places
    const places = [];
    if (Array.isArray(plan.days)) {
        plan.days.forEach((dayObj, dayIdx) => {
            const dayNum = dayObj.day || (dayIdx + 1);
            const stopIndex = dayToStopIndex[dayNum] !== undefined ? dayToStopIndex[dayNum] : 0;
            const targetStop = stops[stopIndex] || stops[0];

            if (Array.isArray(dayObj.activities)) {
                dayObj.activities.forEach((act, actIdx) => {
                    let category = act.category || '● See & Do';
                    const nameLower = (act.name || '').toLowerCase();
                    const descLower = (act.description || '').toLowerCase();
                    const timeLower = (act.time || '').toLowerCase();

                    if (!act.category) {
                        if (nameLower.includes('dinner') || nameLower.includes('lunch') || nameLower.includes('food') || 
                            nameLower.includes('ramen') || nameLower.includes('dim sum') || nameLower.includes('pasta') || 
                            nameLower.includes('cafe') || nameLower.includes('bistro') || nameLower.includes('trattoria') ||
                            timeLower.includes('evening') || descLower.includes('savor') || descLower.includes('sample') ||
                            descLower.includes('feast') || descLower.includes('taste')) {
                            category = '🍽 Food & Drink';
                        }
                    }

                    // Calculate local day index within that stop
                    let stopStartDay = 1;
                    for (let s = 0; s < stopIndex; s++) {
                        stopStartDay += stops[s].nights;
                    }
                    const localDayIndex = Math.max(0, dayNum - stopStartDay);

                    places.push({
                        id: `poi_ai_${Date.now()}_${dayIdx}_${actIdx}`,
                        cityIndex: stopIndex,
                        dayIndex: localDayIndex,
                        approxLocation: true,
                        name: act.name || 'Activity',
                        category: mapAICategory(category, act.name),
                        address: act.location || targetStop.name,
                        notes: act.description ? `[${act.time || 'Day'}] ${act.description}` : '',
                        lat: targetStop.lat + (Math.random() - 0.5) * 0.03,
                        lon: targetStop.lon + (Math.random() - 0.5) * 0.03
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

    finishAITripSave(newTrip, `${stops.length} ${stops.length === 1 ? 'city' : 'cities'}, ${totalDays} days`);
}

// Intelligent fallback generator when edge worker is not yet deployed or in local dev
export function generateIntelligentFallbackItinerary(prompt) {
    const totalDays = extractDurationDays(prompt);
    const resolved = resolveTripDestinations(prompt, totalDays);

    // If multi-city, generate rich days distributed across stops
    if (resolved.isMultiCity) {
        const cityNames = resolved.stops.map(s => s.name).join(' → ');
        const days = [];
        let currentDayNum = 1;

        resolved.stops.forEach((stop) => {
            for (let d = 0; d < stop.nights; d++) {
                const themeName = (stop.themes && stop.themes[d % stop.themes.length]) 
                    ? `${stop.name}: ${stop.themes[d % stop.themes.length]}` 
                    : `${stop.name} Exploration & Discovery`;

                // Rotate through stop's preset places or synthesize rich activities
                const activities = [];
                if (Array.isArray(stop.presetPlaces) && stop.presetPlaces.length >= 2) {
                    const morningAct = stop.presetPlaces[0];
                    const lunchAct = stop.presetPlaces[1] || stop.presetPlaces[0];
                    const eveningAct = stop.presetPlaces[2] || stop.presetPlaces[stop.presetPlaces.length - 1];

                    if (d === 0) {
                        activities.push(
                            { time: "Morning", name: morningAct.name, description: morningAct.description, location: morningAct.location },
                            { time: "Afternoon", name: lunchAct.name, description: lunchAct.description, location: lunchAct.location },
                            { time: "Evening", name: eveningAct.name, description: eveningAct.description, location: eveningAct.location }
                        );
                    } else {
                        activities.push(
                            { time: "Morning", name: `${stop.name} Cultural Old Town Walk`, description: `Wander through historic quarters, morning artisan bakeries, and vibrant neighborhood alleys.`, location: `Old District, ${stop.name}` },
                            { time: "Afternoon", name: `${stop.name} Scenic Parks & Viewpoint`, description: `Experience local life, traditional tea gardens, and picturesque viewpoints.`, location: `Gardens & Vista, ${stop.name}` },
                            { time: "Evening", name: `${stop.name} Food Market & Night Walk`, description: `Sample authentic local specialties and take in the illuminated night atmosphere.`, location: `Night Market, ${stop.name}` }
                        );
                    }
                } else {
                    activities.push(
                        { time: "Morning", name: `${stop.name} Historic Walking Tour`, description: `Discover landmark architecture, vibrant morning squares, and local history.`, location: `City Center, ${stop.name}` },
                        { time: "Afternoon", name: `${stop.name} Museum & Art District`, description: `Explore cultural exhibits, artisan workshops, and specialty cafes.`, location: `Arts Quarter, ${stop.name}` },
                        { time: "Evening", name: `${stop.name} Traditional Dining & Evening Walk`, description: `Savor regional dishes with authentic local ingredients and evening ambiance.`, location: `Downtown, ${stop.name}` }
                    );
                }

                days.push({
                    day: currentDayNum,
                    theme: themeName,
                    activities: activities
                });
                currentDayNum++;
            }
        });

        return {
            title: `${totalDays}-Day ${resolved.regionName} Journey (${cityNames})`,
            destination: `${resolved.regionName} (${cityNames})`,
            durationDays: totalDays,
            summary: `A curated ${totalDays}-day journey across ${resolved.regionName}, highlighting the best of ${cityNames} with immersive sightseeing, scenic nature, and iconic regional culinary experiences.`,
            days: days
        };
    }

    // Single city destination fallback: dynamically generate requested number of days (1..N)
    const dest = findDestinationCoords(prompt);
    const cityName = dest.name.split(',')[0].trim();

    const DAY_THEMES = [
        { theme: 'Historic Center & Iconic Heritage', morning: 'Old Town Walking Tour', afternoon: 'Cultural Museum & Heritage Square', evening: 'Authentic Local Dining' },
        { theme: 'Panoramic Views & Waterfront Exploration', morning: 'Scenic Observation Deck & Vista', afternoon: 'Artisan Markets & Boutique Promenade', evening: 'Sunset River / Waterfront Promenade Walk' },
        { theme: 'Hidden Neighborhoods & Gastronomy', morning: 'Botanical Gardens or Quiet Historic Temple', afternoon: 'Famous Food Hall & Regional Tasting', evening: 'Farewell Dinner at Rooftop Terrace' },
        { theme: 'Art, Design & Modern Culture', morning: 'Contemporary Art District & Galleries', afternoon: 'Design Boutiques & Historic Cafes', evening: 'Live Music & Night District Exploration' },
        { theme: 'Day Excursion & Nature Retreat', morning: 'Scenic Countryside or Mountain Vista', afternoon: 'Charming Village Walk & Local Vineyard/Farm', evening: 'Relaxed Fireside or Terrace Dinner' },
        { theme: 'Architecture & Photography Highlights', morning: 'Architectural Landmarks & Sunlit Plazas', afternoon: 'Hidden Alleyways & Antique Quarters', evening: 'Night Lights Skyline Photography' },
        { theme: 'Relaxed Leisure & Farewell Celebrations', morning: 'Leisurely Brunch & Local Flea Market', afternoon: 'Scenic Boat Tour or Serene Park Stroll', evening: 'Celebratory Gala Dinner & Toast' }
    ];

    const days = [];
    for (let d = 1; d <= totalDays; d++) {
        const template = DAY_THEMES[(d - 1) % DAY_THEMES.length];
        days.push({
            day: d,
            theme: `${template.theme}`,
            activities: [
                {
                    time: "Morning",
                    name: `${cityName} ${template.morning}`,
                    description: `Start the day discovering vibrant architecture, morning markets, and cultural landmarks.`,
                    location: `Historic Center, ${cityName}`
                },
                {
                    time: "Afternoon",
                    name: `${cityName} ${template.afternoon}`,
                    description: `Immerse yourself in world-class collections, artisan cafes, and scenic neighborhood courtyards.`,
                    location: `Central District, ${cityName}`
                },
                {
                    time: "Evening",
                    name: `${cityName} ${template.evening}`,
                    description: `Taste celebrated traditional specialties paired with refreshing local drinks and sunset vistas.`,
                    location: `Evening Quarter, ${cityName}`
                }
            ]
        });
    }

    return {
        title: `${totalDays}-Day ${cityName} Adventure: AI Travel Plan`,
        destination: dest.name,
        durationDays: totalDays,
        summary: `A personalized ${totalDays}-day itinerary for exploring ${cityName}. Enjoy historic landmarks, scenic viewpoints, cultural districts, and authentic regional cuisine curated by Edge AI.`,
        days: days
    };
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
        if (window.saveAIPlanToLibrary) window.saveAIPlanToLibrary(query, itinerary);
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
            showNotification("AI request timed out. Please check your connection and try again.");
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
    if (!getGeminiApiKey() && !endpoint) {
        // No key: answer instantly with a template and invite the user to add their own key.
        return { ...generateIntelligentFallbackItinerary(promptText), isTemplate: true, needsKey: true };
    }

    const durationDays = extractDurationDays(promptText);
    const resolvedContext = resolveTripDestinations(promptText, durationDays);

    // Long multi-city plans take a while; the loading screen shows which day Gemini is on
    aiFetchAbortController = new AbortController();
    const timeoutId = setTimeout(() => {
        if (aiFetchAbortController) aiFetchAbortController.abort();
    }, getGeminiApiKey() ? 150000 : 60000);

    try {
        if (getGeminiApiKey()) {
            console.log(`[AI Assistant] Bypassing Edge AI - hitting Gemini directly.`);
            const systemPrompt = `You are the trip-planning engine inside Trippo, a travel planner app. Plan real, bookable trips.
RULES
1. Travel topics only. If the request isn't about travel, return {"error":"Trippo can only plan trips."}.
2. Use exactly the number of days asked for. Default to 5 days if none is given.
3. Name real cities. A multi-city route goes in "stops" in travel order; "nights" per stop must add up to the number of days.
4. Day trips (e.g. Nara from Osaka) are NOT stops: keep "stop" as the base city and set "dayTrip": true.
5. Moving between cities goes in "transitToNext" of the earlier stop (fastest practical option, e.g. high-speed rail), not as an activity. On a travel day, plan only what fits after arrival.
6. Each day: 4-6 activities with realistic 24h clock times, including lunch and dinner at specific real restaurants or food streets. Cluster each day by neighbourhood and respect opening days for the travel month.
7. Every activity needs accurate "lat"/"lon" (4 decimals), "durationMinutes", a typical "costUSD" per person (0 if free) and a "tip" only when it really helps. Add "localName" (the official name in the local script) in countries that don't use the Latin alphabet, and "bookable": true when tickets or tours for it are sold online.
8. Use Google Search to check that places exist and are open. Do not invent places.
9. If the request mentions a month or dates, set "startDate" (YYYY-MM-DD, the next such date after today); otherwise leave it "". With flights, startDate is the day the outbound flight leaves.
10. Flights: the traveller's home airport is given below. Unless the request says they're already there or it's an easy drive, plan the flight out and back. For long-haul or international trips, leave from the best big airport they could drive to in about 4 hours when it has better nonstop or one-stop options than the home airport (say so in "driveNote"); if the request names a departure city, use that. Name real airlines that fly the route, typical local departure and arrival times, flight time, and a typical round-trip economy fare per person for the travel month. Day 1 is the day they land; the flight home leaves the day after the last day. Use "flights": null when no flight is needed.
11. For each stop give 3 real hotels in or near "stayArea" (budget, mid-range, upscale; the best match for the request first) with a typical price per room per night.
Return ONLY this JSON:
{
  "title": "Short catchy title",
  "destination": "Cities, Country",
  "durationDays": 6,
  "startDate": "",
  "travelers": 2,
  "summary": "2-3 sentences on the route, vibe and food.",
  "flights": {"departAirport": "IAH", "departCity": "Houston", "departLat": 29.9902, "departLon": -95.3368, "driveNote": "About 3 h drive from Lafayette; more nonstops than LFT",
    "outbound": {"from": "IAH", "to": "KIX", "depTime": "10:55", "arrTime": "15:30", "arrivesNextDay": true, "airlines": "United via SFO", "durationMinutes": 930},
    "return": {"from": "KIX", "to": "IAH", "depTime": "17:10", "arrTime": "16:20", "arrivesNextDay": false, "airlines": "United via SFO", "durationMinutes": 820},
    "fareUSDPerPerson": 1150},
  "stops": [
    {"name": "Kyoto", "country": "Japan", "lat": 35.0116, "lon": 135.7681, "nights": 3,
     "stayArea": "Gion / Higashiyama: walkable to the temples",
     "hotels": [{"name": "Hotel Kanra Kyoto", "area": "Karasuma", "tier": "mid", "pricePerNightUSD": 220}],
     "transitToNext": {"method": "train", "from": "Kyoto Station", "to": "Osaka Station", "durationMinutes": 30, "costUSD": 5, "details": "JR Special Rapid, every 15 min"}}
  ],
  "days": [
    {"day": 1, "stop": "Kyoto", "dayTrip": false, "theme": "Kyoto: Higashiyama temples and Gion",
     "activities": [
       {"time": "09:00", "durationMinutes": 90, "name": "Kiyomizu-dera", "category": "See & Do", "description": "Wooden terrace over the city; go early before the crowds.", "location": "Higashiyama, Kyoto", "lat": 34.9949, "lon": 135.7850, "costUSD": 3, "tip": "Walk down Sannenzaka afterwards.", "localName": "清水寺", "bookable": false}
     ]}
  ],
  "tips": ["2-4 short practical tips: passes, bookings, money, etiquette"]
}
category is one of: "See & Do", "Food & Drink", "Shopping", "Cafe", "Nature".
KEEP IT SHORT: "description" max 15 words, "tip" max 12 words, "summary" max 40 words, each of "tips" max 25 words. "location" is just "Neighbourhood, City". Output compact JSON without indentation.`;
            const explicitDuration = durationDays ? `\nREQUIREMENT: You MUST generate exactly ${durationDays} days.` : '';
            const explicitCities = resolvedContext.stops && resolvedContext.stops.length > 0
                ? `\nREQUIREMENT: You MUST include stops in these cities: ${resolvedContext.stops.map(s => s.fullName).join(', ')}.`
                : '';
            const homeAirport = String(safeGetStorage('trippo_home_airport', 'LFT') || 'LFT').toUpperCase();
            const profileText = getTravelProfileText();
            const userContextPrompt = `Today is ${formatLocalDate(new Date())}.\nHome airport: ${homeAirport}.${profileText ? `\n${profileText}` : ''}\nPlan a trip for: "${promptText}"${explicitDuration}${explicitCities}`;

            const totalDays = durationDays || 5;
            const rawContent = await callGeminiDirectly(systemPrompt, [{ role: "user", content: userContextPrompt }], true, null, {
                thinking: 'low',
                onProgress: text => {
                    const dayNums = text.match(/"day"\s*:\s*\d+/g);
                    const titleEl = document.getElementById('ai-loading-title');
                    if (!titleEl) return;
                    if (dayNums) titleEl.textContent = `Planning day ${Math.min(dayNums.length, totalDays)} of ${totalDays}…`;
                    else if (/"stops"/.test(text)) titleEl.textContent = 'Choosing the route…';
                }
            });
            const parsedItinerary = parseJsonReply(rawContent);
            clearTimeout(timeoutId);
            if (parsedItinerary && parsedItinerary.error && !Array.isArray(parsedItinerary.days)) throw new Error(String(parsedItinerary.error));
            return normalizeAIItinerary(parsedItinerary);
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ 
                prompt: promptText,
                durationDays: durationDays,
                isMultiCity: resolvedContext.isMultiCity,
                resolvedCities: resolvedContext.stops.map(s => s.fullName)
            }),
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
            return normalizeAIItinerary(data.itinerary);
        } else if (data.data) {
            return data.data;
        } else if (data.title && data.days) {
            return data;
        } else {
            throw new Error("Invalid itinerary structure received from Edge AI.");
        }
    } catch (fetchErr) {
        clearTimeout(timeoutId);

        // If user intentionally hit Cancel, do not fall back
        if (isUserCancelledAI) {
            throw fetchErr;
        }

        // Seamless Resilience: If the remote edge worker fails, times out, is blocked, or is not yet deployed,
        // seamlessly generate the structured travel itinerary locally so the user never encounters a failure.
        console.warn('[AI Assistant] Remote edge worker unavailable or returned error. Generating intelligent travel itinerary...', fetchErr);
        if (getGeminiApiKey()) {
            if (fetchErr instanceof GeminiKeyError) throw fetchErr;
            throw new Error(fetchErr && fetchErr.name === 'AbortError'
                ? 'Gemini took too long to answer. Try again, or plan fewer days at a time.'
                : 'Gemini’s answer came back incomplete. Please try again.');
        }
        try {
            // Flag it so the result is labelled as a template, not AI output.
            if (fetchErr instanceof GeminiKeyError) showNotification(fetchErr.message, 6000);
            return { ...generateIntelligentFallbackItinerary(promptText), isTemplate: true, keyProblem: fetchErr instanceof GeminiKeyError };
        } catch (fallbackErr) {
            console.error('[AI Assistant] Fallback generator failed:', fallbackErr);
            throw fetchErr;
        }
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
            btn.innerHTML = `<span class="btn-text">Generate</span> <span class="btn-icon"><svg class="ico ico-only" aria-hidden="true"><use href="#i-sparkles"></use></svg></span>`;
        }
    }

    if (loadingOverlay) {
        if (isLoading) {
            if (queryEl) queryEl.innerText = `"${queryText}"`;
            loadingOverlay.style.display = 'flex';
            const titleEl = document.getElementById('ai-loading-title');
            if (titleEl) titleEl.textContent = 'Generating itinerary…';
        } else {
            loadingOverlay.style.display = 'none';
        }
    }
}

// Real recent fares (through the worker) under the AI's estimate
async function showLiveFares(fl, start) {
    const out = fl.outbound, back = fl.return;
    let ret = '';
    if (start && back && Array.isArray(currentAIGeneratedItinerary?.stops)) {
        const d = parseLocalDate(start);
        d.setDate(d.getDate() + (out.arrivesNextDay ? 1 : 0) + currentAIGeneratedItinerary.stops.reduce((n, s) => n + (Number(s.nights) || 0), 0));
        ret = formatLocalDate(d);
    }
    const fares = await getLiveFares(out.from, out.to, start || '', back && back.from === out.to ? ret : '');
    const el = document.getElementById('ai-live-fares');
    if (!el || !fares || !fares.length) return;
    el.innerHTML = `<div class="ai-live-fares"><strong>Real recent fares</strong>${fares.slice(0, 3).map(f => `
        <a href="${escapeHTML(f.link || buildAviasalesFlightUrl(out.from, out.to, start))}" target="_blank" rel="noopener noreferrer">
            <span>$${Math.round(f.price)}</span>
            <span>${escapeHTML([f.airline, f.departAt ? new Date(f.departAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '', Number(f.transfers) === 0 ? 'nonstop' : `${f.transfers} stop${Number(f.transfers) === 1 ? '' : 's'}`].filter(Boolean).join(' · '))}</span>
        </a>`).join('')}<small>Prices other travellers found recently on Aviasales, per person. Check before booking.</small></div>`;
}

// --- EDIT A PLAN BY CHAT (before saving) ---
let refineUndo = [];
let refineBusy = false;

function setRefineStatus(html) {
    const status = document.getElementById('ai-refine-status');
    if (!status) return;
    status.style.display = html ? '' : 'none';
    status.innerHTML = html || '';
}

function mergePlanChanges(plan, res) {
    const next = JSON.parse(JSON.stringify(plan));
    if (Array.isArray(res.days) && res.days.length) {
        next.days = res.days;
    } else if (Array.isArray(res.replaceDays)) {
        res.replaceDays.forEach(d => {
            if (!d || !Number(d.day)) return;
            const i = next.days.findIndex(x => Number(x.day) === Number(d.day));
            if (i >= 0) next.days[i] = d; else next.days.push(d);
        });
        next.days.sort((a, b) => Number(a.day) - Number(b.day));
    }
    ['stops', 'flights', 'title', 'summary', 'tips', 'destination', 'startDate', 'travelers'].forEach(k => {
        if (Object.prototype.hasOwnProperty.call(res, k)) next[k] = res[k];
    });
    next.durationDays = next.days.length;
    return normalizeAIItinerary(next);
}

export function setAIRefinePrompt(text) {
    const input = document.getElementById('ai-refine-input');
    if (input) input.value = text;
    refineAIPlan();
}

export async function refineAIPlan() {
    const input = document.getElementById('ai-refine-input');
    const btn = document.getElementById('ai-refine-btn');
    const instruction = (input?.value || '').trim();
    const plan = currentAIGeneratedItinerary;
    if (refineBusy || !plan) return;
    if (!instruction) { if (input) input.focus(); return; }
    if (!getGeminiApiKey()) { showNotification('Editing a plan by chat needs your Gemini key (Settings → AI).', 4000); return; }
    if (!checkIsOnline()) { showNotification('Editing a plan needs an internet connection.'); return; }

    refineBusy = true;
    if (btn) btn.disabled = true;
    if (input) input.disabled = true;
    setRefineStatus('<span class="ai-btn-spinner"></span> Updating the plan…');
    const clean = JSON.parse(JSON.stringify(plan, (k, v) => (k.startsWith('_') || k === 'slot' || k === 'isTemplate' ? undefined : v)));
    const profile = getTravelProfileText();
    const system = `You edit an existing trip plan in Trippo, a travel planner. Apply the requested change and keep everything else the same unless the change needs it.
Follow the same rules as the plan: real places that exist, accurate "lat"/"lon" (4 decimals), realistic 24h times, lunch and dinner at real places, day trips stay on their base stop with "dayTrip": true, travel between cities goes in "transitToNext", 3 real hotels per stop, nights per stop add up to the number of days.
Return ONLY JSON with just what changed:
{"summaryOfChanges": "One short sentence on what you changed",
 "replaceDays": [complete day objects that changed, same shape as the plan, each with its "day" number],
 "days": [every day, only when the number or order of days changes],
 "stops": [the complete stops array, only if stops, nights, stay areas, hotels or transport changed],
 "flights": {the complete flights object, only if flights changed},
 "title": "", "summary": "", "tips": [] (only if they should change)}
If the request has nothing to do with this trip, return {"error": "short reason"}.
KEEP IT SHORT: "description" max 15 words, "tip" max 12 words. Output compact JSON without indentation.${profile ? `\n${profile}` : ''}`;
    const user = `Today is ${formatLocalDate(new Date())}.\nCurrent plan JSON:\n${JSON.stringify(clean)}\n\nRequested change: "${instruction}"`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120000);
    try {
        const raw = await callGeminiDirectly(system, [{ role: 'user', content: user }], false, ctrl.signal, {
            thinking: 'low',
            onProgress: text => {
                const n = (text.match(/"day"\s*:\s*\d+/g) || []).length;
                if (n) setRefineStatus(`<span class="ai-btn-spinner"></span> Rewriting day ${n}…`);
            }
        });
        const res = parseJsonReply(raw);
        if (res && res.error && !res.replaceDays && !res.days) throw new Error(String(res.error));
        const next = mergePlanChanges(plan, res || {});
        refineUndo.push(plan);
        if (refineUndo.length > 10) refineUndo.shift();
        openAITripModal(next, true);
        if (window.updateAIPlanInLibrary) window.updateAIPlanInLibrary(next, instruction);
        if (input) input.value = '';
        setRefineStatus(`<svg class="ico" aria-hidden="true"><use href="#i-check"></use></svg><span>${escapeHTML((res && res.summaryOfChanges) || 'Plan updated.')}</span><button type="button" class="ai-refine-undo" onclick="undoAIPlanRefine()">Undo</button>`);
        triggerHaptic('success');
    } catch (e) {
        setRefineStatus(escapeHTML(e && e.name === 'AbortError' ? 'That took too long. Please try again.' : (e && e.message) || 'Couldn’t update the plan. Please try again.'));
    } finally {
        clearTimeout(timer);
        refineBusy = false;
        if (btn) btn.disabled = false;
        if (input) input.disabled = false;
    }
}

export function undoAIPlanRefine() {
    const prev = refineUndo.pop();
    if (!prev) return;
    openAITripModal(prev, true);
    if (window.updateAIPlanInLibrary) window.updateAIPlanInLibrary(prev, null);
    setRefineStatus(refineUndo.length ? 'Undone. <button type="button" class="ai-refine-undo" onclick="undoAIPlanRefine()">Undo again</button>' : 'Undone.');
}

// --- RENDER ITINERARY PREVIEW MODAL ---
export function openAITripModal(itinerary, keepEdits = false) {
    if (!itinerary) return;
    currentAIGeneratedItinerary = itinerary;
    if (!keepEdits) {
        refineUndo = [];
        const status = document.getElementById('ai-refine-status');
        if (status) { status.style.display = 'none'; status.innerHTML = ''; }
    }

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
        // Detect distinct cities across days
        const cityList = Array.isArray(itinerary.stops) ? itinerary.stops.map(st => st.name) : [];
        if (!cityList.length && Array.isArray(itinerary.days)) {
            itinerary.days.forEach(d => {
                if (d.theme && d.theme.includes(':') && !isDayTripTheme(d.theme)) {
                    const c = d.theme.split(':')[0].trim();
                    if (!cityList.includes(c)) cityList.push(c);
                }
            });
        }
        const routeBadge = cityList.length > 1
            ? `<span class="ai-stat-chip" style="background:var(--primary-light,#e3f1ed); color:var(--primary); font-weight:700;"><svg class="ico" aria-hidden="true"><use href="#i-route"></use></svg>${cityList.map(c => escapeHTML(c)).join(' → ')}</span>`
            : '';

        statsEl.innerHTML = `
            <span class="ai-stat-chip"><svg class="ico" aria-hidden="true"><use href="#i-calendar-event"></use></svg>${totalDays} Day${totalDays !== 1 ? 's' : ''}</span>
            <span class="ai-stat-chip"><svg class="ico" aria-hidden="true"><use href="#i-map-pin"></use></svg>${totalActivities} Activit${totalActivities !== 1 ? 'ies' : 'y'}</span>
            ${routeBadge}
            ${!itinerary.isTemplate
                ? '<span class="ai-stat-chip edge"><svg class="ico" aria-hidden="true"><use href="#i-sparkles"></use></svg>Gemini AI</span>'
                : itinerary.needsKey
                    ? '<button type="button" class="ai-stat-chip ai-key-cta" onclick="openAIKeySettings()" title="Real AI planning uses your own free Google Gemini key."><svg class="ico" aria-hidden="true"><use href="#i-list-details"></use></svg>Template plan · ✨ Add your free Gemini key for real AI ›</button>'
                    : '<span class="ai-stat-chip" title="Gemini could not be reached, so this is a ready-made template plan."><svg class="ico" aria-hidden="true"><use href="#i-list-details"></use></svg>Template plan · live AI unavailable</span>'}
        `;
    }

    // Day-by-Day Timeline Cards
    if (timelineEl) {
        if (Array.isArray(itinerary.days) && itinerary.days.length > 0) {
            const fl = itinerary.flights;
            const flightLeg = (label, l) => `<div class="ai-flight-leg"><b>${label}</b>${escapeHTML([
                `${l.from} → ${l.to}`,
                l.depTime ? `${formatTime(normalizeAITime(l.depTime) || l.depTime)} → ${l.arrTime ? formatTime(normalizeAITime(l.arrTime) || l.arrTime) : '?'}${l.arrivesNextDay ? ' (+1 day)' : ''}` : '',
                l.airlines, Number(l.durationMinutes) ? fmtMinutes(l.durationMinutes) : ''
            ].filter(Boolean).join(' · '))}</div>`;
            const startForLink = /^\d{4}-\d{2}-\d{2}$/.test(String(itinerary.startDate || '')) ? itinerary.startDate : '';
            const flightHtml = fl ? `
                <div class="ai-flight-card">
                    <div class="ai-flight-head"><svg class="ico" aria-hidden="true"><use href="#i-plane-departure"></use></svg><strong>Flights${fl.departCity ? ` from ${escapeHTML(fl.departCity)}` : ''}</strong>${Number(fl.fareUSDPerPerson) > 0 ? `<span>est. ~$${Math.round(fl.fareUSDPerPerson)} pp round trip</span>` : ''}</div>
                    ${fl.driveNote ? `<div class="ai-flight-note">${escapeHTML(fl.driveNote)}</div>` : ''}
                    ${flightLeg('Out', fl.outbound)}${fl.return ? flightLeg('Home', fl.return) : ''}
                    <div id="ai-live-fares"></div>
                    <a class="ai-flight-link" href="${escapeHTML(buildAviasalesFlightUrl(fl.outbound.from, fl.outbound.to, startForLink))}" target="_blank" rel="noopener noreferrer">Check real fares ›</a>
                </div>` : '';
            if (fl && hasLiveFlightPrices()) showLiveFares(fl, startForLink);
            const routeHtml = Array.isArray(itinerary.stops) && itinerary.stops.length ? `
                <div class="ai-route-card">
                    ${itinerary.stops.map((st, i) => {
                        const next = st.transitToNext;
                        return `
                        <div class="ai-route-stop"><strong>${escapeHTML(st.name)}</strong><span>${Number(st.nights) || '?'} night${Number(st.nights) === 1 ? '' : 's'}${st.stayArea ? ` · stay: ${escapeHTML(st.stayArea)}` : ''}</span></div>
                        ${st.hotels && st.hotels.length ? `<div class="ai-route-hotels"><svg class="ico" aria-hidden="true"><use href="#i-bed"></use></svg>${st.hotels.map(h => escapeHTML(`${h.name}${Number(h.pricePerNightUSD) > 0 ? ` ~$${Math.round(h.pricePerNightUSD)}` : ''}`)).join(' · ')}</div>` : ''}
                        ${next && i < itinerary.stops.length - 1 ? `<div class="ai-route-leg"><svg class="ico" aria-hidden="true"><use href="#i-${/plane|fl/i.test(next.method) ? 'plane-departure' : /bus|coach/i.test(next.method) ? 'bus' : /car|drive/i.test(next.method) ? 'car' : 'train'}"></use></svg>${escapeHTML([next.details || next.method, next.durationMinutes ? `${next.durationMinutes} min` : '', next.costUSD ? `~$${next.costUSD} pp` : ''].filter(Boolean).join(' · '))}</div>` : ''}`;
                    }).join('')}
                </div>` : '';
            const tipsHtml = Array.isArray(itinerary.tips) && itinerary.tips.length ? `
                <div class="ai-tips-card"><strong>Good to know</strong><ul>${itinerary.tips.slice(0, 5).map(t => `<li>${escapeHTML(String(t))}</li>`).join('')}</ul></div>` : '';
            timelineEl.innerHTML = flightHtml + routeHtml + itinerary.days.map((dayObj) => {
                const dayNum = dayObj.day || 1;
                const theme = dayObj.theme ? escapeHTML(dayObj.theme) : `Day ${dayNum} Exploration`;
                const activities = Array.isArray(dayObj.activities) ? dayObj.activities : [];

                const activitiesHtml = activities.map((act) => {
                    const timeBadge = act.time ? `<span class="activity-time-badge">${escapeHTML(formatTime(act.time))}${Number(act.durationMinutes) >= 10 ? ` · ${Number(act.durationMinutes) >= 60 ? `${Math.floor(act.durationMinutes / 60)}h${act.durationMinutes % 60 ? ` ${act.durationMinutes % 60}m` : ''}` : `${act.durationMinutes}m`}` : ''}</span>` : '';
                    const cost = Number(act.costUSD);
                    const costBadge = Number.isFinite(cost) && act.costUSD !== '' && act.costUSD !== null ? `<span class="activity-loc-badge">${cost > 0 ? `~$${Math.round(cost)}` : 'Free'}</span>` : '';
                    const tipLine = act.tip ? `<div class="ai-activity-tip">${escapeHTML(act.tip)}</div>` : '';
                    const ticketBadge = act.bookable === true ? `<a class="activity-ticket-link" href="${escapeHTML(ticketLink(act.name, String(dayObj.stop || itinerary.destination || ''), act.lat, act.lon))}" target="_blank" rel="noopener noreferrer"><svg class="ico" aria-hidden="true"><use href="#i-ticket"></use></svg>Tickets</a>` : '';
                    const localLine = act.localName ? `<span class="place-local-name">${escapeHTML(act.localName)}</span>` : '';
                    const locBadge = act.location ? `<span class="activity-loc-badge"><svg class="ico" aria-hidden="true"><use href="#i-map-pin"></use></svg>${escapeHTML(act.location)}</span>` : '';

                    return `
                        <div class="ai-activity-item">
                            <div class="ai-activity-header">
                                <span class="ai-activity-name">${escapeHTML(act.name || 'Activity')}</span>
                                ${timeBadge}
                            </div>
                            ${localLine}
                            <div class="ai-activity-desc">${escapeHTML(act.description || '')}</div>
                            ${tipLine}
                            ${locBadge || costBadge || ticketBadge ? `<div class="ai-activity-footer">${locBadge}${costBadge}${ticketBadge}</div>` : ''}
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
            }).join('') + tipsHtml;
        } else {
            timelineEl.innerHTML = `<p style="color:var(--text-muted); text-align:center;">No activities found.</p>`;
        }
    }

    modal.style.display = 'flex';
    triggerHaptic('medium');
}



/**
 * Open the AI Trip Generator search modal from Trip Tools in the sidebar
 */
// Saved plans, recent prompts and comparison live in js/ai-plans.js
export function setCurrentAIItinerary(itinerary) {
    currentAIGeneratedItinerary = itinerary || null;
}

// --- COPILOT CHAT HISTORY: kept per trip on this device (last 40 messages, 10 most recent trips) ---
const AI_CHATS_KEY = 'trippo_ai_chats_v1';
let copilotHistoryTripId = null;

function readJSON(key, fallback) {
    try { const v = JSON.parse(safeGetStorage(key) || 'null'); return v ?? fallback; } catch (e) { return fallback; }
}

function loadCopilotChat(tripId) {
    const all = readJSON(AI_CHATS_KEY, {});
    const saved = all && all[tripId];
    return saved && Array.isArray(saved.messages) ? saved.messages.filter(m => m && typeof m.content === 'string') : null;
}

function saveCopilotChat() {
    if (!copilotHistoryTripId) return;
    const all = readJSON(AI_CHATS_KEY, {}) || {};
    const msgs = copilotChatHistory.slice(-40);
    if (!msgs.some(m => m.role === 'user')) delete all[copilotHistoryTripId];
    else all[copilotHistoryTripId] = { messages: msgs, updatedAt: Date.now() };
    Object.keys(all).sort((x, y) => (all[y].updatedAt || 0) - (all[x].updatedAt || 0)).slice(10).forEach(k => delete all[k]);
    safeSetStorage(AI_CHATS_KEY, JSON.stringify(all));
}

export function openAITripSearchModal() {
    toggleSidebar(false);
    if (window.renderAIPlanLibrary) window.renderAIPlanLibrary();
    const modal = document.getElementById('ai-trip-search-modal');
    if (modal) {
        modal.style.display = 'flex';
        triggerHaptic('light');
        setTimeout(() => {
            const input = document.getElementById('ai-trip-input');
            if (input) input.focus();
        }, 150);
    }
}
if (typeof window !== 'undefined') {
    window.openAITripSearchModal = openAITripSearchModal;
}

// --- INITIALIZE AI COMPONENT LISTENERS ---
export function initAITripGenerator() {
    // 1. Set up network change listeners
    window.addEventListener('online', updateAIOfflineStatus);
    window.addEventListener('offline', updateAIOfflineStatus);
    updateAIOfflineStatus();

    // 2. Form submission listener
    // (The form's inline onsubmit handles submit; a second listener here sent every prompt twice.)

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
    if (copilotHistoryTripId !== trip.id) {
        copilotHistoryTripId = trip.id;
        copilotSuggestionsRegistry.clear();
        copilotChatHistory = loadCopilotChat(trip.id) || [];
    }
    if (copilotChatHistory.length === 0) renderAICopilotGreeting(stop.name, activeCopilotDayIndex + 1);
    else renderAICopilotMessages();

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

    // Pin the answer to the day it was asked about, even if the user switches days while waiting
    const askedStop = activeCopilotStopIndex;
    const askedDay = activeCopilotDayIndex;

    try {
        const responseData = await fetchChatFromWorker(query, {
            city: stop.name,
            day: activeCopilotDayIndex + 1,
            tripName: trip.name,
            existingPlaces: existingPlaces,
            ...buildCopilotTripContext(trip, askedStop, askedDay)
        });

        setCopilotTyping(false);

        const replyText = responseData.reply || responseData.content || `Here are recommendations for ${stop.name}:`;
        const suggestions = Array.isArray(responseData.suggestions) ? responseData.suggestions : [];

        copilotChatHistory.push({
            role: 'bot',
            content: replyText,
            suggestions: suggestions,
            stopIndex: askedStop,
            dayIndex: askedDay
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
            suggestions: fallback.suggestions,
            stopIndex: askedStop,
            dayIndex: askedDay,
            isTemplate: true,
            needsKey: err instanceof NoAIKeyError
        });
        if (err instanceof GeminiKeyError) showNotification(err.message, 6000);
        renderAICopilotMessages();
        triggerHaptic('light');
    }
}

// Trip facts the copilot uses to give answers that fit this trip, day and group
function buildCopilotTripContext(trip, stopIdx, dayIdx) {
    const stops = Array.isArray(trip.stops) ? trip.stops : [];
    const stop = stops[stopIdx] || {};
    const ctx = {};
    if (stops.length > 1) ctx.route = stops.map(s => `${s.name} (${Number(s.nights) || 0} nights)`).join(' → ');
    if (trip.startDate) {
        const d = new Date(`${trip.startDate}T12:00:00`);
        if (!isNaN(d)) {
            const offset = stops.slice(0, stopIdx).reduce((n, s) => n + (Number(s.nights) || 0), 0) + dayIdx;
            d.setDate(d.getDate() + offset);
            ctx.date = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        }
    }
    if (stop.lodging && stop.lodging.name) ctx.hotel = [stop.lodging.name, stop.lodging.address].filter(Boolean).join(', ');
    const others = (trip.places || []).filter(p => p.cityIndex === stopIdx && p.dayIndex !== dayIdx).map(p => p.name).filter(Boolean);
    if (others.length) ctx.otherDays = others.slice(0, 25).join(', ');
    const travelers = Number(trip.budgetTravelers) || 0;
    const style = trip.budgetPlan && trip.budgetPlan.style;
    if (travelers || style) ctx.group = [travelers ? `${travelers} traveler${travelers === 1 ? '' : 's'}` : '', style ? `${style === 'mid' ? 'mid-range' : style} budget` : ''].filter(Boolean).join(', ');
    return ctx;
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
            const sIdx = Number.isInteger(msg.stopIndex) ? msg.stopIndex : activeCopilotStopIndex;
            const dIdx = Number.isInteger(msg.dayIndex) ? msg.dayIndex : activeCopilotDayIndex;
            if (Array.isArray(msg.suggestions) && msg.suggestions.length > 0) {
                const batchKey = `batch_${msgIndex}`;
                copilotSuggestionsRegistry.set(batchKey, msg.suggestions);

                const itemsHtml = msg.suggestions.map((sug, sugIndex) => {
                    const sugId = `sug_${msgIndex}_${sugIndex}`;
                    copilotSuggestionsRegistry.set(sugId, sug);

                    const timeBadge = sug.time ? `<span style="display:inline-block; font-size:10px; font-weight:700; padding:2px 7px; border-radius:10px; background:var(--primary-light, #e3f1ed); color:var(--primary); margin-left:6px;">⏱️ ${escapeHTML(formatTime(sug.time))}</span>` : '';
                    const catBadge = sug.category ? `<span style="font-size:10px; font-weight:700; opacity:0.8; margin-right:4px;">${escapeHTML(sug.category)}</span>` : '';

                    return `
                        <div class="ai-chat-card" id="card_${sugId}">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                                <div>
                                    <div class="ai-chat-card-title">${catBadge}${escapeHTML(sug.name)}${timeBadge}</div>
                                    ${sug.address ? `<div style="font-size:11px; color:var(--text-muted); margin-top:2px;"><svg class="ico" aria-hidden="true"><use href="#i-map-pin"></use></svg>${escapeHTML(sug.address)}</div>` : ''}
                                </div>
                                <button type="button" id="btn_${sugId}" class="ai-card-add-btn" onclick="addPlaceFromAISuggestion('${sugId}', ${sIdx}, ${dIdx})"${sug.added ? ' disabled' : ''}>
                                    <span>${sug.added ? `✓ Added to Day ${dIdx + 1}` : `+ Add to Day ${dIdx + 1}`}</span>
                                </button>
                            </div>
                            <div class="ai-chat-card-desc">${escapeHTML(sug.description || '')}</div>
                        </div>
                    `;
                }).join('');

                const addAllBtn = msg.suggestions.length > 1 ? `
                    <button type="button" id="btn_${batchKey}" class="ai-add-all-btn" onclick="addAllPlacesFromAISuggestions('${batchKey}', ${sIdx}, ${dIdx})"${msg.suggestions.every(s => s.added) ? ' disabled' : ''}>
                        <span><svg class="ico" aria-hidden="true"><use href="#i-plus"></use></svg>Add All (${msg.suggestions.length}) to Day ${dIdx + 1}</span>
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
                        ${msg.isTemplate ? (msg.needsKey
                            ? '<button type="button" class="ai-template-note ai-key-cta" onclick="openAIKeySettings()"><svg class="ico" aria-hidden="true"><use href="#i-list-details"></use></svg>Suggested ideas · ✨ Add your free Gemini key for real AI ›</button>'
                            : '<div class="ai-template-note"><svg class="ico" aria-hidden="true"><use href="#i-list-details"></use></svg>Suggested ideas · live AI unavailable</div>') : ''}
                        <div>${formattedContent}</div>
                        ${suggestionsHtml}
                    </div>
                </div>
            `;
        }
    });

    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
    saveCopilotChat();
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
    sug.added = true;
    saveCopilotChat();

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
        if (sug.added) return; // already added one by one
        sug.added = true;
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
    saveCopilotChat();
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
    if (!getGeminiApiKey() && !endpoint) throw new NoAIKeyError();
    copilotAbortController = new AbortController();
    const timeoutId = setTimeout(() => {
        if (copilotAbortController) copilotAbortController.abort();
    }, 30000);

    try {
        if (getGeminiApiKey()) {
            console.log(`[AI Copilot] Bypassing Edge AI - hitting Gemini directly.`);
            const city = context.city || "your destination";
            const day = context.day || 1;
            const tripName = context.tripName || "Vacation";
            const existingPlaces = Array.isArray(context.existingPlaces) && context.existingPlaces.length > 0
                ? context.existingPlaces.join(", ")
                : "None scheduled yet";
            const chatSystemPrompt = `You are the in-app AI Travel Copilot for Trippo, assisting a traveler currently planning their daily itinerary.
Current Context:
- Destination City: ${city}
- Active Day: Day ${day}
- Trip: ${tripName}
- Already Scheduled Places for Day ${day}: ${existingPlaces}
${context.date ? `- Date: ${context.date} (think about season, weather, opening days and holidays)\n` : ''}${context.route ? `- Whole trip route: ${context.route}\n` : ''}${context.hotel ? `- Staying at: ${context.hotel} (prefer places that are easy to reach from here; mention rough travel time)\n` : ''}${context.otherDays ? `- Already planned on other days in ${city} (don't repeat these): ${context.otherDays}\n` : ''}${context.group ? `- Group: ${context.group}\n` : ''}
${getTravelProfileText() ? `${getTravelProfileText()}\n` : ''}CRITICAL INSTRUCTIONS & SAFETY CONSTRAINTS:
1. STRICT IMMUTABILITY & NO-DELETION RESTRICTION: You are strictly an ADDITIVE recommendation assistant. You do NOT have any authority, ability, or permission to delete, modify, clear, remove, or overwrite existing trips, itineraries, stops, or places.
2. If the user asks you to delete, cancel, wipe, clear, remove, or replace any trips, cities, days, stops, or places, you MUST decline politely and explain:
   {"reply": "I am designed to suggest and add new travel ideas without altering or deleting your existing plans. To remove or edit any existing places, stops, or trips, you can safely use the trash icon 🗑️ or edit buttons directly in the planner.", "suggestions": []}
3. You are strictly restricted to travel planning, itineraries, restaurants, sightseeing, and local cultural advice.
4. If the user's inquiry is completely unrelated to travel or geography, politely decline.
5. Use Google Search Grounding to find REAL, currently open restaurants and attractions. Do not invent places!
6. If recommending specific spots, activities, or an itinerary, ALWAYS provide them in the structured "suggestions" array.
7. You MUST return a valid JSON object matching this schema EXACTLY:
{
  "reply": "Friendly conversational advice...",
  "suggestions": [
    {
      "name": "Official name of the place/activity",
      "category": "● See & Do",
      "time": "Morning",
      "description": "Why it's recommended and practical advice",
      "address": "Neighborhood or area in ${city}"
    }
  ]
}`;
            // Remember what was already suggested so follow-ups ("something cheaper", "closer to that") make sense
            const conversationMessages = copilotChatHistory.slice(-10).map(m => ({
                role: m.role === 'bot' ? 'assistant' : 'user',
                content: m.role === 'bot' && Array.isArray(m.suggestions) && m.suggestions.length
                    ? `${m.content}\n(Suggested: ${m.suggestions.map(s => s.name).filter(Boolean).join(', ')})`
                    : m.content
            }));
            if (conversationMessages.length === 0 || conversationMessages[conversationMessages.length - 1].content !== promptText) {
                conversationMessages.push({ role: "user", content: promptText });
            }
            const rawContent = await callGeminiDirectly(chatSystemPrompt, conversationMessages, true);
            const parsedChat = parseJsonReply(rawContent);
            clearTimeout(timeoutId);
            return {
                reply: parsedChat.reply || "Here are some recommendations for your itinerary:",
                suggestions: Array.isArray(parsedChat.suggestions) ? parsedChat.suggestions : []
            };
        }

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

export function getGeminiApiKey() {
    return localStorage.getItem('trippoGeminiApiKey') || '';
}

export function saveGeminiApiKey() {
    const key = document.getElementById('gemini-api-key-input')?.value.trim();
    // Keys stay on this device only. Older versions copied them into the account's Supabase
    // metadata, which the project owner can read, so clear any such copy either way.
    if (window.saveUserGeminiKeyToCloud) window.saveUserGeminiKeyToCloud('');
    if (key) {
        localStorage.setItem('trippoGeminiApiKey', key);
        if (window.showNotification) window.showNotification('Gemini key saved on this device. Real AI is on!');
    } else {
        localStorage.removeItem('trippoGeminiApiKey');
        if (window.showNotification) window.showNotification('Gemini API Key removed.');
    }
}
window.saveGeminiApiKey = saveGeminiApiKey;

// From an AI result's "add your key" prompt: close the AI screens and jump to the key field.
export function openAIKeySettings() {
    document.querySelectorAll('.modal').forEach(m => {
        if (m.style.display === 'flex' || m.style.display === 'block') m.style.display = 'none';
    });
    if (typeof window.openSettingsModal === 'function') window.openSettingsModal();
    setTimeout(() => {
        const input = document.getElementById('gemini-api-key-input');
        if (!input) return;
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (!input.value) input.focus({ preventScroll: true });
    }, 250);
}

// The "-latest" aliases track Google's current models, so retirements don't break the app
// (pinned names like gemini-1.5/2.5-flash have been retired). Lite is the fallback when the
// main model is unavailable (404) or overloaded (503).
const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest'];
// Google Search grounding needs a paid key; free keys get 429 for it. Once that happens,
// skip search for the rest of the session.
let geminiSearchUnavailable = false;

async function callGeminiDirectly(systemInstruction, conversationMessages, enableSearch, signalOverride = null, opts = {}) {
    const apiKey = getGeminiApiKey();
    const contents = conversationMessages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: Array.isArray(m.parts) && m.parts.length ? m.parts : [{ text: m.content }]
    }));
    const signal = signalOverride || aiFetchAbortController?.signal || copilotAbortController?.signal;

    let thinking = opts.thinking || null;
    const stream = typeof opts.onProgress === 'function';
    const request = (model, withSearch) => {
        const generationConfig = { temperature: 0.35, topP: 0.9, maxOutputTokens: 16384 };
        if (thinking) generationConfig.thinkingConfig = { thinkingLevel: thinking };
        // Gemini rejects JSON mode combined with search grounding; with search on, the prompt
        // asks for JSON and parseJsonReply() extracts it.
        if (!withSearch) generationConfig.responseMimeType = 'application/json';
        const payload = { systemInstruction: { parts: [{ text: systemInstruction }] }, contents, generationConfig };
        if (withSearch) payload.tools = [{ googleSearch: {} }];
        return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify(payload),
            signal
        });
    };

    let res;
    for (const model of GEMINI_MODELS) {
        const useSearch = enableSearch && !geminiSearchUnavailable;
        res = await request(model, useSearch);
        if (res.status === 400 && thinking) {
            // Older models don't take a thinking level
            thinking = null;
            res = await request(model, useSearch);
        }
        if (res.status === 429 && useSearch) {
            geminiSearchUnavailable = true;
            res = await request(model, false);
        }
        if (res.status !== 404 && res.status !== 503) break;
    }
    if (!res.ok) {
        const errText = await res.text();
        throw new GeminiKeyError(res.status, errText);
    }
    if (stream) return readGeminiStream(res, opts.onProgress);
    const json = await res.json();
    const parts = json.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts) || parts.length === 0) throw new Error('No response candidates returned from Gemini.');
    return parts.map(p => p.text || '').join('');
}

// Server-sent events: each "data:" line is a partial response; join the text parts as they arrive
async function readGeminiStream(res, onProgress) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', text = '';
    const handleLine = line => {
        if (!line.startsWith('data:')) return;
        try {
            const chunk = JSON.parse(line.slice(5));
            const parts = chunk.candidates?.[0]?.content?.parts || [];
            text += parts.filter(p => !p.thought).map(p => p.text || '').join('');
        } catch (e) { /* partial or keep-alive line */ }
    };
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        lines.forEach(l => handleLine(l.trim()));
        try { onProgress(text); } catch (e) { /* progress is cosmetic */ }
    }
    handleLine(buffer.trim());
    if (!text) throw new Error('No response candidates returned from Gemini.');
    return text;
}

// Gemini errors the user can fix (bad key, quota) get a readable message.
class GeminiKeyError extends Error {
    constructor(status, body) {
        let reason = `Gemini returned an error (${status}).`;
        if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(body)) reason = 'Your Gemini API key isn’t valid. Check it in Settings → AI.';
        else if (status === 403) reason = 'Your Gemini API key doesn’t have access to Gemini. Check it in Settings → AI.';
        else if (status === 429) reason = 'Your Gemini free quota is used up for now. Try again later.';
        else if (status === 503) reason = 'Gemini is busy right now. Try again in a minute.';
        super(reason);
        this.name = 'GeminiKeyError';
        this.status = status;
        this.detail = String(body || '').slice(0, 500);
    }
}

// Models sometimes wrap JSON in code fences or add a sentence around it (especially with search
// grounding); take the outermost {...} block.
// One-off JSON question for other features (e.g. the smart day planner in js/day-planner.js).
// Throws NoAIKeyError when there's no Gemini key, so callers can fall back to local estimates.
// options.search: let Gemini use Google Search for current facts (slower; JSON is then parsed from text)
export async function askGeminiJSON(systemInstruction, userText, timeoutMs = 30000, options = {}) {
    if (!getGeminiApiKey()) throw new NoAIKeyError();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const parts = Array.isArray(options.attachments) && options.attachments.length
            ? [...options.attachments.map(a => ({ inlineData: { mimeType: a.mimeType, data: a.data } })), { text: userText }]
            : null;
        const raw = await callGeminiDirectly(systemInstruction, [{ role: 'user', content: userText, parts }], Boolean(options.search), ctrl.signal,
            { thinking: options.thinking || null, onProgress: options.onProgress });
        return parseJsonReply(raw);
    } finally {
        clearTimeout(timer);
    }
}

function parseJsonReply(raw) {
    const text = String(raw || '').trim();
    try { return JSON.parse(text); } catch (e) {}
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('AI reply did not contain JSON.');
    return JSON.parse(text.slice(start, end + 1));
}
