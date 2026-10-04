const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_mobile_test');

if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

async function runMobileTest() {
    console.log('=== Running Mobile Map View & Fullscreen QA Suite ===\n');
    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=9229',
        `--user-data-dir=${USER_DATA_DIR}`,
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=390,844'
    ]);

    await new Promise(r => setTimeout(r, 1500));

    try {
        const newTabRes = await fetch('http://127.0.0.1:9229/json/new?http://127.0.0.1:8080/', { method: 'PUT' });
        const targetTab = await newTabRes.json();
        const ws = new WebSocket(targetTab.webSocketDebuggerUrl);

        let msgId = 1;
        const pending = new Map();
        function send(method, params = {}) {
            return new Promise((resolve, reject) => {
                const id = msgId++;
                pending.set(id, { resolve, reject });
                ws.send(JSON.stringify({ id, method, params }));
            });
        }

        const consoleLogs = [];
        const pageErrors = [];

        await new Promise((resolve, reject) => {
            ws.onopen = resolve;
            ws.onerror = reject;
        });

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.id && pending.has(msg.id)) {
                const { resolve, reject } = pending.get(msg.id);
                pending.delete(msg.id);
                if (msg.error) reject(msg.error);
                else resolve(msg.result);
            } else if (msg.method === 'Runtime.consoleAPICalled') {
                consoleLogs.push({ type: msg.params.type, args: msg.params.args.map(a => a.value || a.description) });
            } else if (msg.method === 'Runtime.exceptionThrown') {
                pageErrors.push(msg.params.exceptionDetails);
            }
        };

        await send('Page.enable');
        await send('Runtime.enable');
        await send('DOM.enable');

        await send('Emulation.setDeviceMetricsOverride', {
            width: 390,
            height: 844,
            deviceScaleFactor: 3,
            mobile: true,
            screenOrientation: { angle: 0, type: 'portraitPrimary' }
        });
        await send('Emulation.setTouchEmulationEnabled', { enabled: true });
        await send('Page.reload');

        console.log('Mobile device emulated (390x844). Waiting for initial load...');
        await new Promise(r => setTimeout(r, 2500));

        async function evalJs(expr) {
            const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
            if (res.exceptionDetails) {
                console.error('Eval error:', res.exceptionDetails);
                throw new Error(res.exceptionDetails.text);
            }
            return res.result.value;
        }

        // Test 1: Open Trip to Planner View
        console.log('Test 1: Opening first trip card...');
        const cardStatus = await evalJs(`
            (() => {
                const card = document.querySelector('.trip-card-content');
                const list = document.getElementById('trip-list');
                const tripsCount = window.trips ? window.trips.length : -1;
                const activeView = document.querySelector('.view.active')?.id;
                if (card) {
                    card.click();
                } else if (typeof openTrip === 'function' && window.trips && window.trips.length > 0) {
                    openTrip(window.trips[0].id);
                }
                return {
                    cardFound: !!card,
                    tripListHTML: list ? list.innerHTML.slice(0, 150) : null,
                    tripsCount,
                    activeView
                };
            })()
        `);
        console.log('Card Status:', cardStatus);
        await new Promise(r => setTimeout(r, 1500));

        const plannerInitial = await evalJs(`
            (() => {
                const mapEl = document.getElementById('planner-map');
                const sheet = document.querySelector('#planner-view .sheet');
                const btn = document.getElementById('planner-fullscreen-btn');
                return {
                    mapHeight: mapEl ? mapEl.offsetHeight : 0,
                    sheetHeight: sheet ? sheet.offsetHeight : 0,
                    btnText: btn ? btn.innerText.trim() : null
                };
            })()
        `);
        console.log('Planner Initial State:', plannerInitial);
        if (plannerInitial.mapHeight < 200 || !plannerInitial.btnText.includes('Full Map')) {
            throw new Error('Test 1 failed: Planner map did not initialize with Full Map button');
        }

        // Test 2: Toggle Planner to Full Map Mode
        console.log('Test 2: Clicking Full Map button in Planner...');
        await evalJs(`
            (() => {
                const btn = document.getElementById('planner-fullscreen-btn');
                if (btn) btn.click();
            })()
        `);
        await new Promise(r => setTimeout(r, 600));

        const plannerExpanded = await evalJs(`
            (() => {
                const view = document.getElementById('planner-view');
                const mapEl = document.getElementById('planner-map');
                const sheet = document.querySelector('#planner-view .sheet');
                const btn = document.getElementById('planner-fullscreen-btn');
                const collapsedBar = sheet ? sheet.querySelector('.sheet-collapsed-bar') : null;
                return {
                    hasExpandedClass: view.classList.contains('map-expanded'),
                    mapHeight: mapEl ? mapEl.offsetHeight : 0,
                    sheetHeight: sheet ? sheet.offsetHeight : 0,
                    btnText: btn ? btn.innerText.trim() : null,
                    collapsedBarVisible: collapsedBar ? window.getComputedStyle(collapsedBar).display !== 'none' : false
                };
            })()
        `);
        console.log('Planner Expanded State:', plannerExpanded);
        if (!plannerExpanded.hasExpandedClass || plannerExpanded.mapHeight < 690 || plannerExpanded.sheetHeight > 145) {
            throw new Error(`Test 2 failed: Map did not expand properly (${plannerExpanded.mapHeight}px) or sheet did not collapse (${plannerExpanded.sheetHeight}px)`);
        }

        // Save screenshot of Full Map Mode
        const ss1 = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(__dirname, 'mobile-full-map-planner.png'), Buffer.from(ss1.data, 'base64'));
        console.log('📸 Saved mobile-full-map-planner.png');

        // Test 3: Tap collapsed sheet bar to return to split view
        console.log('Test 3: Tapping collapsed sheet bar to restore split view...');
        await evalJs(`
            (() => {
                const bar = document.querySelector('#planner-view .sheet-collapsed-bar');
                if (bar) bar.click();
            })()
        `);
        await new Promise(r => setTimeout(r, 600));

        const plannerRestored = await evalJs(`
            (() => {
                const view = document.getElementById('planner-view');
                const mapEl = document.getElementById('planner-map');
                const sheet = document.querySelector('#planner-view .sheet');
                return {
                    hasExpandedClass: view.classList.contains('map-expanded'),
                    mapHeight: mapEl ? mapEl.offsetHeight : 0,
                    sheetHeight: sheet ? sheet.offsetHeight : 0
                };
            })()
        `);
        console.log('Planner Restored State:', plannerRestored);
        if (plannerRestored.hasExpandedClass || plannerRestored.mapHeight > 450) {
            throw new Error('Test 3 failed: Sheet did not expand back to split view');
        }

        // Test 4: Daily Planner tab with Quick Map shortcut
        console.log('Test 4: Navigating to Daily Planner tab...');
        await evalJs(`
            (() => {
                const nav = document.getElementById('nav-places');
                if (nav) nav.click();
            })()
        `);
        await new Promise(r => setTimeout(r, 800));

        const quickMapCheck = await evalJs(`
            (() => {
                const quickCard = document.querySelector('#places-trip-list [onclick*="openPlacesCityView"]');
                return {
                    hasQuickMapCard: Boolean(quickCard),
                    cardText: quickCard ? quickCard.innerText : null
                };
            })()
        `);
        console.log('Quick Map Shortcut in Daily Planner:', quickMapCheck);
        if (!quickMapCheck.hasQuickMapCard) {
            throw new Error('Test 4 failed: Quick map shortcut card not found in Daily master list');
        }

        // Click Quick Map Card to jump directly to city view
        console.log('Clicking Quick Map shortcut to jump directly to city map...');
        await evalJs(`
            (() => {
                const quickCard = document.querySelector('#places-trip-list [onclick*="openPlacesCityView"]');
                if (quickCard) quickCard.click();
            })()
        `);
        await new Promise(r => setTimeout(r, 1000));

        const cityViewCheck = await evalJs(`
            (() => {
                const cityView = document.getElementById('places-city-view');
                const mapEl = document.getElementById('places-map');
                const btn = document.getElementById('places-fullscreen-btn');
                return {
                    cityViewDisplay: cityView ? cityView.style.display : null,
                    mapHeight: mapEl ? mapEl.offsetHeight : 0,
                    btnText: btn ? btn.innerText.trim() : null
                };
            })()
        `);
        console.log('Places City View State:', cityViewCheck);
        if (cityViewCheck.cityViewDisplay !== 'flex' || cityViewCheck.mapHeight < 200) {
            throw new Error('Test 4 failed: Places city view not displayed with map');
        }

        // Test 5: Fullscreen Map in Daily Planner
        console.log('Test 5: Expanding map in Daily Planner city view...');
        await evalJs(`
            (() => {
                const btn = document.getElementById('places-fullscreen-btn');
                if (btn) btn.click();
            })()
        `);
        await new Promise(r => setTimeout(r, 600));

        const cityExpandedCheck = await evalJs(`
            (() => {
                const cityView = document.getElementById('places-city-view');
                const mapEl = document.getElementById('places-map');
                const sheet = document.querySelector('#places-city-view .sheet');
                return {
                    hasExpandedClass: cityView.classList.contains('map-expanded'),
                    mapHeight: mapEl ? mapEl.offsetHeight : 0,
                    sheetHeight: sheet ? sheet.offsetHeight : 0
                };
            })()
        `);
        console.log('Places City View Expanded State:', cityExpandedCheck);
        if (!cityExpandedCheck.hasExpandedClass || cityExpandedCheck.mapHeight < 690) {
            throw new Error('Test 5 failed: Daily city map did not expand to full screen');
        }

        const ss2 = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(__dirname, 'mobile-full-map-places.png'), Buffer.from(ss2.data, 'base64'));
        console.log('📸 Saved mobile-full-map-places.png');

        // Test 6: Wishlist Map Fullscreen
        console.log('Test 6: Testing Wishlist Map Fullscreen...');
        await evalJs(`
            (() => {
                const nav = document.getElementById('nav-wishlist');
                if (nav) nav.click();
            })()
        `);
        await new Promise(r => setTimeout(r, 800));

        await evalJs(`
            (() => {
                const card = document.querySelector('#wishlist-collections-list .trip-card-content');
                if (card) card.click();
            })()
        `);
        await new Promise(r => setTimeout(r, 1000));

        // Click Wishlist Full Map button
        await evalJs(`
            (() => {
                const btn = document.getElementById('wishlist-fullscreen-btn');
                if (btn) btn.click();
            })()
        `);
        await new Promise(r => setTimeout(r, 600));

        const wishlistExpandedCheck = await evalJs(`
            (() => {
                const detailView = document.getElementById('wishlist-detail-view');
                const mapEl = document.getElementById('wishlist-map');
                const sheet = document.getElementById('wishlist-sheet');
                return {
                    hasExpandedClass: detailView.classList.contains('map-expanded'),
                    mapHeight: mapEl ? mapEl.offsetHeight : 0,
                    sheetHeight: sheet ? sheet.offsetHeight : 0
                };
            })()
        `);
        console.log('Wishlist Detail Expanded State:', wishlistExpandedCheck);
        if (!wishlistExpandedCheck.hasExpandedClass || wishlistExpandedCheck.mapHeight < 690) {
            throw new Error('Test 6 failed: Wishlist map did not expand to full screen');
        }

        const ss3 = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(__dirname, 'mobile-full-map-wishlist.png'), Buffer.from(ss3.data, 'base64'));
        console.log('📸 Saved mobile-full-map-wishlist.png');

        console.log('\n✅ ALL 6 MOBILE MAP QA TESTS PASSED CLEANLY!\n');
        console.log('Console logs:', consoleLogs);
        console.log('Page errors:', pageErrors);

        ws.close();
    } finally {
        chrome.kill();
    }
}

runMobileTest().catch(err => {
    console.error('Mobile QA Test failed:', err);
    process.exit(1);
});
