const { spawn } = require('child_process');

async function waitForDeploy() {
    console.log('Waiting for GitHub Pages build and deployment to complete...');
    for (let i = 0; i < 20; i++) {
        try {
            const res = await fetch('https://api.github.com/repos/jacobgbroussard-code/trippo-site/actions/runs');
            if (res.ok) {
                const data = await res.json();
                if (data.workflow_runs && data.workflow_runs.length > 0) {
                    const latest = data.workflow_runs[0];
                    console.log(`[Attempt ${i + 1}] Status: ${latest.status}, Conclusion: ${latest.conclusion}`);
                    if (latest.status === 'completed' && latest.conclusion === 'success') {
                        return true;
                    }
                }
            }
        } catch (e) {}
        await new Promise(r => setTimeout(r, 6000));
    }
    return false;
}

async function verifyLive() {
    await waitForDeploy();

    console.log('\nVerifying live site https://trippo.top/ with headless Chrome...\n');
    const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
        '--headless=new',
        '--remote-debugging-port=9258',
        '--disable-gpu',
        '--no-first-run'
    ]);

    await new Promise(r => setTimeout(r, 2500));

    try {
        const tab = await (await fetch('http://127.0.0.1:9258/json/new?https://trippo.top/?t=' + Date.now(), { method: 'PUT' })).json();
        const ws = new WebSocket(tab.webSocketDebuggerUrl);
        await new Promise(r => ws.onopen = r);

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

        await new Promise(r => setTimeout(r, 4000));

        const title = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
        const hasEscapeHTML = await send('Runtime.evaluate', { expression: 'typeof window.escapeHTML === "function"', returnByValue: true });
        const hasEscapeJS = await send('Runtime.evaluate', { expression: 'typeof window.escapeJS === "function"', returnByValue: true });
        const verBadge = await send('Runtime.evaluate', { expression: 'document.body.innerHTML.includes("v2.3.59")', returnByValue: true });

        console.log('=== Live Production Verification (https://trippo.top) ===');
        console.log('Title:', title.result?.value);
        console.log('Version Badge v2.3.59:', verBadge.result?.value);
        console.log('escapeHTML XSS Helper Active:', hasEscapeHTML.result?.value);
        console.log('escapeJS XSS Helper Active:', hasEscapeJS.result?.value);
        console.log('Runtime Errors:', errors.length);

        ws.close();
        chrome.kill();
        process.exit(errors.length === 0 ? 0 : 1);
    } catch (e) {
        console.error('Verification error:', e);
        chrome.kill();
        process.exit(1);
    }
}

verifyLive();
