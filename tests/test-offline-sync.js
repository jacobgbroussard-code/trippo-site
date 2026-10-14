// Offline-first cloud sync (js/sync.js) against an in-memory fake Supabase backend.
// Runs inside the real app in headless Chrome; no real account or network needed.
// Usage: node dev-server.js (port 8080), then: node tests/test-offline-sync.js
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_offline_sync');
const PORT = 9341;
fs.mkdirSync(USER_DATA_DIR, { recursive: true });

// Everything below runs in the page
const HARNESS = String.raw`(async () => {
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, cond, detail) => results.push({ name, pass: !!cond, detail: cond ? undefined : detail });

// ---------- fake Supabase tables ----------
function makeBackend({ fullSchema }) {
    const tables = { trips: [], wishlist: [], wishlist_collections: [] };
    const calls = [];
    const columns = {
        trips: ['id', 'user_id', 'name', 'start_date', 'stops', 'places', 'updated_at'].concat(fullSchema ? ['data'] : []),
        wishlist: ['id', 'user_id', 'name', 'category', 'lat', 'lon', 'notes'].concat(fullSchema ? ['data', 'wishlist_id'] : [])
    };
    function from(table) {
        const q = { table, filters: [] };
        const exec = () => {
            if (table === 'wishlist_collections' && !fullSchema) return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.wishlist_collections' in the schema cache" } };
            let rows = tables[table].filter(r => q.filters.every(([k, op, v]) => op === 'eq' ? r[k] === v : v.map(String).includes(String(r[k]))));
            if (q.op === 'select') return { data: rows.map(r => JSON.parse(JSON.stringify(r))), error: null };
            if (q.op === 'delete') {
                tables[table] = tables[table].filter(r => !rows.includes(r));
                calls.push({ table, op: 'delete', ids: rows.map(r => r.id) });
                return { data: null, error: null };
            }
            if (q.op === 'upsert') {
                const cols = columns[table];
                if (cols) for (const row of q.rows) for (const k of Object.keys(row)) {
                    if (!cols.includes(k)) return { data: null, error: { code: 'PGRST204', message: "Could not find the '" + k + "' column of '" + table + "' in the schema cache" } };
                }
                calls.push({ table, op: 'upsert', ids: q.rows.map(r => r.id), hasData: q.rows.every(r => 'data' in r) });
                for (const row of q.rows) {
                    const key = table === 'wishlist_collections' ? r => r.id === row.id && r.user_id === row.user_id : r => r.id === row.id;
                    const i = tables[table].findIndex(key);
                    const copy = JSON.parse(JSON.stringify(row));
                    if (i >= 0) tables[table][i] = { ...tables[table][i], ...copy }; else tables[table].push(copy);
                }
                return { data: null, error: null };
            }
        };
        const builder = {
            select() { q.op = 'select'; return builder; },
            delete() { q.op = 'delete'; return builder; },
            upsert(rows) { q.op = 'upsert'; q.rows = Array.isArray(rows) ? rows : [rows]; return builder; },
            eq(k, v) { q.filters.push([k, 'eq', v]); return builder; },
            in(k, v) { q.filters.push([k, 'in', v]); return builder; },
            then(res, rej) { return Promise.resolve(exec()).then(res, rej); }
        };
        return builder;
    }
    return { tables, calls, from };
}

const sync = await import('/js/sync.js');
const S = await import('/js/state.js'); // live bindings (window.trips is a startup snapshot)
// Let the app's own startup session check finish first (it sets the signed-out UI)
await getSupabase().auth.getSession();
for (let i = 0; i < 40 && document.getElementById('sidebar-auth-form')?.style.display !== 'block'; i++) await sleep(100);
await sleep(300);
const client = getSupabase();
const realFrom = client.from.bind(client);
const USER = { id: 'user-123', email: 'test@example.com', user_metadata: { full_name: 'Test User' } };
const names = () => S.trips.map(t => t.name);

// ---------- 1. legacy schema, first sign-in on a device that already has trips ----------
localStorage.removeItem('trippo_sync_v1');
let be = makeBackend({ fullSchema: false });
client.from = be.from;
be.tables.trips.push(
    { id: 'tA', user_id: USER.id, name: 'Japan (cloud old)', start_date: '2027-03-01', stops: [{ name: 'Tokyo', nights: 2 }], places: [] },
    { id: 'tB', user_id: USER.id, name: 'Peru', start_date: null, stops: [{ name: 'Lima', nights: 3 }], places: [] }
);
S.setTrips([
    { id: 'tA', name: 'Japan', startDate: '2027-03-01', stops: [{ name: 'Tokyo', nights: 4 }], places: [], expenses: [{ id: 'e1', amount: 900 }], budgetTravelers: 3 },
    { id: 'tC', name: 'Iceland', startDate: '', stops: [], places: [] },
    { id: 'sample-trip-asia-2026', name: 'Asia Adventure', isExample: true, stops: [], places: [] }
]);
updateAuthUI(USER);
await sync.syncNow();
check('First sync keeps local order, appends cloud-only trip, drops sample', JSON.stringify(names()) === JSON.stringify(['Japan', 'Iceland', 'Peru']), names());
check('Local edits win over older cloud copy', S.trips[0].stops[0].nights === 4 && S.trips[0].expenses.length === 1, S.trips[0]);
check('Legacy schema: data column dropped, trips still uploaded', be.calls.some(c => c.table === 'trips' && c.op === 'upsert' && c.ids.includes('tC') && !c.hasData), be.calls);
check('Cloud-only trip gets local-only defaults', Array.isArray(S.trips[2].expenses), S.trips[2]);
check('Collections skipped while table is missing', JSON.parse(localStorage.getItem('trippo_sync_v1')).schema.cols === false);
check('Saved to phone storage', JSON.parse(localStorage.getItem('myTrips')).length === 3);

// ---------- 2. edit one trip -> only that one uploads ----------
be.calls.length = 0;
S.trips[1].name = 'Iceland Ring Road';
await sync.syncNow({ pullFirst: false });
const up = be.calls.filter(c => c.op === 'upsert' && c.table === 'trips');
check('Only the edited trip is uploaded', up.length === 1 && JSON.stringify(up[0].ids) === '["tC"]', be.calls);

// ---------- 3. delete locally -> deleted in cloud ----------
be.calls.length = 0;
S.setTrips(S.trips.filter(t => t.id !== 'tA'));
await sync.syncNow({ pullFirst: false });
check('Local delete removes the cloud row', !be.tables.trips.some(r => r.id === 'tA') && be.calls.some(c => c.op === 'delete' && c.ids.includes('tA')), be.calls);

// ---------- 4. another device deletes / renames ----------
be.tables.trips = be.tables.trips.filter(r => r.id !== 'tB');
be.tables.trips.find(r => r.id === 'tC').name = 'Iceland (renamed on laptop)';
await sync.syncNow();
check('Trip deleted on another device disappears here', !S.trips.some(t => t.id === 'tB'), names());
check('Clean trip picks up rename from another device', S.trips.some(t => t.name === 'Iceland (renamed on laptop)'), names());

// ---------- 5. offline edits queue up, then sync when back online ----------
const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
be.calls.length = 0;
S.trips.push({ id: 'tD', name: 'Offline idea', startDate: '', stops: [], places: [] });
saveTrips();
await sleep(1800);
check('Offline: nothing sent, change counted as pending', be.calls.length === 0 && sync.pendingChangeCount() >= 1, { calls: be.calls, pending: sync.pendingChangeCount() });
check('Offline badge shown', /Offline/.test(document.getElementById('cloud-status-badge').innerText), document.getElementById('cloud-status-badge').innerText);
delete navigator.onLine;
if (desc) Object.defineProperty(Navigator.prototype, 'onLine', desc);
await sync.syncNow();
check('Back online: queued trip uploaded', be.tables.trips.some(r => r.id === 'tD'), be.tables.trips.map(r => r.id));
check('Nothing left pending after sync', sync.pendingChangeCount() === 0, sync.pendingChangeCount());

// ---------- 6. full schema (migration run): whole S.trips + collections ----------
const before = JSON.parse(JSON.stringify(S.trips));
const be2 = makeBackend({ fullSchema: true });
be2.tables.trips = JSON.parse(JSON.stringify(be.tables.trips));
client.from = be2.from;
const st = JSON.parse(localStorage.getItem('trippo_sync_v1')); st.schema = {}; st.trips = {}; localStorage.setItem('trippo_sync_v1', JSON.stringify(st));
S.trips[0].expenses = [{ id: 'e9', amount: 42 }];
await sync.syncNow();
const rowD = be2.tables.trips.find(r => r.id === S.trips[0].id);
check('Full schema: whole trip stored in data column', rowD && rowD.data && Array.isArray(rowD.data.expenses) && rowD.data.expenses[0].amount === 42, rowD);
check('Full schema: wishlist lists uploaded', be2.tables.wishlist_collections.some(r => r.id === 'master' && r.user_id === USER.id), be2.tables.wishlist_collections);
// a second device pulling gets the whole trip back
S.setTrips([]); localStorage.removeItem('trippo_sync_v1');
await sync.syncNow();
check('Fresh device restores whole trips from cloud', S.trips.length === before.length && S.trips.some(t => t.expenses && t.expenses[0] && t.expenses[0].amount === 42), names());

client.from = realFrom;
updateAuthUI(null);
return results;
})()`;

async function main() {
    const chrome = spawn(CHROME_PATH, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DATA_DIR}`, '--disable-gpu', '--no-first-run', '--no-default-browser-check']);
    await new Promise(r => setTimeout(r, 1500));
    let exitCode = 1;
    try {
        // Wait for headless Chrome to start listening instead of trusting a fixed sleep.
        for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch (e) { await new Promise(r => setTimeout(r, 250)); } }
        const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?http://127.0.0.1:8080/`, { method: 'PUT' })).json();
        const ws = new WebSocket(tab.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        let id = 1; const pending = new Map(); const pageErrors = [];
        ws.onmessage = e => {
            const m = JSON.parse(e.data);
            if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
            else if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
        };
        const send = (method, params = {}) => new Promise(res => { const i = id++; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
        await send('Runtime.enable');
        await send('Runtime.evaluate', { expression: 'localStorage.clear(); true' });
        await send('Page.reload', { ignoreCache: true });
        for (let i = 0; i < 40; i++) {
            const r = await send('Runtime.evaluate', { expression: `typeof window.getSupabase === 'function' && !!window.getSupabase() && typeof window.saveTrips === 'function'`, returnByValue: true });
            if (r.result?.result?.value) break;
            await new Promise(r => setTimeout(r, 250));
        }
        const r = await send('Runtime.evaluate', { expression: HARNESS, awaitPromise: true, returnByValue: true });
        if (!r.result) throw new Error('CDP error: ' + JSON.stringify(r.error || r));
        if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
        const results = r.result.result.value;
        console.log('=== OFFLINE-FIRST SYNC ===');
        results.forEach(t => console.log(`  ${t.pass ? '✅' : '❌'} ${t.name}`, t.pass ? '' : JSON.stringify(t.detail).slice(0, 400)));
        if (pageErrors.length) console.log('Page errors:', pageErrors);
        const passed = results.filter(t => t.pass).length;
        console.log(`Results: ${passed}/${results.length} passed`);
        exitCode = passed === results.length && pageErrors.length === 0 ? 0 : 1;
        ws.close();
    } catch (e) {
        console.error('Test error:', e);
    }
    chrome.kill();
    process.exit(exitCode);
}

main();
