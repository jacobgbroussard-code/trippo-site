const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_test_locking');

if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

let passed = 0;
let failed = 0;

function check(desc, fn) {
    try {
        fn();
        console.log(`  ✅ ${desc}`);
        passed++;
    } catch (e) {
        console.error(`  ❌ ${desc}: ${e.message}`);
        failed++;
    }
}

function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
}

async function runTests() {
    console.log('=============================================================');
    console.log('  TEST: TRANSPACIFIC FLIGHT PATHS & STOP ORDER LOCKING (v2.3.65)');
    console.log('=============================================================\n');

    // 1. Static checks & Math Tests
    console.log('[Suite 1] Static Code & Math Verification:');

    const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const appJs = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
    const toolsJs = fs.readFileSync(path.join(__dirname, '../js/tools.js'), 'utf8');
    const swJs = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
    const mapsJs = fs.readFileSync(path.join(__dirname, '../js/maps.js'), 'utf8');
    const plannerJs = fs.readFileSync(path.join(__dirname, '../js/planner.js'), 'utf8');
    const compCss = fs.readFileSync(path.join(__dirname, '../styles/components.css'), 'utf8');

    check('v2.3.68 version bump is consistent across all files', () => {
        assert(indexHtml.includes('Trippo Travel Planner v2.3.68'), 'index.html title mismatch');
        assert(indexHtml.includes('js/app.js?v=2.3.68'), 'index.html script tag mismatch');
        assert(indexHtml.includes('v2.3.68</span></span>'), 'index.html sidebar badge mismatch');
        assert(appJs.includes("CURRENT_VERSION = '2.3.68'"), 'js/app.js CURRENT_VERSION mismatch');
        assert(toolsJs.includes('version: "2.3.68"'), 'js/tools.js version mismatch');
        assert(swJs.includes('trippo-cache-v2.3.68'), 'sw.js CACHE_NAME mismatch');
    });

    check('maps.js exports getShortestRoutePath', () => {
        assert(mapsJs.includes('export function getShortestRoutePath'), 'Missing getShortestRoutePath export in maps.js');
    });

    check('planner.js exports toggleStopLock and toggleLockAllStops', () => {
        assert(plannerJs.includes('export function toggleStopLock'), 'Missing toggleStopLock in planner.js');
        assert(plannerJs.includes('export function toggleLockAllStops'), 'Missing toggleLockAllStops in planner.js');
    });

    check('components.css defines stop-card.is-locked and stop-lock-btn', () => {
        assert(compCss.includes('.stop-card.is-locked'), 'Missing .stop-card.is-locked in components.css');
        assert(compCss.includes('.stop-lock-btn'), 'Missing .stop-lock-btn in components.css');
        assert(compCss.includes('.lock-all-toggle-btn'), 'Missing .lock-all-toggle-btn in components.css');
    });

    // 2. Headless Chrome Browser Verification
    console.log('\n[Suite 2] In-Browser Runtime Verification:');

    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=9272',
        `--user-data-dir=${USER_DATA_DIR}`,
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=393,852'
    ]);

    let newTabRes = null;
    for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise(r => setTimeout(r, 600));
        try {
            newTabRes = await fetch('http://127.0.0.1:9272/json/new?http://127.0.0.1:8080/', { method: 'PUT' });
            if (newTabRes.ok) break;
        } catch (e) {}
    }
    if (!newTabRes) throw new Error('Could not connect to Chrome on port 9272');

    try {
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
            }
        };

        await send('Page.enable');
        await send('Runtime.enable');

        async function evalInBrowser(expr) {
            const res = await send('Runtime.evaluate', {
                expression: expr,
                returnByValue: true,
                awaitPromise: true
            });
            if (res.exceptionDetails) {
                console.error('Eval Exception:', res.exceptionDetails);
                throw new Error(res.exceptionDetails.text || res.exceptionDetails.exception?.description || 'Eval failed');
            }
            return res.result.value;
        }

        await send('Page.navigate', { url: 'http://127.0.0.1:8080/' });
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 200));
            try {
                const ready = await evalInBrowser(`Boolean(document && document.body && document.getElementById('itinerary-list'))`);
                if (ready) break;
            } catch (e) {}
        }
        await new Promise(r => setTimeout(r, 1200));

        // Test A: Math function getShortestRoutePath in browser
        const transpacificResult = await evalInBrowser(`(() => {
            const laxToTokyo = window.getShortestRoutePath(33.94, -118.41, 35.68, 139.65);
            const tokyoToLax = window.getShortestRoutePath(35.68, 139.65, 33.94, -118.41);
            const nycToLondon = window.getShortestRoutePath(40.71, -74.00, 51.50, -0.12);
            return { laxToTokyo, tokyoToLax, nycToLondon };
        })()`);

        check('LAX to Tokyo crosses antimeridian westward across Pacific', () => {
            assert(transpacificResult.laxToTokyo.crossesAntimeridian === true, 'Should cross antimeridian');
            assert(transpacificResult.laxToTokyo.latlngs.length >= 2, 'Should have multiple polyline segments');
            // Midpoint must be in the Pacific Ocean (-180 to -150), NOT in Europe/Africa (~+10)
            assert(transpacificResult.laxToTokyo.midLon < -150 && transpacificResult.laxToTokyo.midLon > -180, 
                `Midpoint should be in Pacific (-169.38), got ${transpacificResult.laxToTokyo.midLon}`);
        });

        check('Tokyo to LAX crosses antimeridian eastward across Pacific with midpoint in Pacific', () => {
            assert(transpacificResult.tokyoToLax.crossesAntimeridian === true, 'Should cross antimeridian');
            assert(transpacificResult.tokyoToLax.midLon < -150 && transpacificResult.tokyoToLax.midLon > -180, 
                `Midpoint should be in Pacific (-169.38), got ${transpacificResult.tokyoToLax.midLon}`);
        });

        check('NYC to London does not cross antimeridian', () => {
            assert(transpacificResult.nycToLondon.crossesAntimeridian === false, 'Should not cross antimeridian');
            assert(transpacificResult.nycToLondon.midLon > -40 && transpacificResult.nycToLondon.midLon < -35,
                `Midpoint should be in Atlantic, got ${transpacificResult.nycToLondon.midLon}`);
        });

        // Test B: Stop locking UI and behavior
        const lockingUITest = await evalInBrowser(`(() => {
            // Setup a test trip with stops
            const trip = {
                id: 'test_trip_locking_' + Date.now(),
                name: 'Transpacific & Locking Test Trip',
                startDate: '2026-11-01',
                stops: [
                    { id: 's1', name: 'Los Angeles (LAX)', lat: 33.94, lon: -118.41, nights: 2, locked: false, transit: { method: 'plane' } },
                    { id: 's2', name: 'Tokyo', lat: 35.68, lon: 139.65, nights: 4, locked: false },
                    { id: 's3', name: 'Kyoto', lat: 35.01, lon: 135.76, nights: 3, locked: false }
                ],
                places: []
            };
            window.trips.push(trip);
            window.activeTripId = trip.id;
            window.renderPlanner();

            const initialCards = document.querySelectorAll('#itinerary-list .stop-card').length;
            const initialButtons = document.querySelectorAll('#itinerary-list .stop-lock-btn').length;

            // Toggle lock on Tokyo (index 1)
            window.toggleStopLock(null, 1);
            const tokyoLocked = trip.stops[1].locked;
            const tokyoCardHasClass = document.querySelectorAll('#itinerary-list .stop-card')[1]?.classList.contains('is-locked');
            const tokyoBtnText = document.querySelectorAll('#itinerary-list .stop-lock-btn')[1]?.textContent.trim();

            // Toggle lock all
            window.toggleLockAllStops();
            const allLockedAfter = trip.stops.every(s => s.locked);
            const lockAllBtnText = document.getElementById('toggle-lock-all-btn')?.innerText.trim();

            // Toggle lock all back to unlock
            window.toggleLockAllStops();
            const allUnlockedAfter = trip.stops.every(s => !s.locked);

            return {
                initialCards,
                initialButtons,
                tokyoLocked,
                tokyoCardHasClass,
                tokyoBtnText,
                allLockedAfter,
                lockAllBtnText,
                allUnlockedAfter
            };
        })()`);

        check('Stop lock buttons rendered on each stop card in itinerary', () => {
            assert(lockingUITest.initialCards === 3, `Expected 3 cards, got ${lockingUITest.initialCards}`);
            assert(lockingUITest.initialButtons === 3, `Expected 3 lock buttons, got ${lockingUITest.initialButtons}`);
        });

        check('Toggling stop lock updates state, CSS class, and icon', () => {
            assert(lockingUITest.tokyoLocked === true, 'Tokyo stop should be locked');
            assert(lockingUITest.tokyoCardHasClass === true, 'Card should have .is-locked class');
            assert(lockingUITest.tokyoBtnText.includes('🔒'), 'Lock button should show lock icon');
        });

        check('Toggle Lock All switches all stops and updates header button text', () => {
            assert(lockingUITest.allLockedAfter === true, 'All stops should be locked');
            assert(lockingUITest.lockAllBtnText.includes('Unlock All'), `Button should say Unlock All, got ${lockingUITest.lockAllBtnText}`);
            assert(lockingUITest.allUnlockedAfter === true, 'All stops should be unlocked on second toggle');
        });

        // Test C: Route auto-optimization respects locked stops and updates places cityIndex
        const optimizationTest = await evalInBrowser(`(() => {
            // Setup a 5-stop trip where:
            // Stop 0: LAX (Locked)
            // Stop 1: Tokyo (Unlocked)
            // Stop 2: London (Unlocked)
            // Stop 3: Paris (Unlocked)
            // Stop 4: SFO (Locked)
            const testTrip = {
                id: 'test_opt_' + Date.now(),
                name: 'Constrained TSP Optimization Test',
                startDate: '2026-12-01',
                stops: [
                    { id: 'stop_lax', name: 'Los Angeles (LAX)', lat: 33.94, lon: -118.41, nights: 1, locked: true },
                    { id: 'stop_tokyo', name: 'Tokyo', lat: 35.68, lon: 139.65, nights: 2, locked: false },
                    { id: 'stop_london', name: 'London', lat: 51.50, lon: -0.12, nights: 2, locked: false },
                    { id: 'stop_paris', name: 'Paris', lat: 48.85, lon: 2.35, nights: 2, locked: false },
                    { id: 'stop_sfo', name: 'San Francisco (SFO)', lat: 37.77, lon: -122.41, nights: 1, locked: true }
                ],
                places: [
                    { id: 'p_tokyo', name: 'Senso-ji', cityIndex: 1 },
                    { id: 'p_london', name: 'Big Ben', cityIndex: 2 },
                    { id: 'p_paris', name: 'Eiffel Tower', cityIndex: 3 }
                ]
            };
            window.trips.push(testTrip);
            window.activeTripId = testTrip.id;
            window.renderPlanner();

            // Run auto-optimization
            window.optimizeTripRoute();

            const finalStops = testTrip.stops.map(s => ({ id: s.id, name: s.name, locked: s.locked }));
            const finalPlaces = testTrip.places.map(p => ({
                id: p.id,
                name: p.name,
                cityIndex: p.cityIndex,
                cityName: testTrip.stops[p.cityIndex]?.name
            }));

            // Test case: All stops locked prevents accidental reorder
            testTrip.stops.forEach(s => s.locked = true);
            const stopsBefore = testTrip.stops.map(s => s.id);
            window.optimizeTripRoute();
            const stopsAfter = testTrip.stops.map(s => s.id);
            const unchanged = JSON.stringify(stopsBefore) === JSON.stringify(stopsAfter);

            return {
                finalStops,
                finalPlaces,
                unchanged
            };
        })()`);

        check('optimizeTripRoute preserves locked stop positions (Index 0 is LAX, Index 4 is SFO)', () => {
            assert(optimizationTest.finalStops[0].id === 'stop_lax', `Index 0 should remain LAX, got ${optimizationTest.finalStops[0].name}`);
            assert(optimizationTest.finalStops[4].id === 'stop_sfo', `Index 4 should remain SFO, got ${optimizationTest.finalStops[4].name}`);
        });

        check('optimizeTripRoute clusters unlocked geographic neighbors (London and Paris together)', () => {
            const stopIds = optimizationTest.finalStops.map(s => s.id);
            const londonIdx = stopIds.indexOf('stop_london');
            const parisIdx = stopIds.indexOf('stop_paris');
            assert(Math.abs(londonIdx - parisIdx) === 1, `London (${londonIdx}) and Paris (${parisIdx}) should be consecutive`);
        });

        check('optimizeTripRoute updates places.cityIndex to track moved stops by stop.id', () => {
            optimizationTest.finalPlaces.forEach(p => {
                if (p.id === 'p_tokyo') assert(p.cityName.includes('Tokyo'), `Senso-ji should map to Tokyo, got ${p.cityName}`);
                if (p.id === 'p_london') assert(p.cityName.includes('London'), `Big Ben should map to London, got ${p.cityName}`);
                if (p.id === 'p_paris') assert(p.cityName.includes('Paris'), `Eiffel Tower should map to Paris, got ${p.cityName}`);
            });
        });

        check('optimizeTripRoute safely refuses to reorder when all stops are locked', () => {
            assert(optimizationTest.unchanged === true, 'Stops should remain unchanged when all are locked');
        });

        // Test D: Planner map route rendering for transpacific flight
        const mapRouteTest = await evalInBrowser(`(() => {
            const trip = {
                id: 'transpacific_map_' + Date.now(),
                name: 'LAX to Tokyo Route Map',
                startDate: '2026-10-10',
                stops: [
                    { id: 'st1', name: 'Los Angeles (LAX)', lat: 33.94, lon: -118.41, nights: 1, transit: { method: 'plane' } },
                    { id: 'st2', name: 'Tokyo', lat: 35.68, lon: 139.65, nights: 3, transit: null }
                ],
                places: []
            };
            window.trips.push(trip);
            window.setActiveTripId(trip.id);
            if (window.initPlannerMap) window.initPlannerMap();
            window.renderPlanner();

            const pLinesCount = window.pLines ? window.pLines.length : 0;
            const pMarkersCount = window.pMarkers ? window.pMarkers.length : 0;

            return {
                pLinesCount,
                pMarkersCount
            };
        })()`);

        check('drawPlannerMapRoute renders multi-polyline and Pacific transit marker', () => {
            assert(mapRouteTest.pLinesCount >= 1, `Expected at least 1 polyline, got ${mapRouteTest.pLinesCount}`);
            // 2 stop circle markers + 1 or 2 transit emoji markers
            assert(mapRouteTest.pMarkersCount >= 3, `Expected at least 3 markers (stops + transit), got ${mapRouteTest.pMarkersCount}`);
        });

        ws.close();
    } finally {
        chrome.kill();
    }

    console.log('\n=============================================================');
    console.log(`Results: ${passed} Passed, ${failed} Failed`);
    console.log('=============================================================');

    if (failed > 0) process.exit(1);
}

runTests().catch(err => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
});
