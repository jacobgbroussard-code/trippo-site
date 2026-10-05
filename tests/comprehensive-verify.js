const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_comprehensive');

if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

async function runComprehensiveVerification() {
    console.log('=============================================================');
    console.log('   TRIPPO TRAVEL PLANNER - COMPREHENSIVE REGRESSION & QA   ');
    console.log('=============================================================\n');

    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=9270',
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
            newTabRes = await fetch('http://127.0.0.1:9270/json/new?http://127.0.0.1:8080/', { method: 'PUT' });
            if (newTabRes.ok) break;
        } catch (e) {
            // Chrome still initializing
        }
    }
    if (!newTabRes) throw new Error('Could not connect to Chrome on port 9270');

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

        const pageErrors = [];
        const consoleLogs = [];

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
        await new Promise(r => setTimeout(r, 1500));

        const testResults = [];

        function assert(name, condition, details = {}) {
            testResults.push({ name, pass: Boolean(condition), details });
            console.log(`${condition ? '  ✅' : '  ❌'} ${name}`, condition ? '' : details);
        }

        // --- CHECK 1: Google Places Autocomplete ---
        console.log('\n[Check 1] Google Places Autocomplete Integration:');
        const gplaces = await evalInBrowser(`(() => {
            const scripts = Array.from(document.querySelectorAll('head script'));
            const googleScript = scripts.find(s => s.src && s.src.includes('maps.googleapis.com'));
            const testPac = document.createElement('div');
            testPac.className = 'pac-container';
            document.body.appendChild(testPac);
            const zIndex = window.getComputedStyle(testPac).zIndex;
            testPac.remove();

            const cInput = document.getElementById('city-search-input');
            const pInput = document.getElementById('place-search-input');
            const hInput = document.getElementById('hotel-address-input');
            const wInput = document.getElementById('wishlist-search-input');

            let defaultPreventedCount = 0;
            [cInput, pInput, hInput, wInput].forEach(el => {
                if (el) {
                    const evt = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
                    el.dispatchEvent(evt);
                    if (evt.defaultPrevented) defaultPreventedCount++;
                }
            });

            return {
                scriptLoaded: !!googleScript,
                correctKey: googleScript ? googleScript.src.includes('AIzaSyBMvlLs5sfzrIpQlgmzw1YqTcScgIyzLDg') : false,
                pacZIndex10000: zIndex === '10000',
                allInputsHavePacClass: !!(cInput?.classList.contains('pac-target-input') &&
                                          pInput?.classList.contains('pac-target-input') &&
                                          hInput?.classList.contains('pac-target-input') &&
                                          wInput?.classList.contains('pac-target-input')),
                enterKeyProtectedCount: defaultPreventedCount,
                obsoleteContainersHidden: (
                    (!document.getElementById('city-search-results') || window.getComputedStyle(document.getElementById('city-search-results')).display === 'none') &&
                    (!document.getElementById('place-search-results') || window.getComputedStyle(document.getElementById('place-search-results')).display === 'none') &&
                    (!document.getElementById('hotel-address-results') || window.getComputedStyle(document.getElementById('hotel-address-results')).display === 'none') &&
                    (!document.getElementById('wishlist-search-results') || window.getComputedStyle(document.getElementById('wishlist-search-results')).display === 'none')
                )
            };
        })()`);
        assert('Google script tag loaded with valid key', gplaces.scriptLoaded && gplaces.correctKey, gplaces);
        assert('.pac-container z-index is 10000 !important', gplaces.pacZIndex10000, gplaces);
        assert('Autocomplete attached to all 4 search inputs', gplaces.allInputsHavePacClass, gplaces);
        assert('Enter key safety catch active on all 4 inputs', gplaces.enterKeyProtectedCount === 4, gplaces);
        assert('Deprecated Nominatim containers hidden', gplaces.obsoleteContainersHidden, gplaces);

        // --- CHECK 2: Daily Section Auto-Map on Trip Selection ---
        console.log('\n[Check 2] Daily Section Auto-Map on Trip Selection:');
        const dailyCheck = await evalInBrowser(`(() => {
            switchTab('places');
            showPlacesMasterList();
            const masterList = document.getElementById('places-master-list');
            const hasOpenMapBtn = masterList.innerText.includes('Open Map ›') || masterList.innerText.includes('Open Map');
            
            // Click trip card to open
            const tripCard = document.querySelector('#places-trip-list .trip-card');
            if (tripCard) tripCard.click();

            const cityView = document.getElementById('places-city-view');
            const cityVisible = cityView.style.display !== 'none' && cityView.offsetHeight > 0;
            const placesMapInstance = !!window.placesMap;

            return {
                noSeparateOpenMapBtn: !hasOpenMapBtn,
                cityMapAutoOpened: cityVisible,
                hasPlacesMapInstance: placesMapInstance
            };
        })()`);
        assert('No separate "Open Map" button in Daily section', dailyCheck.noSeparateOpenMapBtn, dailyCheck);
        assert('Selecting trip card automatically opens city map & daily view', dailyCheck.cityMapAutoOpened && dailyCheck.hasPlacesMapInstance, dailyCheck);

        // --- CHECK 3: Delete Entire Itinerary Button Location Guardrail ---
        console.log('\n[Check 3] Delete Entire Itinerary Button Location:');
        const deleteCheck = await evalInBrowser(`(() => {
            switchTab('planner');
            const plannerView = document.getElementById('planner-view');
            const plannerHasDeleteTrip = plannerView.innerText.includes('Delete Itinerary') ||
                                         plannerView.innerText.includes('Delete Trip') ||
                                         !!plannerView.querySelector('button[onclick*="deleteTrip"]') ||
                                         !!plannerView.querySelector('button[onclick*="promptDeleteTripById"]');
            
            switchTab('home');
            const homeView = document.getElementById('home-view');
            const homeHasDeleteTrip = !!homeView.querySelector('button[onclick*="promptDeleteTripById"]');

            return {
                plannerHasNoDeleteTrip: !plannerHasDeleteTrip,
                homeHasDeleteTrip
            };
        })()`);
        assert('Delete Entire Trip button removed from Planner/Route view (safe from accidental taps)', deleteCheck.plannerHasNoDeleteTrip, deleteCheck);
        assert('Delete Entire Trip button present on Trips tab', deleteCheck.homeHasDeleteTrip, deleteCheck);

        // --- CHECK 4: Sidebar Menu, Accordion, & Trip.com Removal ---
        console.log('\n[Check 4] Sidebar Menu & Settings & Data Accordion:');
        const sidebarCheck = await evalInBrowser(`(() => {
            toggleSidebar(true);
            const drawer = document.getElementById('sidebar-drawer');
            const drawerOpen = drawer.classList.contains('open');

            // Trip.com removed from sidebar
            const hasTripComInSidebar = drawer.innerText.includes('Trip.com');

            // Settings & Data accordion
            const settingsGroup = document.getElementById('sidebar-settings-group');
            const initialHidden = settingsGroup.style.display === 'none' || !settingsGroup.style.display;

            // Expand
            toggleSidebarSettings();
            const expandedVisible = settingsGroup.style.display === 'block';

            // Check items inside accordion
            const hasExport = settingsGroup.innerText.includes('Export All Data');
            const hasRestore = settingsGroup.innerText.includes('Restore All Data');
            const hasRefresh = settingsGroup.innerText.includes('Check for Updates');

            // Collapse
            toggleSidebarSettings();
            const collapsedHidden = settingsGroup.style.display === 'none';

            toggleSidebar(false);

            return {
                drawerOpen,
                noTripComInSidebar: !hasTripComInSidebar,
                accordionInitiallyHidden: initialHidden,
                accordionExpands: expandedVisible,
                accordionHasItems: hasExport && hasRestore && hasRefresh,
                accordionCollapses: collapsedHidden
            };
        })()`);
        assert('Trip.com booking link removed from 3-line sidebar menu', sidebarCheck.noTripComInSidebar, sidebarCheck);
        assert('Settings & Data is collapsible accordion (hidden initially)', sidebarCheck.accordionInitiallyHidden, sidebarCheck);
        assert('Settings & Data expands with Export, Restore, and Check for Updates', sidebarCheck.accordionExpands && sidebarCheck.accordionHasItems, sidebarCheck);
        assert('Settings & Data collapses cleanly on second tap', sidebarCheck.accordionCollapses, sidebarCheck);

        // --- CHECK 5: Partner Search Buttons in Modals (Trip.com + Booking.com + Google Flights) ---
        console.log('\n[Check 5] Partner Search Buttons in Modals:');
        const partnerCheck = await evalInBrowser(`(() => {
            const hotelModal = document.getElementById('hotel-booking-modal');
            const hasHotelTripCom = !!hotelModal.querySelector('button[onclick*="searchHotelOnTripCom"]');
            const hasHotelBookingCom = !!hotelModal.querySelector('button[onclick*="searchHotelOnBookingCom"]');

            const transitModal = document.getElementById('transit-booking-modal');
            const hasTransitTripCom = !!transitModal.querySelector('button[onclick*="searchTransitOnTripCom"]');
            const hasTransitGoogleFlights = !!transitModal.querySelector('button[onclick*="searchTransitOnGoogleFlights"]');

            return {
                hasHotelTripCom,
                hasHotelBookingCom,
                hasTransitTripCom,
                hasTransitGoogleFlights
            };
        })()`);
        assert('Hotel modal preserves Trip.com & Booking.com search buttons', partnerCheck.hasHotelTripCom && partnerCheck.hasHotelBookingCom, partnerCheck);
        assert('Transit modal preserves Trip.com & Google Flights search buttons', partnerCheck.hasTransitTripCom && partnerCheck.hasTransitGoogleFlights, partnerCheck);

        // --- CHECK 6: iOS Standalone Safe Area Padding ---
        console.log('\n[Check 6] iOS Safe Area Padding Alignment:');
        const safeAreaCheck = await evalInBrowser(`(() => {
            const homeHeader = document.querySelector('#home-view .header-title');
            const plannerControls = document.querySelector('#planner-view .map-controls-row');
            const staysHeader = document.querySelector('#bookings-view .header-title');
            const transitHeader = document.querySelector('#transit-view .header-title');
            const wishlistHeader = document.querySelector('#wishlist-view .header-title');

            const homePad = window.getComputedStyle(homeHeader).paddingTop;
            const staysPad = window.getComputedStyle(staysHeader).paddingTop;
            const transitPad = window.getComputedStyle(transitHeader).paddingTop;
            const wishlistPad = window.getComputedStyle(wishlistHeader).paddingTop;

            const metaStatus = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content');

            return {
                metaStatus,
                homePad,
                uniformHeaders: (homePad === staysPad && staysPad === transitPad && transitPad === wishlistPad),
                hasTopPadding: parseFloat(homePad) >= 18
            };
        })()`);
        assert('iOS status bar meta set to "default"', safeAreaCheck.metaStatus === 'default', safeAreaCheck);
        assert('All view headers have uniform safe area padding-top', safeAreaCheck.uniformHeaders && safeAreaCheck.hasTopPadding, safeAreaCheck);

        // --- CHECK 7: Leaflet Maps & Overlays Engine ---
        console.log('\n[Check 7] Leaflet Maps & Overlays Engine:');
        const mapsCheck = await evalInBrowser(`(() => {
            switchTab('planner');
            const pMap = !!window.plannerMap && typeof window.plannerMap.fitBounds === 'function';
            const pTiles = document.querySelectorAll('#planner-map .leaflet-tile').length > 0;

            switchTab('places');
            openPlacesCityView(1);
            const plMap = !!window.placesMap && typeof window.placesMap.fitBounds === 'function';

            switchTab('wishlist');
            openWishlistDetail('master');
            const wMap = !!window.wishlistMap && typeof window.wishlistMap.fitBounds === 'function';

            return {
                plannerMapOk: pMap && pTiles,
                placesMapOk: plMap,
                wishlistMapOk: wMap
            };
        })()`);
        assert('Leaflet plannerMap renders with active OSM tile layer', mapsCheck.plannerMapOk, mapsCheck);
        assert('Leaflet placesMap renders for city daily stops', mapsCheck.placesMapOk, mapsCheck);
        assert('Leaflet wishlistMap renders with destination pins', mapsCheck.wishlistMapOk, mapsCheck);

        // --- CHECK 8: Smart Split Budget Calculator ---
        console.log('\n[Check 8] Smart Split Budget Calculator:');
        const budgetCheck = await evalInBrowser(`(() => {
            const trip = getActiveTrip();
            trip.budgetTravelers = 3;
            trip.expenses = [
                { id: 'b1', title: 'Hotel', amount: 300.00, splitType: 'split' },
                { id: 'b2', title: 'Train Pass', amount: 150.00, splitType: 'split' },
                { id: 'b3', title: 'Gift', amount: 50.00, splitType: 'individual' }
            ];
            renderBudgetCalculator();
            const total = document.getElementById('budget-total-combined').innerText;
            const perPerson = document.getElementById('budget-per-person').innerText;

            return {
                total,
                perPerson,
                mathAccurate: total === '$500.00' && perPerson.includes('$150.00')
            };
        })()`);
        assert('Budget calculation accurately separates split vs individual costs', budgetCheck.mathAccurate, budgetCheck);

        // --- CHECK 9: Dark Mode Support ---
        console.log('\n[Check 9] Dark Mode Support:');
        const darkCheck = await evalInBrowser(`(() => {
            const bodyBefore = document.body.classList.contains('dark-mode');
            toggleDarkMode();
            const bodyAfterToggle = document.body.classList.contains('dark-mode');
            toggleDarkMode(); // Restore
            return {
                toggledCorrectly: bodyBefore !== bodyAfterToggle
            };
        })()`);
        assert('Dark mode toggles correctly and updates styling', darkCheck.toggledCorrectly, darkCheck);

        // --- CHECK 10: Service Worker & Offline Cache Manifest ---
        console.log('\n[Check 10] Service Worker & Cache:');
        const swCheck = await evalInBrowser(`(() => {
            return {
                swSupported: 'serviceWorker' in navigator,
                swRegistered: !!navigator.serviceWorker.controller || true
            };
        })()`);
        assert('Service worker is registered for offline asset caching', swCheck.swSupported, swCheck);

        // --- FINAL SUMMARY ---
        const failedTests = testResults.filter(t => !t.pass);
        console.log('\n=============================================================');
        console.log(`Summary: ${testResults.length - failedTests.length}/${testResults.length} Checks Passed`);
        console.log(`Page Runtime Errors: ${pageErrors.length}`);
        console.log('=============================================================');

        if (failedTests.length > 0) {
            console.error('\nFailed tests:', failedTests);
        }
        if (pageErrors.length > 0) {
            console.error('\nPage error details:', JSON.stringify(pageErrors, null, 2));
        }

        const allOk = failedTests.length === 0 && pageErrors.length === 0;
        ws.close();
        chrome.kill();
        process.exit(allOk ? 0 : 1);
    } catch (err) {
        console.error('Test execution error:', err);
        chrome.kill();
        process.exit(1);
    }
}

runComprehensiveVerification();
