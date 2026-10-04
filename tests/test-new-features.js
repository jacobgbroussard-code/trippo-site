const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA = path.join(__dirname, 'scratch_chrome_test_new_features');

async function testNewFeatures() {
    console.log('--- Testing New Features & Bug Fixes ---');
    const chrome = spawn(CHROME, [
        '--headless=new',
        '--remote-debugging-port=9261',
        `--user-data-dir=${USER_DATA}`,
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=393,852'
    ]);
    await new Promise(r => setTimeout(r, 1500));

    try {
        const newTab = await (await fetch('http://127.0.0.1:9261/json/new?http://127.0.0.1:8080/', { method: 'PUT' })).json();
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

        const resDaily = await send('Runtime.evaluate', {
            expression: `(() => {
                try {
                    switchTab('places');
                    const masterList = document.getElementById('places-master-list');
                    const cityView = document.getElementById('places-city-view');
                    const hasOpenMapBtn = !!document.body.innerText.includes('Open Map ›');
                    const cityVisible = cityView.style.display !== 'none' && cityView.offsetHeight > 0;
                    const placesMapInstance = !!window.placesMap;
                    const citySelect = document.getElementById('places-city-select');
                    const citySelectVisible = citySelect && citySelect.style.display !== 'none';
                    return { hasOpenMapBtn, cityVisible, placesMapInstance, citySelectVisible };
                } catch(err) {
                    return { error: err.message, stack: err.stack };
                }
            })()`,
            returnByValue: true
        });
        console.log('Daily Section Auto-Map Check:', resDaily.result.value);

        const resTransition = await send('Runtime.evaluate', {
            expression: `(() => {
                try {
                    showPlacesMasterList();
                    const masterList = document.getElementById('places-master-list');
                    const masterVisible = masterList.style.display !== 'none';
                    const hasOpenMapBtnInList = !!masterList.innerText.includes('Open Map ›');
                    
                    const firstTrip = document.querySelector('#places-trip-list .trip-card');
                    if (firstTrip) firstTrip.click();
                    
                    const cityView = document.getElementById('places-city-view');
                    const cityVisibleAfterClick = cityView.style.display !== 'none';
                    
                    return { masterVisible, hasOpenMapBtnInList, cityVisibleAfterClick };
                } catch (err) {
                    return { error: err.message, stack: err.stack };
                }
            })()`,
            returnByValue: true
        });
        console.log('Daily Master List to Map Transition Check:', resTransition.result.value);

        const resTripCom = await send('Runtime.evaluate', {
            expression: `(() => {
                try {
                    const hotelModal = document.getElementById('hotel-booking-modal');
                    const hotelTripCom = !!hotelModal.querySelector('button[onclick*="searchHotelOnTripCom"]');
                    const transitModal = document.getElementById('transit-booking-modal');
                    const transitTripCom = !!transitModal.querySelector('button[onclick*="searchTransitOnTripCom"]');
                    return { hotelTripCom, transitTripCom };
                } catch(err) {
                    return { error: err.message };
                }
            })()`,
            returnByValue: true
        });
        console.log('Other Trip.com Integrations Check:', resTripCom.result.value);

        ws.close();
    } finally {
        chrome.kill();
        try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch(e){}
    }
}

testNewFeatures().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
