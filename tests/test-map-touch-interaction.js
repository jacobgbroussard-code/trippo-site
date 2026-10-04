const { spawn } = require('child_process');
const path = require('path');

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA = path.join(__dirname, 'scratch_chrome_touch_debug');

async function testTouchInteraction() {
    console.log('Testing touch interaction on #planner-map...');
    const chrome = spawn(CHROME, [
        '--headless=new',
        '--remote-debugging-port=9235',
        `--user-data-dir=${USER_DATA}`,
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=390,844'
    ]);

    await new Promise(r => setTimeout(r, 1500));

    try {
        const newTabRes = await fetch('http://127.0.0.1:9235/json/new?http://127.0.0.1:8080/', { method: 'PUT' });
        const targetTab = await newTabRes.json();
        const ws = new WebSocket(targetTab.webSocketDebuggerUrl);

        let msgId = 1;
        const pending = new Map();
        function send(method, params = {}) {
            return new Promise((resolve, reject) => {
                const id = msgId++;
                pending.set(id, { resolve, reject });
                ws.send(JSON.stringify({ id, method, params }));
            });
        }

        await new Promise((resolve, reject) => {
            ws.onopen = resolve;
            ws.onerror = reject;
        });

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.id && pending.has(msg.id)) {
                const { resolve, reject } = pending.get(msg.id);
                pending.delete(msg.id);
                if (msg.error) reject(msg.error);
                else resolve(msg.result);
            }
        };

        await send('Page.enable');
        await send('Runtime.enable');

        await send('Emulation.setUserAgentOverride', {
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
        });
        await send('Emulation.setDeviceMetricsOverride', {
            width: 390,
            height: 844,
            deviceScaleFactor: 3,
            mobile: true,
            screenOrientation: { angle: 0, type: 'portraitPrimary' }
        });
        await send('Emulation.setTouchEmulationEnabled', { enabled: true });

        await new Promise(r => setTimeout(r, 2000));

        async function evalJs(expr) {
            const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
            if (res.exceptionDetails) {
                console.error('Eval error:', res.exceptionDetails);
                throw new Error(res.exceptionDetails.text);
            }
            return res.result.value;
        }

        await evalJs(`switchTab('planner')`);
        await new Promise(r => setTimeout(r, 1500));

        const centerBefore = await evalJs(`
            (() => {
                if (!window.plannerMap) return null;
                const c = window.plannerMap.getCenter();
                return { lat: c.lat, lng: c.lng, zoom: window.plannerMap.getZoom() };
            })()
        `);
        console.log('Center before drag:', centerBefore);

        // Perform Touch Drag on the map at x: 200, y: 150
        console.log('Dispatching touch drag...');
        await send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x: 200, y: 150 }]
        });
        await new Promise(r => setTimeout(r, 100));

        await send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: 100, y: 150 }]
        });
        await new Promise(r => setTimeout(r, 100));

        await send('Input.dispatchTouchEvent', {
            type: 'touchEnd',
            touchPoints: []
        });
        await new Promise(r => setTimeout(r, 500));

        const centerAfter = await evalJs(`
            (() => {
                if (!window.plannerMap) return null;
                const c = window.plannerMap.getCenter();
                return { lat: c.lat, lng: c.lng, zoom: window.plannerMap.getZoom() };
            })()
        `);
        console.log('Center after drag:', centerAfter);

        const moved = (centerBefore && centerAfter && (centerBefore.lng !== centerAfter.lng || centerBefore.lat !== centerAfter.lat));
        console.log('Did map center move on touch drag?', moved);

        ws.close();
    } catch (e) {
        console.error('Touch test error:', e);
    } finally {
        chrome.kill();
    }
}

testTouchInteraction();
