/* ==========================================================================
   Trippo Travel Planner - Budget Estimator
   js/budget-estimator.js

   Builds estimate line items from a trip's stops (getting there, hotel, food,
   local transport), adjusted for each country's cost level and a travel style.
   Every line can be switched off or given your own amount; those choices are
   saved on the trip as trip.budgetPlan. Lives in the Trip Budget modal next to
   the spending tracker (js/budget-tracker.js), which supplies spent-per-line.
   ========================================================================== */
import { trips, saveTrips, escapeHTML, escapeJS, getDistance, icon, triggerHaptic } from './state.js';
import { getStopFlag } from './planner.js';

// Mid-range prices in USD for a cost index of 1.0 (roughly the US average)
const BASE = { hotelPerRoomNight: 150, foodPerPersonDay: 60, localPerPersonDay: 15 };
export const BUDGET_STYLES = {
    budget: { label: 'Budget', mult: 0.55 },
    mid: { label: 'Mid-range', mult: 1 },
    luxury: { label: 'Luxury', mult: 2.2 }
};

// Relative day-to-day cost (hotels, food, getting around), 1.0 = US
const COUNTRY_COST = {
    US: 1.0, CA: 0.95, MX: 0.5, GB: 1.05, IE: 1.0, FR: 0.95, IT: 0.85, ES: 0.75, PT: 0.65, DE: 0.9,
    NL: 1.0, BE: 0.9, AT: 0.9, CH: 1.4, GR: 0.7, IS: 1.3, NO: 1.3, SE: 1.0, DK: 1.15, FI: 1.0,
    PL: 0.55, CZ: 0.6, HU: 0.55, HR: 0.65, TR: 0.45, JP: 0.8, CN: 0.5, HK: 1.0, MO: 0.8, TW: 0.6,
    KR: 0.75, TH: 0.4, VN: 0.3, KH: 0.3, LA: 0.3, ID: 0.35, MY: 0.45, PH: 0.4, SG: 1.05, IN: 0.3,
    NP: 0.25, LK: 0.35, AU: 1.0, NZ: 0.95, AE: 1.0, QA: 1.0, IL: 1.1, JO: 0.6, EG: 0.3, MA: 0.4,
    ZA: 0.5, KE: 0.5, TZ: 0.55, BR: 0.5, AR: 0.4, CL: 0.6, PE: 0.4, CO: 0.4, CR: 0.7, CU: 0.5
};

// Fallback when the country isn't recognised: rough regions by coordinates
function regionCostByCoords(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 0.8;
    if (lat > 35 && lat < 72 && lon > -25 && lon < 45) return 0.85;          // Europe
    if (lat > 15 && lat < 72 && lon >= -170 && lon < -50) return 0.95;       // North America
    if (lat <= 15 && lat > -56 && lon >= -120 && lon < -30) return 0.5;      // Latin America
    if (lat > 20 && lat < 55 && lon >= 100 && lon < 150) return 0.65;        // East Asia
    if (lat > -11 && lat <= 20 && lon >= 92 && lon < 141) return 0.4;        // Southeast Asia
    if (lat > 5 && lat < 37 && lon >= 60 && lon < 92) return 0.3;            // South Asia
    if (lat > 12 && lat < 42 && lon >= 34 && lon < 60) return 0.8;           // Middle East
    if (lat >= -35 && lat <= 37 && lon >= -18 && lon < 52) return 0.45;      // Africa
    if (lat < -10 && lon >= 110) return 1.0;                                 // Oceania
    return 0.8;
}

// "🇨🇳" → "CN"
function countryFromFlag(flag) {
    const pts = [...String(flag || '')].map(c => c.codePointAt(0));
    if (pts.length !== 2 || pts.some(p => p < 0x1F1E6 || p > 0x1F1FF)) return null;
    return String.fromCharCode(pts[0] - 0x1F1E6 + 65, pts[1] - 0x1F1E6 + 65);
}

export function getStopCostIndex(stop) {
    const code = countryFromFlag(getStopFlag(stop));
    if (code && COUNTRY_COST[code]) return { index: COUNTRY_COST[code], country: code };
    return { index: regionCostByCoords(Number(stop.lat), Number(stop.lon)), country: null };
}

const METHOD_LABEL = { plane: 'Flight', train: 'Train', bus: 'Bus', car: 'Drive' };

// One-way, per person for public transport; per car for driving
function travelCost(method, km) {
    if (method === 'plane') return Math.max(80, 50 + 0.09 * km);
    if (method === 'train') return Math.max(15, 0.13 * km);
    if (method === 'bus') return Math.max(10, 0.06 * km);
    return Math.max(10, 0.12 * km);
}

function guessMethod(km) {
    if (km > 800) return 'plane';
    if (km > 120) return 'train';
    return 'car';
}

const round5 = n => Math.round(n / 5) * 5;
export const formatMoney = n => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');

function getPlan(trip) {
    if (!trip.budgetPlan || typeof trip.budgetPlan !== 'object') trip.budgetPlan = { style: 'mid', lines: {} };
    if (!BUDGET_STYLES[trip.budgetPlan.style]) trip.budgetPlan.style = 'mid';
    if (!trip.budgetPlan.lines || typeof trip.budgetPlan.lines !== 'object') trip.budgetPlan.lines = {};
    return trip.budgetPlan;
}

// Build every line for every stop, with the user's on/off and custom amounts applied
export function estimateTripBudget(trip) {
    const plan = getPlan(trip);
    const style = BUDGET_STYLES[plan.style];
    const travelers = Math.max(1, parseInt(trip.budgetTravelers, 10) || 1);
    const rooms = Math.ceil(travelers / 2);
    const stops = Array.isArray(trip.stops) ? trip.stops : [];
    let total = 0;

    const groups = stops.map((stop, i) => {
        const key = id => `${stop.id || 'i' + i}:${id}`;
        const nights = Math.max(0, Number(stop.nights) || 0);
        const days = Math.max(1, nights);
        const { index, country } = getStopCostIndex(stop);
        const k = index * style.mult;
        const lines = [];

        if (i > 0) {
            const prev = stops[i - 1];
            const km = getDistance(Number(prev.lat), Number(prev.lon), Number(stop.lat), Number(stop.lon)) || 0;
            const method = (prev.transit && prev.transit.method) || guessMethod(km);
            const perUnit = travelCost(method, km) * (plan.style === 'luxury' && method === 'plane' ? 2.5 : plan.style === 'budget' ? 0.85 : 1);
            const units = method === 'car' ? 1 : travelers;
            lines.push({
                key: key('travel'), kind: 'travel', icon: method === 'plane' ? 'plane-departure' : method === 'train' ? 'train' : method === 'bus' ? 'bus' : 'car',
                label: `${METHOD_LABEL[method]} from ${prev.name}`,
                detail: `${Math.round(km).toLocaleString('en-US')} km · ${method === 'car' ? 'fuel + tolls' : `${travelers} × ${formatMoney(perUnit)}`}`,
                estimate: round5(perUnit * units)
            });
        }
        if (nights > 0) {
            const rate = BASE.hotelPerRoomNight * k;
            lines.push({
                key: key('stay'), kind: 'stay', icon: 'bed', label: stop.lodging && stop.lodging.name ? stop.lodging.name : 'Hotel',
                detail: `${nights} night${nights === 1 ? '' : 's'} × ${rooms} room${rooms === 1 ? '' : 's'} × ${formatMoney(rate)}`,
                estimate: round5(rate * nights * rooms)
            });
        }
        const food = BASE.foodPerPersonDay * k;
        lines.push({
            key: key('food'), kind: 'food', icon: 'coins', label: 'Food & drinks',
            detail: `${days} day${days === 1 ? '' : 's'} × ${travelers} × ${formatMoney(food)}`,
            estimate: round5(food * days * travelers)
        });
        const local = BASE.localPerPersonDay * Math.max(0.5, index) * (plan.style === 'luxury' ? 2 : 1);
        lines.push({
            key: key('local'), kind: 'local', icon: 'bus', label: 'Getting around',
            detail: `${days} day${days === 1 ? '' : 's'} × ${travelers} × ${formatMoney(local)}`,
            estimate: round5(local * days * travelers)
        });

        // A short first stop is usually where you leave from (home), so its day costs start unchecked
        const looksLikeHome = i === 0 && stops.length > 1 && nights <= 1;
        if (looksLikeHome) lines.forEach(l => { l.defaultOn = false; });

        // Trip home from the last stop: on by default when the outbound ticket is a round trip
        if (i === stops.length - 1 && stops.length > 1) {
            const first = stops[0];
            const km = getDistance(Number(stop.lat), Number(stop.lon), Number(first.lat), Number(first.lon)) || 0;
            if (km > 50) {
                const out = first.transit || {};
                const method = out.method || guessMethod(km);
                const perUnit = travelCost(method, km) * (plan.style === 'luxury' && method === 'plane' ? 2.5 : plan.style === 'budget' ? 0.85 : 1);
                lines.push({
                    key: key('return'), kind: 'return', icon: method === 'plane' ? 'plane-departure' : method === 'train' ? 'train' : method === 'bus' ? 'bus' : 'car',
                    label: `${METHOD_LABEL[method]} home to ${first.name}`,
                    detail: `${Math.round(km).toLocaleString('en-US')} km · ${method === 'car' ? 'fuel + tolls' : `${travelers} × ${formatMoney(perUnit)}`}`,
                    estimate: round5(perUnit * (method === 'car' ? 1 : travelers)),
                    defaultOn: out.flightType === 'rt'
                });
            }
        }

        let subtotal = 0;
        lines.forEach(l => {
            const saved = plan.lines[l.key] || {};
            l.on = typeof saved.on === 'boolean' ? saved.on : l.defaultOn !== false;
            l.custom = Number.isFinite(saved.amount);
            l.amount = l.custom ? saved.amount : l.estimate;
            if (l.on) subtotal += l.amount;
        });
        total += subtotal;
        return { stop, index: i, country, costIndex: index, lines, subtotal };
    });

    return { groups, total, travelers, perPerson: total / travelers, style: plan.style };
}

function findTrip(tripId) {
    return trips.find(t => t.id === tripId);
}

function changed(trip) {
    saveTrips();
    if (window.renderBudgetCalculator) window.renderBudgetCalculator();
    else renderBudgetEstimator(trip.id);
}

export function setBudgetStyle(tripId, style) {
    const trip = findTrip(tripId);
    if (!trip || !BUDGET_STYLES[style]) return;
    getPlan(trip).style = style;
    triggerHaptic('light');
    changed(trip);
}

export function toggleEstimateLine(tripId, key, on) {
    const trip = findTrip(tripId);
    if (!trip) return;
    const lines = getPlan(trip).lines;
    lines[key] = { ...(lines[key] || {}), on: !!on };
    changed(trip);
}

export function setEstimateAmount(tripId, key, value) {
    const trip = findTrip(tripId);
    if (!trip) return;
    const lines = getPlan(trip).lines;
    const n = parseFloat(String(value).replace(/[^0-9.]/g, ''));
    const entry = { ...(lines[key] || {}) };
    if (Number.isFinite(n) && n >= 0) entry.amount = Math.round(n); else delete entry.amount;
    lines[key] = entry;
    changed(trip);
}

export function resetEstimateLine(tripId, key) {
    const trip = findTrip(tripId);
    if (!trip) return;
    const lines = getPlan(trip).lines;
    if (lines[key]) delete lines[key].amount;
    changed(trip);
}

export function renderBudgetEstimator(tripId) {
    const container = document.getElementById('budget-estimator-container');
    const trip = findTrip(tripId) || (window.getBudgetActiveTrip && window.getBudgetActiveTrip());
    if (!container || !trip) return;
    const est = estimateTripBudget(trip);
    const safeTrip = escapeJS(trip.id);

    const totalEl = document.getElementById('budget-estimate-total');
    if (totalEl) totalEl.innerText = formatMoney(est.total);
    const ppEl = document.getElementById('budget-estimate-per-person');
    if (ppEl) ppEl.innerText = `${formatMoney(est.perPerson)} / person`;

    if (!est.groups.length) {
        container.innerHTML = `<p class="budget-empty">Add stops to this trip to get an estimate.</p>`;
        return;
    }

    const spent = (window.budgetSpentByLine && window.budgetSpentByLine(trip)) || { lines: {}, otherByStop: {}, unassigned: 0 };
    const spentTag = (amt, plan) => amt > 0
        ? `<span class="budget-spent${plan && amt > plan ? ' over' : ''}">spent ${formatMoney(amt)}</span>` : '';

    const styles = Object.entries(BUDGET_STYLES).map(([id, s]) =>
        `<button type="button" class="budget-style-chip${est.style === id ? ' active' : ''}" onclick="setBudgetStyle('${safeTrip}', '${id}')">${s.label}</button>`).join('');

    container.innerHTML = `
        <div class="budget-style-row">${styles}</div>
        ${est.groups.map(g => {
            const sk = g.stop.id || 'i' + g.index;
            const stopSpent = g.lines.reduce((n, l) => n + (spent.lines[l.key] || 0), 0) + (spent.otherByStop[sk] || 0);
            return `
            <div class="budget-stop">
                <div class="budget-stop-head">
                    <span class="budget-stop-name">${escapeHTML(g.stop.name)}${g.country ? ` <span class="budget-country">${g.country}</span>` : ''}</span>
                    <span class="budget-stop-sub">${stopSpent ? `<span class="budget-stop-spent${stopSpent > g.subtotal ? ' over' : ''}">${formatMoney(stopSpent)} of</span> ` : ''}${formatMoney(g.subtotal)}</span>
                </div>
                ${g.lines.map(l => {
                    const k = escapeJS(l.key);
                    return `
                    <div class="budget-line${l.on ? '' : ' off'}">
                        <label class="budget-line-check">
                            <input type="checkbox" ${l.on ? 'checked' : ''} onchange="toggleEstimateLine('${safeTrip}', '${k}', this.checked)" aria-label="Include ${escapeHTML(l.label)}">
                        </label>
                        ${icon(l.icon, 'budget-line-ico')}
                        <div class="budget-line-text">
                            <span class="budget-line-label">${escapeHTML(l.label)}</span>
                            <span class="budget-line-detail">${escapeHTML(l.detail)}${l.custom ? ` · <button type="button" class="budget-reset" onclick="resetEstimateLine('${safeTrip}', '${k}')">reset</button>` : ''}</span>
                            ${spentTag(spent.lines[l.key] || 0, l.on ? l.amount : 0)}
                        </div>
                        <input class="budget-line-amount${l.custom ? ' custom' : ''}" inputmode="decimal" value="${Math.round(l.amount)}" aria-label="Amount for ${escapeHTML(l.label)}" onchange="setEstimateAmount('${safeTrip}', '${k}', this.value)" ${l.on ? '' : 'disabled'}>
                    </div>`;
                }).join('')}
                ${spent.otherByStop[sk] ? `<div class="budget-line budget-line-extra">${icon('ticket', 'budget-line-ico')}<div class="budget-line-text"><span class="budget-line-label">Activities, shopping &amp; other</span><span class="budget-spent">spent ${formatMoney(spent.otherByStop[sk])}</span></div></div>` : ''}
            </div>`;
        }).join('')}
        ${spent.unassigned ? `<div class="budget-stop"><div class="budget-stop-head"><span class="budget-stop-name">Whole trip</span><span class="budget-stop-sub"><span class="budget-stop-spent">${formatMoney(spent.unassigned)} spent</span></span></div></div>` : ''}
        <button type="button" class="budget-to-expenses" onclick="showBudgetPane('expenses')">${icon('plus')}Log an expense</button>
        <p class="budget-note">Rough averages adjusted for each country and your travel style. Tap an amount to use your own number. Expenses tagged with a stop show up here as spent.</p>`;
}
