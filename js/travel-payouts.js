/* ==========================================================================
   Trippo Travel Planner - Travelpayouts Monetization & Deals Engine
   js/travel-payouts.js
   Affiliate Marker: 581802
   ========================================================================== */

export const TRAVELPAYOUTS_MARKER = '581802';

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
 * Travelpayouts tracked links for partner programs (Klook, Tiqets, Airalo...).
 * Paste one link made with that program's "Generate links" tool in the Travelpayouts dashboard,
 * with the destination part replaced by {URL}. Until a template is set, links go straight to
 * the partner and earn nothing.
 */
const PARTNER_LINK_TEMPLATES = {
    klook: '',
    tiqets: '',
    airalo: ''
};

export function partnerLink(program, url) {
    const template = PARTNER_LINK_TEMPLATES[program];
    return template ? template.replace('{URL}', encodeURIComponent(url)) : url;
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
 * Builds Aviasales flight search URL with active affiliate marker
 */
export function buildAviasalesFlightUrl(origin, destination, dateStr = '', returnStr = '') {
    const orig = (origin || 'LFT').toUpperCase();
    const dest = (destination || 'anywhere').toUpperCase();
    let url = `https://www.aviasales.com/search?marker=${TRAVELPAYOUTS_MARKER}&origin=${orig}&destination=${dest}`;
    if (dateStr && dateStr.trim()) {
        url += `&depart_date=${dateStr.trim()}`;
        if (returnStr && returnStr.trim()) url += `&return_date=${returnStr.trim()}`;
    }
    url += '&currency=USD';
    return url;
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

    // If user provided a Travelpayouts Data API token, attempt live price lookup
    if (token) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2500);
            
            const apiUrl = `https://api.travelpayouts.com/v1/prices/cheap?origin=${code}&currency=USD&token=${token}`;
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

    // Default to high-accuracy curated matrix
    const catalog = AIRPORT_CATALOG[code] || GLOBAL_DEFAULT_DESTINATIONS;
    return catalog.map(item => ({
        ...item,
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
