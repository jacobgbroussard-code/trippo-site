const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA = path.join(__dirname, 'scratch_chrome_route_debug');

async function testMobileRouteMap() {
    console.log('Testing mobile route map in iPhone Safari emulation...');
    const chrome = spawn(CHROME, [
        '--headless=new',
        '--remote-debugging-port=9233',
        `--user-data-dir=${USER_DATA}`,
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=390,844'
    ]);

    await new Promise(r => setTimeout(r, 1500));

    try {
        const newTabRes = await fetch('http://127.0.0.1:9233/json/new?http://127.0.0.1:8080/', { method: 'PUT' });
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

        // Switch to planner view
        console.log('Switching to planner view...');
        await evalJs(`
            (() => {
                switchTab('planner');
            })()
        `);
        await new Promise(r => setTimeout(r, 1500));

        // Inspect map elements
        const mapInfo = await evalJs(`
            (() => {
                const mapEl = document.getElementById('planner-map');
                if (!mapEl) return { found: false };
                const rect = mapEl.getBoundingClientRect();
                const computed = getComputedStyle(mapEl);
                const tiles = mapEl.querySelectorAll('.leaflet-tile');
                const tilePanes = mapEl.querySelectorAll('.leaflet-pane');
                const tileSrcs = Array.from(tiles).slice(0, 5).map(t => ({
                    src: t.src,
                    complete: t.complete,
                    naturalWidth: t.naturalWidth,
                    width: t.width,
                    height: t.height,
                    opacity: getComputedStyle(t).opacity,
                    display: getComputedStyle(t).display,
                    visibility: getComputedStyle(t).visibility
                }));

                const markers = mapEl.querySelectorAll('.leaflet-marker-icon, .leaflet-interactive');
                
                // Element at center of map
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                const elAtCenter = document.elementFromPoint(centerX, centerY);

                return {
                    found: true,
                    rect: { width: rect.width, height: rect.height, top: rect.top, left: rect.left },
                    zIndex: computed.zIndex,
                    pointerEvents: computed.pointerEvents,
                    hasLeafletMap: !!window.plannerMap,
                    tilesCount: tiles.length,
                    markersCount: markers.length,
                    tileSample: tileSrcs,
                    elAtCenterTag: elAtCenter ? elAtCenter.tagName : null,
                    elAtCenterClass: elAtCenter ? elAtCenter.className : null,
                    elAtCenterId: elAtCenter ? elAtCenter.id : null
                };
            })()
        `);

        console.log('Map Inspection Info:', JSON.stringify(mapInfo, null, 2));

        // Take screenshot
        const screenshot = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(__dirname, 'route-map-mobile.png'), Buffer.from(screenshot.data, 'base64'));
        console.log('Screenshot saved to route-map-mobile.png');

        console.log('Console logs:', consoleLogs);
        console.log('Page errors:', pageErrors);

        ws.close();
    } catch (e) {
        console.error('Test error:', e);
    } finally {
        chrome.kill();
    }
}

testMobileRouteMap();
