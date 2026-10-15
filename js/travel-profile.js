/* ==========================================================================
   TRAVEL PROFILE: set once, used by every AI feature
   (trip planner, plan edits, Copilot, day trips, trip check-up, Plan my days pace)
   ========================================================================== */
import { safeGetStorage, safeSetStorage, escapeHTML, escapeJS, triggerHaptic } from './state.js';

const PROFILE_KEY = 'trippo_travel_profile_v1';
const PACES = [['relaxed', 'Relaxed'], ['balanced', 'Balanced'], ['packed', 'Packed']];
const BUDGETS = [['budget', 'Budget'], ['mid', 'Mid-range'], ['luxury', 'Luxury']];
const INTERESTS = ['Food', 'History', 'Museums & art', 'Nature & hikes', 'Architecture', 'Local life',
    'Nightlife', 'Shopping', 'Cafes', 'Photography', 'Theme parks', 'Beaches'];

export function getTravelProfile() {
    try {
        const p = JSON.parse(safeGetStorage(PROFILE_KEY) || 'null');
        if (p && typeof p === 'object') return p;
    } catch (e) { /* fall through */ }
    return {};
}

function saveProfile(p) {
    safeSetStorage(PROFILE_KEY, JSON.stringify(p));
    renderTravelProfileSummaries();
}

// One line for AI prompts; empty when nothing is set
export function getTravelProfileText() {
    const p = getTravelProfile();
    const parts = [];
    if (p.pace) parts.push(`pace: ${p.pace}`);
    if (p.budget) parts.push(`budget: ${p.budget === 'mid' ? 'mid-range' : p.budget}`);
    if (Array.isArray(p.interests) && p.interests.length) parts.push(`loves: ${p.interests.join(', ')}`);
    if (p.food) parts.push(`food and diet: ${p.food}`);
    if (p.avoid) parts.push(`avoid: ${p.avoid}`);
    if (p.lightWalking) parts.push('keep walking light');
    if (p.kids) parts.push('travelling with kids');
    if (p.passport) parts.push(`passport: ${p.passport}`);
    return parts.length ? `Traveller profile (follow it unless the request says otherwise): ${parts.join('; ')}.` : '';
}

export function getProfilePace() {
    const pace = getTravelProfile().pace;
    return PACES.some(([id]) => id === pace) ? pace : '';
}

function summaryText() {
    const p = getTravelProfile();
    const bits = [];
    if (p.pace) bits.push(PACES.find(([id]) => id === p.pace)?.[1] || p.pace);
    if (p.budget) bits.push(BUDGETS.find(([id]) => id === p.budget)?.[1] || p.budget);
    if (Array.isArray(p.interests) && p.interests.length) bits.push(p.interests.slice(0, 3).join(', ') + (p.interests.length > 3 ? '…' : ''));
    return bits.length ? bits.join(' · ') : 'Not set yet';
}

export function renderTravelProfileSummaries() {
    document.querySelectorAll('.travel-profile-summary').forEach(el => { el.textContent = summaryText(); });
}

function pills(options, current, field) {
    return options.map(([id, label]) => `<button type="button" class="type-pill${current === id ? ' active' : ''}" onclick="setTravelProfileOption('${field}', '${id}')">${label}</button>`).join('');
}

function renderTravelProfile() {
    const body = document.getElementById('travel-profile-body');
    if (!body) return;
    const p = getTravelProfile();
    const interests = Array.isArray(p.interests) ? p.interests : [];
    body.innerHTML = `
        <div class="tp-field"><div class="tp-label">Pace</div><div class="tp-pills">${pills(PACES, p.pace, 'pace')}</div></div>
        <div class="tp-field"><div class="tp-label">Budget</div><div class="tp-pills">${pills(BUDGETS, p.budget, 'budget')}</div></div>
        <div class="tp-field"><div class="tp-label">Loves</div><div class="tp-pills">${INTERESTS.map(name => `<button type="button" class="type-pill${interests.includes(name) ? ' active' : ''}" onclick="toggleTravelProfileInterest('${escapeJS(name)}')">${escapeHTML(name)}</button>`).join('')}</div></div>
        <div class="tp-field"><label class="tp-label" for="tp-food">Food and diet</label>
            <input id="tp-food" class="form-control" maxlength="120" placeholder="e.g. vegetarian, love spicy, no seafood" value="${escapeHTML(p.food || '')}" onchange="setTravelProfileText('food', this.value)"></div>
        <div class="tp-field"><label class="tp-label" for="tp-avoid">Avoid</label>
            <input id="tp-avoid" class="form-control" maxlength="120" placeholder="e.g. long queues, tourist traps, early starts" value="${escapeHTML(p.avoid || '')}" onchange="setTravelProfileText('avoid', this.value)"></div>
        <div class="tp-field"><label class="tp-label" for="tp-passport">Passport</label>
            <input id="tp-passport" class="form-control" maxlength="60" placeholder="e.g. United States (used for visa and entry checks)" value="${escapeHTML(p.passport || '')}" onchange="setTravelProfileText('passport', this.value)"></div>
        <label class="tp-toggle"><span>Keep walking light</span><span class="switch"><input type="checkbox" ${p.lightWalking ? 'checked' : ''} onchange="setTravelProfileFlag('lightWalking', this.checked)"><span class="slider round"></span></span></label>
        <label class="tp-toggle"><span>Travelling with kids</span><span class="switch"><input type="checkbox" ${p.kids ? 'checked' : ''} onchange="setTravelProfileFlag('kids', this.checked)"><span class="slider round"></span></span></label>`;
}

export function openTravelProfile() {
    renderTravelProfile();
    const modal = document.getElementById('travel-profile-modal');
    if (modal) { modal.style.display = 'flex'; modal.classList.add('active'); }
}

function update(fn) {
    const p = getTravelProfile();
    fn(p);
    saveProfile(p);
    renderTravelProfile();
    triggerHaptic('light');
}

export function setTravelProfileOption(field, id) {
    const options = field === 'pace' ? PACES : field === 'budget' ? BUDGETS : null;
    if (!options || !options.some(([x]) => x === id)) return;
    update(p => { p[field] = p[field] === id ? '' : id; });
}
export function toggleTravelProfileInterest(name) {
    update(p => {
        const list = Array.isArray(p.interests) ? p.interests : [];
        p.interests = list.includes(name) ? list.filter(x => x !== name) : [...list, name];
    });
}
export function setTravelProfileText(field, value) {
    if (!['food', 'avoid', 'passport'].includes(field)) return;
    const p = getTravelProfile();
    p[field] = String(value || '').trim().slice(0, 120);
    saveProfile(p);
}
export function setTravelProfileFlag(field, on) {
    if (!['lightWalking', 'kids'].includes(field)) return;
    const p = getTravelProfile();
    p[field] = Boolean(on);
    saveProfile(p);
}


// Fill the "For you: …" lines once the page is ready
renderTravelProfileSummaries();
