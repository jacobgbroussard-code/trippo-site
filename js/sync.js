/* ==========================================================================
   Trippo Travel Planner - Offline-First Cloud Sync
   js/sync.js

   The phone (localStorage) is the source of truth. The cloud is a backup that
   catches up whenever there's a connection:
   - Every change is detected by comparing each item's content hash with the hash
     last confirmed in the cloud (trippo_sync_v1). Unsynced items stay "dirty"
     until an upload succeeds, so nothing is lost while offline.
   - Deletions are detected the same way (synced before, gone locally now).
   - Sync runs after edits (debounced), on app start / sign-in, when the app comes
     back to the foreground, and the moment the device goes back online.

   Cloud schema: full objects go in a `data` jsonb column when it exists (see
   supabase/full-sync-migration.sql). Without it, only the legacy columns are
   synced and every other field is preserved from the local copy.
   ========================================================================== */

import {
    trips,
    setTrips,
    wishlistPins,
    setWishlistPins,
    wishlistCollections,
    setWishlistCollections,
    safeGetStorage,
    safeSetStorage
} from './state.js';
import { getSupabase, currentUser } from './db.js';

const STATE_KEY = 'trippo_sync_v1';
const PUSH_DELAY_MS = 1500;

let pushTimer = null;
let syncing = false;
let rerunRequested = false;
let statusListener = null;

// ---------- helpers ----------

function hashOf(obj) {
    const s = JSON.stringify(obj);
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return String(h >>> 0) + ':' + s.length;
}

function loadState() {
    let st = null;
    try { st = JSON.parse(safeGetStorage(STATE_KEY, 'null')); } catch (e) {}
    if (!st || typeof st !== 'object') st = {};
    st.trips = st.trips || {};
    st.pins = st.pins || {};
    st.cols = st.cols || {};
    st.schema = st.schema || {};
    return st;
}

function saveState(st) {
    safeSetStorage(STATE_KEY, JSON.stringify(st));
}

const isSample = t => t && t.isExample && t.id === 'sample-trip-asia-2026';
const isMissingColumn = (err, col) => !!err && /column|schema cache/i.test(err.message || '') && (err.message || '').includes(col);
const isMissingTable = err => !!err && (err.code === '42P01' || err.code === 'PGRST205' || /relation .* does not exist|Could not find the table/i.test(err.message || ''));
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

function setStatus(status, detail = '') {
    if (statusListener) {
        try { statusListener(status, detail); } catch (e) {}
    }
}

export function onSyncStatus(fn) {
    statusListener = fn;
}

/** Number of local items waiting to be uploaded (for the status badge). */
export function pendingChangeCount() {
    const st = loadState();
    let n = 0;
    trips.filter(t => !isSample(t)).forEach(t => { if (st.trips[t.id] !== hashOf(t)) n++; });
    Object.keys(st.trips).forEach(id => { if (!trips.some(t => t.id === id)) n++; });
    wishlistPins.forEach(p => { if (st.pins[p.id] !== hashOf(p)) n++; });
    Object.keys(st.pins).forEach(id => { if (!wishlistPins.some(p => p.id === id)) n++; });
    if (st.schema.cols === true) {
        wishlistCollections.forEach(c => { if (st.cols[c.id] !== hashOf(c)) n++; });
    }
    return n;
}

// ---------- local persistence without re-triggering a push ----------

function persistLocal() {
    safeSetStorage('myTrips', JSON.stringify(trips));
    safeSetStorage('myWishlist', JSON.stringify(wishlistPins));
    safeSetStorage('myWishlistCollections', JSON.stringify(wishlistCollections));
}

function logSync(message) {
    console.log('[Trippo Sync]', message);
    try {
        const log = JSON.parse(localStorage.getItem('trippo_auth_log') || '[]');
        log.push(`${new Date().toISOString()} ${message}`);
        localStorage.setItem('trippo_auth_log', JSON.stringify(log.slice(-15)));
    } catch (e) {}
}

function rerender() {
    try { if (window.renderHome) window.renderHome(); } catch (e) { logSync(`Trips page render failed: ${e?.message || e}`); }
    try {
        const wishDetail = document.getElementById('wishlist-detail-view');
        if (wishDetail && wishDetail.style.display === 'flex') {
            if (window.renderWishlistPins) window.renderWishlistPins(false);
        } else if (window.renderWishlistCollections) {
            window.renderWishlistCollections();
        }
    } catch (e) {}
}

// ---------- row mapping ----------

function tripToRow(trip, userId, withData) {
    const row = {
        id: trip.id,
        user_id: userId,
        name: trip.name,
        start_date: trip.startDate || null,
        stops: trip.stops || [],
        places: trip.places || [],
        updated_at: new Date().toISOString()
    };
    if (withData) row.data = trip;
    return row;
}

function rowToTrip(row, localTrip) {
    if (row.data && typeof row.data === 'object') return { ...row.data, id: row.id };
    // Legacy row (no `data` column): keep every field the cloud doesn't store from the local copy
    return {
        budgetTravelers: 2,
        expenses: [],
        ...(localTrip || {}),
        id: row.id,
        name: row.name,
        startDate: row.start_date || '',
        stops: row.stops || [],
        places: row.places || [],
        isExample: false
    };
}

function pinToRow(pin, userId, schema) {
    const row = {
        id: pin.id,
        user_id: userId,
        name: pin.name,
        category: pin.category,
        lat: pin.lat,
        lon: pin.lon,
        notes: pin.notes || ''
    };
    if (schema.wishCollection !== false) row.wishlist_id = pin.wishlistId || 'master';
    if (schema.wishData !== false) row.data = pin;
    return row;
}

function rowToPin(row, localPin) {
    if (row.data && typeof row.data === 'object') return { ...row.data, id: row.id };
    return {
        ...(localPin || {}),
        id: row.id,
        wishlistId: row.wishlist_id || localPin?.wishlistId || 'master',
        name: row.name,
        category: row.category,
        lat: row.lat,
        lon: row.lon,
        notes: row.notes
    };
}

// ---------- pull (cloud -> phone) ----------

/**
 * Merge a cloud list into the local list.
 * - local edits not yet uploaded (dirty) always win
 * - clean local items take the cloud version (edited on another device)
 * - items deleted locally but not yet deleted in the cloud stay deleted
 * - clean items that vanished from the cloud were deleted elsewhere -> remove locally
 * - local order is preserved; new cloud items are appended
 */
function mergeList(localList, cloudRows, syncedHashes, toLocal, skipLocal = () => false) {
    const cloudById = new Map(cloudRows.map(r => [String(r.id), r]));
    const result = [];

    localList.forEach(item => {
        if (skipLocal(item)) { result.push(item); return; }
        const id = String(item.id);
        const row = cloudById.get(id);
        const dirty = syncedHashes[id] !== hashOf(item);
        if (row) {
            if (dirty) {
                result.push(item);
            } else {
                const fresh = toLocal(row, item);
                syncedHashes[id] = hashOf(fresh);
                result.push(fresh);
            }
            cloudById.delete(id);
        } else if (syncedHashes[id] !== undefined && !dirty) {
            delete syncedHashes[id]; // deleted on another device
        } else {
            result.push(item); // never uploaded (or edited since): keep, push later
        }
    });

    cloudById.forEach((row, id) => {
        const wasSyncedThenDeletedHere = syncedHashes[id] !== undefined;
        if (wasSyncedThenDeletedHere) return; // local delete pending upload
        const fresh = toLocal(row, null);
        syncedHashes[id] = hashOf(fresh);
        result.push(fresh);
    });

    return result;
}

async function pull(client, userId, st) {
    const { data: tripRows, error: tErr } = await client.from('trips').select('*').eq('user_id', userId);
    if (tErr) throw tErr;
    if (tripRows.length && tripRows.some(r => 'data' in r)) st.schema.tripsData = true;

    let merged = mergeList(trips, tripRows, st.trips, rowToTrip, isSample);
    // The bundled sample trip only makes sense on an empty account
    if (merged.some(t => !isSample(t))) merged = merged.filter(t => !isSample(t));
    setTrips(merged);

    const { data: pinRows, error: pErr } = await client.from('wishlist').select('*').eq('user_id', userId);
    if (pErr) throw pErr;
    setWishlistPins(mergeList(wishlistPins, pinRows, st.pins, rowToPin));

    if (st.schema.cols !== false) {
        const { data: colRows, error: cErr } = await client.from('wishlist_collections').select('*').eq('user_id', userId);
        if (cErr) {
            if (isMissingTable(cErr)) st.schema.cols = false; else throw cErr;
        } else {
            st.schema.cols = true;
            const merged = mergeList(wishlistCollections, colRows, st.cols, (row, local) => ({ ...(local || {}), ...(row.data || {}), id: row.id }));
            if (!merged.some(c => c.id === 'master')) merged.unshift({ id: 'master', name: '🌟 Master Wishlist', isMaster: true });
            setWishlistCollections(merged);
        }
    }

    persistLocal();
    rerender();
    logSync(`Synced: ${tripRows.length} trip(s) in cloud, ${trips.length} on this device`);
}

// ---------- push (phone -> cloud) ----------

async function upsertWithFallback(client, table, rows, dropOrder, schema) {
    // Retry without optional columns the database doesn't have yet
    let attempt = rows;
    for (let i = 0; i <= dropOrder.length; i++) {
        const { error } = await client.from(table).upsert(attempt);
        if (!error) return;
        const missing = dropOrder.find(([col]) => isMissingColumn(error, col) && attempt.some(r => col in r));
        if (!missing) throw error;
        const [col, flag] = missing;
        schema[flag] = false;
        attempt = attempt.map(r => { const c = { ...r }; delete c[col]; return c; });
    }
}

async function push(client, userId, st) {
    // Trips
    const localTrips = trips.filter(t => !isSample(t));
    const dirtyTrips = localTrips.filter(t => st.trips[t.id] !== hashOf(t));
    if (dirtyTrips.length) {
        const rows = dirtyTrips.map(t => tripToRow(t, userId, st.schema.tripsData !== false));
        await upsertWithFallback(client, 'trips', rows, [['data', 'tripsData']], st.schema);
        dirtyTrips.forEach(t => { st.trips[t.id] = hashOf(t); });
    }
    const deletedTrips = Object.keys(st.trips).filter(id => !trips.some(t => t.id === id));
    if (deletedTrips.length) {
        const { error } = await client.from('trips').delete().in('id', deletedTrips).eq('user_id', userId);
        if (error) throw error;
        deletedTrips.forEach(id => delete st.trips[id]);
    }

    // Wishlist pins
    const dirtyPins = wishlistPins.filter(p => st.pins[p.id] !== hashOf(p));
    if (dirtyPins.length) {
        const rows = dirtyPins.map(p => pinToRow(p, userId, st.schema));
        await upsertWithFallback(client, 'wishlist', rows, [['data', 'wishData'], ['wishlist_id', 'wishCollection']], st.schema);
        dirtyPins.forEach(p => { st.pins[p.id] = hashOf(p); });
    }
    const deletedPins = Object.keys(st.pins).filter(id => !wishlistPins.some(p => String(p.id) === id));
    if (deletedPins.length) {
        const { error } = await client.from('wishlist').delete().in('id', deletedPins).eq('user_id', userId);
        if (error) throw error;
        deletedPins.forEach(id => delete st.pins[id]);
    }

    // Wishlist collections (only once the table exists)
    if (st.schema.cols === true) {
        const dirtyCols = wishlistCollections.filter(c => st.cols[c.id] !== hashOf(c));
        if (dirtyCols.length) {
            const { error } = await client.from('wishlist_collections').upsert(
                dirtyCols.map(c => ({ id: c.id, user_id: userId, data: c, updated_at: new Date().toISOString() })),
                { onConflict: 'user_id,id' }
            );
            if (error) throw error;
            dirtyCols.forEach(c => { st.cols[c.id] = hashOf(c); });
        }
        const deletedCols = Object.keys(st.cols).filter(id => !wishlistCollections.some(c => c.id === id));
        if (deletedCols.length) {
            const { error } = await client.from('wishlist_collections').delete().in('id', deletedCols).eq('user_id', userId);
            if (error) throw error;
            deletedCols.forEach(id => delete st.cols[id]);
        }
    }
}

// ---------- public API ----------

/**
 * Full two-way sync: pull cloud changes, merge, then upload local changes.
 * Safe to call any time; does nothing when signed out or offline.
 */
export async function syncNow({ pullFirst = true } = {}) {
    const client = getSupabase();
    const user = currentUser;
    if (!client || !user || !user.id) return;
    if (isOffline()) { setStatus('offline'); return; }
    if (syncing) { rerunRequested = true; return; }

    syncing = true;
    setStatus('syncing');
    const st = loadState();
    if (st.userId && st.userId !== user.id) {
        // Different account on this device: start fresh so nothing is treated as already uploaded
        st.trips = {}; st.pins = {}; st.cols = {};
    }
    st.userId = user.id;

    try {
        if (pullFirst) await pull(client, user.id, st);
        await push(client, user.id, st);
        st.lastSyncedAt = new Date().toISOString();
        saveState(st);
        setStatus('synced');
    } catch (e) {
        saveState(st); // keep whatever succeeded
        console.warn('[Trippo Sync] Will retry when back online:', e?.message || e);
        setStatus(isOffline() || /fetch|network|load failed/i.test(e?.message || '') ? 'offline' : 'error', e?.message || String(e));
    } finally {
        syncing = false;
        if (rerunRequested) {
            rerunRequested = false;
            schedulePush();
        }
    }
}

/** Called after every local save: upload soon (debounced), or later once online. */
export function schedulePush() {
    clearTimeout(pushTimer);
    if (!currentUser) return;
    if (isOffline()) { setStatus('offline'); return; }
    pushTimer = setTimeout(() => syncNow({ pullFirst: false }), PUSH_DELAY_MS);
}

/** Forget sync bookkeeping (on sign-out) so the next account starts clean. */
export function resetSyncState() {
    clearTimeout(pushTimer);
    try { localStorage.removeItem(STATE_KEY); } catch (e) {}
}

let lastForegroundSync = 0;
export function initSyncTriggers(onBackOnline) {
    window.addEventListener('online', () => {
        if (onBackOnline) onBackOnline();
        else syncNow();
    });
    window.addEventListener('offline', () => setStatus('offline'));
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        const now = Date.now();
        if (now - lastForegroundSync < 30000) return;
        lastForegroundSync = now;
        syncNow();
    });
}
