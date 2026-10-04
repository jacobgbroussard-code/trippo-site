const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA = path.join(__dirname, 'scratch_chrome_test_safe_areas');

async function testIOSSafeAreas() {
    console.log('--- Testing iOS iPhone Standalone Safe Area Alignment ---');
    const chrome = spawn(CHROME, [
        '--headless=new',
        '--remote-debugging-port=9263',
        `--user-data-dir=${USER_DATA}`,
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=393,852'
    ]);
    await new Promise(r => setTimeout(r, 1500));

    try {
        const newTab = await (await fetch('http://127.0.0.1:9263/json/new?http://127.0.0.1:8080/', { method: 'PUT' })).json();
        const ws = new WebSocket(newTab.webSocketDebuggerUrl);
        let id = 1;
        const pending = new Map();
        const send = (method, params = {}) => new Promise((res, rej) => {
            const cur = id++;
            pending.set(cur, { res, rej });
            ws.send(JSON.stringify({ id: cur, method, params }));
        });
        await new Promise(r => ws.onopen = r);

        ws.onmessage = (msg) => {
            const data = JSON.parse(msg.data);
            if (data.id && pending.has(data.id)) {
                const { res, rej } = pending.get(data.id);
                pending.delete(data.id);
                if (data.error) rej(data.error);
                else res(data.result);
            }
        };

        await send('Page.enable');
        await send('Runtime.enable');
        await send('Emulation.setDeviceMetricsOverride', {
            width: 393,
            height: 852,
            deviceScaleFactor: 3,
            mobile: true
        });

        // Override safe area insets to simulate iPhone 15 Pro standalone mode
        await send('Emulation.setSafeAreaInsetsOverride', {
            insets: { top: 59, bottom: 34, left: 0, right: 0 }
        });

        await new Promise(r => setTimeout(r, 1500));

        const evaluation = await send('Runtime.evaluate', {
            expression: `(() => {
                // 1. Home header padding top
                const homeHeader = document.querySelector('#home-view .header-title');
                const homeHeaderStyle = window.getComputedStyle(homeHeader);
                const homeHeaderPaddingTop = parseFloat(homeHeaderStyle.paddingTop);

                // 2. Planner map controls top
                switchTab('planner');
                const plannerControls = document.querySelector('#planner-view .map-controls-row');
                const plannerControlsStyle = window.getComputedStyle(plannerControls);
                const plannerControlsTop = parseFloat(plannerControlsStyle.top);

                // 3. Stays & Lodging header padding top
                switchTab('bookings');
                const staysHeader = document.querySelector('#bookings-view .header-title');
                const staysHeaderStyle = window.getComputedStyle(staysHeader);
                const staysHeaderPaddingTop = parseFloat(staysHeaderStyle.paddingTop);

                // 4. Transit header padding top
                switchTab('transit');
                const transitHeader = document.querySelector('#transit-view .header-title');
                const transitHeaderStyle = window.getComputedStyle(transitHeader);
                const transitHeaderPaddingTop = parseFloat(transitHeaderStyle.paddingTop);

                // 5. Wishlists header padding top
                switchTab('wishlist');
                const wishlistHeader = document.querySelector('#wishlist-view .header-title');
                const wishlistHeaderStyle = window.getComputedStyle(wishlistHeader);
                const wishlistHeaderPaddingTop = parseFloat(wishlistHeaderStyle.paddingTop);

                // 6. Meta tag check
                const statusMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
                const statusContent = statusMeta ? statusMeta.getAttribute('content') : null;

                return {
                    homeHeaderPaddingTop,
                    plannerControlsTop,
                    staysHeaderPaddingTop,
                    transitHeaderPaddingTop,
                    wishlistHeaderPaddingTop,
                    statusContent,
                    safeAreaAppliedCorrectly: homeHeaderPaddingTop >= 59 && plannerControlsTop >= 59,
                    headersUniform: homeHeaderPaddingTop === staysHeaderPaddingTop && staysHeaderPaddingTop === transitHeaderPaddingTop
                };
            })()`,
            returnByValue: true
        });

        const val = evaluation.result?.value !== undefined ? evaluation.result.value : evaluation.result?.result?.value;
        console.log('Safe Area Test Result:', val);

        // Take a screenshot of the corrected Home view
        await send('Runtime.evaluate', { expression: `switchTab('home')` });
        await new Promise(r => setTimeout(r, 500));
        const screenshot = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(__dirname, 'iphone15_homescreen_safe_area.png'), Buffer.from(screenshot.data, 'base64'));
        console.log('Saved verification screenshot to tests/iphone15_homescreen_safe_area.png');

        ws.close();
    } finally {
        chrome.kill();
        try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch(e){}
    }
}

testIOSSafeAreas().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
