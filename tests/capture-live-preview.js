const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA = path.join(__dirname, 'scratch_chrome_live_snap');

async function capture() {
    console.log('Capturing live site screenshot...');
    const chrome = spawn(CHROME, [
        '--headless=new',
        '--remote-debugging-port=9280',
        `--user-data-dir=${USER_DATA}`,
        '--disable-gpu',
        '--no-first-run',
        '--window-size=412,915'
    ]);

    try {
        await new Promise(r => setTimeout(r, 1500));
        const newTab = await (await fetch('http://127.0.0.1:9280/json/new?https://trippo.top/?v=2.3.65', { method: 'PUT' })).json();
        const ws = new WebSocket(newTab.webSocketDebuggerUrl);

        let id = 1;
        const send = (method, params = {}) => new Promise((res, rej) => {
            const cur = id++;
            ws.onmessage = (e) => {
                const msg = JSON.parse(e.data);
                if (msg.id === cur) res(msg.result);
            };
            ws.send(JSON.stringify({ id: cur, method, params }));
        });

        await new Promise(r => ws.onopen = r);
        await send('Page.enable');
        await send('Runtime.enable');
        await new Promise(r => setTimeout(r, 3000));

        // Open trip and lock first stop
        await send('Runtime.evaluate', {
            expression: `(() => {
                if (window.trips && window.trips.length > 0) {
                    window.openTrip(window.trips[0].id);
                    setTimeout(() => {
                        window.toggleStopLock(null, 0);
                    }, 350);
                }
            })()`
        });

        await new Promise(r => setTimeout(r, 1800));

        const snap = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(__dirname, 'live-stop-locking-preview.png'), Buffer.from(snap.data, 'base64'));
        console.log('Saved screenshot to tests/live-stop-locking-preview.png');
        ws.close();
    } catch (e) {
        console.error('Capture error:', e);
    } finally {
        chrome.kill();
    }
}

capture();
