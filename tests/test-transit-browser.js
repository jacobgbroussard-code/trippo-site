const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_transit_test');

if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

async function runBrowserTest() {
    console.log('=== TRIPPO TRANSIT DIRECTION BROWSER TEST ===\n');
    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=9231',
        `--user-data-dir=${USER_DATA_DIR}`,
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=414,896'
    ]);

    await new Promise(r => setTimeout(r, 1500));

    try {
        const newTabRes = await fetch('http://127.0.0.1:9231/json/new?http://127.0.0.1:8080/', { method: 'PUT' });
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
            } else if (msg.method === 'Runtime.exceptionThrown') {
                pageErrors.push(msg.params.exceptionDetails);
            }
        };

        await send('Page.enable');
        await send('Runtime.enable');

        await new Promise(r => setTimeout(r, 2000));

        // Inject sample trip with 3 places
        console.log('[Step 1] Injecting trip with multiple places for Day 1...');
        const injectRes = await send('Runtime.evaluate', {
            expression: `
            (() => {
                const testTrip = {
                    id: 'test_transit_trip_1',
                    name: 'Tokyo Explorer',
                    startDate: '2026-11-01',
                    stops: [
                        { name: 'Tokyo', lat: 35.6762, lon: 139.6503, nights: 3 }
                    ],
                    places: [
                        { id: 'p1', cityIndex: 0, dayIndex: 0, name: 'Hotel Gracery Shinjuku', category: '🏨 Hotel / Base', lat: 35.6946, lon: 139.7020, address: 'Kabukicho, Shinjuku' },
                        { id: 'p2', cityIndex: 0, dayIndex: 0, name: 'Meiji Jingu', category: '● See & Do', lat: 35.6764, lon: 139.6993, address: 'Yoyogikamizonocho, Shibuya', transitMode: 'walking' },
                        { id: 'p3', cityIndex: 0, dayIndex: 0, name: 'Tokyo Tower', category: '● See & Do', lat: 35.6586, lon: 139.7454, address: 'Minato City, Tokyo', transitMode: 'driving' }
                    ]
                };
                window.trips = [testTrip];
                window.setActiveTripId(testTrip.id);
                window.setActivePlacesTripId(testTrip.id);
                window.setActivePlacesStopIndex(0);
                window.setActivePlacesDayIndex(0);
                window.openPlacesCityView(0);
                return {
                    tripCount: window.trips.length,
                    activePlacesTripId: window.activePlacesTripId,
                    activePlacesStopIndex: window.activePlacesStopIndex
                };
            })()
            `,
            returnByValue: true
        });
        console.log('  Trip injected:', injectRes.result.value);

        await new Promise(r => setTimeout(r, 1200));

        // Verify timeline connector transit pills and mode switchers
        console.log('\n[Step 2] Checking timeline transit connectors and mode switchers...');
        const timelineCheck = await send('Runtime.evaluate', {
            expression: `
            (() => {
                const pills = document.querySelectorAll('.transit-pill');
                const switchers = document.querySelectorAll('.transit-mode-switcher');
                const links = document.querySelectorAll('.transit-estimate-link');
                const activeButtons = Array.from(document.querySelectorAll('.mode-icon-btn.active')).map(b => b.innerText.trim());

                return {
                    pillCount: pills.length,
                    switcherCount: switchers.length,
                    linkCount: links.length,
                    activeButtons: activeButtons,
                    linkTexts: Array.from(links).map(l => l.innerText.replace(/\\s+/g, ' ').trim())
                };
            })()
            `,
            returnByValue: true
        });
        console.log('  Timeline verification:', timelineCheck.result.value);
        if (timelineCheck.result.value.switcherCount !== 2) {
            throw new Error(`Expected 2 switchers between 3 places, got ${timelineCheck.result.value.switcherCount}`);
        }

        // Test mode switching via setPlaceTransitMode
        console.log('\n[Step 3] Switching commute mode for place 2 to transit (train)...');
        const switchModeRes = await send('Runtime.evaluate', {
            expression: `
            (() => {
                window.setPlaceTransitMode('p2', 'transit');
                const place = window.trips[0].places.find(p => p.id === 'p2');
                const activeButtons = Array.from(document.querySelectorAll('.mode-icon-btn.active')).map(b => b.innerText.trim());
                const links = Array.from(document.querySelectorAll('.transit-estimate-link')).map(l => l.innerText.replace(/\\s+/g, ' ').trim());
                return {
                    updatedMode: place.transitMode,
                    activeButtons,
                    links
                };
            })()
            `,
            returnByValue: true
        });
        console.log('  Switched mode result:', switchModeRes.result.value);
        if (switchModeRes.result.value.updatedMode !== 'transit') {
            throw new Error(`Expected updatedMode to be 'transit', got ${switchModeRes.result.value.updatedMode}`);
        }

        // Check map lines and markers
        console.log('\n[Step 4] Checking map segment polylines & midpoint mode badges...');
        const mapCheck = await send('Runtime.evaluate', {
            expression: `
            (() => {
                const segBadges = document.querySelectorAll('.transit-seg-icon');
                return {
                    badgeCount: segBadges.length,
                    badgeEmojis: Array.from(segBadges).map(b => b.innerText.trim()),
                    cLinesCount: window.cLines ? window.cLines.length : 0,
                    cMarkersCount: window.cMarkers ? window.cMarkers.length : 0
                };
            })()
            `,
            returnByValue: true
        });
        console.log('  Map state:', mapCheck.result.value);
        if (mapCheck.result.value.badgeCount !== 2) {
            throw new Error(`Expected 2 midpoint mode badges, got ${mapCheck.result.value.badgeCount}`);
        }

        // Check edit place modal transit mode dropdown
        console.log('\n[Step 5] Checking Edit Place modal transit mode dropdown...');
        const editModalCheck = await send('Runtime.evaluate', {
            expression: `
            (() => {
                window.openEditPlaceModal('p2');
                const group = document.getElementById('edit-poi-transit-mode-group');
                const select = document.getElementById('edit-poi-transit-mode');
                const groupDisplay = group ? group.style.display : null;
                const selectValue = select ? select.value : null;
                window.closeModal('edit-place-modal');
                return {
                    groupExists: !!group,
                    groupDisplay,
                    selectValue
                };
            })()
            `,
            returnByValue: true
        });
        console.log('  Edit Modal Transit Dropdown:', editModalCheck.result.value);
        if (editModalCheck.result.value.selectValue !== 'transit') {
            throw new Error(`Expected edit modal select value to be 'transit', got ${editModalCheck.result.value.selectValue}`);
        }

        console.log(`\nPage runtime errors: ${pageErrors.length}`);
        if (pageErrors.length > 0) {
            console.error('Errors encountered:', pageErrors);
            throw new Error('Runtime errors detected in page!');
        }

        console.log('\n🎉 ALL TRANSIT DIRECTION BROWSER CHECKS PASSED!\n');
    } finally {
        chrome.kill();
    }
}

runBrowserTest().catch(e => {
    console.error('Test failed:', e);
    process.exit(1);
});
