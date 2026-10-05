const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_test_client_services');
if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

async function testClientServices() {
    console.log('=== Testing Client-Side Google Services in Chrome ===\n');

    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=9245',
        `--user-data-dir=${USER_DATA_DIR}`,
        '--disable-gpu',
        '--no-first-run'
    ]);

    await new Promise(r => setTimeout(r, 2500));

    try {
        const tab = await (await fetch('http://127.0.0.1:9245/json/new?https://trippo.top/', { method: 'PUT' })).json();
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

        await send('Runtime.enable');
        await new Promise(r => setTimeout(r, 3000));

        // 1. Test DirectionsService in browser
        const dirTest = await send('Runtime.evaluate', {
            expression: `
                new Promise((resolve) => {
                    try {
                        if (!window.google || !google.maps || !google.maps.DirectionsService) {
                            return resolve({ error: 'DirectionsService not defined' });
                        }
                        const ds = new google.maps.DirectionsService();
                        ds.route({
                            origin: { lat: 48.8584, lng: 2.2945 },
                            destination: { lat: 48.8606, lng: 2.3376 },
                            travelMode: google.maps.TravelMode.WALKING
                        }, (result, status) => {
                            resolve({
                                status,
                                duration: result?.routes?.[0]?.legs?.[0]?.duration?.text,
                                distance: result?.routes?.[0]?.legs?.[0]?.distance?.text
                            });
                        });
                    } catch (e) {
                        resolve({ error: e.message });
                    }
                })
            `,
            awaitPromise: true,
            returnByValue: true
        });

        console.log('1. DirectionsService Result:', JSON.stringify(dirTest.result.value, null, 2));

        // 2. Test Street View image element loading in browser
        const svTest = await send('Runtime.evaluate', {
            expression: `
                new Promise((resolve) => {
                    const img = new Image();
                    img.onload = () => resolve({ loaded: true, width: img.naturalWidth, height: img.naturalHeight });
                    img.onerror = (e) => resolve({ loaded: false, error: 'Failed to load' });
                    img.src = 'https://maps.googleapis.com/maps/api/streetview?size=400x200&location=48.8584,2.2945&key=AIzaSyBMvlLs5sfzrIpQlgmzw1YqTcScgIyzLDg';
                })
            `,
            awaitPromise: true,
            returnByValue: true
        });

        console.log('2. Street View Image Load:', JSON.stringify(svTest.result.value, null, 2));

        // 3. Test Places (New) client fetch
        const placesNewTest = await send('Runtime.evaluate', {
            expression: `
                fetch('https://places.googleapis.com/v1/places:autocomplete', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Goog-Api-Key': 'AIzaSyBMvlLs5sfzrIpQlgmzw1YqTcScgIyzLDg'
                    },
                    body: JSON.stringify({ input: 'Eiffel Tower' })
                })
                .then(r => r.json())
                .then(data => ({
                    status: 'OK',
                    count: data.suggestions ? data.suggestions.length : 0,
                    top: data.suggestions?.[0]?.placePrediction?.text?.text
                }))
                .catch(err => ({ status: 'Error', error: err.message }))
            `,
            awaitPromise: true,
            returnByValue: true
        });

        console.log('3. Places (New) Client Fetch:', JSON.stringify(placesNewTest.result.value, null, 2));

        chrome.kill();
        process.exit(0);
    } catch (e) {
        console.error('Error in test:', e);
        chrome.kill();
        process.exit(1);
    }
}

testClientServices();
