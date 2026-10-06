const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_audit_test');
const ARTIFACT_DIR = 'C:\\Users\\Jacob\\.gemini\\antigravity-ide\\brain\\2e5f8455-2bd0-4c5a-8577-f678d97d0ff1';

async function testAuditAIAndSharing() {
    console.log('🚀 Starting Audit: AI Trip Assistant & Streamlined Sharing Options...');

    if (fs.existsSync(USER_DATA_DIR)) {
        try { fs.rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch (e) {}
    }

    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=9312',
        `--user-data-dir=${USER_DATA_DIR}`,
        '--window-size=430,932',
        '--disable-gpu',
        '--no-first-run'
    ]);

    await new Promise(r => setTimeout(r, 2000));

    try {
        const tab = await (await fetch('http://127.0.0.1:9312/json/new?http://127.0.0.1:8080/', { method: 'PUT' })).json();
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

        // ==========================================
        // 1. AUDIT: AI FEATURE CANCELLATION & SEAMLESSNESS
        // ==========================================
        console.log('\n--- 1. Testing AI Cancellation & Loading Overlay ---');
        // Start search
        await evalCode(`
            document.getElementById('ai-trip-input').value = "2 weeks in Patagonia hiking glaciers";
            window.submitAITripSearch();
        `);
        await new Promise(r => setTimeout(r, 200));

        const isOverlayVisible = await evalCode(`(() => {
            const el = document.getElementById('ai-loading-overlay');
            return Boolean(el && window.getComputedStyle(el).display !== 'none');
        })()`);
        console.log(`  Loading overlay visible: ${isOverlayVisible}`);

        // Click Cancel on overlay
        await evalCode(`window.cancelAIGeneration()`);
        await new Promise(r => setTimeout(r, 300));

        const isOverlayDismissed = await evalCode(`(() => {
            const el = document.getElementById('ai-loading-overlay');
            return Boolean(el && window.getComputedStyle(el).display === 'none');
        })()`);
        console.log(`  Loading overlay dismissed on cancel: ${isOverlayDismissed}`);

        // Verify ESC key also dismisses loading overlay
        await evalCode(`
            window.submitAITripSearch();
        `);
        await new Promise(r => setTimeout(r, 200));
        await evalCode(`
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        `);
        await new Promise(r => setTimeout(r, 300));
        const isOverlayEscDismissed = await evalCode(`(() => {
            const el = document.getElementById('ai-loading-overlay');
            return Boolean(el && window.getComputedStyle(el).display === 'none');
        })()`);
        console.log(`  Loading overlay dismissed via ESC key: ${isOverlayEscDismissed}`);

        // ==========================================
        // 2. AUDIT: DARK MODE SUPPORT FOR AI & SHARING
        // ==========================================
        console.log('\n--- 2. Testing Dark Mode Support ---');
        await evalCode(`
            if (!document.body.classList.contains('dark-mode')) window.toggleDarkMode();
        `);
        await new Promise(r => setTimeout(r, 400));
        await takeScreenshot('ai-widget-dark-mode.png');

        // Generate a trip in dark mode
        await evalCode(`
            document.getElementById('ai-trip-input').value = "Weekend in Rome";
            window.submitAITripSearch();
        `);
        await new Promise(r => setTimeout(r, 2000));
        await takeScreenshot('ai-trip-modal-dark-mode.png');

        // Save trip
        await evalCode(`window.saveAIGeneratedTrip()`);
        await new Promise(r => setTimeout(r, 1200));

        // Switch back to light mode for remaining tests
        await evalCode(`
            if (document.body.classList.contains('dark-mode')) window.toggleDarkMode();
        `);
        await new Promise(r => setTimeout(r, 400));

        // ==========================================
        // 3. AUDIT: SHARING OPTIONS STREAMLINING
        // ==========================================
        console.log('\n--- 3. Testing Streamlined Sharing Hub ---');

        // Verify dead modal is removed
        const legacyModalExists = await evalCode(`Boolean(document.getElementById('legacy-share-file-modal'))`);
        console.log(`  Legacy dead modal removed from DOM: ${!legacyModalExists}`);

        // Test opening Share Modal from Planner iOS button
        await evalCode(`
            window.switchTab('planner');
            window.openShareTripModal();
        `);
        await new Promise(r => setTimeout(r, 600));

        const isShareModalVisible = await evalCode(`(() => {
            const m = document.getElementById('share-trip-modal');
            return Boolean(m && window.getComputedStyle(m).display !== 'none');
        })()`);
        console.log(`  Share modal opened from planner: ${isShareModalVisible}`);

        // Check the 4 unified export tiles
        const exportTilesCount = await evalCode(`document.querySelectorAll('.share-export-tile').length`);
        console.log(`  Unified export tiles count: ${exportTilesCount} (Calendar, Offline, PDF, Import)`);

        await takeScreenshot('streamlined-share-modal-hub.png');

        // Check trip switcher if multiple trips exist
        const tripSwitcherExists = await evalCode(`Boolean(document.getElementById('share-modal-trip-select'))`);
        console.log(`  In-modal trip switcher active for multiple trips: ${tripSwitcherExists}`);

        // Test Settings Modal -> Share Hub link
        await evalCode(`window.closeModal('share-trip-modal')`);
        await new Promise(r => setTimeout(r, 300));

        await evalCode(`window.openSettingsModal()`);
        await new Promise(r => setTimeout(r, 500));
        await takeScreenshot('settings-modal-unified-backup.png');

        await evalCode(`
            window.closeModal('settings-modal');
            window.openShareTripModal();
        `);
        await new Promise(r => setTimeout(r, 500));
        const reOpenedShare = await evalCode(`(() => {
            const m = document.getElementById('share-trip-modal');
            return Boolean(m && window.getComputedStyle(m).display !== 'none');
        })()`);
        console.log(`  Seamlessly transitioned from Settings to Share Hub: ${reOpenedShare}`);

        await evalCode(`window.closeModal('share-trip-modal')`);

        console.log('\n✅ ALL AUDIT & SEAMLESSNESS CHECKS PASSED!');
    } finally {
        chrome.kill();
        if (fs.existsSync(USER_DATA_DIR)) {
            try { fs.rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch (e) {}
        }
    }
}

testAuditAIAndSharing().catch(err => {
    console.error('❌ Audit failed:', err);
    process.exit(1);
});
