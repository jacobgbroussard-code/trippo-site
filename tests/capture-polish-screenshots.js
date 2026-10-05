const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_capture_polish');
if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

async function capturePolishScreenshots() {
    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=9252',
        `--user-data-dir=${USER_DATA_DIR}`,
        '--window-size=390,844',
        '--disable-gpu',
        '--no-first-run'
    ]);

    await new Promise(r => setTimeout(r, 2500));

    try {
        const tab = await (await fetch('http://127.0.0.1:9252/json/new?http://localhost:8080/', { method: 'PUT' })).json();
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
            deviceScaleFactor: 3,
            mobile: true
        });

        await new Promise(r => setTimeout(r, 2500));

        // 1. Screenshot of Connected Journey Timeline in Places view (Beijing has 2 stops)
        await send('Runtime.evaluate', {
            expression: `
                switchTab('places');
                openPlacesCityView(2);
            `
        });
        await new Promise(r => setTimeout(r, 1500));

        const snap1 = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(__dirname, 'polish-timeline-mobile.png'), Buffer.from(snap1.data, 'base64'));
        console.log('Saved polish-timeline-mobile.png');

        // 2. Open Place search modal, type query to show clear button and auto category
        await send('Runtime.evaluate', {
            expression: `
                openPlaceSearchModal();
                const inp = document.getElementById('place-search-input');
                inp.value = 'Blue Bottle Coffee';
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                inp.blur();
            `
        });
        await new Promise(r => setTimeout(r, 1000));

        const snap2 = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(__dirname, 'polish-search-clear-mobile.png'), Buffer.from(snap2.data, 'base64'));
        console.log('Saved polish-search-clear-mobile.png');

        ws.close();
        chrome.kill();
        process.exit(0);
    } catch (e) {
        console.error(e);
        chrome.kill();
        process.exit(1);
    }
}

capturePolishScreenshots();
