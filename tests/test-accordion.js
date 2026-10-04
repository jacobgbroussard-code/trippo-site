const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA = path.join(__dirname, 'scratch_chrome_test_accordion');

async function testAccordion() {
    console.log('--- Testing Collapsible Settings Accordion ---');
    const chrome = spawn(CHROME, [
        '--headless=new',
        '--remote-debugging-port=9262',
        `--user-data-dir=${USER_DATA}`,
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=393,852'
    ]);
    await new Promise(r => setTimeout(r, 1500));

    try {
        const newTab = await (await fetch('http://127.0.0.1:9262/json/new?http://127.0.0.1:8080/', { method: 'PUT' })).json();
        const ws = new WebSocket(newTab.webSocketDebuggerUrl);
        let id = 1;
        const pending = new Map();
        const send = (method, params = {}) => new Promise((res, rej) => {
            const cur = id++;
            pending.set(cur, { res, rej });
            ws.send(JSON.stringify({ id: cur, method, params }));
        });
        await new Promise(r => ws.onopen = r);

        ws.onmessage = (msg) => {
            const data = JSON.parse(msg.data);
            if (data.id && pending.has(data.id)) {
                const { res, rej } = pending.get(data.id);
                pending.delete(data.id);
                if (data.error) rej(data.error);
                else res(data.result);
            }
        };

        await send('Page.enable');
        await send('Runtime.enable');
        await new Promise(r => setTimeout(r, 2000));

        const result = await send('Runtime.evaluate', {
            expression: `(() => {
                try {
                    toggleSidebar(true);
                    const group = document.getElementById('sidebar-settings-group');
                    const initialDisplay = group ? window.getComputedStyle(group).display : null;
                    
                    // Toggle open
                    toggleSidebarSettings();
                    const openedDisplay = group ? window.getComputedStyle(group).display : null;
                    
                    // Toggle close
                    toggleSidebarSettings();
                    const closedDisplay = group ? window.getComputedStyle(group).display : null;

                    return {
                        initialDisplay,
                        openedDisplay,
                        closedDisplay,
                        correctlyHiddenInitially: initialDisplay === 'none',
                        correctlyVisibleOnOpen: openedDisplay === 'block',
                        correctlyHiddenOnClose: closedDisplay === 'none'
                    };
                } catch(e) {
                    return { error: e.message };
                }
            })()`,
            returnByValue: true
        });

        console.log('Accordion Test Result:', result.result.value);
        ws.close();
    } finally {
        chrome.kill();
        try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch(e){}
    }
}

testAccordion().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
