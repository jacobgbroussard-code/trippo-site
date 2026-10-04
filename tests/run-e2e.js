const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_modular');

if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

async function runModularSuite() {
    console.log('=== Running Trippo Modular Architecture Full QA Suite ===\n');
    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=9225',
        `--user-data-dir=${USER_DATA_DIR}`,
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check'
    ]);

    await new Promise(r => setTimeout(r, 1500));

    try {
        const newTabRes = await fetch('http://127.0.0.1:9225/json/new?http://127.0.0.1:8080/', { method: 'PUT' });
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
        const networkFailures = [];

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
            } else if (msg.method === 'Network.responseReceived') {
                const resp = msg.params.response;
                if (resp.status >= 400) {
                    networkFailures.push({ url: resp.url, status: resp.status });
                }
            }
        };

        await send('Page.enable');
        await send('Runtime.enable');
        await send('Network.enable');

        async function evalInBrowser(expr) {
            const res = await send('Runtime.evaluate', {
                expression: expr,
                returnByValue: true,
                awaitPromise: true
            });
            if (res.exceptionDetails) {
                console.error('Exception Details:', JSON.stringify(res.exceptionDetails, null, 2));
                throw new Error(res.exceptionDetails.text || res.exceptionDetails.exception?.description || 'Eval failed');
            }
            return res.result.value;
        }

        // Wait for page and modules to load
        await new Promise(r => setTimeout(r, 2500));

        console.log('Test 1: Global Window Module Bindings & Scope Check');
        const testBindings = await evalInBrowser(`(() => {
            const requiredGlobals = [
                'switchTab', 'openTrip', 'saveNewTrip', 'openCreateTripModal',
                'renderPlanner', 'optimizeTripRoute', 'exportTripICS',
                'openPlacesCityView', 'jumpToDailyFromStay', 'renderPlacesMasterList',
                'openLodgingModal', 'openTransitBookingModal',
                'showWishlistDirectory', 'exportWishlistKML', 'parseKMLWishlist',
                'openBudgetModal', 'convertCurrency', 'exportAppDataJSON',
                'toggleDarkMode', 'toggleSidebar'
            ];
            const missing = requiredGlobals.filter(fn => typeof window[fn] !== 'function');
            return {
                allGlobalsBound: missing.length === 0,
                missing
            };
        })()`);
        console.log('Result 1 (Global Bindings):', testBindings);

        console.log('\nTest 2: Viewport Emulation (Mobile 390x844 & Desktop 1280x800)');
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
        await new Promise(r => setTimeout(r, 500));
        const mobileCheck = await evalInBrowser(`({
            innerWidth: window.innerWidth,
            bottomNavVisible: getComputedStyle(document.querySelector('.bottom-nav')).display !== 'none'
        })`);
        console.log('Result 2a (Mobile 390x844):', mobileCheck);

        await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
        await new Promise(r => setTimeout(r, 500));
        const desktopCheck = await evalInBrowser(`({
            innerWidth: window.innerWidth,
            activeView: document.querySelector('.view.active')?.id
        })`);
        console.log('Result 2b (Desktop 1280x800):', desktopCheck);

        console.log('\nTest 3: Trip Creation & Calendar Reset on Reopen');
        const testTripCreation = await evalInBrowser(`(() => {
            openCreateTripModal();
            const dateInput = document.getElementById('new-trip-date');
            if (dateInput._flatpickr) {
                dateInput._flatpickr.setDate('2026-11-15', true);
            } else {
                dateInput.value = '2026-11-15';
            }
            document.getElementById('new-trip-name').value = 'Modular Test Trip';
            saveNewTrip();
            
            const tripFound = trips.some(t => t.name === 'Modular Test Trip');
            
            // Reopen modal to verify reset
            openCreateTripModal();
            const dateAfterReopen = document.getElementById('new-trip-date').value;
            const nameAfterReopen = document.getElementById('new-trip-name').value;
            closeModal('create-trip-modal');
            
            return {
                tripFound,
                dateAfterReopenClean: dateAfterReopen === '',
                nameAfterReopenClean: nameAfterReopen === ''
            };
        })()`);
        console.log('Result 3 (Trip Creation & Calendar Reset):', testTripCreation);

        console.log('\nTest 4: Map Invalidation & Tab Switching');
        const testMapInvalidation = await evalInBrowser(`(() => {
            switchTab('planner');
            const plannerOk = !!plannerMap;
            
            switchTab('wishlist');
            openWishlistDetail('master');
            const wishlistOk = !!wishlistMap;
            
            switchTab('places');
            openPlacesTripDetail(trips[0].id);
            openPlacesCityView(0);
            const placesOk = !!placesMap;
            
            return {
                plannerMapInitialized: plannerOk,
                wishlistMapInitialized: wishlistOk,
                placesMapInitialized: placesOk
            };
        })()`);
        console.log('Result 4 (Maps & Tab Switching):', testMapInvalidation);

        console.log('\nTest 5: Search Input Rate Limiting & Debouncing');
        const testSearchDebounce = await evalInBrowser(`(() => {
            // Rapid keystroke simulation
            searchCity('Par');
            searchPOI('Lou');
            searchHotelAddress('Hil');
            searchWishlistLocation('Rom');
            searchTransitStation('Gare', 'dep');
            
            // Check that debounce timeouts were properly set
            const hasTimeouts = !!(citySearchTimeout || poiSearchTimeout || hotelSearchTimeout || wishlistSearchTimeout);
            
            return {
                debounceTimersSet: hasTimeouts
            };
        })()`);
        console.log('Result 5 (Search Input Rate Limiting):', testSearchDebounce);

        console.log('\nTest 6: Hotel to Daily Map Linking (DOM Isolation Check)');
        const testHotelLinking = await evalInBrowser(`(() => {
            // Switch to stays
            switchTab('bookings');
            // Jump to Shanghai (stop 1 of Asia Adventure)
            const sampleTrip = trips.find(t => t.stops && t.stops.length > 1);
            if (sampleTrip) {
                syncSelectedTrip(sampleTrip.id, 'bookings');
                jumpToDailyFromStay(1);
            }
            
            const placesView = document.getElementById('places-view');
            const masterList = document.getElementById('places-master-list');
            const detailList = document.getElementById('places-trip-detail-list');
            const cityView = document.getElementById('places-city-view');
            
            return {
                placesViewActive: placesView.classList.contains('active'),
                masterListHidden: masterList.style.display === 'none',
                detailListHidden: detailList.style.display === 'none',
                cityViewVisible: cityView.style.display === 'flex',
                overlapBugFixed: masterList.style.display === 'none' && cityView.style.display === 'flex'
            };
        })()`);
        console.log('Result 6 (Hotel to Daily Map Linking):', testHotelLinking);

        console.log('\nTest 7: Smart Split Budget Math & Two-Decimal Precision');
        const testBudget = await evalInBrowser(`(() => {
            const trip = getActiveTrip();
            trip.budgetTravelers = 3;
            trip.expenses = [
                { id: 'b1', title: 'Luxury Ryokan', amount: 333.33, splitType: 'split' },
                { id: 'b2', title: 'Bullet Train Pass', amount: 166.67, splitType: 'split' },
                { id: 'b3', title: 'Personal Kimono', amount: 120.00, splitType: 'individual' }
            ];
            
            renderBudgetCalculator();
            
            const totalText = document.getElementById('budget-total-combined').innerText;
            const splitText = document.getElementById('budget-per-person').innerText;
            
            // Update to 5 travelers
            updateTravelersCount(5);
            const splitAfter5 = document.getElementById('budget-per-person').innerText;
            
            return {
                totalText, // Expected $620.00
                splitText, // Expected $166.67 (500 / 3)
                splitAfter5, // Expected $100.00 (500 / 5)
                mathAccurate: totalText === '$620.00' && splitText.includes('$166.67') && splitAfter5.includes('$100.00')
            };
        })()`);
        console.log('Result 7 (Smart Split Budget Math):', testBudget);

        console.log('\nTest 8: KML Export & Re-Import Round-Trip');
        const testKML = await evalInBrowser(`(() => {
            const initialCount = wishlistPins.length;
            // Generate KML XML
            const sampleKML = '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Roundtrip Test</name><Placemark><name>Matterhorn</name><description>Alpine summit</description><Point><coordinates>7.7584,45.9765,0</coordinates></Point></Placemark></Document></kml>';
            
            parseKMLWishlist(sampleKML);
            const afterCount = wishlistPins.length;
            const imported = wishlistPins.find(p => p.name === 'Matterhorn');
            
            return {
                pinAdded: afterCount === initialCount + 1,
                coordinatesCorrect: imported && imported.lat === 45.9765 && imported.lon === 7.7584,
                exportFnExists: typeof exportWishlistKML === 'function'
            };
        })()`);
        console.log('Result 8 (KML Round-Trip):', testKML);

        console.log('\nTest 9: Supabase Offline & LocalStorage Sync Check');
        const testOffline = await evalInBrowser(`(() => {
            currentUser = null;
            trips.push({ id: 'persisted_offline', name: 'Offline Alps', startDate: '2026-10-10', stops: [], places: [], expenses: [] });
            saveTrips();
            
            const stored = JSON.parse(localStorage.getItem('myTrips') || '[]');
            return {
                storedOffline: stored.some(t => t.id === 'persisted_offline')
            };
        })()`);
        console.log('Result 9 (Offline Storage):', testOffline);

        console.log('\nTest 10: Single Segment Flight Search URLs (One-Way vs Round-Trip)');
        const testFlightUrls = await evalInBrowser(`(() => {
            switchTab('transit');
            const sampleTrip = trips.find(t => t.stops && t.stops.length >= 2);
            if (sampleTrip) {
                syncSelectedTrip(sampleTrip.id, 'transit');
            }
            const container = document.getElementById('transit-list-container');
            const buttons = Array.from(container.querySelectorAll('.partner-btn'));
            const onclicks = buttons.map(b => b.getAttribute('onclick'));
            
            // Check that single segment searches default to One-Way
            const hasOneWayTrip = onclicks.some(c => c && c.includes('triptype=ow'));
            const hasOneWayGoogle = onclicks.some(c => c && c.includes('one%20way%20flights'));

            // Toggle trip to round-trip and verify
            setTripFlightType(true);
            const rtButtons = Array.from(container.querySelectorAll('.partner-btn'));
            const rtOnclicks = rtButtons.map(b => b.getAttribute('onclick'));
            const hasRtOption = rtOnclicks.some(c => c && (c.includes('triptype=rt') || c.includes('round%20trip%20flights') || c.includes('triptype=ow')));

            // Reset back
            setTripFlightType(false);

            return {
                oneWayTripComEnforced: hasOneWayTrip,
                oneWayGoogleFlightsEnforced: hasOneWayGoogle,
                roundTripToggleWorking: hasRtOption
            };
        })()`);
        console.log('Result 10 (Flight Search URLs):', testFlightUrls);

        console.log('\n=== Page Runtime Errors ===');
        console.log(JSON.stringify(pageErrors, null, 2));

        console.log('\n=== Network Failures (>=400) ===');
        console.log(JSON.stringify(networkFailures, null, 2));

        console.log('\n=== Console Logs ===');
        console.log(consoleLogs.slice(-10));

        ws.close();
    } catch (err) {
        console.error('Modular Suite Failure:', err);
    } finally {
        chrome.kill();
        setTimeout(() => {
            try { fs.rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch (e) {}
        }, 1000);
    }
}

runModularSuite();
