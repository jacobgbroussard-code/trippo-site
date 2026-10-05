const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_google_signin');
if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

async function capture() {
    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=9288',
        `--user-data-dir=${USER_DATA_DIR}`,
        '--window-size=390,844',
        '--disable-gpu',
        '--no-first-run'
    ]);

    await new Promise(r => setTimeout(r, 2000));

    try {
        const tab = await (await fetch('http://127.0.0.1:9288/json/new?http://127.0.0.1:8080/', { method: 'PUT' })).json();
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
            width: 390,
            height: 844,
            deviceScaleFactor: 2,
            mobile: true
        });

        // Wait for module load
        for (let i = 0; i < 20; i++) {
            const hasFn = await send('Runtime.evaluate', {
                expression: `typeof window.toggleSidebar === 'function'`
            });
            if (hasFn.result?.value) break;
            await new Promise(r => setTimeout(r, 200));
        }

        // Open sidebar
        await send('Runtime.evaluate', {
            expression: `window.toggleSidebar(true)`
        });

        // Wait for drawer slide-in transition
        await new Promise(r => setTimeout(r, 600));

        const snap = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(__dirname, 'google-signin-sidebar.png'), Buffer.from(snap.data, 'base64'));
        console.log('Saved screenshot to tests/google-signin-sidebar.png');
    } catch (e) {
        console.error('Error capturing screenshot:', e);
    } finally {
        chrome.kill();
    }
}

capture();
