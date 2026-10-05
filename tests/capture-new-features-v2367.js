const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_v2367');
if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

async function capture() {
    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=9292',
        `--user-data-dir=${USER_DATA_DIR}`,
        '--window-size=390,844',
        '--disable-gpu',
        '--no-first-run'
    ]);

    await new Promise(r => setTimeout(r, 2000));

    try {
        const tab = await (await fetch('http://127.0.0.1:9292/json/new?http://127.0.0.1:8080/', { method: 'PUT' })).json();
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

        // Wait for app load
        for (let i = 0; i < 20; i++) {
            const res = await send('Runtime.evaluate', { expression: `typeof window.openPackingModal === 'function'` });
            if (res.result?.value) break;
            await new Promise(r => setTimeout(r, 200));
        }

        // 1. Capture Packing Modal
        await send('Runtime.evaluate', {
            expression: `
                window.openTrip(window.trips[0].id);
                window.openPackingModal();
            `
        });
        await new Promise(r => setTimeout(r, 500));
        const snap1 = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(__dirname, 'feature-packing-modal.png'), Buffer.from(snap1.data, 'base64'));
        console.log('Saved feature-packing-modal.png');

        // Close packing modal & open places map to show GPS button
        await send('Runtime.evaluate', {
            expression: `
                window.closeModal('packing-modal');
                window.showView('places-view');
                if (window.trips[0]) {
                    window.openPlacesCityView(0);
                }
            `
        });
        await new Promise(r => setTimeout(r, 600));
        const snap2 = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(__dirname, 'feature-gps-map.png'), Buffer.from(snap2.data, 'base64'));
        console.log('Saved feature-gps-map.png');

    } catch (e) {
        console.error('Capture error:', e);
    } finally {
        chrome.kill();
    }
}

capture();
