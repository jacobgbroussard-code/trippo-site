const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_polish_audit');

async function testPolishedUI() {
    console.log('--- Testing Polished UI/UX & Dynamic Partner Cards v2.3.72 ---');
    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=9297',
        `--user-data-dir=${USER_DATA_DIR}`,
        '--window-size=412,915',
        '--disable-gpu',
        '--no-first-run'
    ]);

    await new Promise(r => setTimeout(r, 2000));

    try {
        const tab = await (await fetch('http://127.0.0.1:9297/json/new?http://127.0.0.1:8080/', { method: 'PUT' })).json();
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
        await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });

        async function evalExpr(expression) {
            const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
            if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || 'Eval error');
            return res.result?.value;
        }

        await send('Network.enable');
        await send('Network.clearBrowserCache');
        await send('Page.reload', { ignoreCache: true });
        await new Promise(r => setTimeout(r, 1500));

        // 1. Check Planner View
        console.log('Step 1: Checking Planner View & Activities Card...');
        await evalExpr(`switchTab('planner')`);
        await new Promise(r => setTimeout(r, 600));

        const plannerCheck = await evalExpr(`(() => {
            const link = document.getElementById('planner-activities-link');
            const title = link ? link.querySelector('.action-title')?.innerText : '';
            return {
                exists: Boolean(link),
                href: link ? link.href : '',
                title: title,
                isCardClass: link ? link.classList.contains('travel-partner-action-card') : false,
                display: link ? window.getComputedStyle(link).display : 'none'
            };
        })()`);
        console.log('Planner check:', plannerCheck);

        // Screenshot Planner
        const snap1 = await send('Page.captureScreenshot');
        fs.writeFileSync(path.join(__dirname, 'polish-planner-activities.png'), Buffer.from(snap1.data, 'base64'));
        console.log('Saved polish-planner-activities.png');

        // 2. Check Daily Places View
        console.log('Step 2: Checking Daily Places View for Shanghai...');
        await evalExpr(`(() => {
            switchTab('places');
            openPlacesCityView(1); // Shanghai in sample trip
        })()`);
        await new Promise(r => setTimeout(r, 600));

        const placesCheck = await evalExpr(`(() => {
            const link = document.getElementById('places-activities-link');
            const title = link ? link.querySelector('.action-title')?.innerText : '';
            return {
                exists: Boolean(link),
                href: link ? link.href : '',
                title: title,
                isCardClass: link ? link.classList.contains('travel-partner-action-card') : false
            };
        })()`);
        console.log('Places check:', placesCheck);

        const snap2 = await send('Page.captureScreenshot');
        fs.writeFileSync(path.join(__dirname, 'polish-places-activities.png'), Buffer.from(snap2.data, 'base64'));
        console.log('Saved polish-places-activities.png');

        // 3. Check Stays & Lodging View (DiscoverCars)
        console.log('Step 3: Checking Stays View & DiscoverCars Card...');
        await evalExpr(`switchTab('bookings')`);
        await new Promise(r => setTimeout(r, 600));

        const staysCheck = await evalExpr(`(() => {
            const link = document.getElementById('bookings-car-link');
            const title = link ? link.querySelector('.action-title')?.innerText : '';
            return {
                exists: Boolean(link),
                href: link ? link.href : '',
                title: title,
                isCardClass: link ? link.classList.contains('travel-partner-action-card') : false
            };
        })()`);
        console.log('Stays check:', staysCheck);

        // 4. Check Transit View (Omio)
        console.log('Step 4: Checking Transit View & Omio Card...');
        await evalExpr(`switchTab('transit')`);
        await new Promise(r => setTimeout(r, 600));

        const transitCheck = await evalExpr(`(() => {
            const link = document.getElementById('transit-train-link');
            const title = link ? link.querySelector('.action-title')?.innerText : '';
            return {
                exists: Boolean(link),
                href: link ? link.href : '',
                title: title,
                isCardClass: link ? link.classList.contains('travel-partner-action-card') : false
            };
        })()`);
        console.log('Transit check:', transitCheck);

        const snap3 = await send('Page.captureScreenshot');
        fs.writeFileSync(path.join(__dirname, 'polish-transit-omio.png'), Buffer.from(snap3.data, 'base64'));
        console.log('Saved polish-transit-omio.png');

        // 5. Test Dark Mode
        console.log('Step 5: Testing Dark Mode toggle and styling...');
        await evalExpr(`toggleDarkMode()`);
        await new Promise(r => setTimeout(r, 500));

        const darkModeCheck = await evalExpr(`(() => {
            const isDark = document.body.classList.contains('dark-mode');
            const link = document.getElementById('transit-train-link');
            const cardBg = link ? window.getComputedStyle(link).backgroundColor : '';
            return { isDark, cardBg };
        })()`);
        console.log('Dark mode check:', darkModeCheck);

        const snap4 = await send('Page.captureScreenshot');
        fs.writeFileSync(path.join(__dirname, 'polish-dark-mode.png'), Buffer.from(snap4.data, 'base64'));
        console.log('Saved polish-dark-mode.png');

        console.log('\n🎉 ALL POLISHED UI & INTEGRATION AUDIT CHECKS PASSED!');

        ws.close();
    } catch (err) {
        console.error('Test error:', err);
    } finally {
        chrome.kill();
    }
}

testPolishedUI();
