const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_live_mobile');

if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

async function debugLiveMobile() {
    console.log('=== Debugging Live https://trippo.top on Mobile Viewport ===\n');
    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=9228',
        `--user-data-dir=${USER_DATA_DIR}`,
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=390,844'
    ]);

    await new Promise(r => setTimeout(r, 1500));

    try {
        const newTabRes = await fetch('http://127.0.0.1:9228/json/new?https://trippo.top/', { method: 'PUT' });
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

        const consoleLogs = [];
        const pageErrors = [];

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
            } else if (msg.method === 'Runtime.consoleAPICalled') {
                consoleLogs.push({ type: msg.params.type, args: msg.params.args.map(a => a.value || a.description) });
            } else if (msg.method === 'Runtime.exceptionThrown') {
                pageErrors.push(msg.params.exceptionDetails);
            }
        };

        await send('Page.enable');
        await send('Runtime.enable');
        await send('DOM.enable');

        await send('Emulation.setDeviceMetricsOverride', {
            width: 390,
            height: 844,
            deviceScaleFactor: 3,
            mobile: true,
            screenOrientation: { angle: 0, type: 'portraitPrimary' }
        });
        await send('Emulation.setTouchEmulationEnabled', { enabled: true });

        console.log('Waiting for live page to load...');
        await new Promise(r => setTimeout(r, 3000));

        async function evalJs(expr) {
            const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
            if (res.exceptionDetails) {
                console.error('Eval error:', res.exceptionDetails);
                throw new Error(res.exceptionDetails.text);
            }
            return res.result.value;
        }

        const initInfo = await evalJs(`
            (() => {
                const trips = JSON.parse(localStorage.getItem('myTrips') || '[]');
                return {
                    tripsLength: trips.length,
                    activeTab: document.querySelector('.view.active')?.id,
                    activeNav: document.querySelector('.nav-item.active')?.id
                };
            })()
        `);
        console.log('Init info:', initInfo);

        // Click Route tab or click trip
        console.log('Clicking Route tab...');
        await evalJs(`
            (() => {
                const navRoute = document.getElementById('nav-planner');
                if (navRoute) navRoute.click();
            })()
        `);
        await new Promise(r => setTimeout(r, 1500));

        const plannerCheck = await evalJs(`
            (() => {
                const plannerView = document.getElementById('planner-view');
                const plannerMapEl = document.getElementById('planner-map');
                const sheet = document.querySelector('#planner-view .sheet');
                return {
                    viewActive: plannerView?.classList.contains('active'),
                    mapOffsetHeight: plannerMapEl?.offsetHeight,
                    mapClientHeight: plannerMapEl?.clientHeight,
                    mapStyleHeight: plannerMapEl?.style?.height,
                    mapComputedHeight: plannerMapEl ? window.getComputedStyle(plannerMapEl).height : null,
                    sheetOffsetHeight: sheet?.offsetHeight,
                    tilesCount: plannerMapEl?.querySelectorAll('.leaflet-tile').length,
                    errorImages: Array.from(plannerMapEl?.querySelectorAll('img') || []).filter(img => !img.complete || img.naturalWidth === 0).length
                };
            })()
        `);
        console.log('Planner Check on Live:\n', plannerCheck);

        const ss = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(__dirname, 'live-mobile-route.png'), Buffer.from(ss.data, 'base64'));
        console.log('Saved live-mobile-route.png');

        console.log('\nLive Console logs:', consoleLogs);
        console.log('\nLive Page errors:', pageErrors);

        ws.close();
    } finally {
        chrome.kill();
    }
}

debugLiveMobile().catch(console.error);
