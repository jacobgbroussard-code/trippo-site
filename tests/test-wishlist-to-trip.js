const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_test_wishlist_to_trip');

if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

async function testWishlistToTrip() {
    console.log('====================================================');
    console.log('  TESTING WISHLIST TO TRIP INTEGRATION (v2.3.62)');
    console.log('====================================================\n');

    let passed = 0;
    let total = 0;
    function assert(name, condition) {
        total++;
        if (condition) {
            console.log(`  [PASS] ${name}`);
            passed++;
        } else {
            console.error(`  [FAIL] ${name}`);
        }
    }

    const port = 9319;
    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${USER_DATA_DIR}`,
        '--disable-gpu',
        '--no-first-run',
        '--window-size=393,852'
    ]);

    await new Promise(r => setTimeout(r, 1500));

    try {
        const tabRes = await fetch(`http://127.0.0.1:${port}/json/new?http://127.0.0.1:8080/?t=${Date.now()}`, { method: 'PUT' });
        const tab = await tabRes.json();
        const ws = new WebSocket(tab.webSocketDebuggerUrl);

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
        const consoleErrors = [];

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
                if (msg.params.type === 'error') {
                    consoleErrors.push(msg.params.args.map(a => a.value || a.description).join(' '));
                }
            } else if (msg.method === 'Runtime.exceptionThrown') {
                pageErrors.push(msg.params.exceptionDetails);
            }
        };

        await send('Page.enable');
        await send('Runtime.enable');

        await new Promise(r => setTimeout(r, 2000));

        // Test 1: Open Wishlist view and verify "✈ Add to Trip ›" button is present on pin cards
        const step1 = await send('Runtime.evaluate', {
            expression: `
            (function() {
                window.switchTab('wishlist');
                const dirCards = document.querySelectorAll('#wishlist-collections-list .trip-card');
                if (dirCards.length > 0) {
                    window.openWishlistDetail('master');
                }
                const toTripBtns = document.querySelectorAll('.place-item-card button[onclick*="openAddWishlistPinToTripModal"]');
                return {
                    cardsCount: document.querySelectorAll('.place-item-card').length,
                    toTripBtnsCount: toTripBtns.length,
                    hasBtnText: Array.from(toTripBtns).some(b => b.textContent.includes('Add to Trip'))
                };
            })()
            `,
            returnByValue: true
        });

        const r1 = step1.result.value;
        console.log('[Test 1] Wishlist Card UI:', r1);
        assert('Wishlist items render with "Add to Trip" action button', r1.toTripBtnsCount > 0 && r1.hasBtnText);

        // Test 2: Trigger openAddWishlistPinToTripModal on pin '1' (Kyoto Bamboo Forest)
        const step2 = await send('Runtime.evaluate', {
            expression: `
            (function() {
                const pin = window.wishlistPins[0];
                window.openAddWishlistPinToTripModal(pin.id);
                const modal = document.getElementById('add-wishlist-to-trip-modal');
                const nameEl = document.getElementById('add-pin-to-trip-name');
                const tripSelect = document.getElementById('add-pin-to-trip-select-trip');
                const stopSelect = document.getElementById('add-pin-to-trip-select-stop');
                const daySelect = document.getElementById('add-pin-to-trip-select-day');
                const catSelect = document.getElementById('add-pin-to-trip-select-cat');

                return {
                    modalVisible: modal && modal.style.display === 'flex',
                    displayedName: nameEl ? nameEl.textContent : '',
                    tripOptionsCount: tripSelect ? tripSelect.options.length : 0,
                    stopOptionsCount: stopSelect ? stopSelect.options.length : 0,
                    dayOptionsCount: daySelect ? daySelect.options.length : 0,
                    category: catSelect ? catSelect.value : ''
                };
            })()
            `,
            returnByValue: true
        });

        const r2 = step2.result.value;
        console.log('[Test 2] Add to Trip Modal Opened:', r2);
        assert('Modal opened with flex display', r2.modalVisible);
        assert('Modal displays target pin name', r2.displayedName.length > 0);
        assert('Modal populates trips dropdown', r2.tripOptionsCount > 0);
        assert('Modal populates stops dropdown', r2.stopOptionsCount > 0);
        assert('Modal populates days dropdown', r2.dayOptionsCount > 0);

        // Test 3: Confirm adding the pin to the trip stop and verify it appears in trip.places
        const step3 = await send('Runtime.evaluate', {
            expression: `
            (function() {
                const pin = window.wishlistPins[0];
                const trip = window.trips[0];
                const initialPlacesCount = (trip.places || []).length;

                // Select Stop 1 (Beijing or Shanghai) and Day 2
                const stopSelect = document.getElementById('add-pin-to-trip-select-stop');
                const daySelect = document.getElementById('add-pin-to-trip-select-day');
                if (stopSelect && stopSelect.options.length > 1) {
                    stopSelect.selectedIndex = 1;
                    window.handleAddPinStopChange();
                }

                window.confirmAddWishlistPinToTrip();
                const modal = document.getElementById('add-wishlist-to-trip-modal');
                const newPlacesCount = (trip.places || []).length;
                const addedPlace = trip.places[trip.places.length - 1];

                return {
                    modalClosed: modal.style.display === 'none',
                    placesIncremented: newPlacesCount === initialPlacesCount + 1,
                    addedName: addedPlace ? addedPlace.name : '',
                    addedCityIndex: addedPlace ? addedPlace.cityIndex : -1,
                    hasCoordinates: addedPlace && addedPlace.lat !== 0 && addedPlace.lon !== 0
                };
            })()
            `,
            returnByValue: true
        });

        const r3 = step3.result.value;
        console.log('[Test 3] Confirm Add to Trip:', r3);
        assert('Modal closed cleanly after adding', r3.modalClosed);
        assert('Trip places incremented by 1', r3.placesIncremented);
        assert('Added place retains correct name', r3.addedName === 'Kyoto Bamboo Forest');
        assert('Added place has valid coordinates', r3.hasCoordinates);

        // Test 4: Open Places view and check Wishlist Quick-Picker integration
        const step4 = await send('Runtime.evaluate', {
            expression: `
            (function() {
                window.switchTab('places');
                const trip = window.trips[0];
                window.openPlacesForTrip(trip.id);
                window.openPlacesCityView(1);
                window.openPlaceSearchModal();

                const pickerBtn = document.getElementById('toggle-wishlist-picker-btn');
                const btnVisible = pickerBtn && pickerBtn.style.display !== 'none';
                
                // Toggle open
                window.togglePlaceWishlistPicker();
                const picker = document.getElementById('place-wishlist-picker');
                const pickerVisible = picker && picker.style.display === 'block';
                const itemsCount = picker ? picker.querySelectorAll('button').length : 0;

                return {
                    btnVisible,
                    pickerVisible,
                    itemsCount
                };
            })()
            `,
            returnByValue: true
        });

        const r4 = step4.result.value;
        console.log('[Test 4] Places Search Modal Wishlist Picker:', r4);
        assert('Place search modal shows Wishlist import toggle', r4.btnVisible);
        assert('Toggling opens the wishlist quick-picker list', r4.pickerVisible && r4.itemsCount > 0);

        // Test 5: Verify zero broken images and zero console errors
        const step5 = await send('Runtime.evaluate', {
            expression: `
            (function() {
                const brokenImgs = Array.from(document.querySelectorAll('img')).filter(img => {
                    return img.src && img.complete && img.naturalWidth === 0 && !img.style.display.includes('none');
                }).map(img => img.src);

                return {
                    brokenImgs,
                    scrollW: document.documentElement.scrollWidth,
                    clientW: document.documentElement.clientWidth
                };
            })()
            `,
            returnByValue: true
        });

        const r5 = step5.result.value;
        console.log('[Test 5] Image & Layout Health:', r5);
        assert('Zero broken images detected', r5.brokenImgs.length === 0);
        assert('Zero horizontal overflow on mobile viewport', r5.scrollW <= r5.clientW + 2);
        assert('Zero uncaught exceptions / page errors', pageErrors.length === 0);
        assert('Zero console errors', consoleErrors.length === 0);

        console.log(`\nResults: ${passed}/${total} Checks Passed.`);
        ws.close();
        if (passed !== total) {
            process.exit(1);
        }
    } finally {
        chrome.kill();
    }
}

testWishlistToTrip().catch(err => {
    console.error(err);
    process.exit(1);
});
