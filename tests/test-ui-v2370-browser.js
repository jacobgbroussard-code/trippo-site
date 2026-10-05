const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_v2370');

async function testUIV2370Browser() {
    console.log('Testing v2.3.70 Browser UI...');
    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=9295',
        `--user-data-dir=${USER_DATA_DIR}`,
        '--window-size=412,915',
        '--disable-gpu',
        '--no-first-run'
    ]);

    await new Promise(r => setTimeout(r, 2000));

    try {
        const tab = await (await fetch('http://127.0.0.1:9295/json/new?http://127.0.0.1:8080/', { method: 'PUT' })).json();
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

        // 1. Check Home Screen Countdown Badges
        const badges = await evalExpr(`(() => {
            const el = document.querySelectorAll('.trip-countdown-badge');
            return Array.from(el).map(e => e.innerText);
        })()`);
        console.log('Home Screen Badges:', badges);

        const homeShot = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(__dirname, 'feature-countdown-home.png'), Buffer.from(homeShot.data, 'base64'));

        // 2. Open First Trip & Check Weather Chips
        await evalExpr(`(() => {
            if (window.trips && window.trips.length > 0) {
                window.openTrip(window.trips[0].id);
            }
        })()`);
        await new Promise(r => setTimeout(r, 1500));

        const weatherChips = await evalExpr(`(() => {
            const el = document.querySelectorAll('.stop-weather-chip');
            return Array.from(el).map(e => ({ text: e.innerText, title: e.title, display: e.style.display }));
        })()`);
        console.log('Planner Weather Chips:', weatherChips);

        const plannerShot = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(__dirname, 'feature-weather-chips.png'), Buffer.from(plannerShot.data, 'base64'));

        // 3. Test Currency & Tipping Modal
        await evalExpr(`window.openCurrencyModal()`);
        await new Promise(r => setTimeout(r, 600));

        const currResult = await evalExpr(`document.getElementById('curr-result')?.innerText`);
        console.log('Currency Conversion Output:', currResult);

        const currShot = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(__dirname, 'feature-currency-modal.png'), Buffer.from(currShot.data, 'base64'));

        await evalExpr(`window.closeModal('currency-modal')`);
        await new Promise(r => setTimeout(r, 400));

        // 4. Test Travel eSIM Modal
        await evalExpr(`window.openEsimModal()`);
        await new Promise(r => setTimeout(r, 600));

        const esimShot = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(__dirname, 'feature-esim-modal.png'), Buffer.from(esimShot.data, 'base64'));
        console.log('📸 All feature screenshots captured successfully!');

        ws.close();
    } finally {
        chrome.kill();
    }
}

testUIV2370Browser().catch(console.error);
