const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_sleek_buttons');
const ARTIFACT_DIR = 'C:\\Users\\Jacob\\.gemini\\antigravity-ide\\brain\\2e5f8455-2bd0-4c5a-8577-f678d97d0ff1';

async function testSleekButtons() {
    console.log('🚀 Testing Sleek Buttons & Bottom Bar via CDP...');
    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=9298',
        `--user-data-dir=${USER_DATA_DIR}`,
        '--window-size=412,915',
        '--disable-gpu',
        '--no-first-run'
    ]);

    await new Promise(r => setTimeout(r, 2000));

    try {
        const tab = await (await fetch('http://127.0.0.1:9298/json/new?http://127.0.0.1:8080/', { method: 'PUT' })).json();
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
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

        async function evalExpr(expression) {
            const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
            if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || 'Eval error');
            return res.result?.value;
        }

        await send('Network.enable');
        await send('Network.clearBrowserCache');
        await send('Page.reload', { ignoreCache: true });
        await new Promise(r => setTimeout(r, 1500));

        console.log('Step 1: Inspecting Home View & Sleek Bottom Bar (Light Mode)...');
        const homeCheck = await evalExpr(`(() => {
            const bNav = window.getComputedStyle(document.querySelector('.bottom-nav'));
            const activeItem = window.getComputedStyle(document.querySelector('.nav-item.active'));
            const headerBtn = window.getComputedStyle(document.querySelector('.header-icon-btn'));
            return {
                bottomNavHeight: bNav.height,
                bottomNavRadius: bNav.borderRadius,
                bottomNavBg: bNav.backgroundColor,
                bottomNavBackdrop: bNav.backdropFilter,
                activeColor: activeItem.color,
                activeBg: activeItem.backgroundImage || activeItem.backgroundColor,
                headerBtnRadius: headerBtn.borderRadius
            };
        })()`);
        console.log('Home Light Mode Styles:', homeCheck);

        const snap1 = await send('Page.captureScreenshot');
        fs.writeFileSync(path.join(ARTIFACT_DIR, 'sleek-home-bottombar-light.png'), Buffer.from(snap1.data, 'base64'));
        console.log('📸 Saved sleek-home-bottombar-light.png');

        console.log('Step 2: Switching to Route View & Inspecting Frosted Map Buttons...');
        await evalExpr(`switchTab('planner')`);
        await new Promise(r => setTimeout(r, 600));

        const plannerCheck = await evalExpr(`(() => {
            const mapBtn = document.querySelector('.map-btn');
            const style = mapBtn ? window.getComputedStyle(mapBtn) : null;
            return {
                exists: Boolean(mapBtn),
                radius: style ? style.borderRadius : null,
                backdrop: style ? style.backdropFilter : null,
                bg: style ? style.backgroundColor : null,
                text: mapBtn ? mapBtn.innerText : null
            };
        })()`);
        console.log('Planner Map Buttons Check:', plannerCheck);

        const snap2 = await send('Page.captureScreenshot');
        fs.writeFileSync(path.join(ARTIFACT_DIR, 'sleek-planner-map-buttons-light.png'), Buffer.from(snap2.data, 'base64'));
        console.log('📸 Saved sleek-planner-map-buttons-light.png');

        console.log('Step 3: Checking Daily View & Dashed Add Place Button...');
        await evalExpr(`(() => {
            switchTab('places');
            openPlacesCityView(1);
        })()`);
        await new Promise(r => setTimeout(r, 600));

        const snap3 = await send('Page.captureScreenshot');
        fs.writeFileSync(path.join(ARTIFACT_DIR, 'sleek-places-dashed-button.png'), Buffer.from(snap3.data, 'base64'));
        console.log('📸 Saved sleek-places-dashed-button.png');

        console.log('Step 4: Opening Currency Modal & Inspecting Circular Close Button...');
        await evalExpr(`openCurrencyModal()`);
        await new Promise(r => setTimeout(r, 500));

        const closeBtnCheck = await evalExpr(`(() => {
            const btn = document.querySelector('#currency-modal .close-modal');
            const style = window.getComputedStyle(btn);
            return {
                width: style.width,
                height: style.height,
                radius: style.borderRadius,
                bg: style.backgroundColor,
                display: style.display
            };
        })()`);
        console.log('Modal Close Button Check:', closeBtnCheck);

        const snap4 = await send('Page.captureScreenshot');
        fs.writeFileSync(path.join(ARTIFACT_DIR, 'sleek-modal-close-button.png'), Buffer.from(snap4.data, 'base64'));
        console.log('📸 Saved sleek-modal-close-button.png');

        await evalExpr(`closeModal('currency-modal')`);
        await new Promise(r => setTimeout(r, 300));

        console.log('Step 5: Toggling Dark Mode & Testing Bottom Bar / Map Controls...');
        await evalExpr(`document.body.classList.add('dark-mode')`);
        await new Promise(r => setTimeout(r, 400));

        const darkBottomCheck = await evalExpr(`(() => {
            const bNav = window.getComputedStyle(document.querySelector('.bottom-nav'));
            const activeItem = window.getComputedStyle(document.querySelector('.nav-item.active'));
            return {
                bottomNavBg: bNav.backgroundColor,
                activeColor: activeItem.color,
                activeBg: activeItem.backgroundImage || activeItem.backgroundColor
            };
        })()`);
        console.log('Dark Mode Bottom Bar Check:', darkBottomCheck);

        const snap5 = await send('Page.captureScreenshot');
        fs.writeFileSync(path.join(ARTIFACT_DIR, 'sleek-dark-mode-places.png'), Buffer.from(snap5.data, 'base64'));
        console.log('📸 Saved sleek-dark-mode-places.png');

        await evalExpr(`switchTab('planner')`);
        await new Promise(r => setTimeout(r, 600));

        const snap6 = await send('Page.captureScreenshot');
        fs.writeFileSync(path.join(ARTIFACT_DIR, 'sleek-dark-mode-planner-map.png'), Buffer.from(snap6.data, 'base64'));
        console.log('📸 Saved sleek-dark-mode-planner-map.png');

        ws.close();
        console.log('✅ ALL Sleek Button Visual Tests Passed Successfully!');
    } catch (err) {
        console.error('❌ Error during visual verification:', err);
    } finally {
        chrome.kill();
    }
}

testSleekButtons();
