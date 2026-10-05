const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_flighthub');
if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

async function testFlightHubBrowser() {
    console.log('=============================================================');
    console.log('   TRIPPO TRAVEL PLANNER - FLIGHT HUB BROWSER RUNTIME TEST');
    console.log('=============================================================\n');

    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=9293',
        `--user-data-dir=${USER_DATA_DIR}`,
        '--window-size=412,915',
        '--disable-gpu',
        '--no-first-run'
    ]);

    await new Promise(r => setTimeout(r, 2000));

    try {
        const tab = await (await fetch('http://127.0.0.1:9293/json/new?http://127.0.0.1:8080/', { method: 'PUT' })).json();
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

        ws.onmessage = (evt) => {
            const msg = JSON.parse(evt.data);
            if (msg.id && pending.has(msg.id)) {
                const { resolve, reject } = pending.get(msg.id);
                pending.delete(msg.id);
                if (msg.error) reject(msg.error);
                else resolve(msg.result);
            }
        };

        await send('Runtime.enable');
        await send('Page.enable');
        await send('Emulation.setDeviceMetricsOverride', {
            width: 412,
            height: 915,
            deviceScaleFactor: 2,
            mobile: true
        });

        async function evalExpr(expression) {
            const res = await send('Runtime.evaluate', {
                expression,
                returnByValue: true,
                awaitPromise: true
            });
            if (res.exceptionDetails) {
                throw new Error(res.exceptionDetails.text || res.exceptionDetails.exception?.description || 'Eval error');
            }
            return res.result?.value;
        }

        await send('Network.enable');
        await send('Network.clearBrowserCache');
        await send('Page.reload', { ignoreCache: true });
        await new Promise(r => setTimeout(r, 1500));

        // Wait for app load
        for (let i = 0; i < 30; i++) {
            const res = await send('Runtime.evaluate', { expression: `typeof window.initFlightHub === 'function'` });
            if (res.result?.value) break;
            await new Promise(r => setTimeout(r, 200));
        }

        // Open sidebar drawer and expand tools
        await evalExpr(`(() => {
            if (window.toggleSidebar) window.toggleSidebar(true);
            const group = document.getElementById('sidebar-tools-group');
            if (group && group.style.display === 'none' && window.toggleSidebarTools) {
                window.toggleSidebarTools();
            }
        })()`);
        await new Promise(r => setTimeout(r, 600));

        // 1. Initial Default State Check
        const initial = await evalExpr(`(() => {
            const input = document.getElementById('flight-hub-origin');
            const skyscanner = document.getElementById('flighthub-skyscanner');
            const google = document.getElementById('flighthub-googleflights');
            const flightconn = document.getElementById('flighthub-flightconnections');
            const kayak = document.getElementById('flighthub-kayak');
            const aviasales = document.getElementById('flighthub-aviasales');
            const deals = document.querySelectorAll('.flight-deal-item');

            return {
                val: input ? input.value : null,
                skyscannerHref: skyscanner ? skyscanner.href : null,
                googleHref: google ? google.href : null,
                flightconnHref: flightconn ? flightconn.href : null,
                kayakHref: kayak ? kayak.href : null,
                aviasalesHref: aviasales ? aviasales.href : null,
                dealCount: deals.length
            };
        })()`);

        assert.strictEqual(initial.val, 'LFT', 'Initial origin input should be LFT');
        assert.ok(initial.skyscannerHref.includes('/transport/flights-from/lft/'), 'Skyscanner default link');
        assert.ok(initial.googleHref.includes('flights+from+LFT+to+anywhere'), 'Google Flights default link');
        assert.ok(initial.flightconnHref.includes('/flights-from-lft'), 'FlightConnections default link');
        assert.ok(initial.kayakHref.includes('/explore/LFT'), 'Kayak Explore default link');
        assert.ok(initial.aviasalesHref.includes('origin=LFT'), 'Aviasales default link');
        console.log('  ✅ [PASS] Initial default airport (LFT) and 5 outbound links generated');

        // 2. Chip Click Interaction (MSY)
        await evalExpr(`window.selectFlightHubChip('MSY')`);
        const msyState = await evalExpr(`(() => {
            const input = document.getElementById('flight-hub-origin');
            const skyscanner = document.getElementById('flighthub-skyscanner');
            const google = document.getElementById('flighthub-googleflights');
            return {
                val: input.value,
                skyscanner: skyscanner.href,
                google: google.href
            };
        })()`);

        assert.strictEqual(msyState.val, 'MSY', 'Input should update to MSY');
        assert.ok(msyState.skyscanner.includes('/transport/flights-from/msy/'), 'Skyscanner should update to MSY');
        assert.ok(msyState.google.includes('flights+from+MSY+to+anywhere'), 'Google Flights should update to MSY');
        console.log('  ✅ [PASS] Quick-select chip click updates input and links to MSY in real time');

        // 3. User Typing & Sanitization (IAH)
        await evalExpr(`(() => {
            const input = document.getElementById('flight-hub-origin');
            input.value = 'iah';
            window.handleFlightHubOriginInput({ target: input });
        })()`);
        const iahState = await evalExpr(`(() => {
            const input = document.getElementById('flight-hub-origin');
            const kayak = document.getElementById('flighthub-kayak');
            return {
                val: input.value,
                kayak: kayak.href
            };
        })()`);

        assert.strictEqual(iahState.val, 'IAH', 'Input should be sanitized to uppercase IAH');
        assert.ok(iahState.kayak.includes('/explore/IAH'), 'Kayak should update to IAH');
        console.log('  ✅ [PASS] Manual input sanitizes to uppercase and updates targets');

        // 4. Set Default Button Persistence
        await evalExpr(`window.saveDefaultFlightHubOrigin()`);
        const savedState = await evalExpr(`(() => {
            const stored = localStorage.getItem('trippo_home_airport');
            const btn = document.getElementById('flight-hub-save-btn');
            return {
                stored,
                btnText: btn.innerText
            };
        })()`);

        assert.strictEqual(savedState.stored, 'IAH', 'trippo_home_airport should be saved in localStorage');
        assert.ok(savedState.btnText.includes('Saved'), 'Button text should indicate Saved state');
        console.log('  ✅ [PASS] Set Default saves IAH to localStorage with visual confirmation');

        // 5. Capture screenshot of Flight Hub in sidebar
        await evalExpr(`(() => {
            window.toggleSidebar(true);
            const card = document.querySelector('.flight-hub-card');
            if (card) {
                card.scrollIntoView({ behavior: 'instant', block: 'center' });
            }
        })()`);
        // Wait for 300ms transition to complete
        await new Promise(r => setTimeout(r, 600));

        const shot = await send('Page.captureScreenshot', { format: 'png' });
        const shotPath = path.join(__dirname, 'feature-flight-hub.png');
        fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
        console.log(`  📸 Screenshot saved to: ${shotPath}`);

        // Also copy screenshot to artifacts
        const artPath = "C:\\Users\\Jacob\\.gemini\\antigravity-ide\\brain\\2e5f8455-2bd0-4c5a-8577-f678d97d0ff1\\feature-flight-hub.png";
        fs.copyFileSync(shotPath, artPath);
        console.log(`  📸 Artifact copy saved to: ${artPath}`);

        console.log('\n=============================================================');
        console.log('All Browser Runtime Tests Passed Successfully (5/5)!');
        console.log('=============================================================');
    } finally {
        chrome.kill();
    }
}

testFlightHubBrowser().catch(err => {
    console.error('Fatal error in browser test:', err);
    process.exit(1);
});
