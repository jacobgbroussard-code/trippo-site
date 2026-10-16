/* ==========================================================================
   TRIP DOCUMENTS: boarding passes, tickets, hotel confirmations and visas attached to a
   flight, a stay or the whole trip. Kept in IndexedDB on this device (works offline); they
   aren't part of cloud sync or the JSON backup.
   ========================================================================== */
import { getActiveTrip, escapeHTML, escapeJS, icon, showNotification, triggerHaptic } from './state.js';
import { membershipFor, membershipChipHTML } from './memberships.js';

const DB_NAME = 'trippo-docs';
const MAX_BYTES = 20 * 1024 * 1024;
let dbPromise = null;

function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') { reject(new Error('no IndexedDB')); return; }
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            const store = req.result.createObjectStore('docs', { keyPath: 'id' });
            store.createIndex('owner', 'owner');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    }).catch(e => { dbPromise = null; throw e; });
    return dbPromise;
}

async function tx(mode, fn) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const t = db.transaction('docs', mode);
        const out = fn(t.objectStore('docs'));
        t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
    });
}

export const docOwner = (tripId, kind, stopId) => (kind === 'trip' ? `${tripId}|trip` : `${tripId}|${kind}|${stopId}`);

export async function listDocs(owner) {
    try {
        const docs = await tx('readonly', s => s.index('owner').getAll(owner));
        return (docs || []).sort((a, b) => a.added - b.added);
    } catch (e) { return []; }
}

async function getDoc(id) {
    try { return await tx('readonly', s => s.get(id)); } catch (e) { return null; }
}

const fileIcon = d => (String(d.type).startsWith('image/') ? 'photo' : 'file');
const fmtSize = n => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/* ---------- the Documents section (in the flight, stay and trip forms) ---------- */
export async function renderDocsSection(boxId, owner) {
    const box = document.getElementById(boxId);
    if (!box) return;
    box.dataset.owner = owner;
    const docs = await listDocs(owner);
    if (box.dataset.owner !== owner) return; // a different form opened meanwhile
    box.innerHTML = `
        <div class="docs-head">${icon('paperclip')}<strong>Documents</strong><span>On this device only</span></div>
        <div class="docs-list">
            ${docs.map(d => `
                <div class="doc-chip">
                    <button type="button" class="doc-open" onclick="openTripDoc('${escapeJS(d.id)}')">${icon(fileIcon(d))}<span>${escapeHTML(d.name)}</span><small>${fmtSize(d.size)}</small></button>
                    <button type="button" class="doc-remove" aria-label="Remove ${escapeHTML(d.name)}" onclick="removeTripDoc('${escapeJS(d.id)}', '${escapeJS(boxId)}')">${icon('x', 'ico-only')}</button>
                </div>`).join('')}
            <label class="doc-add">${icon('plus')}${docs.length ? 'Add' : 'Add boarding pass, ticket or PDF'}
                <input type="file" accept="image/*,application/pdf" multiple hidden data-box="${escapeHTML(boxId)}" onchange="addTripDocs(this)">
            </label>
        </div>`;
}

export async function addTripDocs(input) {
    const box = document.getElementById(input.dataset.box);
    const owner = box && box.dataset.owner;
    const files = [...(input.files || [])];
    input.value = '';
    if (!owner || !files.length) return;
    let added = 0;
    for (const f of files) {
        if (!/^image\/|^application\/pdf$/.test(f.type)) { showNotification(`${f.name}: only photos and PDFs`); continue; }
        if (f.size > MAX_BYTES) { showNotification(`${f.name} is over 20 MB`); continue; }
        const doc = { id: `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`, owner, name: f.name || 'Document', type: f.type, size: f.size, added: Date.now(), blob: f };
        try { await tx('readwrite', s => s.put(doc)); added++; } catch (e) { showNotification('Couldn’t save that file on this device.'); break; }
    }
    if (added) { triggerHaptic('success'); showNotification(added === 1 ? 'Document saved' : `${added} documents saved`); }
    renderDocsSection(box.id, owner);
}

export async function removeTripDoc(id, boxId) {
    const d = await getDoc(id);
    if (!d || !confirm(`Remove ${d.name} from this device?`)) return;
    try { await tx('readwrite', s => s.delete(id)); } catch (e) { /* ignore */ }
    const box = document.getElementById(boxId);
    if (box && box.dataset.owner) renderDocsSection(boxId, box.dataset.owner);
}

/* ---------- viewer ---------- */
let viewerUrl = '';
export function closeTripDoc() {
    const v = document.getElementById('doc-viewer');
    if (v) v.remove();
    if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = ''; }
}

export async function openTripDoc(id) {
    const d = await getDoc(id);
    if (!d || !d.blob) { showNotification('That document isn’t on this device.'); return; }
    closeTripDoc();
    viewerUrl = URL.createObjectURL(d.blob);
    const isImage = String(d.type).startsWith('image/');
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [new File([d.blob], d.name, { type: d.type })] }));
    const v = document.createElement('div');
    v.id = 'doc-viewer';
    v.className = 'doc-viewer';
    v.setAttribute('role', 'dialog');
    v.setAttribute('aria-label', d.name);
    v.innerHTML = `
        <div class="doc-viewer-bar">
            <strong>${escapeHTML(d.name)}</strong>
            ${canShare ? `<button type="button" onclick="shareTripDoc('${escapeJS(id)}')">${icon('share')}Share</button>` : ''}
            <a href="${viewerUrl}" download="${escapeHTML(d.name)}" target="_blank" rel="noopener">${icon('download')}Open</a>
            <button type="button" aria-label="Close" onclick="closeTripDoc()">${icon('x', 'ico-only')}</button>
        </div>
        <div class="doc-viewer-body">${isImage ? `<img src="${viewerUrl}" alt="${escapeHTML(d.name)}">` : `<iframe src="${viewerUrl}" title="${escapeHTML(d.name)}"></iframe>`}</div>`;
    v.addEventListener('click', e => { if (e.target === v || e.target.classList.contains('doc-viewer-body')) closeTripDoc(); });
    document.body.appendChild(v);
}

export async function shareTripDoc(id) {
    const d = await getDoc(id);
    if (!d) return;
    try { await navigator.share({ files: [new File([d.blob], d.name, { type: d.type })], title: d.name }); } catch (e) { /* cancelled */ }
}

/* ---------- extras under the flight / stay forms and the trip details ---------- */
// kind: 'travel' (leg leaving stop `index`) or 'stay'
export function renderBookingExtras(kind, index) {
    const trip = getActiveTrip();
    const stop = trip && trip.stops && trip.stops[index];
    const boxId = kind === 'travel' ? 'transit-extras' : 'lodging-extras';
    const box = document.getElementById(boxId);
    if (!box || !stop) return;
    const booking = kind === 'travel' ? (stop.transit || {}) : (stop.lodging || { name: '' });
    box.innerHTML = `<div id="${boxId}-member">${membershipChipHTML(membershipFor(kind, booking))}</div><div id="${boxId}-docs" class="docs-box"></div>`;
    renderDocsSection(`${boxId}-docs`, docOwner(trip.id, kind, stop.id));
}

export function renderTripDocs(tripId) {
    const box = document.getElementById('trip-docs-extras');
    if (!box || !tripId) return;
    box.innerHTML = '<div id="trip-docs-box" class="docs-box"></div>';
    renderDocsSection('trip-docs-box', docOwner(tripId, 'trip'));
}

// How many documents are attached to a leg / stay (for the Today travel card)
export async function docsCount(owner) {
    try { return await tx('readonly', s => s.index('owner').count(owner)); } catch (e) { return 0; }
}

// Open the first document of a leg straight away (boarding pass at the gate)
export async function openFirstDoc(owner) {
    const docs = await listDocs(owner);
    if (docs.length === 1) openTripDoc(docs[0].id);
    else if (docs.length) { showNotification(`${docs.length} documents: opening the first. The rest are in the booking.`); openTripDoc(docs[0].id); }
}
