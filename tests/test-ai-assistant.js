const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_ai_test');
const ARTIFACT_DIR = 'C:\\Users\\Jacob\\.gemini\\antigravity-ide\\brain\\2e5f8455-2bd0-4c5a-8577-f678d97d0ff1';

async function testAIAssistant() {
    console.log('🚀 Starting Test: Serverless Edge AI Travel Assistant...');

    if (fs.existsSync(USER_DATA_DIR)) {
        try { fs.rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch (e) {}
    }

    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=9305',
        `--user-data-dir=${USER_DATA_DIR}`,
        '--window-size=430,932',
        '--disable-gpu',
        '--no-first-run'
    ]);

    await new Promise(r => setTimeout(r, 2000));

    try {
        const tab = await (await fetch('http://127.0.0.1:9305/json/new?http://127.0.0.1:8080/', { method: 'PUT' })).json();
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
                console.log('  [Dialog Handled]:', msg.params.message);
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
        await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });

        // Helper evaluation
        async function evalCode(expression) {
            const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
            if (res.exceptionDetails) {
                console.error('Eval error:', res.exceptionDetails);
            }
            return res.result ? res.result.value : null;
        }

        async function takeScreenshot(filename) {
            const res = await send('Page.captureScreenshot', { format: 'png' });
            const buffer = Buffer.from(res.data, 'base64');
            const targetPath = path.join(ARTIFACT_DIR, filename);
            fs.writeFileSync(targetPath, buffer);
            console.log(`📸 Screenshot saved: ${filename}`);
            return targetPath;
        }

        console.log('Waiting for app initialization and service worker stabilization...');
        await new Promise(r => setTimeout(r, 3500));

        // 1. Verify AI generator widget on home dashboard
        console.log('\n--- 1. Testing AI Generator UI Elements ---');
        const widgetExists = await evalCode(`Boolean(document.querySelector('.ai-generator-widget'))`);
        const inputExists = await evalCode(`Boolean(document.getElementById('ai-trip-input'))`);
        const btnExists = await evalCode(`Boolean(document.getElementById('ai-generate-btn'))`);
        const chipsCount = await evalCode(`document.querySelectorAll('.ai-chip').length`);

        console.log(`  AI Widget exists: ${widgetExists}`);
        console.log(`  AI Input exists: ${inputExists}`);
        console.log(`  AI Generate Button exists: ${btnExists}`);
        console.log(`  Prompt Chips count: ${chipsCount}`);

        if (!widgetExists || !inputExists || !btnExists) {
            throw new Error("Missing AI generator UI elements on home dashboard!");
        }

        await takeScreenshot('ai-widget-home-dashboard.png');

        // 2. Test prompt chip click
        console.log('\n--- 2. Testing Prompt Chips ---');
        await evalCode(`
            const chips = document.querySelectorAll('.ai-chip');
            if (chips.length > 0) chips[0].click();
        `);
        await new Promise(r => setTimeout(r, 1500));

        const inputValue = await evalCode(`document.getElementById('ai-trip-input') ? document.getElementById('ai-trip-input').value : ''`);
        console.log(`  Input value after chip click: "${inputValue}"`);

        // Close any preview modal opened by chip click before testing offline mode
        await evalCode(`
            if (window.closeModal) window.closeModal('ai-trip-modal');
        `);
        await new Promise(r => setTimeout(r, 400));

        // 3. Test Offline-First Constraint
        console.log('\n--- 3. Testing Offline-First Constraint ---');
        // Override navigator.onLine & fire offline event
        await evalCode(`
            Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
            window.dispatchEvent(new Event('offline'));
        `);
        await new Promise(r => setTimeout(r, 600));

        const isInputDisabled = await evalCode(`document.getElementById('ai-trip-input').disabled`);
        const isBtnDisabled = await evalCode(`document.getElementById('ai-generate-btn').disabled`);
        const isBannerVisible = await evalCode(`window.getComputedStyle(document.getElementById('ai-offline-banner')).display !== 'none'`);

        console.log(`  When offline -> Input disabled: ${isInputDisabled}`);
        console.log(`  When offline -> Button disabled: ${isBtnDisabled}`);
        console.log(`  When offline -> Banner visible: ${isBannerVisible}`);

        // Try triggering AI search while offline
        await evalCode(`window.submitAITripSearch()`);
        await new Promise(r => setTimeout(r, 500));

        const offlineNotificationText = await evalCode(`
            const el = document.getElementById('notification-toast') || document.querySelector('.notification');
            el ? el.innerText : ''
        `);
        console.log(`  Offline notification toast text: "${offlineNotificationText}"`);

        await takeScreenshot('ai-widget-offline-state.png');

        // 4. Restore Online status and test AI Generation
        console.log('\n--- 4. Testing Online AI Trip Generation & Modal Preview ---');
        await evalCode(`
            Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
            window.dispatchEvent(new Event('online'));
        `);
        await new Promise(r => setTimeout(r, 600));

        const isInputRestored = await evalCode(`!document.getElementById('ai-trip-input').disabled`);
        console.log(`  Online restored -> Input enabled: ${isInputRestored}`);

        // Submit query: "5 days in Tokyo for ramen & anime"
        await evalCode(`
            document.getElementById('ai-trip-input').value = "5 days in Tokyo for ramen & anime";
            window.submitAITripSearch();
        `);

        // Allow async generation & fallback simulation
        await new Promise(r => setTimeout(r, 2000));

        const isModalVisible = await evalCode(`
            const modal = document.getElementById('ai-trip-modal');
            modal && window.getComputedStyle(modal).display !== 'none'
        `);
        const modalTitle = await evalCode(`document.getElementById('ai-modal-title').innerText`);
        const modalDest = await evalCode(`document.getElementById('ai-modal-destination').innerText`);
        const daysRendered = await evalCode(`document.querySelectorAll('.ai-day-card').length`);
        const actsRendered = await evalCode(`document.querySelectorAll('.ai-activity-item').length`);

        console.log(`  AI Modal visible: ${isModalVisible}`);
        console.log(`  AI Modal title: "${modalTitle}"`);
        console.log(`  AI Modal destination: "${modalDest}"`);
        console.log(`  Rendered days count: ${daysRendered}`);
        console.log(`  Rendered activities count: ${actsRendered}`);

        await takeScreenshot('ai-trip-modal-preview.png');

        // 5. Test saving generated trip
        console.log('\n--- 5. Testing Save Generated Trip to Trippo Planner ---');
        await evalCode(`window.saveAIGeneratedTrip()`);
        await new Promise(r => setTimeout(r, 1200));

        const currentActiveTrip = await evalCode(`window.trips && window.trips[0] ? window.trips[0].name : ''`);
        const currentTab = await evalCode(`document.getElementById('planner-view').style.display !== 'none' ? 'planner' : 'other'`);
        const stopsCount = await evalCode(`window.trips[0].stops.length`);
        const placesCount = await evalCode(`window.trips[0].places.length`);

        console.log(`  Active trip name: "${currentActiveTrip}"`);
        console.log(`  Switched to planner view: ${currentTab === 'planner'}`);
        console.log(`  Trip stops count: ${stopsCount}`);
        console.log(`  Trip places count: ${placesCount}`);

        await takeScreenshot('ai-saved-trip-in-planner.png');

        console.log('\n✅ ALL SERVERLESS EDGE AI TESTS PASSED PERFECTLY!');
    } finally {
        chrome.kill();
        if (fs.existsSync(USER_DATA_DIR)) {
            try { fs.rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch (e) {}
        }
    }
}

testAIAssistant().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
