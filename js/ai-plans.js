/* ==========================================================================
   Trippo Travel Planner - Saved AI Plans
   js/ai-plans.js

   Every itinerary the AI Trip Planner generates is kept on this device (the 24
   most recent, a few KB each; never synced) so it can be reopened later or
   compared side by side. Also keeps the recent prompts list and the desktop
   "wide" preference for the full-page AI screens.
   ========================================================================== */
import { safeGetStorage, safeSetStorage, escapeHTML, escapeJS, triggerHaptic, icon, formatTime, closeModal } from './state.js';

const PLANS_KEY = 'trippo_ai_plans_v1';
const RECENT_KEY = 'trippo_ai_recent_prompts';
const OLD_LAST_PLAN_KEY = 'trippo_ai_last_plan';
const WIDE_KEY = 'trippo_ai_wide';
const MAX_PLANS = 24; // older plans are dropped automatically
const MAX_RECENT = 6;

let compareIds = [];

function readJSON(key, fallback) {
    try { const v = JSON.parse(safeGetStorage(key) || 'null'); return v ?? fallback; } catch (e) { return fallback; }
}

export function getAIPlans() {
    let plans = readJSON(PLANS_KEY, null);
    if (!Array.isArray(plans)) {
        // One-time move from the single "last plan" slot used before the library existed
        plans = [];
        const last = readJSON(OLD_LAST_PLAN_KEY, null);
        if (last && last.itinerary) plans.push({ id: 'plan_' + Date.now().toString(36), query: last.query || '', createdAt: Date.now(), itinerary: last.itinerary });
        safeSetStorage(PLANS_KEY, JSON.stringify(plans));
    }
    return plans.filter(p => p && p.id && p.itinerary && typeof p.itinerary === 'object');
}

function writePlans(plans) {
    safeSetStorage(PLANS_KEY, JSON.stringify(plans.slice(0, MAX_PLANS)));
}

const findPlan = id => getAIPlans().find(p => p.id === id);
const planDays = it => (Array.isArray(it.days) ? it.days : []);
const planTitle = p => p.itinerary.title || p.itinerary.destination || p.query || 'AI plan';

function planCities(it) {
    const cities = [];
    planDays(it).forEach(d => {
        const c = d && typeof d.theme === 'string' && d.theme.includes(':') ? d.theme.split(':')[0].trim() : '';
        if (c && !cities.includes(c)) cities.push(c);
    });
    return cities;
}

const activityCount = it => planDays(it).reduce((n, d) => n + (Array.isArray(d.activities) ? d.activities.length : 0), 0);

export function saveAIPlanToLibrary(query, itinerary) {
    if (!itinerary || typeof itinerary !== 'object') return;
    const recent = readJSON(RECENT_KEY, []).filter(q => typeof q === 'string' && q.toLowerCase() !== String(query).toLowerCase());
    recent.unshift(String(query));
    safeSetStorage(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
    const plans = getAIPlans();
    const id = 'plan_' + Date.now().toString(36);
    itinerary._libId = id;
    plans.unshift({ id, query: String(query), createdAt: Date.now(), itinerary });
    writePlans(plans);
    renderAIPlanLibrary();
}

// Chat edits replace the saved plan instead of adding a new one each time
export function updateAIPlanInLibrary(itinerary, instruction) {
    if (!itinerary || !itinerary._libId) return;
    const plans = getAIPlans();
    const p = plans.find(x => x.id === itinerary._libId);
    if (!p) return;
    p.itinerary = itinerary;
    if (instruction) p.edits = [...(Array.isArray(p.edits) ? p.edits : []), String(instruction).slice(0, 120)].slice(-8);
    writePlans(plans);
    renderAIPlanLibrary();
}

export function openSavedAIPlan(id) {
    const p = findPlan(id);
    if (!p) return;
    p.itinerary._libId = p.id;
    if (window.setCurrentAIItinerary) window.setCurrentAIItinerary(p.itinerary);
    if (window.openAITripModal) window.openAITripModal(p.itinerary);
}

export function deleteSavedAIPlan(id) {
    const p = findPlan(id);
    if (!p || !confirm(`Delete the saved plan "${planTitle(p)}"?`)) return;
    writePlans(getAIPlans().filter(x => x.id !== id));
    compareIds = compareIds.filter(x => x !== id);
    triggerHaptic('warning');
    renderAIPlanLibrary();
}

export function toggleAIPlanCompare(id) {
    if (compareIds.includes(id)) compareIds = compareIds.filter(x => x !== id);
    else compareIds = [...compareIds, id].slice(-2);
    triggerHaptic('light');
    renderAIPlanLibrary();
}

export function useRecentAIPrompt(index) {
    const q = readJSON(RECENT_KEY, [])[Number(index)];
    const input = document.getElementById('ai-trip-input');
    if (!q || !input) return;
    input.value = q;
    input.focus();
    triggerHaptic('light');
}

export function renderAIPlanLibrary() {
    const box = document.getElementById('ai-planner-history');
    if (!box) return;
    const plans = getAIPlans();
    compareIds = compareIds.filter(id => plans.some(p => p.id === id));
    const recent = readJSON(RECENT_KEY, []).filter(q => typeof q === 'string');
    const date = ts => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const cards = plans.map(p => {
        const sid = escapeJS(p.id);
        const on = compareIds.includes(p.id);
        const days = planDays(p.itinerary).length;
        return `
        <div class="ai-plan-card${on ? ' selected' : ''}">
            <button type="button" class="ai-plan-check" aria-pressed="${on}" aria-label="Pick to compare" onclick="toggleAIPlanCompare('${sid}')">${on ? icon('check', 'ico-only') : ''}</button>
            <button type="button" class="ai-plan-open" onclick="openSavedAIPlan('${sid}')">
                <strong>${escapeHTML(planTitle(p))}</strong>
                <span>${days ? `${days} day${days === 1 ? '' : 's'} · ` : ''}${date(p.createdAt)}${p.query ? ` · “${escapeHTML(p.query)}”` : ''}</span>
            </button>
            <button type="button" class="budget-icon-btn" aria-label="Delete saved plan" onclick="deleteSavedAIPlan('${sid}')">${icon('x', 'ico-only')}</button>
        </div>`;
    }).join('');

    box.innerHTML = (plans.length ? `
        <div class="ai-recent-title">Saved plans <span>${plans.length >= 2 ? 'tick two to compare' : ''}</span></div>
        ${cards}
        ${compareIds.length === 2 ? `<button type="button" class="ai-compare-btn" onclick="openAIPlanCompare()">${icon('list-details')}Compare these 2 plans</button>` : ''}` : '') +
        (recent.length ? `<div class="ai-recent-title">Recent ideas</div>` + recent.map((q, i) =>
            `<button type="button" class="ai-recent-item" onclick="useRecentAIPrompt(${i})">${escapeHTML(q)}</button>`).join('') : '');
}

/* --- Side-by-side comparison --- */
export function openAIPlanCompare() {
    const plans = compareIds.map(findPlan).filter(Boolean);
    const box = document.getElementById('ai-compare-body');
    const modal = document.getElementById('ai-compare-modal');
    if (plans.length !== 2 || !box || !modal) return;
    const maxDays = Math.max(...plans.map(p => planDays(p.itinerary).length), 0);

    const head = plans.map(p => {
        const it = p.itinerary;
        const cities = planCities(it);
        return `<div class="ai-cmp-cell ai-cmp-head">
            <strong>${escapeHTML(planTitle(p))}</strong>
            ${it.destination ? `<span class="ai-cmp-dest">${escapeHTML(it.destination)}</span>` : ''}
            <span class="ai-cmp-stats">${planDays(it).length} days · ${activityCount(it)} activities${cities.length > 1 ? `<br>${cities.map(escapeHTML).join(' → ')}` : ''}</span>
            ${it.summary ? `<span class="ai-cmp-summary">${escapeHTML(it.summary)}</span>` : ''}
        </div>`;
    }).join('');

    let rows = '';
    for (let d = 0; d < maxDays; d++) {
        rows += `<div class="ai-cmp-day">Day ${d + 1}</div>` + plans.map(p => {
            const day = planDays(p.itinerary)[d];
            if (!day) return `<div class="ai-cmp-cell ai-cmp-empty">—</div>`;
            const acts = Array.isArray(day.activities) ? day.activities : [];
            return `<div class="ai-cmp-cell">
                ${day.theme ? `<span class="ai-cmp-theme">${escapeHTML(day.theme)}</span>` : ''}
                <ul>${acts.map(a => `<li>${a.time ? `<span class="ai-cmp-time">${escapeHTML(formatTime(a.time))}</span>` : ''}${escapeHTML(a.name || 'Activity')}</li>`).join('')}</ul>
            </div>`;
        }).join('');
    }

    const use = plans.map(p => `<div class="ai-cmp-cell ai-cmp-foot">
        <button type="button" class="save-btn" onclick="useComparedAIPlan('${escapeJS(p.id)}')">${icon('plus')}Make this a trip</button>
        <button type="button" class="budget-link-btn" onclick="openSavedAIPlan('${escapeJS(p.id)}')">Full details</button>
    </div>`).join('');

    box.innerHTML = `<div class="ai-cmp-grid">${head}${rows}${use}</div>`;
    modal.style.display = 'flex';
    triggerHaptic('medium');
}

export function useComparedAIPlan(id) {
    const p = findPlan(id);
    if (!p || !window.setCurrentAIItinerary || !window.saveAIGeneratedTrip) return;
    closeModal('ai-compare-modal');
    window.setCurrentAIItinerary(p.itinerary);
    window.saveAIGeneratedTrip();
}

/* --- Wide mode for the full-page AI screens on bigger windows --- */
export function toggleAIWide() {
    const wide = !document.body.classList.contains('ai-wide');
    document.body.classList.toggle('ai-wide', wide);
    safeSetStorage(WIDE_KEY, wide ? '1' : '0');
    triggerHaptic('light');
}

if (typeof document !== 'undefined' && safeGetStorage(WIDE_KEY) === '1') document.body.classList.add('ai-wide');
