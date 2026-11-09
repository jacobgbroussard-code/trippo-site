// Thrift & vintage: the shopping-bag button on the Daily and Wishlist maps shows second-hand / vintage / antique
// shops from OpenStreetMap (Overpass), and each one can be added to the day or saved to the Wishlist (Shopping).
// Needs the dev server on :8080 and the internet (Overpass). Uses a fresh Chrome profile, so no real trips are touched.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const OUT = path.join(__dirname, 'artifacts', 'thrift');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 9371;
const PROF = path.join(require('os').tmpdir(), 'trippo-chrome-prof-thrift');
fs.rmSync(PROF, { recursive: true, force: true });
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROF}`, '--window-size=390,844', '--no-first-run']);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`); if (!ok) fails++; };
(async () => {
    try {
        for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch (e) { await sleep(250); } }
        const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?http://127.0.0.1:8080/`, { method: 'PUT' })).json();
        const ws = new WebSocket(tab.webSocketDebuggerUrl);
        await new Promise(r => ws.onopen = r);
        let id = 1; const pending = new Map(); const errors = [];
        ws.onmessage = e => {
            const m = JSON.parse(e.data);
            if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
            if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        };
        const send = (method, params = {}) => new Promise(r => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
        const ev = async expr => {
            let r;
            for (let k = 0; k < 5; k++) { r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result) break; await sleep(800); }
            if (!r.result) throw new Error(JSON.stringify(r.error));
            if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
            return r.result.result.value;
        };
        const tap = async sel => {
            const r = await ev(`(() => { const b = document.querySelector('${sel}').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
            for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
        };
        const overlaps = sel => ev(`(() => { const el = document.querySelector('${sel}'); const a = el.getBoundingClientRect(); const root = el.closest('.map-container') || document; return [...root.querySelectorAll('.map-btn, .map-sub-back'), document.getElementById('universal-back-btn')].filter(b => b && b !== el && b.offsetParent).map(b => b.getBoundingClientRect()).some(b => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom); })()`);
        const shot = async name => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(s.result.data, 'base64')); };
        const waitFor = async (expr, ms = 45000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(500); } return false; };
        await send('Page.enable'); await send('Runtime.enable');
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
        await send('Page.reload', { ignoreCache: true });
        await waitFor(`typeof window.toggleExploreLayer === 'function' && !!window.trips`, 20000);
        await sleep(1200);

        // categories
        check('Shopping category', await ev(`window.normalizeCategory('Shopping') === 'Shopping' && window.normalizeCategory('🛍 Shopping') === 'Shopping' && window.getCategoryVisuals('Shopping').emoji === '🛍️'`));

        // Daily map in Shanghai (lots of vintage shops in OSM)
        await ev(`(() => {
            const t = window.trips[0];
            t.name = 'Thrift test';
            t.stops = [{ id: 'sha', name: 'Shanghai, China', lat: 31.2165, lon: 121.4450, nights: 3 }];
            t.places = [];
            window.setActiveTripId(t.id); window.saveTrips();
        })()`);
        await ev(`window.switchTab('places'); window.openPlacesForTrip(window.getActiveTrip().id); window.openPlacesCityView(0); 0`);
        await sleep(1500);
        check('bag button on Daily map', await ev(`!!document.getElementById('places-thrift-btn') && getComputedStyle(document.getElementById('places-thrift-btn')).display !== 'none'`));
        await ev(`window.placesMap.setView([31.2165, 121.4450], 15, { animate: false }); 0`);
        await sleep(600);
        // Shanghai comes from the layer's offline cache (same shape Overpass results are saved in), so this part
        // checks the pins / popup / Add to Day even when the public Overpass servers are busy
        await ev(`new Promise((resolve, reject) => {
            const req = indexedDB.open('trippo-explore', 1);
            req.onupgradeneeded = () => req.result.createObjectStore('kv');
            req.onsuccess = () => {
                const tx = req.result.transaction('kv', 'readwrite');
                const st = tx.objectStore('kv');
                st.put({ t: Date.now(), items: [[31.2171, 121.4452, 'Loki Love Vintage', '', 'vintage', 'Mo-Su 12:00-21:00', 'https://example.com', '68 Anfu Rd']] }, 'thrift:624:2428');
                st.put({ t: Date.now(), items: [[31.2160, 121.4512, '多抓鱼 循环商店', 'Duozhuayu Circular Store', 'thrift', '', '', '']] }, 'thrift:624:2429');
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => reject(tx.error);
            };
            req.onerror = () => reject(req.error);
        })`);
        check('Daily bag button clear of other buttons', !(await overlaps('#places-thrift-btn')));
        await tap('#places-thrift-btn');
        const gotPins = await waitFor(`document.querySelectorAll('#places-map .explore-pin').length > 0`);
        const dailyCount = await ev(`document.querySelectorAll('#places-map .explore-pin').length`);
        check('thrift shops show on Daily map (2 cached)', gotPins && dailyCount === 2, `${dailyCount} pins`);
        check('bag button lights up', await ev(`document.getElementById('places-thrift-btn').classList.contains('active-mode') && document.getElementById('places-thrift-btn').getAttribute('aria-pressed') === 'true'`));
        await shot('1-daily-map');
        // open the first pin, add it to the day
        await ev(`document.querySelector('#places-map .explore-pin').closest('.leaflet-marker-icon').click(); 0`);
        await sleep(600);
        const pop = await ev(`(() => { const p = document.querySelector('#places-map .explore-pop'); return p ? p.innerText.replace(/\\s+/g, ' ') : null; })()`);
        check('popup has Add to Day', !!pop && /Add to Day 1/.test(pop), pop);
        await shot('2-daily-popup');
        await ev(`document.querySelector('#places-map .explore-pop-add').click(); 0`);
        await sleep(500);
        const added = await ev(`(window.getActiveTrip().places || []).map(p => ({ name: p.name, cat: p.category, day: p.dayIndex }))`);
        check('added to Day 1 as Shopping', added.length === 1 && added[0].cat === '🛍 Shopping' && added[0].day === 0, JSON.stringify(added));
        // turning it off clears the pins
        await ev(`document.getElementById('places-thrift-btn').click(); 0`);
        await sleep(300);
        check('off clears pins', (await ev(`document.querySelectorAll('#places-map .explore-pin').length`)) === 0);

        // Wishlist map in Lafayette
        await ev(`window.switchTab('wishlist'); window.openWishlistDetail('master'); 0`);
        await sleep(1500);
        check('bag button on Wishlist map', await ev(`!!document.getElementById('wishlist-thrift-btn') && document.getElementById('wishlist-thrift-btn').getBoundingClientRect().width > 0`));
        check('Wishlist bag button clear of other buttons', !(await overlaps('#wishlist-thrift-btn')));
        await ev(`window.wishlistMap.setView([30.2241, -92.0198], 13, { animate: false }); 0`);
        await sleep(600);
        await tap('#wishlist-thrift-btn');
        await sleep(1500);
        check('tapping the bag does not drop a wishlist pin', await ev(`!document.querySelector('#wishlist-map .leaflet-popup')`));
        // live data: the public Overpass servers are often at capacity; the layer retries after a minute
        const gotW = await waitFor(`document.querySelectorAll('#wishlist-map .explore-pin').length > 0`, 110000);
        if (gotW) check('thrift shops show on Wishlist map (Lafayette, live)', true, `${await ev(`document.querySelectorAll('#wishlist-map .explore-pin').length`)} pins`);
        else console.log('SKIP live Overpass check: the public servers did not answer (the cached Shanghai part above covers the code)');
        await shot('3-wishlist-map');
        if (gotW) {
            await ev(`document.querySelector('#wishlist-map .explore-pin').closest('.leaflet-marker-icon').click(); 0`);
            await sleep(600);
            await shot('4-wishlist-popup');
            const before = await ev(`window.wishlistPins.length`);
            await ev(`document.querySelector('#wishlist-map .explore-pop-add').click(); 0`);
            await sleep(500);
            const pin = await ev(`window.wishlistPins[window.wishlistPins.length - 1]`);
            check('saved to Wishlist as Shopping', (await ev(`window.wishlistPins.length`)) === before + 1 && pin.category === 'Shopping', JSON.stringify(pin).slice(0, 200));
            await ev(`window.filterWishlistCategory('Shopping'); 0`);
            await sleep(500);
            check('Shopping filter tab works', await ev(`!!document.querySelector('#wishlist-filter-row .day-tab.active[data-category="Shopping"]')`));
        }
        check('no page errors', !errors.filter(e => !/ServiceWorker/.test(e)).length, JSON.stringify(errors));
    } catch (e) { console.error(e); fails++; } finally { chrome.kill(); console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0); }
})();
