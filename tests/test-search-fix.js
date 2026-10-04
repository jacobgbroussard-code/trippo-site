const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_test_search_fix');
if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

async function testSearchFix() {
    console.log('=== Testing Resilient Search Fix (Google + Nominatim Hybrid) ===\n');

    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=9235',
        `--user-data-dir=${USER_DATA_DIR}`,
        '--disable-gpu',
        '--no-first-run'
    ]);

    await new Promise(r => setTimeout(r, 3000));

    try {
        const tab = await (await fetch('http://127.0.0.1:9235/json/new?http://localhost:8080/', { method: 'PUT' })).json();
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

        // Test 1: Verify inputs are NOT disabled and have no gm-err-autocomplete
        const inputState = await send('Runtime.evaluate', {
            expression: `
                (() => {
                    const ids = ['city-search-input', 'place-search-input', 'hotel-address-input', 'wishlist-search-input'];
                    return ids.map(id => {
                        const el = document.getElementById(id);
                        return {
                            id,
                            exists: !!el,
                            disabled: el ? el.disabled : null,
                            hasErrorClass: el ? el.classList.contains('gm-err-autocomplete') : null,
                            backgroundImage: el ? window.getComputedStyle(el).backgroundImage : null
                        };
                    });
                })()
            `,
            returnByValue: true
        });

        console.log('Test 1 - Input Armor Status:');
        console.log(JSON.stringify(inputState.result.value, null, 2));

        const allArmed = inputState.result.value.every(i => !i.disabled && (!i.backgroundImage || i.backgroundImage === 'none'));
        console.log('Armor Verified (None disabled, no error background):', allArmed);

        // Test 2: Open place search modal, type, verify Nominatim search produces results
        console.log('\nTest 2 - Testing Place Search typing & results:');
        await send('Runtime.evaluate', {
            expression: `
                (() => {
                    const modal = document.getElementById('place-search-modal');
                    modal.style.display = 'flex';
                    const input = document.getElementById('place-search-input');
                    input.focus();
                    input.value = 'Louvre Museum';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                })()
            `
        });

        // Wait for debounce and network
        await new Promise(r => setTimeout(r, 1800));

        const placeSearchResults = await send('Runtime.evaluate', {
            expression: `
                (() => {
                    const results = document.getElementById('place-search-results');
                    const items = Array.from(results.querySelectorAll('.search-result')).map(el => el.innerText.trim());
                    return {
                        resultsDisplay: results ? window.getComputedStyle(results).display : 'none',
                        itemsCount: items.length,
                        firstItem: items[0] || null
                    };
                })()
            `,
            returnByValue: true
        });

        console.log('Place search results:', JSON.stringify(placeSearchResults.result.value, null, 2));

        // Test 3: Click first result, verify place-add-form is populated
        console.log('\nTest 3 - Click search result:');
        const clickResult = await send('Runtime.evaluate', {
            expression: `
                (() => {
                    const firstResult = document.querySelector('#place-search-results .search-result');
                    if (firstResult) {
                        firstResult.click();
                        const form = document.getElementById('place-add-form');
                        const nameInput = document.getElementById('add-poi-name');
                        const latInput = document.getElementById('add-poi-lat');
                        const lonInput = document.getElementById('add-poi-lon');
                        return {
                            clicked: true,
                            formDisplay: window.getComputedStyle(form).display,
                            name: nameInput ? nameInput.value : '',
                            lat: latInput ? latInput.value : '',
                            lon: lonInput ? lonInput.value : ''
                        };
                    }
                    return { clicked: false };
                })()
            `,
            returnByValue: true
        });

        console.log('Selection Result:', JSON.stringify(clickResult.result.value, null, 2));

        // Test 4: City Search Modal test
        console.log('\nTest 4 - City Search:');
        await send('Runtime.evaluate', {
            expression: `
                (() => {
                    const modal = document.getElementById('city-search-modal');
                    modal.style.display = 'flex';
                    const input = document.getElementById('city-search-input');
                    input.focus();
                    input.value = 'Rome';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                })()
            `
        });

        await new Promise(r => setTimeout(r, 1800));

        const citySearchResults = await send('Runtime.evaluate', {
            expression: `
                (() => {
                    const results = document.getElementById('city-search-results');
                    const items = Array.from(results.querySelectorAll('.search-result')).map(el => el.innerText.trim());
                    return {
                        resultsDisplay: results ? window.getComputedStyle(results).display : 'none',
                        itemsCount: items.length,
                        firstItem: items[0] || null
                    };
                })()
            `,
            returnByValue: true
        });

        console.log('City search results:', JSON.stringify(citySearchResults.result.value, null, 2));

        console.log('\nPage Errors:', pageErrors.length);
        if (pageErrors.length > 0) {
            console.error(pageErrors);
        }

        chrome.kill();
        process.exit(0);
    } catch (e) {
        console.error('Test error:', e);
        chrome.kill();
        process.exit(1);
    }
}

testSearchFix();
