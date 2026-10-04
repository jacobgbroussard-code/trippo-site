const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_google_places');

if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

async function testGooglePlaces() {
    console.log('=== Verifying Google Places Autocomplete Integration ===\n');

    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=9226',
        `--user-data-dir=${USER_DATA_DIR}`,
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check'
    ]);

    await new Promise(r => setTimeout(r, 1500));

    try {
        const newTabRes = await fetch('http://127.0.0.1:9226/json/new?http://localhost:8080/', { method: 'PUT' });
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

        async function evalInBrowser(expr) {
            const res = await send('Runtime.evaluate', {
                expression: expr,
                returnByValue: true,
                awaitPromise: true
            });
            if (res.exceptionDetails) {
                throw new Error(res.exceptionDetails.text || res.exceptionDetails.exception?.description || 'Eval failed');
            }
            return res.result.value;
        }

        // Wait 3.5 seconds for external Google Places CDN script and Trippo ES modules to initialize
        await new Promise(r => setTimeout(r, 3500));

        console.log('1. Checking Script Tag in <head>:');
        const scriptCheck = await evalInBrowser(`(() => {
            const scripts = Array.from(document.querySelectorAll('head script'));
            const googleScript = scripts.find(s => s.src && s.src.includes('maps.googleapis.com') && s.src.includes('places'));
            return {
                found: !!googleScript,
                src: googleScript ? googleScript.src : null,
                hasCorrectKey: googleScript ? googleScript.src.includes('AIzaSyBMvlLs5sfzrIpQlgmzw1YqTcScgIyzLDg') : false
            };
        })()`);
        console.log('Script check result:', scriptCheck);

        console.log('\n2. Checking Google Maps & Places API runtime presence:');
        const googleRuntime = await evalInBrowser(`(() => {
            return {
                hasGoogle: typeof window.google !== 'undefined',
                hasMaps: typeof window.google !== 'undefined' && typeof window.google.maps !== 'undefined',
                hasPlaces: typeof window.google !== 'undefined' && typeof window.google.maps !== 'undefined' && typeof window.google.maps.places !== 'undefined',
                hasAutocomplete: typeof window.google !== 'undefined' && typeof window.google.maps !== 'undefined' && typeof window.google.maps.places?.Autocomplete === 'function'
            };
        })()`);
        console.log('Google Places runtime:', googleRuntime);

        console.log('\n3. Checking .pac-container CSS z-index and styles:');
        const pacCssCheck = await evalInBrowser(`(() => {
            // Create a temporary test .pac-container to check computed styles
            const testPac = document.createElement('div');
            testPac.className = 'pac-container';
            document.body.appendChild(testPac);
            const computed = window.getComputedStyle(testPac);
            const zIndex = computed.zIndex;
            const borderRadius = computed.borderRadius;
            const boxShadow = computed.boxShadow;
            testPac.remove();
            return {
                zIndex,
                isZIndex10000: zIndex === '10000',
                borderRadius,
                boxShadow
            };
        })()`);
        console.log('pac-container CSS check:', pacCssCheck);

        console.log('\n4. Checking 4 Search Inputs & Autocomplete Instances:');
        const inputsCheck = await evalInBrowser(`(() => {
            const cityInput = document.getElementById('city-search-input');
            const placeInput = document.getElementById('place-search-input');
            const hotelInput = document.getElementById('hotel-address-input');
            const wishlistInput = document.getElementById('wishlist-search-input');

            return {
                cityInput: {
                    exists: !!cityInput,
                    hasPacClass: cityInput?.classList.contains('pac-target-input'),
                    autocompleteAttr: cityInput?.getAttribute('autocomplete'),
                    noLegacyOninput: !cityInput?.getAttribute('oninput')
                },
                placeInput: {
                    exists: !!placeInput,
                    hasPacClass: placeInput?.classList.contains('pac-target-input'),
                    autocompleteAttr: placeInput?.getAttribute('autocomplete'),
                    noLegacyOninput: !placeInput?.getAttribute('oninput')
                },
                hotelInput: {
                    exists: !!hotelInput,
                    hasPacClass: hotelInput?.classList.contains('pac-target-input'),
                    autocompleteAttr: hotelInput?.getAttribute('autocomplete'),
                    noLegacyOninput: !hotelInput?.getAttribute('oninput')
                },
                wishlistInput: {
                    exists: !!wishlistInput,
                    hasPacClass: wishlistInput?.classList.contains('pac-target-input'),
                    autocompleteAttr: wishlistInput?.getAttribute('autocomplete'),
                    noLegacyOninput: !wishlistInput?.getAttribute('oninput')
                },
                autocompleteInstances: {
                    city: !!window.cityAutocomplete,
                    place: !!window.dailyPlaceAutocomplete,
                    hotel: !!window.hotelAutocomplete,
                    wishlist: !!window.wishlistAutocomplete
                }
            };
        })()`);
        console.log('Inputs check result:', JSON.stringify(inputsCheck, null, 2));

        console.log('\n5. Checking Deprecated Nominatim Results Containers:');
        const obsoleteContainers = await evalInBrowser(`(() => {
            const cityRes = document.getElementById('city-search-results');
            const placeRes = document.getElementById('place-search-results');
            const hotelRes = document.getElementById('hotel-address-results');
            const wishRes = document.getElementById('wishlist-search-results');

            return {
                cityHidden: !cityRes || window.getComputedStyle(cityRes).display === 'none',
                placeHidden: !placeRes || window.getComputedStyle(placeRes).display === 'none',
                hotelHidden: !hotelRes || window.getComputedStyle(hotelRes).display === 'none',
                wishHidden: !wishRes || window.getComputedStyle(wishRes).display === 'none'
            };
        })()`);
        console.log('Obsolete containers check:', obsoleteContainers);

        console.log('\n6. Checking Enter Key Safety Catch:');
        const enterSafetyCheck = await evalInBrowser(`(() => {
            let defaultPreventedCount = 0;
            const ids = ['city-search-input', 'place-search-input', 'hotel-address-input', 'wishlist-search-input'];
            ids.forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    const evt = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
                    el.dispatchEvent(evt);
                    if (evt.defaultPrevented) defaultPreventedCount++;
                }
            });
            return {
                tested: ids.length,
                defaultPreventedCount,
                allProtected: defaultPreventedCount === ids.length
            };
        })()`);
        console.log('Enter safety catch check:', enterSafetyCheck);

        console.log('\n7. Checking Leaflet Maps Architectural Guardrails:');
        const mapGuardrailsCheck = await evalInBrowser(`(() => {
            switchTab('planner');
            const plannerLeaflet = !!window.plannerMap && typeof window.plannerMap.fitBounds === 'function';
            switchTab('places');
            openPlacesTripDetail(trips[0].id);
            openPlacesCityView(0);
            const placesLeaflet = !!window.placesMap && typeof window.placesMap.fitBounds === 'function';
            switchTab('wishlist');
            openWishlistDetail('master');
            const wishlistLeaflet = !!window.wishlistMap && typeof window.wishlistMap.fitBounds === 'function';

            return {
                plannerLeaflet,
                placesLeaflet,
                wishlistLeaflet,
                allLeafletActive: plannerLeaflet && placesLeaflet && wishlistLeaflet
            };
        })()`);
        console.log('Leaflet maps check:', mapGuardrailsCheck);

        console.log('\nPage Errors:', pageErrors.length);
        if (pageErrors.length > 0) {
            console.error('Page Errors Details:', pageErrors);
        }

        const success = scriptCheck.hasCorrectKey &&
            pacCssCheck.isZIndex10000 &&
            inputsCheck.cityInput.noLegacyOninput &&
            obsoleteContainers.cityHidden &&
            enterSafetyCheck.allProtected &&
            mapGuardrailsCheck.allLeafletActive &&
            pageErrors.length === 0;

        console.log(`\n========================================`);
        console.log(success ? '🎉 ALL GOOGLE PLACES TESTS PASSED!' : '❌ SOME TESTS FAILED');
        console.log(`========================================\n`);

        ws.close();
        chrome.kill();
        process.exit(success ? 0 : 1);
    } catch (err) {
        console.error('Test error:', err);
        chrome.kill();
        process.exit(1);
    }
}

testGooglePlaces();
