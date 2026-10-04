const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA = path.join(__dirname, 'scratch_chrome_test_all_mobile');

const DEVICES = [
    {
        name: 'iPhone 15 Pro (Safari)',
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
        metrics: { width: 393, height: 852, deviceScaleFactor: 3, mobile: true }
    },
    {
        name: 'Pixel 7 (Android Chrome)',
        ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        metrics: { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true }
    }
];

async function runTestOnTarget(baseUrl) {
    console.log(`\n======================================================`);
    console.log(`Testing target: ${baseUrl}`);
    console.log(`======================================================\n`);

    for (const dev of DEVICES) {
        console.log(`\n--- Device: ${dev.name} ---`);
        const chrome = spawn(CHROME, [
            '--headless=new',
            '--remote-debugging-port=9250',
            `--user-data-dir=${USER_DATA}_${dev.name.replace(/[^a-zA-Z0-9]/g, '_')}`,
            '--disable-gpu',
            '--no-first-run',
            '--no-default-browser-check',
            `--window-size=${dev.metrics.width},${dev.metrics.height}`
        ]);
        await new Promise(r => setTimeout(r, 1500));

        try {
            const newTab = await (await fetch(`http://127.0.0.1:9250/json/new?${baseUrl}`, { method: 'PUT' })).json();
            const ws = new WebSocket(newTab.webSocketDebuggerUrl);
            let id = 1;
            const pending = new Map();
            const send = (method, params = {}) => new Promise((res, rej) => {
                const cur = id++;
                pending.set(cur, { res, rej });
                ws.send(JSON.stringify({ id: cur, method, params }));
            });
            await new Promise(r => ws.onopen = r);

            const errors = [];
            const consoleLogs = [];
            ws.onmessage = (evt) => {
                const msg = JSON.parse(evt.data);
                if (msg.id && pending.has(msg.id)) {
                    const { res, rej } = pending.get(msg.id);
                    pending.delete(msg.id);
                    if (msg.error) rej(msg.error); else res(msg.result);
                } else if (msg.method === 'Runtime.exceptionThrown') {
                    errors.push(msg.params.exceptionDetails);
                } else if (msg.method === 'Runtime.consoleAPICalled') {
                    consoleLogs.push({ type: msg.params.type, args: msg.params.args.map(a => a.value || a.description) });
                }
            };

            await send('Page.enable');
            await send('Runtime.enable');
            await send('Emulation.setUserAgentOverride', { userAgent: dev.ua });
            await send('Emulation.setDeviceMetricsOverride', dev.metrics);
            await send('Emulation.setTouchEmulationEnabled', { enabled: true });
            await send('Page.reload');
            await new Promise(r => setTimeout(r, 2500));

            // Test 1: Home View status
            const homeInfo = await send('Runtime.evaluate', {
                expression: `(() => {
                    const activeView = document.querySelector('.view.active')?.id;
                    const tripCards = document.querySelectorAll('#trip-list .trip-card');
                    return { activeView, tripCardsCount: tripCards.length };
                })()`,
                returnByValue: true
            });
            console.log('Home View status:', homeInfo.result.value);

            // Test 2: Click Trip Card or open planner
            console.log('Navigating to Trip Planner...');
            const clickRes = await send('Runtime.evaluate', {
                expression: `(() => {
                    const card = document.querySelector('#trip-list .trip-card-content');
                    if (card) { card.click(); return 'clicked-card'; }
                    const nav = document.getElementById('nav-planner');
                    if (nav) { nav.click(); return 'clicked-nav'; }
                    return 'none';
                })()`,
                returnByValue: true
            });
            console.log('Open planner action:', clickRes.result.value);
            await new Promise(r => setTimeout(r, 2000));

            // Test 3: Inspect Planner Map
            const plannerInspect = await send('Runtime.evaluate', {
                expression: `(() => {
                    const plannerMapEl = document.getElementById('planner-map');
                    if (!plannerMapEl) return { error: 'No planner-map element' };
                    const rect = plannerMapEl.getBoundingClientRect();
                    const computed = getComputedStyle(plannerMapEl);
                    const tiles = Array.from(plannerMapEl.querySelectorAll('.leaflet-tile'));
                    const markers = plannerMapEl.querySelectorAll('.leaflet-marker-icon, .leaflet-interactive');
                    const mapInstance = window.plannerMap;
                    return {
                        hasMapInstance: !!mapInstance,
                        mapInstanceZoom: mapInstance ? mapInstance.getZoom() : null,
                        mapInstanceCenter: mapInstance ? mapInstance.getCenter() : null,
                        offsetWidth: plannerMapEl.offsetWidth,
                        offsetHeight: plannerMapEl.offsetHeight,
                        rect: { width: rect.width, height: rect.height, top: rect.top, left: rect.left },
                        display: computed.display,
                        visibility: computed.visibility,
                        tilesTotal: tiles.length,
                        tilesLoaded: tiles.filter(t => t.complete && t.naturalWidth > 0).length,
                        markersTotal: markers.length,
                        tileSources: tiles.slice(0, 3).map(t => t.src)
                    };
                })()`,
                returnByValue: true
            });
            console.log('Planner Map Inspection:', plannerInspect.result.value);

            const ssPlanner = await send('Page.captureScreenshot', { format: 'png' });
            fs.writeFileSync(path.join(__dirname, `mobile-planner-${dev.name.replace(/[^a-zA-Z0-9]/g, '_')}.png`), Buffer.from(ssPlanner.data, 'base64'));

            // Test 4: Navigate to Daily Places Map
            console.log('Navigating to Daily Places...');
            await send('Runtime.evaluate', {
                expression: `(() => {
                    const nav = document.getElementById('nav-places');
                    if (nav) nav.click();
                })()`
            });
            await new Promise(r => setTimeout(r, 1000));

            // Click city if in master list
            await send('Runtime.evaluate', {
                expression: `(() => {
                    const tripCard = document.querySelector('#places-trip-list .trip-card-content') || document.querySelector('#places-trip-list .trip-card');
                    if (tripCard) tripCard.click();
                })()`
            });
            await new Promise(r => setTimeout(r, 1000));

            await send('Runtime.evaluate', {
                expression: `(() => {
                    const cityCard = document.querySelector('#places-city-list-container .trip-card-content') || document.querySelector('#places-city-list-container .trip-card');
                    if (cityCard) cityCard.click();
                })()`
            });
            await new Promise(r => setTimeout(r, 1500));

            const placesInspect = await send('Runtime.evaluate', {
                expression: `(() => {
                    const placesMapEl = document.getElementById('places-map');
                    const cityView = document.getElementById('places-city-view');
                    if (!placesMapEl) return { error: 'No places-map element' };
                    const rect = placesMapEl.getBoundingClientRect();
                    const tiles = Array.from(placesMapEl.querySelectorAll('.leaflet-tile'));
                    return {
                        cityViewDisplay: cityView ? getComputedStyle(cityView).display : null,
                        hasMapInstance: !!window.placesMap,
                        offsetWidth: placesMapEl.offsetWidth,
                        offsetHeight: placesMapEl.offsetHeight,
                        rect: { width: rect.width, height: rect.height, top: rect.top, left: rect.left },
                        tilesTotal: tiles.length,
                        tilesLoaded: tiles.filter(t => t.complete && t.naturalWidth > 0).length
                    };
                })()`,
                returnByValue: true
            });
            // Capture screenshot of Places Map
            const ssPlaces = await send('Page.captureScreenshot', { format: 'png' });
            fs.writeFileSync(path.join(__dirname, `mobile-places-${dev.name.replace(/[^a-zA-Z0-9]/g, '_')}.png`), Buffer.from(ssPlaces.data, 'base64'));

            // Test 5: Navigate to Wishlist Map
            console.log('Navigating to Wishlist...');
            await send('Runtime.evaluate', {
                expression: `(() => {
                    const nav = document.getElementById('nav-wishlist');
                    if (nav) nav.click();
                })()`
            });
            await new Promise(r => setTimeout(r, 1000));

            // Click master wishlist card to open detail view
            await send('Runtime.evaluate', {
                expression: `(() => {
                    const wishCard = document.querySelector('#wishlist-collections-list .trip-card-content') || document.querySelector('#wishlist-collections-list .trip-card');
                    if (wishCard) wishCard.click();
                })()`
            });
            await new Promise(r => setTimeout(r, 1500));

            const wishlistInspect = await send('Runtime.evaluate', {
                expression: `(() => {
                    const wishlistMapEl = document.getElementById('wishlist-map');
                    const detailView = document.getElementById('wishlist-detail-view');
                    if (!wishlistMapEl) return { error: 'No wishlist-map element' };
                    const rect = wishlistMapEl.getBoundingClientRect();
                    const tiles = Array.from(wishlistMapEl.querySelectorAll('.leaflet-tile'));
                    const markers = wishlistMapEl.querySelectorAll('.leaflet-marker-icon, .leaflet-interactive');
                    return {
                        detailViewDisplay: detailView ? getComputedStyle(detailView).display : null,
                        hasMapInstance: !!window.wishlistMap,
                        offsetWidth: wishlistMapEl.offsetWidth,
                        offsetHeight: wishlistMapEl.offsetHeight,
                        rect: { width: rect.width, height: rect.height, top: rect.top, left: rect.left },
                        tilesTotal: tiles.length,
                        tilesLoaded: tiles.filter(t => t.complete && t.naturalWidth > 0).length,
                        markersTotal: markers.length
                    };
                })()`,
                returnByValue: true
            });
            console.log('Wishlist Map Inspection:', wishlistInspect.result.value);

            const ssWish = await send('Page.captureScreenshot', { format: 'png' });
            fs.writeFileSync(path.join(__dirname, `mobile-wishlist-${dev.name.replace(/[^a-zA-Z0-9]/g, '_')}.png`), Buffer.from(ssWish.data, 'base64'));

            // Check captured page errors
            if (errors.length > 0) {
                console.error('❌ Page Errors encountered:', errors.map(e => e.exception?.description || e.text));
            } else {
                console.log('✅ No uncaught runtime errors!');
            }

            ws.close();
        } finally {
            chrome.kill();
        }
    }
}

async function main() {
    const targetUrl = process.argv[2] || 'http://127.0.0.1:8080/';
    await runTestOnTarget(targetUrl);
}

main();
