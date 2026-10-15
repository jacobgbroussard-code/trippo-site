/* ==========================================================================
   Trippo Travel Planner - Budget Tracker
   js/budget-tracker.js

   The spending side of the Trip Budget modal. Expenses carry a stop and a
   category so they can be compared with the estimate lines from
   js/budget-estimator.js. The tracker also handles who paid and who shares each
   cost, a settle-up list, daily pace, a category breakdown and CSV export.
   Prices entered on Stays / Transit bookings become expenses automatically
   (ids bk_stay_<stop> / bk_travel_<departing stop>).
   ========================================================================== */
import { trips, activeTripId, getActiveTrip, saveTrips, escapeHTML, escapeJS, showNotification, icon, triggerHaptic, toggleSidebar, parseLocalDate } from './state.js';
import { estimateTripBudget, formatMoney } from './budget-estimator.js';

export const EXPENSE_CATEGORIES = {
    travel: { label: 'Getting there', icon: 'plane-departure', color: '#3b82f6' },
    stay: { label: 'Lodging', icon: 'bed', color: '#8b5cf6' },
    food: { label: 'Food & drinks', icon: 'coins', color: '#f59e0b' },
    local: { label: 'Getting around', icon: 'bus', color: '#14b8a6' },
    activities: { label: 'Activities', icon: 'ticket', color: '#ec4899' },
    shopping: { label: 'Shopping', icon: 'tag', color: '#84cc16' },
    other: { label: 'Other', icon: 'wallet', color: '#94a3b8' }
};
const SETTLEMENT = 'settlement';
const RETURN_STOP = '_return';
const NO_STOP = '-';

// Guess a category from the title when the user leaves it on "Auto"
const KEYWORDS = [
    ['stay', /hotel|hostel|airbnb|\binn\b|resort|lodg|motel|ryokan|guest ?house|\bb&b\b|\bbnb\b|apartment/i],
    ['travel', /flight|plane|airline|airfare|\btrain|\brail|shinkansen|ferry|rental car|car rental|\bgas\b|fuel|\btolls?\b/i],
    ['local', /taxi|uber|lyft|\bgrab\b|didi|metro|subway|\bbus\b|tram|tuk|scooter|bike|parking|transfer|\bcab\b/i],
    ['food', /dinner|lunch|breakfast|brunch|food|restaurant|caf[eé]|coffee|drink|\bbar\b|beer|wine|snack|grocer|meal|dumpling|duck|sushi|ramen|pizza/i],
    ['activities', /ticket|tour|museum|entry|admission|\bpark\b|wall|palace|show|class|excursion|day trip|hike|temple|cruise|\bspa\b|concert/i],
    ['shopping', /souvenir|shop|gift|cloth|market|mall/i]
];

let editingExpenseId = null;
let formSplitWith = null; // null = everyone

const stopKey = (stop, i) => (stop && stop.id) || 'i' + i;
const money2 = n => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isSpend = e => e && e.category !== SETTLEMENT;

/* --- People --- */
export function getPeople(trip) {
    const n = Math.max(1, parseInt(trip.budgetTravelers, 10) || 1);
    if (!Array.isArray(trip.budgetPeople)) trip.budgetPeople = [];
    for (let i = trip.budgetPeople.length; i < n; i++) {
        trip.budgetPeople.push({ id: 'p' + (i + 1), name: i === 0 ? 'You' : `Traveler ${i + 1}` });
    }
    return trip.budgetPeople.slice(0, n);
}

const personName = (people, id) => (people.find(p => p.id === id) || people[0]).name;
const payerOf = (e, people) => (people.some(p => p.id === e.paidBy) ? e.paidBy : people[0].id);

function shareOf(e, people) {
    const ids = people.map(p => p.id);
    if (e.splitType !== 'split') return [payerOf(e, people)];
    const w = Array.isArray(e.splitWith) ? e.splitWith.filter(id => ids.includes(id)) : [];
    return w.length ? w : ids;
}

/* --- Where an expense belongs (stop + category), explicit or inferred --- */
function guessCategory(title) {
    const hit = KEYWORDS.find(([, re]) => re.test(title || ''));
    return hit ? hit[0] : 'other';
}

function guessStopFromTitle(trip, title) {
    const t = String(title || '').toLowerCase();
    let best = null;
    (trip.stops || []).forEach((s, i) => {
        const name = String(s.name || '').toLowerCase().split(',')[0].trim();
        if (name.length > 2 && t.includes(name) && (!best || name.length > best.len)) best = { key: stopKey(s, i), len: name.length };
    });
    return best ? best.key : '';
}

export function expenseCategory(e) {
    if (e.category === SETTLEMENT || EXPENSE_CATEGORIES[e.category]) return e.category;
    const id = String(e.id || '');
    if (id.startsWith('bk_stay_')) return 'stay';
    if (id.startsWith('bk_travel_')) return 'travel';
    if (id.startsWith('est_')) {
        const kind = id.split(':').pop();
        return kind === 'return' ? 'travel' : (EXPENSE_CATEGORIES[kind] ? kind : 'other');
    }
    return guessCategory(e.title);
}

export function expenseStop(trip, e) {
    if (typeof e.stopId === 'string') return e.stopId;
    const stops = trip.stops || [];
    const id = String(e.id || '');
    if (id.startsWith('est_')) {
        const [k, kind] = id.slice(4).split(':');
        return kind === 'return' ? RETURN_STOP : k;
    }
    if (id.startsWith('bk_stay_')) return id.slice(8);
    if (id.startsWith('bk_travel_')) {
        const i = stops.findIndex((s, idx) => stopKey(s, idx) === id.slice(10));
        return i >= 0 && stops[i + 1] ? stopKey(stops[i + 1], i + 1) : '';
    }
    return guessStopFromTitle(trip, e.title);
}

// Spending per estimate line key ("<stop>:<kind>"), plus spending with no matching line
export function budgetSpentByLine(trip) {
    const stops = trip.stops || [];
    const last = stops.length ? stopKey(stops[stops.length - 1], stops.length - 1) : '';
    const lines = {};
    const otherByStop = {};
    let unassigned = 0;
    (trip.expenses || []).filter(isSpend).forEach(e => {
        const amt = Number(e.amount) || 0;
        const cat = expenseCategory(e);
        let stop = expenseStop(trip, e);
        let kind = cat;
        if (stop === RETURN_STOP) { stop = last; kind = 'return'; }
        if (!stop || stop === NO_STOP) { unassigned += amt; return; }
        if (['travel', 'stay', 'food', 'local', 'return'].includes(kind)) {
            const key = `${stop}:${kind}`;
            lines[key] = (lines[key] || 0) + amt;
        } else {
            otherByStop[stop] = (otherByStop[stop] || 0) + amt;
        }
    });
    return { lines, otherByStop, unassigned };
}

/* --- Totals, timing, balances --- */
function tripTiming(trip) {
    const stops = trip.stops || [];
    const days = Math.max(1, stops.reduce((n, s) => n + (Number(s.nights) || 0), 0));
    if (!trip.startDate) return { days, dayNum: null };
    const start = parseLocalDate(trip.startDate);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    start.setHours(0, 0, 0, 0);
    return { days, dayNum: Math.floor((today - start) / 864e5) + 1 };
}

// Stop you're at today, so new expenses default to it during the trip
function currentStopKey(trip) {
    const { dayNum } = tripTiming(trip);
    if (!dayNum || dayNum < 1) return '';
    let acc = 0;
    const stops = trip.stops || [];
    for (let i = 0; i < stops.length; i++) {
        acc += Number(stops[i].nights) || 0;
        if (dayNum <= acc) return stopKey(stops[i], i);
    }
    return '';
}

export function computeBalances(trip) {
    const people = getPeople(trip);
    const bal = {}, paid = {}, share = {};
    people.forEach(p => { bal[p.id] = 0; paid[p.id] = 0; share[p.id] = 0; });
    (trip.expenses || []).forEach(e => {
        const amt = Number(e.amount) || 0;
        if (!amt) return;
        const payer = payerOf(e, people);
        const parts = shareOf(e, people);
        bal[payer] += amt;
        parts.forEach(id => { bal[id] -= amt / parts.length; });
        if (isSpend(e)) {
            paid[payer] += amt;
            parts.forEach(id => { share[id] += amt / parts.length; });
        }
    });
    // Fewest transfers: repeatedly match the biggest debtor with the biggest creditor
    const debt = people.map(p => ({ id: p.id, c: -Math.round(bal[p.id] * 100) })).filter(x => x.c > 0).sort((a, b) => b.c - a.c);
    const cred = people.map(p => ({ id: p.id, c: Math.round(bal[p.id] * 100) })).filter(x => x.c > 0).sort((a, b) => b.c - a.c);
    const transfers = [];
    let i = 0, j = 0;
    while (i < debt.length && j < cred.length) {
        const x = Math.min(debt[i].c, cred[j].c);
        if (x > 1) transfers.push({ from: debt[i].id, to: cred[j].id, amount: x / 100 });
        debt[i].c -= x; cred[j].c -= x;
        if (debt[i].c <= 0) i++;
        if (cred[j].c <= 0) j++;
    }
    return { people, bal, paid, share, transfers };
}

/* --- Modal plumbing --- */
export function getBudgetActiveTrip() {
    const selectEl = document.getElementById('budget-trip-select');
    const tripId = selectEl ? selectEl.value : activeTripId;
    return trips.find(t => t.id === tripId) || getActiveTrip();
}

function syncTravelersInput(trip) {
    if (!trip.budgetTravelers) trip.budgetTravelers = 2;
    if (!Array.isArray(trip.expenses)) trip.expenses = [];
    const countEl = document.getElementById('budget-travelers-count');
    if (countEl) countEl.value = trip.budgetTravelers;
}

export function handleBudgetTripChange(tripId) {
    const trip = trips.find(t => t.id === tripId);
    if (trip) syncTravelersInput(trip);
    resetExpenseForm();
    renderBudgetCalculator();
}

export function openBudgetModal() {
    toggleSidebar(false);
    const selectEl = document.getElementById('budget-trip-select');
    if (selectEl) {
        selectEl.innerHTML = trips.map(t => `<option value="${escapeHTML(String(t.id))}" ${t.id === activeTripId ? 'selected' : ''}>${escapeHTML(t.name)}</option>`).join('');
    }
    const trip = getBudgetActiveTrip();
    if (trip) syncTravelersInput(trip);
    resetExpenseForm();
    renderBudgetCalculator();
    const modal = document.getElementById('budget-modal');
    if (modal) modal.style.display = 'flex';
}

export function updateTravelersCount(val) {
    const trip = getBudgetActiveTrip();
    if (!trip) return;
    trip.budgetTravelers = Math.min(20, Math.max(1, parseInt(val, 10) || 1));
    getPeople(trip);
    saveTrips();
    renderBudgetCalculator();
}

export function renameBudgetPerson(personId, name) {
    const trip = getBudgetActiveTrip();
    const p = trip && getPeople(trip).find(x => x.id === personId);
    if (!p) return;
    p.name = String(name || '').trim().slice(0, 24) || p.name;
    saveTrips();
    renderBudgetCalculator();
}

export function showBudgetPane(pane) {
    ['estimate', 'expenses', 'settle'].forEach(p => {
        const el = document.getElementById(`budget-pane-${p}`);
        const tab = document.getElementById(`budget-tab-${p}`);
        if (el) el.style.display = p === pane ? '' : 'none';
        if (tab) { tab.classList.toggle('active', p === pane); tab.setAttribute('aria-selected', String(p === pane)); }
    });
}

/* --- Expense form --- */
function stopOptions(trip, selected) {
    const stops = trip.stops || [];
    const opts = [`<option value="">Stop: auto</option>`]
        .concat(stops.map((s, i) => `<option value="${escapeHTML(stopKey(s, i))}">${escapeHTML(s.name)}</option>`));
    if (stops.length > 1) opts.push(`<option value="${RETURN_STOP}">Trip home</option>`);
    opts.push(`<option value="${NO_STOP}">Whole trip</option>`);
    return opts.join('');
}

function fillExpenseForm(trip) {
    const people = getPeople(trip);
    const cat = document.getElementById('expense-category');
    const stop = document.getElementById('expense-stop');
    const paid = document.getElementById('expense-paid-by');
    if (cat && !cat.options.length) {
        cat.innerHTML = `<option value="">Category: auto</option>` +
            Object.entries(EXPENSE_CATEGORIES).map(([id, c]) => `<option value="${id}">${c.label}</option>`).join('');
    }
    if (stop) {
        const keep = stop.value;
        stop.innerHTML = stopOptions(trip);
        stop.value = [...stop.options].some(o => o.value === keep) ? keep : '';
    }
    if (paid) {
        const keep = paid.value;
        paid.innerHTML = people.map(p => `<option value="${escapeHTML(p.id)}">Paid by ${escapeHTML(p.name)}</option>`).join('');
        paid.value = people.some(p => p.id === keep) ? keep : people[0].id;
        paid.closest('.form-group').style.display = people.length > 1 ? '' : 'none';
    }
    renderExpenseSplitWith();
}

export function renderExpenseSplitWith() {
    const box = document.getElementById('expense-split-with');
    const trip = getBudgetActiveTrip();
    if (!box || !trip) return;
    const people = getPeople(trip);
    const isSplit = (document.getElementById('expense-split-type')?.value || 'split') === 'split';
    if (!isSplit || people.length < 2) { box.innerHTML = ''; return; }
    const on = id => !formSplitWith || formSplitWith.includes(id);
    box.innerHTML = `<span class="expense-split-label">Split with</span>` + people.map(p =>
        `<button type="button" class="split-chip${on(p.id) ? ' on' : ''}" aria-pressed="${on(p.id)}" onclick="toggleExpenseSplitPerson('${escapeJS(p.id)}')">${escapeHTML(p.name)}</button>`).join('');
}

export function toggleExpenseSplitPerson(personId) {
    const trip = getBudgetActiveTrip();
    if (!trip) return;
    const ids = getPeople(trip).map(p => p.id);
    const set = new Set(formSplitWith || ids);
    if (set.has(personId)) { if (set.size > 1) set.delete(personId); } else set.add(personId);
    formSplitWith = set.size === ids.length ? null : ids.filter(id => set.has(id));
    renderExpenseSplitWith();
}

function resetExpenseForm() {
    editingExpenseId = null;
    formSplitWith = null;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('expense-title-input', '');
    set('expense-amount-input', '');
    set('expense-category', '');
    set('expense-stop', '');
    set('expense-split-type', 'split');
    const btn = document.getElementById('expense-save-btn');
    if (btn) btn.textContent = '+ Add Expense';
    const cancel = document.getElementById('expense-cancel-btn');
    if (cancel) cancel.style.display = 'none';
}

export function cancelExpenseEdit() {
    resetExpenseForm();
    renderBudgetCalculator();
}

export function editTripExpense(expId) {
    const trip = getBudgetActiveTrip();
    const e = trip && (trip.expenses || []).find(x => x.id === expId);
    if (!e) return;
    editingExpenseId = expId;
    showBudgetPane('expenses');
    fillExpenseForm(trip);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('expense-title-input', e.title || '');
    set('expense-amount-input', Number(e.amount) || '');
    set('expense-category', EXPENSE_CATEGORIES[e.category] ? e.category : '');
    const stop = typeof e.stopId === 'string' ? (e.stopId || NO_STOP) : '';
    set('expense-stop', stop);
    set('expense-paid-by', payerOf(e, getPeople(trip)));
    set('expense-split-type', e.splitType === 'split' ? 'split' : 'individual');
    formSplitWith = Array.isArray(e.splitWith) && e.splitWith.length ? [...e.splitWith] : null;
    renderExpenseSplitWith();
    const btn = document.getElementById('expense-save-btn');
    if (btn) btn.textContent = 'Save changes';
    const cancel = document.getElementById('expense-cancel-btn');
    if (cancel) cancel.style.display = '';
    renderBudgetCalculator();
    document.getElementById('expense-form')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

export function addTripExpense() {
    const trip = getBudgetActiveTrip();
    if (!trip) return;
    const title = document.getElementById('expense-title-input')?.value.trim();
    const amount = parseFloat(document.getElementById('expense-amount-input')?.value);
    if (!title || isNaN(amount) || amount <= 0) {
        showNotification("Please enter a valid expense name and amount.");
        return;
    }
    const people = getPeople(trip);
    const catVal = document.getElementById('expense-category')?.value || '';
    const stopVal = document.getElementById('expense-stop')?.value || '';
    const paidBy = document.getElementById('expense-paid-by')?.value || people[0].id;
    const splitType = document.getElementById('expense-split-type')?.value || 'split';

    const category = EXPENSE_CATEGORIES[catVal] ? catVal : guessCategory(title);
    let stopId = stopVal === NO_STOP ? '' : stopVal;
    if (!stopVal) stopId = guessStopFromTitle(trip, title) || currentStopKey(trip);

    const fields = {
        title, amount: Math.round(amount * 100) / 100, splitType, category, stopId,
        paidBy: people.some(p => p.id === paidBy) ? paidBy : people[0].id
    };
    if (splitType === 'split' && formSplitWith) fields.splitWith = [...formSplitWith];

    if (!Array.isArray(trip.expenses)) trip.expenses = [];
    const existing = editingExpenseId && trip.expenses.find(e => e.id === editingExpenseId);
    if (existing) {
        Object.assign(existing, fields);
        if (!fields.splitWith) delete existing.splitWith;
    } else {
        trip.expenses.push({ id: 'exp_' + Date.now(), ...fields, date: new Date().toISOString().slice(0, 10) });
    }
    const wasEditing = Boolean(existing);
    saveTrips();
    resetExpenseForm();
    renderBudgetCalculator();
    showNotification(wasEditing ? "Expense updated" : `Added to ${EXPENSE_CATEGORIES[category].label}`);
}

// Flip an expense between shared (split across travelers) and personal
export function setExpenseSplitType(expId, splitType) {
    const trip = getBudgetActiveTrip();
    const exp = trip && (trip.expenses || []).find(e => e.id === expId);
    if (!exp || (splitType !== 'split' && splitType !== 'individual') || exp.splitType === splitType) return;
    exp.splitType = splitType;
    triggerHaptic('light');
    saveTrips();
    renderBudgetCalculator();
}

export function deleteTripExpense(expId) {
    const trip = getBudgetActiveTrip();
    if (!trip || !trip.expenses) return;
    const exp = trip.expenses.find(e => e.id === expId);
    const title = exp ? exp.title : 'this expense';
    if (!confirm(`Are you sure you want to delete "${title}"?`)) return;
    triggerHaptic('warning');
    trip.expenses = trip.expenses.filter(e => e.id !== expId);
    if (editingExpenseId === expId) resetExpenseForm();
    saveTrips();
    renderBudgetCalculator();
    showNotification("Expense removed.");
}

/* --- Settle up --- */
export function recordSettlement(fromId, toId, amount) {
    const trip = getBudgetActiveTrip();
    if (!trip) return;
    const people = getPeople(trip);
    const amt = Math.round((Number(amount) || 0) * 100) / 100;
    if (amt <= 0) return;
    if (!Array.isArray(trip.expenses)) trip.expenses = [];
    trip.expenses.push({
        id: 'set_' + Date.now(), title: `${personName(people, fromId)} paid ${personName(people, toId)}`,
        amount: amt, splitType: 'split', category: SETTLEMENT, paidBy: fromId, splitWith: [toId], stopId: '',
        date: new Date().toISOString().slice(0, 10)
    });
    triggerHaptic('success');
    saveTrips();
    renderBudgetCalculator();
    showNotification('Payment recorded');
}

function renderSettle(trip) {
    const box = document.getElementById('budget-settle-container');
    if (!box) return;
    const { people, paid, share, bal, transfers } = computeBalances(trip);
    if (people.length < 2) {
        box.innerHTML = `<p class="budget-empty">Set Travelers to 2 or more to split costs and see who owes whom.</p>`;
        return;
    }
    const settlements = (trip.expenses || []).filter(e => e.category === SETTLEMENT);
    box.innerHTML = `
        <div class="settle-people">
            ${people.map(p => {
                const b = Math.round(bal[p.id] * 100) / 100;
                const cls = b > 0.009 ? 'pos' : b < -0.009 ? 'neg' : '';
                return `<div class="settle-person">
                    <span class="settle-name">${escapeHTML(p.name)}</span>
                    <span class="settle-sub">Paid ${formatMoney(paid[p.id])} · Share ${formatMoney(share[p.id])}</span>
                    <span class="settle-bal ${cls}">${b > 0.009 ? 'gets back ' + money2(b) : b < -0.009 ? 'owes ' + money2(-b) : 'settled'}</span>
                </div>`;
            }).join('')}
        </div>
        <h3 class="budget-h3">${transfers.length ? 'To settle up' : 'All square'}</h3>
        ${transfers.length ? transfers.map(t => `
            <div class="settle-transfer">
                <span><strong>${escapeHTML(personName(people, t.from))}</strong> pays <strong>${escapeHTML(personName(people, t.to))}</strong></span>
                <strong class="settle-amt">${money2(t.amount)}</strong>
                <button type="button" class="budget-link-btn" onclick="recordSettlement('${escapeJS(t.from)}', '${escapeJS(t.to)}', ${t.amount})">${icon('check')}Paid</button>
            </div>`).join('') : `<p class="budget-empty">Nobody owes anything right now.</p>`}
        ${settlements.length ? `<h3 class="budget-h3">Payments recorded</h3>` + settlements.map(e => `
            <div class="settle-transfer muted">
                <span>${escapeHTML(e.title)}</span><strong class="settle-amt">${money2(e.amount)}</strong>
                <button type="button" class="budget-icon-btn" aria-label="Undo payment" onclick="deleteTripExpense('${escapeJS(e.id)}')">${icon('x', 'ico-only')}</button>
            </div>`).join('') : ''}
        <p class="budget-note">Shared costs split evenly between the people ticked on each expense. Personal costs stay with whoever paid.</p>`;
}

/* --- Summary: progress, pace, categories --- */
function renderProgress(trip, spent, est) {
    const box = document.getElementById('budget-progress');
    if (!box) return;
    if (!spent && !est.total) { box.innerHTML = ''; return; }
    const pct = est.total ? Math.min(100, (spent / est.total) * 100) : 100;
    const over = est.total && spent > est.total;
    const left = est.total - spent;
    const { days, dayNum } = tripTiming(trip);
    let pace = '';
    if (est.total) {
        if (dayNum === null) pace = `${formatMoney(est.total / days)}/day planned over ${days} day${days === 1 ? '' : 's'}`;
        else if (dayNum < 1) pace = `Starts in ${1 - dayNum} day${dayNum === 0 ? '' : 's'} · ${formatMoney(est.total / days)}/day planned`;
        else if (dayNum <= days) {
            const daysLeft = days - dayNum + 1;
            pace = left >= 0 ? `Day ${dayNum} of ${days} · ${formatMoney(left / daysLeft)}/day left to stay on budget` : `Day ${dayNum} of ${days} · over budget`;
        } else pace = left >= 0 ? `Trip done · ${formatMoney(left)} under budget` : `Trip done · ${formatMoney(-left)} over budget`;
    }

    const byCat = {};
    (trip.expenses || []).filter(isSpend).forEach(e => {
        const c = expenseCategory(e);
        byCat[c] = (byCat[c] || 0) + (Number(e.amount) || 0);
    });
    const cats = Object.entries(byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);

    box.innerHTML = `
        ${est.total ? `<div class="budget-bar${over ? ' over' : ''}"><span style="width:${pct.toFixed(1)}%"></span></div>
        <div class="budget-bar-text"><span>${Math.round((spent / est.total) * 100)}% of estimate</span><span>${over ? `${formatMoney(-left)} over` : `${formatMoney(left)} left`}</span></div>` : ''}
        ${pace ? `<div class="budget-pace">${icon('calendar-event')}${pace}</div>` : ''}
        ${cats.length ? `<div class="budget-cat-bar">${cats.map(([c, v]) => `<span style="width:${((v / spent) * 100).toFixed(1)}%; background:${EXPENSE_CATEGORIES[c].color}" title="${EXPENSE_CATEGORIES[c].label}"></span>`).join('')}</div>
        <div class="budget-cat-legend">${cats.map(([c, v]) => `<span><i style="background:${EXPENSE_CATEGORIES[c].color}"></i>${EXPENSE_CATEGORIES[c].label} ${formatMoney(v)}</span>`).join('')}</div>` : ''}`;
}

function renderPeople(trip) {
    const box = document.getElementById('budget-people');
    if (!box) return;
    const people = getPeople(trip);
    if (people.length < 2) { box.innerHTML = ''; return; }
    box.innerHTML = people.map(p =>
        `<input class="budget-person" value="${escapeHTML(p.name)}" maxlength="24" aria-label="Traveler name" onfocus="this.select()" onchange="renameBudgetPerson('${escapeJS(p.id)}', this.value)">`).join('');
}

function stopLabel(trip, key) {
    if (key === RETURN_STOP) return 'Trip home';
    if (!key || key === NO_STOP) return '';
    const stops = trip.stops || [];
    const i = stops.findIndex((s, idx) => stopKey(s, idx) === key);
    return i >= 0 ? stops[i].name : '';
}

export function renderBudgetCalculator() {
    const trip = getBudgetActiveTrip();
    if (!trip) return;

    const people = getPeople(trip);
    const travelers = people.length;
    const expenses = trip.expenses || [];
    const spending = expenses.filter(isSpend);

    let totalCombined = 0;
    let splitPool = 0;
    spending.forEach(e => {
        const amt = Number(e.amount) || 0;
        totalCombined += amt;
        if (e.splitType === 'split') splitPool += amt;
    });
    const perPersonSplit = splitPool / travelers;

    const combinedEl = document.getElementById('budget-total-combined');
    const perPersonEl = document.getElementById('budget-per-person');
    if (combinedEl) combinedEl.innerText = money2(totalCombined);
    if (perPersonEl) perPersonEl.innerText = `${money2(perPersonSplit)} / person (shared ÷ ${travelers})`;

    renderPeople(trip);
    renderProgress(trip, totalCombined, estimateTripBudget(trip));
    if (window.renderBudgetEstimator) window.renderBudgetEstimator(trip.id);
    fillExpenseForm(trip);
    renderSettle(trip);

    const container = document.getElementById('expenses-list-container');
    if (!container) return;
    if (spending.length === 0) {
        container.innerHTML = `<p style="text-align:center; color:#8fa09c; font-size:13px; margin:20px 0;">No expenses recorded for this trip yet.</p>`;
        return;
    }

    container.innerHTML = spending.slice().reverse().map(e => {
        const amt = Number(e.amount) || 0;
        const safeId = escapeJS(e.id);
        const isSplit = e.splitType === 'split';
        const cat = EXPENSE_CATEGORIES[expenseCategory(e)] || EXPENSE_CATEGORIES.other;
        const parts = shareOf(e, people);
        const meta = [stopLabel(trip, expenseStop(trip, e)), cat.label];
        if (travelers > 1) meta.push(`paid by ${personName(people, payerOf(e, people))}`);
        if (String(e.id).startsWith('bk_')) meta.push('from booking');
        const toggle = travelers > 1 ? `<div class="expense-split-toggle" role="group" aria-label="How this cost is shared">
                <button type="button" class="${isSplit ? 'on' : ''}" aria-pressed="${isSplit}" onclick="setExpenseSplitType('${safeId}', 'split')">${icon('users')}Shared</button>
                <button type="button" class="${isSplit ? '' : 'on'}" aria-pressed="${!isSplit}" onclick="setExpenseSplitType('${safeId}', 'individual')">${icon('user')}Personal</button>
            </div>` : '';
        const shareNote = isSplit && parts.length > 1
            ? `<span class="expense-share-note">${money2(amt / parts.length)} each${parts.length < travelers ? ` · ${parts.map(id => escapeHTML(personName(people, id))).join(', ')}` : ''}</span>` : '';

        return `
        <div class="expense-row${editingExpenseId === e.id ? ' editing' : ''}">
            <span class="expense-cat" style="--cat:${cat.color}">${icon(cat.icon, 'ico-only')}</span>
            <div class="expense-body">
                <button type="button" class="expense-main" onclick="editTripExpense('${safeId}')" aria-label="Edit ${escapeHTML(e.title)}">
                    <strong>${escapeHTML(e.title)}</strong>
                    <span class="expense-meta">${escapeHTML(meta.filter(Boolean).join(' · '))}</span>
                </button>
                ${toggle}${shareNote}
            </div>
            <div class="expense-right">
                <strong>${money2(amt)}</strong>
                <button type="button" class="budget-icon-btn danger" aria-label="Delete expense" onclick="deleteTripExpense('${safeId}')">${icon('trash', 'ico-only')}</button>
            </div>
        </div>`;
    }).join('');
}

/* --- CSV export --- */
export function exportExpensesCSV() {
    const trip = getBudgetActiveTrip();
    if (!trip) return;
    const people = getPeople(trip);
    const rows = [['Date', 'Title', 'Amount (USD)', 'Category', 'Stop', 'Paid by', 'Shared/Personal', 'Split with']];
    (trip.expenses || []).forEach(e => {
        const cat = expenseCategory(e);
        rows.push([
            e.date || '', e.title || '', (Number(e.amount) || 0).toFixed(2),
            cat === SETTLEMENT ? 'Settle-up payment' : EXPENSE_CATEGORIES[cat].label,
            stopLabel(trip, expenseStop(trip, e)) || 'Whole trip',
            personName(people, payerOf(e, people)),
            e.splitType === 'split' ? 'Shared' : 'Personal',
            shareOf(e, people).map(id => personName(people, id)).join('; ')
        ]);
    });
    const csv = rows.map(r => r.map(v => {
        let s = String(v);
        if (/^[=+\-@]/.test(s)) s = "'" + s; // keep spreadsheets from running it as a formula
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${String(trip.name || 'trip').replace(/[^\w\- ]+/g, '').trim() || 'trip'} expenses.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* --- Booking prices → expenses --- */
// kind 'stay': stop = the hotel's stop. kind 'travel': stop = the departing stop holding stop.transit.
export function bookingExpenseId(trip, kind, stopIndex) {
    const stop = trip.stops && trip.stops[stopIndex];
    return stop ? `bk_${kind}_${stopKey(stop, stopIndex)}` : null;
}

export function getBookingPrice(trip, kind, stopIndex) {
    const id = bookingExpenseId(trip, kind, stopIndex);
    const e = id && (trip.expenses || []).find(x => x.id === id);
    return e ? Number(e.amount) || '' : '';
}

export function syncBookingExpense(trip, kind, stopIndex, price, title) {
    const id = bookingExpenseId(trip, kind, stopIndex);
    if (!id) return;
    if (!Array.isArray(trip.expenses)) trip.expenses = [];
    const amount = Math.round((parseFloat(price) || 0) * 100) / 100;
    const existing = trip.expenses.find(e => e.id === id);
    if (amount <= 0) {
        if (existing) trip.expenses = trip.expenses.filter(e => e.id !== id);
        return;
    }
    const stops = trip.stops;
    const stopId = kind === 'stay' ? stopKey(stops[stopIndex], stopIndex)
        : stops[stopIndex + 1] ? stopKey(stops[stopIndex + 1], stopIndex + 1) : '';
    if (existing) Object.assign(existing, { title, amount, category: kind, stopId });
    else trip.expenses.push({ id, title, amount, splitType: 'split', category: kind, stopId, paidBy: getPeople(trip)[0].id, date: new Date().toISOString().slice(0, 10) });
}
