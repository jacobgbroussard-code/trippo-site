const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_test_v2359');
if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

async function testSecurityAndUsabilityV2359() {
    console.log('=== Testing v2.3.59 Security Hardening & Usability Verification ===\n');

    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=9252',
        `--user-data-dir=${USER_DATA_DIR}`,
        '--disable-gpu',
        '--no-first-run'
    ]);

    await new Promise(r => setTimeout(r, 2500));

    try {
        const tab = await (await fetch('http://127.0.0.1:9252/json/new?http://localhost:8080/', { method: 'PUT' })).json();
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

        // --- TEST 1: XSS Defense Helpers (escapeHTML & escapeJS) ---
        console.log('[Test 1] XSS Defense Helpers:');
        const xssTest = await evalInBrowser(`(() => {
            const rawMalicious = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
            const escaped = window.escapeHTML ? window.escapeHTML(rawMalicious) : '';
            const safeNoLt = !escaped.includes('<') && !escaped.includes('>');
            const safeEntities = escaped.includes('&lt;') && escaped.includes('&gt;');

            const rawJS = 'hello"\\\'\\x60alert(1);';
            const escapedJS = window.escapeJS ? window.escapeJS(rawJS) : '';
            const safeNoQuotes = !escapedJS.includes('"') && !escapedJS.includes("'") && !escapedJS.includes(String.fromCharCode(96));

            return {
                hasHelpers: typeof window.escapeHTML === 'function' && typeof window.escapeJS === 'function',
                safeNoLt,
                safeEntities,
                safeNoQuotes
            };
        })()`);
        assert('escapeHTML and escapeJS are globally exposed on window', xssTest.hasHelpers);
        assert('escapeHTML neutralizes tags (< and >)', xssTest.safeNoLt && xssTest.safeEntities);
        assert('escapeJS neutralizes quotes and backticks for onclick handlers', xssTest.safeNoQuotes);

        // --- TEST 2: formatLocalDate robustness ---
        console.log('\n[Test 2] formatLocalDate Date Safety:');
        const dateTest = await evalInBrowser(`(() => {
            const resNull = window.formatLocalDate(null);
            const resUndefined = window.formatLocalDate(undefined);
            const resInvalid = window.formatLocalDate("invalid-date-string");
            const resValid = window.formatLocalDate(new Date('2026-10-04T12:00:00'));

            return {
                resNull,
                resUndefined,
                resInvalid,
                resValid
            };
        })()`);
        assert('formatLocalDate returns empty string on null/undefined without crashing', dateTest.resNull === '' && dateTest.resUndefined === '');
        assert('formatLocalDate returns empty string on invalid dates', dateTest.resInvalid === '');
        assert('formatLocalDate formats valid dates accurately (YYYY-MM-DD)', dateTest.resValid === '2026-10-04');

        // --- TEST 3: Modal Search Inputs & Clear Button Resets ---
        console.log('\n[Test 3] Modal Search Inputs & Clear Buttons:');
        const modalTest = await evalInBrowser(`(() => {
            window.openCitySearchModal();
            const cityInput = document.getElementById('city-search-input');
            const cityClear = document.getElementById('clear-city-search-input');
            const cityOk = cityInput && cityInput.value === '' && (!cityClear || cityClear.style.display === 'none');
            window.closeModal('city-search-modal');

            window.openPlaceSearchModal();
            const placeInput = document.getElementById('place-search-input');
            const placeClear = document.getElementById('clear-place-search-input');
            const placeOk = placeInput && placeInput.value === '' && (!placeClear || placeClear.style.display === 'none');
            window.closeModal('place-search-modal');

            window.openWishlistSearchModal();
            const wishInput = document.getElementById('wishlist-search-input');
            const wishClear = document.getElementById('clear-wishlist-search-input');
            const wishOk = wishInput && wishInput.value === '' && (!wishClear || wishClear.style.display === 'none');
            window.closeModal('wishlist-search-modal');

            return { cityOk, placeOk, wishOk };
        })()`);
        assert('City search modal resets input and hides clear button', modalTest.cityOk);
        assert('Daily place search modal resets input and hides clear button', modalTest.placeOk);
        assert('Wishlist search modal resets input and hides clear button', modalTest.wishOk);

        // --- TEST 4: Export App Data Version Check ---
        console.log('\n[Test 4] App Version v2.3.59 Consistency:');
        const verTest = await evalInBrowser(`(() => {
            const titleVer = document.title.includes('v2.3.59');
            const badgeVer = document.body.innerHTML.includes('v2.3.59');
            const swVer = localStorage.getItem('trippo_app_version') === '2.3.59';
            return { titleVer, badgeVer, swVer };
        })()`);
        assert('Document title has v2.3.59', verTest.titleVer);
        assert('Home view badge displays v2.3.59', verTest.badgeVer);
        assert('App version is tracked as 2.3.59 in storage', verTest.swVer);

        // --- TEST 5: Verify All Tabs Render Cleanly Without Errors ---
        console.log('\n[Test 5] Tab Switching & Full Render Suite:');
        const tabRender = await evalInBrowser(`(() => {
            window.switchTab('home');
            window.switchTab('planner');
            window.switchTab('places');
            window.switchTab('bookings');
            window.switchTab('transit');
            window.switchTab('wishlist');
            window.switchTab('home');
            return true;
        })()`);
        assert('All 6 main tabs switch and render without errors', tabRender);

        // --- Final Summary ---
        console.log('\n=============================================================');
        console.log(`Summary: ${passed}/${total} Checks Passed`);
        console.log(`Page Runtime Errors: ${pageErrors.length}`);
        console.log('=============================================================');

        if (pageErrors.length > 0) {
            console.error('Page Errors Details:', pageErrors);
        }

        ws.close();
        chrome.kill();
        process.exit((passed === total && pageErrors.length === 0) ? 0 : 1);
    } catch (err) {
        console.error('Test execution error:', err);
        chrome.kill();
        process.exit(1);
    }
}

testSecurityAndUsabilityV2359();
