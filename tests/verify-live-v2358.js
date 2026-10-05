const { spawn } = require('child_process');
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9256',
    '--disable-gpu',
    '--no-first-run'
]);

setTimeout(async () => {
    try {
        const tab = await (await fetch('http://127.0.0.1:9256/json/new?https://trippo.top/', { method: 'PUT' })).json();
        const ws = new WebSocket(tab.webSocketDebuggerUrl);
        ws.onopen = async () => {
            let id = 1;
            function send(m, p={}) {
                return new Promise(r => {
                    const reqId = id++;
                    ws.send(JSON.stringify({ id: reqId, method: m, params: p }));
                    const h = (e) => {
                        const msg = JSON.parse(e.data);
                        if (msg.id === reqId) {
                            ws.removeEventListener('message', h);
                            r(msg.result);
                        }
                    };
                    ws.addEventListener('message', h);
                });
            }
            await send('Runtime.enable');
            const errors = [];
            ws.onmessage = (evt) => {
                const msg = JSON.parse(evt.data);
                if (msg.method === 'Runtime.exceptionThrown') {
                    errors.push(msg.params.exceptionDetails);
                }
            };

            await new Promise(r => setTimeout(r, 3500));

            const title = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
            const clearBtns = await send('Runtime.evaluate', { expression: 'document.querySelectorAll(".search-clear-btn").length', returnByValue: true });
            const hasHaptic = await send('Runtime.evaluate', { expression: 'typeof window.triggerHaptic === "function"', returnByValue: true });
            const hasDetect = await send('Runtime.evaluate', { expression: 'typeof window.detectCategory === "function"', returnByValue: true });

            console.log('=== Live Production Verification (https://trippo.top) ===');
            console.log('Title:', title.result?.value);
            console.log('Clear Buttons in DOM:', clearBtns.result?.value);
            console.log('Haptic Helper Active:', hasHaptic.result?.value);
            console.log('Detect Category Engine Active:', hasDetect.result?.value);
            console.log('Runtime Errors:', errors.length);

            ws.close();
            chrome.kill();
            process.exit(errors.length === 0 ? 0 : 1);
        };
    } catch (e) {
        console.error(e);
        chrome.kill();
        process.exit(1);
    }
}, 2500);
