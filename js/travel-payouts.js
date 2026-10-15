/* ==========================================================================
   Trippo Travel Planner - Travelpayouts Monetization & Deals Engine
   js/travel-payouts.js
   Travelpayouts account (marker) 785709, Trippo project (trs) 581802
   ========================================================================== */

// The marker is the Travelpayouts account ID; 581802 is the Trippo project ("trs") ID.
// Links before v2.4.47 used 581802 as the marker, so those clicks weren't credited to the account.
export const TRAVELPAYOUTS_MARKER = '785709';
export const TRAVELPAYOUTS_PROJECT = '581802';

// Local storage key for optional Travelpayouts API token
const TP_TOKEN_KEY = 'trippo_travelpayouts_token';

export function getTravelPayoutsToken() {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            return window.localStorage.getItem(TP_TOKEN_KEY) || '';
        }
    } catch (e) {
        console.warn(e);
    }
    return '';
}

export function saveTravelPayoutsToken(token) {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            if (token && token.trim()) {
                window.localStorage.setItem(TP_TOKEN_KEY, token.trim());
            } else {
                window.localStorage.removeItem(TP_TOKEN_KEY);
            }
        }
    } catch (e) {
        console.warn(e);
    }
}

// Popular route catalogs for smart cheap flight recommendations
const AIRPORT_CATALOG = {
    // Lafayette, LA
    LFT: [
        { city: 'Orlando', code: 'MCO', price: 79, airline: 'Direct / 1-stop' },
        { city: 'Denver', code: 'DEN', price: 119, airline: 'United / Frontier' },
        { city: 'Las Vegas', code: 'LAS', price: 129, airline: 'Southwest / Delta' },
        { city: 'Cancun', code: 'CUN', price: 189, airline: 'American / United' },
        { city: 'New York', code: 'JFK', price: 149, airline: 'Delta / JetBlue' }
    ],
    // New Orleans, LA
    MSY: [
        { city: 'Orlando', code: 'MCO', price: 59, airline: 'Breeze / Spirit' },
        { city: 'Miami / Ft Lauderdale', code: 'FLL', price: 68, airline: 'Spirit / Southwest' },
        { city: 'Denver', code: 'DEN', price: 94, airline: 'Southwest / United' },
        { city: 'Cancun', code: 'CUN', price: 145, airline: 'Spirit / Delta' },
        { city: 'New York', code: 'LGA', price: 112, airline: 'Delta / JetBlue' }
    ],
    // Houston, TX
    IAH: [
        { city: 'Cancun', code: 'CUN', price: 115, airline: 'United / Viva' },
        { city: 'Mexico City', code: 'MEX', price: 128, airline: 'Aeromexico / United' },
        { city: 'Miami', code: 'MIA', price: 88, airline: 'American / Spirit' },
        { city: 'Denver', code: 'DEN', price: 92, airline: 'United / Southwest' },
        { city: 'Las Vegas', code: 'LAS', price: 98, airline: 'United / Spirit' }
    ],
    // Dallas, TX
    DFW: [
        { city: 'Denver', code: 'DEN', price: 79, airline: 'American / Frontier' },
        { city: 'Las Vegas', code: 'LAS', price: 85, airline: 'American / Spirit' },
        { city: 'Orlando', code: 'MCO', price: 89, airline: 'American / Spirit' },
        { city: 'Cancun', code: 'CUN', price: 135, airline: 'American / Sun Country' },
        { city: 'San Juan', code: 'SJU', price: 169, airline: 'Frontier / American' }
    ],
    // Atlanta, GA
    ATL: [
        { city: 'Orlando', code: 'MCO', price: 49, airline: 'Frontier / Spirit' },
        { city: 'Miami', code: 'MIA', price: 58, airline: 'Frontier / Delta' },
        { city: 'New York', code: 'LGA', price: 89, airline: 'Delta / JetBlue' },
        { city: 'Denver', code: 'DEN', price: 105, airline: 'Southwest / Delta' },
        { city: 'Cancun', code: 'CUN', price: 162, airline: 'Delta / Frontier' }
    ],
    // New York, NY
    JFK: [
        { city: 'Miami / Fort Lauderdale', code: 'FLL', price: 64, airline: 'JetBlue / Spirit' },
        { city: 'Orlando', code: 'MCO', price: 72, airline: 'Delta / JetBlue' },
        { city: 'London', code: 'LHR', price: 345, airline: 'Norse / Virgin' },
        { city: 'Paris', code: 'CDG', price: 385, airline: 'French Bee / Norse' },
        { city: 'San Juan', code: 'SJU', price: 139, airline: 'JetBlue / Frontier' }
    ],
    // Los Angeles, CA
    LAX: [
        { city: 'Las Vegas', code: 'LAS', price: 49, airline: 'Southwest / Spirit' },
        { city: 'San Francisco', code: 'SFO', price: 59, airline: 'Alaska / United' },
        { city: 'Honolulu', code: 'HNL', price: 179, airline: 'Hawaiian / Southwest' },
        { city: 'Tokyo', code: 'NRT', price: 495, airline: 'ZIPAIR / ANA' },
        { city: 'Cabo San Lucas', code: 'SJD', price: 165, airline: 'Alaska / Delta' }
    ],
    // Chicago, IL
    ORD: [
        { city: 'Orlando', code: 'MCO', price: 69, airline: 'Spirit / Frontier' },
        { city: 'Denver', code: 'DEN', price: 84, airline: 'United / American' },
        { city: 'Miami', code: 'MIA', price: 92, airline: 'American / United' },
        { city: 'Cancun', code: 'CUN', price: 159, airline: 'United / American' },
        { city: 'Las Vegas', code: 'LAS', price: 108, airline: 'Spirit / Southwest' }
    ]
};

// Generic fallback destinations for any unspecified airport
const GLOBAL_DEFAULT_DESTINATIONS = [
    { city: 'Orlando', code: 'MCO', price: 89, airline: 'Direct / 1-stop' },
    { city: 'Denver', code: 'DEN', price: 109, airline: 'Direct / 1-stop' },
    { city: 'Las Vegas', code: 'LAS', price: 119, airline: 'Budget / Major' },
    { city: 'Cancun', code: 'CUN', price: 175, airline: 'Popular Getaway' },
    { city: 'New York', code: 'JFK', price: 135, airline: 'Major Hub' }
];

/**
 * Travelpayouts tracked links: every click goes through tp.media, which records it and forwards to
 * the partner page in "u" with our account attached. campaign_id and p come from each program's
 * "Generate links" tool (switch on "Full link" in the link's menu to see them).
 */
const PARTNER_PROGRAMS = {
    aviasales: { campaign: 100, p: 4114 },
    klook: { campaign: 137, p: 4110 },
    tiqets: { campaign: 89, p: 2074 },
    airalo: { campaign: 541, p: 8310 },
    yesim: { campaign: 224, p: 5998 }
};

export function partnerLink(program, url) {
    const prog = PARTNER_PROGRAMS[program];
    if (!prog || !/^https:\/\//.test(String(url || ''))) return url;
    return `https://tp.media/r?campaign_id=${prog.campaign}&marker=${TRAVELPAYOUTS_MARKER}&p=${prog.p}&trs=${TRAVELPAYOUTS_PROJECT}&u=${encodeURIComponent(url)}`;
}

// Tickets and tours: Klook is strongest in Asia-Pacific, Tiqets in Europe and the Americas
export function ticketLink(name, city, lat, lon) {
    const q = `${name || ''} ${city || ''}`.trim();
    const la = Number(lat), lo = Number(lon);
    const asiaPacific = Number.isFinite(lo) && (lo > 60 || (la < 0 && lo > 100));
    return asiaPacific
        ? partnerLink('klook', `https://www.klook.com/en-US/search/result/?query=${encodeURIComponent(q)}`)
        : partnerLink('tiqets', `https://www.tiqets.com/en/search/?q=${encodeURIComponent(q)}`);
}

// Airalo country pages look like airalo.com/japan-esim
export function esimLink(country) {
    const slug = String(country || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return partnerLink('airalo', slug ? `https://www.airalo.com/${slug}-esim` : 'https://www.airalo.com/');
}

/**
 * Real recent fares go through Trippo's Cloudflare worker, which keeps the Travelpayouts token
 * secret (the Travelpayouts API also can't be called from a web page). Empty = not set up yet,
 * and the app shows Gemini's typical-fare estimates instead.
 */
export const FLIGHT_PRICES_URL = '';

function flightWorkerBase() {
    let custom = '';
    try { custom = (window.localStorage.getItem('trippoCloudflareWorkerUrl') || '').trim(); } catch (e) { /* storage blocked */ }
    return (custom || FLIGHT_PRICES_URL).replace(/\/+$/, '');
}

export function hasLiveFlightPrices() {
    return Boolean(flightWorkerBase());
}

export async function getLiveFares(origin, destination, depart = '', ret = '') {
    const base = flightWorkerBase();
    if (!base || !/^[A-Z]{3}$/i.test(String(origin || '')) || !/^[A-Z]{3}$/i.test(String(destination || ''))) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    try {
        const q = new URLSearchParams({ origin: String(origin).toUpperCase(), destination: String(destination).toUpperCase() });
        if (depart) q.set('depart', depart);
        if (ret) q.set('return', ret);
        const res = await fetch(`${base}/flight-prices?${q}`, { signal: ctrl.signal });
        if (!res.ok) return null;
        const json = await res.json();
        return json && json.success && Array.isArray(json.fares) ? json.fares.filter(f => Number(f.price) > 0) : null;
    } catch (e) {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Builds Aviasales flight search URL with active affiliate marker
 */
export function buildAviasalesFlightUrl(origin, destination, dateStr = '', returnStr = '') {
    const orig = (origin || 'LFT').toUpperCase();
    const dest = (destination || 'anywhere').toUpperCase();
    let url = `https://www.aviasales.com/search?origin=${orig}&destination=${dest}`;
    if (dateStr && dateStr.trim()) {
        url += `&depart_date=${dateStr.trim()}`;
        if (returnStr && returnStr.trim()) url += `&return_date=${returnStr.trim()}`;
    }
    url += '&currency=USD';
    return partnerLink('aviasales', url);
}

/**
 * Builds Hotellook hotel search URL with active affiliate marker
 */
export function buildHotellookUrl(cityName, checkIn = '', checkOut = '') {
    let url = `https://search.hotellook.com/?marker=${TRAVELPAYOUTS_MARKER}&location=${encodeURIComponent(cityName)}&currency=USD&adults=2`;
    if (checkIn && checkOut) {
        url += `&checkIn=${checkIn}&checkOut=${checkOut}`;
    }
    return url;
}

/**
 * Fetches cheap flight deals for a given airport.
 * Uses Travelpayouts Data API if token is present, otherwise returns curated dynamic matrix.
 */
export async function getCheapFlightDeals(origin, dateStr = '') {
    const code = (origin || 'LFT').toUpperCase();
    const token = getTravelPayoutsToken();

    // Live prices come through Trippo's worker (the Travelpayouts API blocks calls from web pages)
    const workerBase = flightWorkerBase();
    if (workerBase || token) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);

            const apiUrl = workerBase
                ? `${workerBase}/flight-deals?origin=${code}`
                : `https://api.travelpayouts.com/v1/prices/cheap?origin=${code}&currency=USD&token=${token}`;
            const res = await fetch(apiUrl, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (res.ok) {
                const data = await res.json();
                if (data && data.success && data.data) {
                    const deals = [];
                    const destKeys = Object.keys(data.data);
                    for (let i = 0; i < Math.min(destKeys.length, 5); i++) {
                        const destCode = destKeys[i];
                        const priceInfo = Object.values(data.data[destCode])[0];
                        if (priceInfo && priceInfo.price) {
                            deals.push({
                                city: destCode,
                                code: destCode,
                                price: Math.round(priceInfo.price),
                                airline: `Airline #${priceInfo.airline || 'Partner'}`,
                                link: buildAviasalesFlightUrl(code, destCode, dateStr)
                            });
                        }
                    }
                    if (deals.length > 0) return deals;
                }
            }
        } catch (err) {
            console.debug('Travelpayouts live API fetch fallback:', err);
        }
    }

    // No live prices: typical fares, labelled as such
    const catalog = AIRPORT_CATALOG[code] || GLOBAL_DEFAULT_DESTINATIONS;
    return catalog.map(item => ({
        ...item,
        typical: true,
        link: buildAviasalesFlightUrl(code, item.code, dateStr)
    }));
}

/**
 * Returns estimated hotel nightly rates and partner booking deep-links
 */
export function getHotelPricingInsights(cityName, checkIn = '', checkOut = '') {
    const safeCity = cityName ? cityName.trim() : 'Destination';
    const cityLower = safeCity.toLowerCase();

    // Baseline nightly pricing approximations for popular world destinations
    let minRate = 65;
    let maxRate = 125;

    if (cityLower.includes('york') || cityLower.includes('paris') || cityLower.includes('london') || cityLower.includes('san francisco') || cityLower.includes('amsterdam') || cityLower.includes('zurich') || cityLower.includes('singapore')) {
        minRate = 135;
        maxRate = 275;
    } else if (cityLower.includes('tokyo') || cityLower.includes('rome') || cityLower.includes('barcelona') || cityLower.includes('los angeles') || cityLower.includes('chicago') || cityLower.includes('vienna') || cityLower.includes('seattle')) {
        minRate = 95;
        maxRate = 185;
    } else if (cityLower.includes('bangkok') || cityLower.includes('bali') || cityLower.includes('hanoi') || cityLower.includes('prague') || cityLower.includes('budapest') || cityLower.includes('mexico') || cityLower.includes('cancun')) {
        minRate = 38;
        maxRate = 89;
    }

    const cityEnc = encodeURIComponent(safeCity);
    const inStr = checkIn || '';
    const outStr = checkOut || '';

    return {
        cityName: safeCity,
        estimatedNightly: `$${minRate} - $${maxRate}`,
        hotellookUrl: buildHotellookUrl(safeCity, inStr, outStr),
        tripUrl: inStr && outStr
            ? `https://us.trip.com/hotels/list?keyword=${cityEnc}&checkIn=${inStr}&checkOut=${outStr}`
            : `https://us.trip.com/hotels/list?keyword=${cityEnc}`,
        bookingUrl: inStr && outStr
            ? `https://www.booking.com/searchresults.html?ss=${cityEnc}&checkin=${inStr}&checkout=${outStr}`
            : `https://www.booking.com/searchresults.html?ss=${cityEnc}`,
        expediaUrl: inStr && outStr
            ? `https://www.expedia.com/Hotel-Search?destination=${cityEnc}&startDate=${inStr}&endDate=${outStr}`
            : `https://www.expedia.com/Hotel-Search?destination=${cityEnc}`
    };
}
