const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_hotel');

async function testHotelBrowser() {
    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=9294',
        `--user-data-dir=${USER_DATA_DIR}`,
        '--window-size=412,915',
        '--disable-gpu',
        '--no-first-run'
    ]);

    await new Promise(r => setTimeout(r, 2000));

    try {
        const tab = await (await fetch('http://127.0.0.1:9294/json/new?http://127.0.0.1:8080/', { method: 'PUT' })).json();
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

        // Wait for app load
        for (let i = 0; i < 30; i++) {
            const res = await send('Runtime.evaluate', { expression: `typeof window.openTrip === 'function' && window.trips.length > 0` });
            if (res.result?.value) break;
            await new Promise(r => setTimeout(r, 200));
        }

        // Open first trip and switch to bookings tab
        await evalExpr(`(() => {
            if (window.trips && window.trips.length > 0) {
                window.openTrip(window.trips[0].id);
            }
        })()`);

        await new Promise(r => setTimeout(r, 600));

        await evalExpr(`(() => {
            if (window.switchTab) window.switchTab('bookings');
        })()`);

        await new Promise(r => setTimeout(r, 1200));

        const shot = await send('Page.captureScreenshot', { format: 'png' });
        const shotBuffer = Buffer.from(shot.data, 'base64');
        const shotPath = path.join(__dirname, 'feature-hotel-insights.png');
        fs.writeFileSync(shotPath, shotBuffer);
        const artPath = "C:\\Users\\Jacob\\.gemini\\antigravity-ide\\brain\\2e5f8455-2bd0-4c5a-8577-f678d97d0ff1\\feature-hotel-insights.png";
        fs.writeFileSync(artPath, shotBuffer);
        console.log('📸 Hotel screenshot saved to:', shotPath);

        ws.close();
    } finally {
        chrome.kill();
    }
}

testHotelBrowser().catch(console.error);
