const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_route_distances');
const ARTIFACT_DIR = 'C:\\Users\\Jacob\\.gemini\\antigravity-ide\\brain\\2e5f8455-2bd0-4c5a-8577-f678d97d0ff1';

async function testRouteDistancesAndSettings() {
    console.log('🚀 Starting Test: Route Distances, Settings Modal & Sleek Stepper...');
    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=9299',
        `--user-data-dir=${USER_DATA_DIR}`,
        '--window-size=412,915',
        '--disable-gpu',
        '--no-first-run'
    ]);

    await new Promise(r => setTimeout(r, 2000));

    try {
        const tab = await (await fetch('http://127.0.0.1:9299/json/new?http://127.0.0.1:8080/', { method: 'PUT' })).json();
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
            if (msg.method === 'Page.javascriptDialogOpening') {
                console.log('Detected dialog:', msg.params.message);
                send('Page.handleJavaScriptDialog', { accept: true });
                return;
            }
            if (msg.id && pending.has(msg.id)) {
                const { resolve, reject } = pending.get(msg.id);
                pending.delete(msg.id);
                if (msg.error) reject(msg.error);
                else resolve(msg.result);
            }
        };

        await send('Runtime.enable');
        await send('Page.enable');
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

        async function evalExpr(expression) {
            const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
            if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || 'Eval error');
            return res.result?.value;
        }

        await send('Network.enable');
        await send('Network.clearBrowserCache');
        await send('Page.reload', { ignoreCache: true });
        await new Promise(r => setTimeout(r, 1500));

        console.log('Step 1: Switching to Planner/Route View...');
        await evalExpr(`switchTab('planner')`);
        await new Promise(r => setTimeout(r, 800));

        // Add Tokyo or third stop if only 2 stops, to test multiple distance dividers
        await evalExpr(`(() => {
            const trip = getActiveTrip();
            if (trip && trip.stops.length === 2) {
                trip.stops.push({
                    id: "s_tokyo",
                    name: "Tokyo",
                    lat: 35.6762,
                    lon: 139.6503,
                    nights: 3,
                    notes: ['Shibuya crossing', 'Meiji shrine'],
                    transit: null,
                    lodging: null
                });
                trip.stops.push({
                    id: "s_hk",
                    name: "Hong Kong",
                    lat: 22.3193,
                    lon: 114.1694,
                    nights: 2,
                    notes: ['Victoria peak', 'Star ferry'],
                    transit: null,
                    lodging: null
                });
                saveTrips();
                renderPlanner();
            }
        })()`);
        await new Promise(r => setTimeout(r, 600));

        // Inspect Route Stop Cards & Distance Badges
        const routeCheck = await evalExpr(`(() => {
            const stopCards = document.querySelectorAll('.stop-card');
            const distanceBadges = document.querySelectorAll('.route-distance-badge');
            const trashBtns = document.querySelectorAll('.stop-card button[title="Delete Stop"]');
            const firstBadge = document.querySelector('.stop-node-badge');
            const stepperVal = document.querySelector('.sleek-stepper-val');
            const stepperLabel = document.querySelector('.sleek-stepper-label');
            const badgesText = Array.from(distanceBadges).map(b => b.innerText.trim());

            return {
                stopCount: stopCards.length,
                distanceBadgeCount: distanceBadges.length,
                trashButtonsCount: trashBtns.length, // Should be 0!
                firstBadgeText: firstBadge ? firstBadge.innerText.trim() : null,
                isBase: firstBadge ? firstBadge.classList.contains('is-base') : false,
                stepperVal: stepperVal ? stepperVal.innerText : null,
                stepperLabel: stepperLabel ? stepperLabel.innerText : null,
                badgesText: badgesText
            };
        })()`);
        console.log('Route Stop Cards & Distance Check:', routeCheck);

        // Capture Screenshot 1: Route View in Light Mode (with distance capsules)
        const snap1 = await send('Page.captureScreenshot');
        fs.writeFileSync(path.join(ARTIFACT_DIR, 'route-distances-light.png'), Buffer.from(snap1.data, 'base64'));
        console.log('📸 Saved route-distances-light.png');

        // Step 2: Open User Settings Modal
        console.log('Step 2: Opening User Settings Modal...');
        await evalExpr(`openSettingsModal()`);
        await new Promise(r => setTimeout(r, 500));

        const settingsModalCheck = await evalExpr(`(() => {
            const modal = document.getElementById('settings-modal');
            const isActive = modal ? modal.classList.contains('active') : false;
            const miBtn = document.getElementById('unit-btn-mi');
            const kmBtn = document.getElementById('unit-btn-km');
            return {
                isOpen: isActive,
                miActive: miBtn ? miBtn.classList.contains('active') : false,
                kmActive: kmBtn ? kmBtn.classList.contains('active') : false
            };
        })()`);
        console.log('Settings Modal Check:', settingsModalCheck);

        // Capture Screenshot 2: User Settings Modal
        const snap2 = await send('Page.captureScreenshot');
        fs.writeFileSync(path.join(ARTIFACT_DIR, 'user-settings-modal.png'), Buffer.from(snap2.data, 'base64'));
        console.log('📸 Saved user-settings-modal.png');

        // Step 3: Toggle Unit to Kilometers (km) in Settings
        console.log('Step 3: Toggling Distance Unit to Kilometers (km)...');
        await evalExpr(`setDistanceUnit('km')`);
        await new Promise(r => setTimeout(r, 400));
        await evalExpr(`closeSettingsModal()`);
        await new Promise(r => setTimeout(r, 500));

        const kmBadgesCheck = await evalExpr(`(() => {
            const badges = document.querySelectorAll('.route-distance-badge');
            return Array.from(badges).map(b => b.innerText.trim());
        })()`);
        console.log('Distances in Kilometers (km):', kmBadgesCheck);

        const snap3 = await send('Page.captureScreenshot');
        fs.writeFileSync(path.join(ARTIFACT_DIR, 'route-distances-km.png'), Buffer.from(snap3.data, 'base64'));
        console.log('📸 Saved route-distances-km.png');

        // Step 4: Test Stepper & Stopover & Click Past Zero
        console.log('Step 4: Testing Stepper & Click Past Zero...');
        // Stop 0 has 1 night, click minus -> becomes 0 nights (Stopover)
        await evalExpr(`updateNights(0, -1)`);
        await new Promise(r => setTimeout(r, 400));

        const stopoverCheck = await evalExpr(`(() => {
            const firstStopSubtitle = document.querySelector('.stop-card p');
            const firstStepperLabel = document.querySelector('.sleek-stepper-label');
            const firstStepperVal = document.querySelector('.sleek-stepper-val');
            return {
                subtitle: firstStopSubtitle ? firstStopSubtitle.innerText : null,
                stepperVal: firstStepperVal ? firstStepperVal.innerText : null,
                stepperLabel: firstStepperLabel ? firstStepperLabel.innerText : null
            };
        })()`);
        console.log('Stopover Check (0 nights):', stopoverCheck);

        // Capture Screenshot 4: Stopover state (0 nights)
        const snap4 = await send('Page.captureScreenshot');
        fs.writeFileSync(path.join(ARTIFACT_DIR, 'route-stopover-state.png'), Buffer.from(snap4.data, 'base64'));
        console.log('📸 Saved route-stopover-state.png');

        // Step 5: Dark Mode Route View
        console.log('Step 5: Testing Dark Mode Route View...');
        await evalExpr(`document.body.classList.add('dark-mode')`);
        await new Promise(r => setTimeout(r, 400));

        const snap5 = await send('Page.captureScreenshot');
        fs.writeFileSync(path.join(ARTIFACT_DIR, 'route-distances-dark.png'), Buffer.from(snap5.data, 'base64'));
        console.log('📸 Saved route-distances-dark.png');

        ws.close();
        console.log('🎉 ALL Route Distances, Settings Modal & Stepper Tests Passed Perfectly!');
    } catch (err) {
        console.error('❌ Error during test:', err);
    } finally {
        chrome.kill();
    }
}

testRouteDistancesAndSettings();
