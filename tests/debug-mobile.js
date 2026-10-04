const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_mobile_debug');

if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

async function debugMobile() {
    console.log('=== Debugging Trippo Mobile Map View ===\n');
    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=9227',
        `--user-data-dir=${USER_DATA_DIR}`,
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=390,844'
    ]);

    await new Promise(r => setTimeout(r, 1500));

    try {
        const newTabRes = await fetch('http://127.0.0.1:9227/json/new?http://127.0.0.1:8080/', { method: 'PUT' });
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
        await send('CSS.enable');

        // Emulate Mobile Device (iPhone 12/13/14: 390x844, DPR 3, mobile=true, touch=true)
        await send('Emulation.setDeviceMetricsOverride', {
            width: 390,
            height: 844,
            deviceScaleFactor: 3,
            mobile: true,
            screenOrientation: { angle: 0, type: 'portraitPrimary' }
        });
        await send('Emulation.setTouchEmulationEnabled', { enabled: true });

        console.log('Mobile emulation configured. Waiting 2s for page load...');
        await new Promise(r => setTimeout(r, 2000));

        // Evaluate state and DOM
        async function evalJs(expr) {
            const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
            if (res.exceptionDetails) {
                console.error('Eval error:', res.exceptionDetails);
                throw new Error(res.exceptionDetails.text);
            }
            return res.result.value;
        }

        const initialStatus = await evalJs(`
            (() => {
                const homeView = document.getElementById('home-view');
                const plannerView = document.getElementById('planner-view');
                const plannerMap = document.getElementById('planner-map');
                const trips = JSON.parse(localStorage.getItem('myTrips') || '[]');
                return {
                    homeActive: homeView ? homeView.classList.contains('active') : false,
                    plannerActive: plannerView ? plannerView.classList.contains('active') : false,
                    tripsCount: trips.length,
                    firstTripName: trips[0] ? trips[0].name : null,
                    firstTripStops: trips[0] ? trips[0].stops.length : 0
                };
            })()
        `);
        console.log('Initial Status:', initialStatus);

        // Click on first trip to open planner
        console.log('Clicking on first trip card...');
        await evalJs(`
            (() => {
                const card = document.querySelector('.trip-card-content');
                if (card) card.click();
                else console.warn('No trip card found to click');
            })()
        `);

        await new Promise(r => setTimeout(r, 1000));

        // Inspect Planner View and Planner Map
        const plannerInspect = await evalJs(`
            (() => {
                const plannerView = document.getElementById('planner-view');
                const plannerMapEl = document.getElementById('planner-map');
                const sheetEl = document.querySelector('#planner-view .sheet');
                const navEl = document.querySelector('.bottom-nav');
                
                const mapRect = plannerMapEl ? plannerMapEl.getBoundingClientRect() : null;
                const sheetRect = sheetEl ? sheetEl.getBoundingClientRect() : null;
                const navRect = navEl ? navEl.getBoundingClientRect() : null;
                const viewRect = plannerView ? plannerView.getBoundingClientRect() : null;

                const leafletPanes = plannerMapEl ? plannerMapEl.querySelectorAll('.leaflet-pane') : [];
                const leafletTiles = plannerMapEl ? plannerMapEl.querySelectorAll('.leaflet-tile') : [];

                return {
                    plannerActive: plannerView ? plannerView.classList.contains('active') : false,
                    viewRect: viewRect ? { width: viewRect.width, height: viewRect.height, top: viewRect.top, bottom: viewRect.bottom } : null,
                    mapRect: mapRect ? { width: mapRect.width, height: mapRect.height, top: mapRect.top, bottom: mapRect.bottom } : null,
                    sheetRect: sheetRect ? { width: sheetRect.width, height: sheetRect.height, top: sheetRect.top, bottom: sheetRect.bottom } : null,
                    navRect: navRect ? { width: navRect.width, height: navRect.height, top: navRect.top, bottom: navRect.bottom } : null,
                    tilesCount: leafletTiles.length,
                    hasLeafletInstance: window.plannerMap !== undefined,
                    windowInnerHeight: window.innerHeight,
                    windowInnerWidth: window.innerWidth,
                    scrollTop: plannerView ? plannerView.scrollTop : 0
                };
            })()
        `);
        console.log('Planner Inspect Result:\n', JSON.stringify(plannerInspect, null, 2));

        // Let's capture a screenshot of mobile viewport
        const screenshot = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(__dirname, 'mobile-planner-screenshot.png'), Buffer.from(screenshot.data, 'base64'));
        console.log('Saved mobile-planner-screenshot.png');

        // Now test Daily Planner (places-view)
        console.log('Testing Daily Planner tab navigation on mobile...');
        await evalJs(`
            (() => {
                const navPlaces = document.getElementById('nav-places');
                if (navPlaces) navPlaces.click();
            })()
        `);
        await new Promise(r => setTimeout(r, 800));

        const placesMasterInspect = await evalJs(`
            (() => {
                const placesView = document.getElementById('places-view');
                const masterList = document.getElementById('places-master-list');
                const cityCards = document.querySelectorAll('#places-trip-list .trip-card');
                return {
                    placesActive: placesView ? placesView.classList.contains('active') : false,
                    masterVisible: masterList ? masterList.style.display !== 'none' : false,
                    cityCardsCount: cityCards.length
                };
            })()
        `);
        console.log('Places Master Inspect:', placesMasterInspect);

        // Click first city in Daily Planner if available
        await evalJs(`
            (() => {
                const card = document.querySelector('#places-trip-list .trip-card');
                if (card) {
                    const content = card.querySelector('.trip-card-content') || card;
                    content.click();
                }
            })()
        `);
        await new Promise(r => setTimeout(r, 800));

        // Now click on a city if in detail list
        await evalJs(`
            (() => {
                const cityItem = document.querySelector('#places-city-list-container .trip-card');
                if (cityItem) {
                    const content = cityItem.querySelector('.trip-card-content') || cityItem;
                    content.click();
                }
            })()
        `);
        await new Promise(r => setTimeout(r, 1000));

        const placesCityInspect = await evalJs(`
            (() => {
                const cityView = document.getElementById('places-city-view');
                const placesMapEl = document.getElementById('places-map');
                const sheetEl = document.querySelector('#places-city-view .sheet');
                const mapRect = placesMapEl ? placesMapEl.getBoundingClientRect() : null;
                const sheetRect = sheetEl ? sheetEl.getBoundingClientRect() : null;
                const tiles = placesMapEl ? placesMapEl.querySelectorAll('.leaflet-tile') : [];

                return {
                    cityViewDisplay: cityView ? cityView.style.display : null,
                    mapRect: mapRect ? { width: mapRect.width, height: mapRect.height, top: mapRect.top, bottom: mapRect.bottom } : null,
                    sheetRect: sheetRect ? { width: sheetRect.width, height: sheetRect.height, top: sheetRect.top, bottom: sheetRect.bottom } : null,
                    tilesCount: tiles.length
                };
            })()
        `);
        console.log('Places City View Inspect:\n', JSON.stringify(placesCityInspect, null, 2));

        const screenshotPlaces = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(__dirname, 'mobile-places-screenshot.png'), Buffer.from(screenshotPlaces.data, 'base64'));
        console.log('Saved mobile-places-screenshot.png');

        // Now test Wishlist Map on mobile
        console.log('Testing Wishlist tab navigation on mobile...');
        await evalJs(`
            (() => {
                const navWishlist = document.getElementById('nav-wishlist');
                if (navWishlist) navWishlist.click();
            })()
        `);
        await new Promise(r => setTimeout(r, 800));

        // Click first collection
        await evalJs(`
            (() => {
                const collectionCard = document.querySelector('#wishlist-collections-list .trip-card');
                if (collectionCard) {
                    const content = collectionCard.querySelector('.trip-card-content') || collectionCard;
                    content.click();
                }
            })()
        `);
        await new Promise(r => setTimeout(r, 1000));

        const wishlistInspect = await evalJs(`
            (() => {
                const detailView = document.getElementById('wishlist-detail-view');
                const mapEl = document.getElementById('wishlist-map');
                const sheetEl = document.getElementById('wishlist-sheet');
                const mapRect = mapEl ? mapEl.getBoundingClientRect() : null;
                const sheetRect = sheetEl ? sheetEl.getBoundingClientRect() : null;
                const tiles = mapEl ? mapEl.querySelectorAll('.leaflet-tile') : [];

                return {
                    detailDisplay: detailView ? detailView.style.display : null,
                    mapRect: mapRect ? { width: mapRect.width, height: mapRect.height, top: mapRect.top, bottom: mapRect.bottom } : null,
                    sheetRect: sheetRect ? { width: sheetRect.width, height: sheetRect.height, top: sheetRect.top, bottom: sheetRect.bottom } : null,
                    tilesCount: tiles.length
                };
            })()
        `);
        console.log('Wishlist Detail Inspect:\n', JSON.stringify(wishlistInspect, null, 2));

        const screenshotWishlist = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(__dirname, 'mobile-wishlist-screenshot.png'), Buffer.from(screenshotWishlist.data, 'base64'));
        console.log('Saved mobile-wishlist-screenshot.png');

        console.log('\nConsole logs:', consoleLogs);
        console.log('Page errors:', pageErrors);

        ws.close();
    } finally {
        chrome.kill();
    }
}

debugMobile().catch(err => {
    console.error('Fatal debug error:', err);
    process.exit(1);
});
