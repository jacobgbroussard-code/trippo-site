const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_test_v2358');
if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

async function testNewFeaturesV2358() {
    console.log('=== Testing v2.3.58 5 High-Impact Polish & UX Features ===\n');

    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=9251',
        `--user-data-dir=${USER_DATA_DIR}`,
        '--disable-gpu',
        '--no-first-run'
    ]);

    await new Promise(r => setTimeout(r, 2500));

    try {
        const tab = await (await fetch('http://127.0.0.1:9251/json/new?http://localhost:8080/', { method: 'PUT' })).json();
        const ws = new WebSocket(tab.webSocketDebuggerUrl);
        await new Promise(r => ws.onopen = r);

        let id = 1;
        const pending = new Map();
        function send(method, params = {}) {
            return new Promise((resolve, reject) => {
                const reqId = id++;
                pending.set(reqId, { resolve, reject });
                ws.send(JSON.stringify({ id: reqId, method, params }));
            });
        }

        const pageErrors = [];
        ws.onmessage = (evt) => {
            const msg = JSON.parse(evt.data);
            if (msg.id && pending.has(msg.id)) {
                const { resolve, reject } = pending.get(msg.id);
                pending.delete(msg.id);
                if (msg.error) reject(msg.error);
                else resolve(msg.result);
            } else if (msg.method === 'Runtime.exceptionThrown') {
                pageErrors.push(msg.params.exceptionDetails);
            }
        };

        await send('Runtime.enable');
        await send('Page.enable');
        await new Promise(r => setTimeout(r, 2500));

        async function evalInBrowser(expr) {
            const res = await send('Runtime.evaluate', {
                expression: expr,
                returnByValue: true,
                awaitPromise: true
            });
            if (res.exceptionDetails) {
                throw new Error(res.exceptionDetails.text || 'Eval exception');
            }
            return res.result.value;
        }

        let passed = 0;
        let total = 0;
        function assert(desc, condition, details = '') {
            total++;
            if (condition) {
                console.log(`  ✅ ${desc}`);
                passed++;
            } else {
                console.error(`  ❌ FAIL: ${desc}`, details);
            }
        }

        // --- TEST 1: Haptic Feedback Helper ---
        console.log('[Test 1] Native Mobile Haptic Feedback (triggerHaptic):');
        const hapticTest = await evalInBrowser(`(() => {
            const fnExists = typeof window.triggerHaptic === 'function';
            let noThrow = true;
            try {
                window.triggerHaptic('light');
                window.triggerHaptic('medium');
                window.triggerHaptic('success');
                window.triggerHaptic('warning');
            } catch (e) {
                noThrow = false;
            }
            return { fnExists, noThrow };
        })()`);
        assert('triggerHaptic is defined on window', hapticTest.fnExists);
        assert('triggerHaptic safely executes all 4 intensity levels without errors', hapticTest.noThrow);

        // --- TEST 2: Auto-Category Detection ---
        console.log('\n[Test 2] Auto-Category Detection Engine:');
        const catTest = await evalInBrowser(`(() => {
            const hasDetect = typeof window.detectCategory === 'function';
            const cafe = window.detectCategory('Blue Bottle Coffee', 'Shinjuku Tokyo');
            const hotel = window.detectCategory('Park Hyatt Hotel', 'Tokyo');
            const food = window.detectCategory('Ichiran Ramen', 'Shibuya Tokyo');
            const shop = window.detectCategory('Dover Street Market Ginza', 'Tokyo');
            const see = window.detectCategory('Tokyo Tower Observatory', 'Minato Tokyo');

            return {
                hasDetect,
                cafeOk: cafe === '☕ Cafe & Chill',
                hotelOk: hotel === '🏨 Hotel / Base',
                foodOk: food === '🍽 Food & Drink',
                shopOk: shop === '🛍 Shopping',
                seeOk: see === '● See & Do'
            };
        })()`);
        assert('detectCategory function is exposed and callable', catTest.hasDetect);
        assert('Correctly maps coffee/cafe places to "☕ Cafe & Chill"', catTest.cafeOk);
        assert('Correctly maps hotel/stay places to "🏨 Hotel / Base"', catTest.hotelOk);
        assert('Correctly maps restaurant/ramen to "🍽 Food & Drink"', catTest.foodOk);
        assert('Correctly maps shopping/market to "🛍 Shopping"', catTest.shopOk);
        assert('Falls back to "● See & Do" for sightseeing/museums', catTest.seeOk);

        // --- TEST 3: 1-Tap Search Clear Buttons ---
        console.log('\n[Test 3] 1-Tap "✕" Clear Buttons on all 4 Search Inputs:');
        const clearBtnTest = await evalInBrowser(`(() => {
            const inputs = ['city-search-input', 'place-search-input', 'hotel-address-input', 'wishlist-search-input'];
            const allHaveWrappers = inputs.every(id => {
                const el = document.getElementById(id);
                return el && el.parentElement && el.parentElement.classList.contains('search-input-wrapper');
            });
            const allHaveClearBtns = inputs.every(id => {
                return !!document.getElementById('clear-' + id);
            });

            // Test interaction on city-search-input
            const testInput = document.getElementById('city-search-input');
            const testClear = document.getElementById('clear-city-search-input');
            testInput.value = 'Kyoto';
            testInput.dispatchEvent(new Event('input', { bubbles: true }));
            const isVisibleWhenTyped = testClear.style.display !== 'none';

            // Click clear button
            window.clearSearchField('city-search-input', 'city-search-results');
            const isCleared = testInput.value === '';
            const isHiddenWhenCleared = testClear.style.display === 'none';

            return {
                allHaveWrappers,
                allHaveClearBtns,
                isVisibleWhenTyped,
                isCleared,
                isHiddenWhenCleared
            };
        })()`);
        assert('All 4 search fields are wrapped with .search-input-wrapper', clearBtnTest.allHaveWrappers);
        assert('All 4 clear buttons (#clear-*) are present in the DOM', clearBtnTest.allHaveClearBtns);
        assert('Clear button becomes visible when text is typed', clearBtnTest.isVisibleWhenTyped);
        assert('Clicking clear button resets input value to empty', clearBtnTest.isCleared);
        assert('Clear button hides automatically when input is empty', clearBtnTest.isHiddenWhenCleared);

        // --- TEST 4: Connected Journey Timeline ---
        console.log('\n[Test 4] Connected Journey Timeline in Daily View:');
        const timelineTest = await evalInBrowser(`(() => {
            switchTab('places');
            openPlacesCityView(1); // Shanghai has places poi_1, poi_2
            const pins = document.querySelectorAll('#saved-places-container .timeline-node-pin');
            const firstIsStart = pins[0] && pins[0].classList.contains('start-pin') && pins[0].innerText.includes('🏨');
            
            // Check connectors
            const connectors = document.querySelectorAll('#saved-places-container .transit-connector-row');
            const cards = document.querySelectorAll('#saved-places-container .place-item-card');

            return {
                hasPins: pins.length > 0,
                firstIsStart,
                hasCards: cards.length > 0,
                cardsCount: cards.length
            };
        })()`);
        assert('Timeline node pins render with step indices or hotel icons', timelineTest.hasPins && timelineTest.firstIsStart);
        assert('Places cards render with integrated timeline structure', timelineTest.hasCards && timelineTest.cardsCount >= 1);

        // --- TEST 5: Smart Map Auto-Framing on Day Switching ---
        console.log('\n[Test 5] Smart Map Auto-Framing & Day Tab Transitions:');
        const autoFrameTest = await evalInBrowser(`(() => {
            let errorOccurred = false;
            try {
                switchPlacesDay(1); // Day 2
                switchPlacesDay(0); // Day 1
            } catch (e) {
                errorOccurred = true;
            }
            const activeTab = document.querySelector('.day-tab.active');
            const placesMapValid = !!window.placesMap && window.placesMap._loaded;

            return {
                smoothTransition: !errorOccurred,
                activeTabDay1: activeTab && activeTab.innerText.includes('Day 1'),
                placesMapValid
            };
        })()`);
        assert('Switching Day tabs auto-frames map smoothly with no exceptions', autoFrameTest.smoothTransition);
        assert('Active day tab updates correctly', autoFrameTest.activeTabDay1);
        assert('Places map remains loaded and interactive', autoFrameTest.placesMapValid);

        console.log('\n=============================================================');
        console.log(`v2.3.58 Polish Test Suite: ${passed}/${total} Checks Passed`);
        console.log(`Runtime Exceptions: ${pageErrors.length}`);
        console.log('=============================================================\n');

        const allOk = passed === total && pageErrors.length === 0;
        ws.close();
        chrome.kill();
        process.exit(allOk ? 0 : 1);
    } catch (e) {
        console.error('Fatal test error:', e);
        chrome.kill();
        process.exit(1);
    }
}

testNewFeaturesV2358();
