/* ==========================================================================
   MEMBERSHIPS: airline / hotel / rail loyalty numbers, saved once (on this device and in
   backups) and shown with a copy button on the flight or stay they belong to.
   ========================================================================== */
import { safeGetStorage, safeSetStorage, escapeHTML, escapeJS, icon, showNotification, triggerHaptic } from './state.js';

const KEY = 'trippo_memberships_v1';

// Popular programs: what they're called, and how to recognise a booking that belongs to them
// (airline: flight number prefix; hotel: brand words in the stay's name)
export const PROGRAMS = [
    { name: 'China Eastern Eastern Miles', kind: 'air', codes: ['MU', 'FM'], words: ['china eastern', 'shanghai airlines'] },
    { name: 'Air China PhoenixMiles', kind: 'air', codes: ['CA'], words: ['air china'] },
    { name: 'China Southern Sky Pearl Club', kind: 'air', codes: ['CZ'], words: ['china southern'] },
    { name: 'Hainan Airlines Fortune Wings', kind: 'air', codes: ['HU'], words: ['hainan airlines'] },
    { name: 'Cathay Pacific Asia Miles', kind: 'air', codes: ['CX'], words: ['cathay'] },
    { name: 'American AAdvantage', kind: 'air', codes: ['AA'], words: ['american airlines'] },
    { name: 'Delta SkyMiles', kind: 'air', codes: ['DL'], words: ['delta'] },
    { name: 'United MileagePlus', kind: 'air', codes: ['UA'], words: ['united airlines'] },
    { name: 'Southwest Rapid Rewards', kind: 'air', codes: ['WN'], words: ['southwest'] },
    { name: 'Alaska Mileage Plan', kind: 'air', codes: ['AS'], words: ['alaska airlines'] },
    { name: 'JAL Mileage Bank', kind: 'air', codes: ['JL'], words: ['japan airlines'] },
    { name: 'ANA Mileage Club', kind: 'air', codes: ['NH'], words: ['all nippon', 'ana '] },
    { name: 'Korean Air SKYPASS', kind: 'air', codes: ['KE'], words: ['korean air'] },
    { name: 'Singapore KrisFlyer', kind: 'air', codes: ['SQ'], words: ['singapore airlines'] },
    { name: 'EVA Air Infinity MileageLands', kind: 'air', codes: ['BR'], words: ['eva air'] },
    { name: 'Emirates Skywards', kind: 'air', codes: ['EK'], words: ['emirates'] },
    { name: 'Qatar Privilege Club', kind: 'air', codes: ['QR'], words: ['qatar airways'] },
    { name: 'British Airways Club', kind: 'air', codes: ['BA'], words: ['british airways'] },
    { name: 'Air France-KLM Flying Blue', kind: 'air', codes: ['AF', 'KL'], words: ['air france', 'klm'] },
    { name: 'Lufthansa Miles & More', kind: 'air', codes: ['LH', 'LX', 'OS'], words: ['lufthansa', 'swiss', 'austrian'] },
    { name: 'Marriott Bonvoy', kind: 'hotel', words: ['marriott', 'sheraton', 'westin', 'w hotel', 'ritz-carlton', 'ritz carlton', 'jw ', 'courtyard', 'renaissance', 'four points', 'aloft', 'moxy', 'st. regis', 'st regis', 'le meridien', 'le méridien', 'fairfield', 'residence inn', 'springhill', 'luxury collection', 'autograph collection', 'edition', 'element', 'westin'] },
    { name: 'Hilton Honors', kind: 'hotel', words: ['hilton', 'hampton', 'doubletree', 'conrad', 'waldorf', 'embassy suites', 'homewood', 'home2', 'curio', 'canopy', 'tapestry', 'tru by hilton', 'lxr'] },
    { name: 'IHG One Rewards', kind: 'hotel', words: ['intercontinental', 'holiday inn', 'crowne plaza', 'hotel indigo', 'kimpton', 'regent', 'six senses', 'hualuxe', 'even hotel', 'staybridge', 'candlewood', 'vignette', 'voco'] },
    { name: 'World of Hyatt', kind: 'hotel', words: ['hyatt', 'andaz', 'alila', 'thompson', 'caption by hyatt'] },
    { name: 'Accor ALL', kind: 'hotel', words: ['novotel', 'sofitel', 'ibis', 'pullman', 'mercure', 'fairmont', 'raffles', 'swissotel', 'mövenpick', 'movenpick', 'mgallery', 'banyan tree'] },
    { name: 'Wyndham Rewards', kind: 'hotel', words: ['wyndham', 'ramada', 'days inn', 'super 8', 'la quinta', 'microtel', 'howard johnson', 'travelodge'] },
    { name: 'Choice Privileges', kind: 'hotel', words: ['comfort inn', 'comfort suites', 'quality inn', 'sleep inn', 'clarion', 'cambria', 'econo lodge', 'radisson'] },
    { name: 'Shangri-La Circle', kind: 'hotel', words: ['shangri-la', 'shangri la', 'kerry hotel', 'jen by shangri-la'] },
    { name: 'Huazhu H Rewards', kind: 'hotel', words: ['hanting', 'ji hotel', 'orange hotel', 'crystal orange', 'joya', 'manxin', 'hi inn'] },
    { name: 'Jin Jiang', kind: 'hotel', words: ['jinjiang', 'jin jiang', 'vienna hotel', 'lavande', '7days', '7 days inn'] },
    { name: 'Atour', kind: 'hotel', words: ['atour'] },
    { name: 'Trip.com Rewards', kind: 'other', words: [] },
    { name: 'Amtrak Guest Rewards', kind: 'rail', words: ['amtrak'] }
];

export function getMemberships() {
    try {
        const list = JSON.parse(safeGetStorage(KEY) || '[]');
        return Array.isArray(list) ? list.filter(m => m && m.program && m.number) : [];
    } catch (e) { return []; }
}

function saveMemberships(list) {
    safeSetStorage(KEY, JSON.stringify(list));
}

const programInfo = name => PROGRAMS.find(p => p.name.toLowerCase() === String(name || '').toLowerCase());

// The membership that belongs to a flight (by its flight number's airline code) or a stay (by hotel brand)
export function membershipFor(kind, booking) {
    const list = getMemberships();
    if (!list.length || !booking) return null;
    if (kind === 'travel') {
        const t = booking;
        const code = String(t.bookingNumber || '').trim().toUpperCase().match(/^([A-Z0-9]{2})\s?\d{1,4}[A-Z]?$/);
        const text = `${t.notes || ''} ${t.bookingNumber || ''}`.toLowerCase();
        return list.find(m => {
            const p = programInfo(m.program);
            if (!p) return false;
            if (t.method === 'train' && p.kind === 'rail') return true;
            return (code && (p.codes || []).includes(code[1])) || (p.words || []).some(w => text.includes(w));
        }) || null;
    }
    const name = ` ${String(booking.name || '').toLowerCase()} `;
    return list.find(m => {
        const p = programInfo(m.program);
        return p && p.kind === 'hotel' && p.words.some(w => name.includes(w));
    }) || null;
}

export function membershipChipHTML(m) {
    if (!m) return '';
    return `<button type="button" class="member-chip" onclick="copyMembershipNumber('${escapeJS(m.number)}')" title="Copy your member number">
        ${icon('user')}<span><small>${escapeHTML(m.program)}</small><strong>${escapeHTML(m.number)}</strong></span>${icon('copy')}
    </button>`;
}

export async function copyMembershipNumber(number) {
    try {
        await navigator.clipboard.writeText(String(number));
        showNotification('Member number copied');
    } catch (e) {
        showNotification(String(number), 4000);
    }
    triggerHaptic('light');
}

/* ---------- Settings: the list ---------- */
export function renderMembershipsSettings() {
    const box = document.getElementById('memberships-settings');
    if (!box) return;
    const list = getMemberships();
    box.innerHTML = `
        ${list.length ? list.map((m, i) => `
            <div class="member-row">
                <div><strong>${escapeHTML(m.program)}</strong><span>${escapeHTML(m.number)}</span></div>
                <button type="button" class="budget-icon-btn" aria-label="Copy ${escapeHTML(m.program)} number" onclick="copyMembershipNumber('${escapeJS(m.number)}')">${icon('copy', 'ico-only')}</button>
                <button type="button" class="budget-icon-btn" aria-label="Remove ${escapeHTML(m.program)}" onclick="removeMembership(${i})">${icon('trash', 'ico-only')}</button>
            </div>`).join('') : '<p class="member-empty">None yet. They show up on matching flights and stays, ready to copy at check-in.</p>'}
        <div class="member-add">
            <input type="text" id="member-program" class="form-control" list="member-program-list" placeholder="Program (e.g. Marriott Bonvoy)" autocomplete="off">
            <input type="text" id="member-number" class="form-control" placeholder="Member number" autocomplete="off" autocapitalize="characters">
            <button type="button" class="save-btn" onclick="addMembership()">${icon('plus')}Add</button>
        </div>
        <datalist id="member-program-list">${PROGRAMS.map(p => `<option value="${escapeHTML(p.name)}"></option>`).join('')}</datalist>`;
}

export function addMembership() {
    const program = (document.getElementById('member-program')?.value || '').trim().slice(0, 60);
    const number = (document.getElementById('member-number')?.value || '').trim().slice(0, 40);
    if (!program || !number) { showNotification('Add the program and your member number.'); return; }
    const known = programInfo(program);
    const list = getMemberships().filter(m => m.program.toLowerCase() !== (known ? known.name : program).toLowerCase());
    list.push({ program: known ? known.name : program, number });
    saveMemberships(list);
    triggerHaptic('success');
    renderMembershipsSettings();
}

// From a JSON backup: merged into what's on this device (same program = the backup's number)
export function restoreMemberships(list) {
    const incoming = (Array.isArray(list) ? list : []).filter(m => m && m.program && m.number)
        .map(m => ({ program: String(m.program).slice(0, 60), number: String(m.number).slice(0, 40) }));
    if (!incoming.length) return;
    const names = new Set(incoming.map(m => m.program.toLowerCase()));
    saveMemberships([...getMemberships().filter(m => !names.has(m.program.toLowerCase())), ...incoming]);
}

export function removeMembership(i) {
    const list = getMemberships();
    const m = list[i];
    if (!m || !confirm(`Remove your ${m.program} number?`)) return;
    list.splice(i, 1);
    saveMemberships(list);
    renderMembershipsSettings();
}
