const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_test_v2357');
if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

async function testNewFeatures() {
    console.log('=== Testing v2.3.57 Street View & Transit Features ===\n');

    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=9250',
        `--user-data-dir=${USER_DATA_DIR}`,
        '--disable-gpu',
        '--no-first-run'
    ]);

    await new Promise(r => setTimeout(r, 2500));

    try {
        const tab = await (await fetch('http://127.0.0.1:9250/json/new?http://localhost:8080/', { method: 'PUT' })).json();
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

        const pageErrors = [];
        ws.onmessage = (evt) => {
            const msg = JSON.parse(evt.data);
            if (msg.id && pending.has(msg.id)) {
                const { resolve, reject } = pending.get(msg.id);
                pending.delete(msg.id);
                if (msg.error) reject(msg.error);
                else resolve(msg.result);
            } else if (msg.method === 'Runtime.exceptionThrown') {
                pageErrors.push(msg.params.exceptionDetails);
            }
        };

        await send('Runtime.enable');
        await send('Page.enable');
        await new Promise(r => setTimeout(r, 2500));

        // 1. Test Street View helper functions on window
        const helpersTest = await send('Runtime.evaluate', {
            expression: `
                (() => {
                    const hasGetSv = typeof window.getStreetViewUrl === 'function';
                    const hasOpenSv = typeof window.openStreetViewModal === 'function';
                    const hasTransitEst = typeof window.calculateTransitEstimate === 'function';

                    const svUrl = hasGetSv ? window.getStreetViewUrl(48.8584, 2.2945) : '';
                    const walkTest = hasTransitEst ? window.calculateTransitEstimate(48.8584, 2.2945, 48.8606, 2.3376) : null;
                    const driveTest = hasTransitEst ? window.calculateTransitEstimate(48.8584, 2.2945, 48.7584, 2.2945) : null;

                    return {
                        hasGetSv,
                        hasOpenSv,
                        hasTransitEst,
                        svUrlValid: svUrl.includes('streetview') && svUrl.includes('48.8584'),
                        walkTest,
                        driveTest
                    };
                })()
            `,
            returnByValue: true
        });

        console.log('1. Helper Functions Test:', JSON.stringify(helpersTest.result.value, null, 2));

        // 2. Test DOM elements for Street View preview cards
        const domTest = await send('Runtime.evaluate', {
            expression: `
                (() => {
                    const hotelSvCard = document.getElementById('hotel-streetview-preview');
                    const placeSvCard = document.getElementById('place-streetview-preview');
                    const svModal = document.getElementById('streetview-modal');

                    return {
                        hasHotelSvCard: !!hotelSvCard,
                        hasPlaceSvCard: !!placeSvCard,
                        hasSvModal: !!svModal
                    };
                })()
            `,
            returnByValue: true
        });

        console.log('\n2. DOM Elements Test:', JSON.stringify(domTest.result.value, null, 2));

        // 3. Open Street View Modal and check population
        const modalOpenTest = await send('Runtime.evaluate', {
            expression: `
                (() => {
                    window.openStreetViewModal(48.8584, 2.2945, 'Eiffel Tower');
                    const modal = document.getElementById('streetview-modal');
                    const img = document.getElementById('streetview-modal-img');
                    const title = document.getElementById('streetview-modal-title');
                    const link = document.getElementById('streetview-gmaps-link');

                    return {
                        modalDisplay: modal ? window.getComputedStyle(modal).display : 'none',
                        imgSrc: img ? img.src : '',
                        title: title ? title.innerText : '',
                        linkHref: link ? link.href : ''
                    };
                })()
            `,
            returnByValue: true
        });

        console.log('\n3. Street View Modal Open Test:', JSON.stringify(modalOpenTest.result.value, null, 2));

        // 4. Test Itinerary rendering with transit badges
        const itineraryTest = await send('Runtime.evaluate', {
            expression: `
                (() => {
                    // Create mock trip with 2 places in a day
                    const mockTrip = {
                        id: 'test_trip_v2357',
                        name: 'Paris Test',
                        startDate: '2026-10-10',
                        stops: [{ id: 's1', name: 'Paris', lat: 48.8566, lon: 2.3522, nights: 2, lodging: null, transit: null }],
                        places: [
                            { id: 'p1', cityIndex: 0, dayIndex: 0, name: 'Eiffel Tower', lat: 48.8584, lon: 2.2945, category: '● See & Do', address: 'Champ de Mars' },
                            { id: 'p2', cityIndex: 0, dayIndex: 0, name: 'Louvre Museum', lat: 48.8606, lon: 2.3376, category: '🏛 Attractions', address: 'Rue de Rivoli' }
                        ]
                    };

                    window.trips = [mockTrip];
                    window.setActivePlacesTripId('test_trip_v2357');
                    window.setActivePlacesStopIndex(0);
                    window.setActivePlacesDayIndex(0);

                    window.renderCityPlaces();

                    const container = document.getElementById('saved-places-container');
                    const transitPills = Array.from(container.querySelectorAll('.transit-pill')).map(p => p.innerText.trim());
                    const svBtns = container.querySelectorAll('.streetview-btn').length;

                    return {
                        placesRendered: container.querySelectorAll('.place-item-card').length,
                        transitPills,
                        streetViewButtonsCount: svBtns
                    };
                })()
            `,
            returnByValue: true
        });

        console.log('\n4. Itinerary Transit & Street View Buttons Test:', JSON.stringify(itineraryTest.result.value, null, 2));

        console.log('\nPage Errors:', pageErrors.length);
        if (pageErrors.length > 0) {
            console.error(pageErrors);
        }

        chrome.kill();
        process.exit(0);
    } catch (e) {
        console.error('Test error:', e);
        chrome.kill();
        process.exit(1);
    }
}

testNewFeatures();
