const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_debug_places');
if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

async function debugPlacesLive() {
    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=9228',
        `--user-data-dir=${USER_DATA_DIR}`,
        '--disable-gpu',
        '--no-first-run'
    ]);

    await new Promise(r => setTimeout(r, 1500));

    try {
        const tab = await (await fetch('http://127.0.0.1:9228/json/new?https://trippo.top/', { method: 'PUT' })).json();
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
            } else if (msg.method === 'Runtime.consoleAPICalled') {
                console.log('CONSOLE [' + msg.params.type + ']:', msg.params.args.map(a => a.value || a.description || JSON.stringify(a)).join(' '));
            } else if (msg.method === 'Runtime.exceptionThrown') {
                console.error('EXCEPTION:', msg.params.exceptionDetails.text, msg.params.exceptionDetails.exception?.description);
            } else if (msg.method === 'Network.responseReceived') {
                if (msg.params.response.url.includes('googleapis') || msg.params.response.url.includes('maps')) {
                    console.log('NET RESPONSE:', msg.params.response.status, msg.params.response.url);
                }
            }
        };

        await send('Runtime.enable');
        await send('Page.enable');
        await send('Network.enable');

        await new Promise(r => setTimeout(r, 4000));

        // Use CDP Input.dispatchKeyEvent to type like a real keyboard
        await send('Runtime.evaluate', {
            expression: `
                const modal = document.getElementById('place-search-modal');
                if (modal) modal.style.display = 'flex';
                const placeInput = document.getElementById('place-search-input');
                if (placeInput) placeInput.focus();
            `
        });

        // Type 'P', 'a', 'r', 'i', 's'
        for (const char of ['P', 'a', 'r', 'i', 's']) {
            await send('Input.dispatchKeyEvent', { type: 'keyDown', text: char });
            await send('Input.dispatchKeyEvent', { type: 'keyUp' });
            await new Promise(r => setTimeout(r, 300));
        }

        await new Promise(r => setTimeout(r, 2000));

        // Evaluate state
        const res = await send('Runtime.evaluate', {
            expression: `
                (() => {
                    const placeInput = document.getElementById('place-search-input');
                    const errorImages = Array.from(document.querySelectorAll('img[src*="icon_error"], img[src*="error"]')).map(img => ({
                        src: img.src,
                        parent: img.parentElement ? img.parentElement.tagName + '.' + img.parentElement.className : null,
                        outerHTML: img.outerHTML
                    }));

                    const allImages = Array.from(document.querySelectorAll('img')).map(img => img.src);
                    
                    const alerts = Array.from(document.querySelectorAll('.gm-err-container, .gm-err-content, [class*="gm-err"], [class*="pac-"]')).map(el => ({
                        tag: el.tagName,
                        className: el.className,
                        text: el.innerText,
                        html: el.innerHTML
                    }));

                    return {
                        inputValue: placeInput ? placeInput.value : null,
                        inputDisabled: placeInput ? placeInput.disabled : null,
                        errorImages,
                        allImages,
                        alerts
                    };
                })()
            `,
            returnByValue: true
        });

        console.log('DEBUG EVAL 2:', JSON.stringify(res.result.value, null, 2));

        // Wait another 3s to capture any delayed network responses or errors
        await new Promise(r => setTimeout(r, 3000));

        chrome.kill();
        process.exit(0);
    } catch (e) {
        console.error('Error running debug:', e);
        chrome.kill();
        process.exit(1);
    }
}

debugPlacesLive();
