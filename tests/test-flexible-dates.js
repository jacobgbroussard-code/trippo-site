const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_flexible_dates');

async function testFlexibleDates() {
    console.log('Testing Optional / Flexible Trip Start Dates in Trippo v2.3.71...');
    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=9296',
        `--user-data-dir=${USER_DATA_DIR}`,
        '--window-size=412,915',
        '--disable-gpu',
        '--no-first-run'
    ]);

    await new Promise(r => setTimeout(r, 2000));

    try {
        const tab = await (await fetch('http://127.0.0.1:9296/json/new?http://127.0.0.1:8080/', { method: 'PUT' })).json();
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
        await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });

        async function evalExpr(expression) {
            const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
            if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || 'Eval error');
            return res.result?.value;
        }

        await send('Network.enable');
        await send('Network.clearBrowserCache');
        await send('Page.reload', { ignoreCache: true });
        await new Promise(r => setTimeout(r, 1500));

        // 1. Create a trip WITHOUT entering a start date
        console.log('Step 1: Creating a trip without selecting a start date...');
        const createResult = await evalExpr(`(() => {
            openCreateTripModal();
            document.getElementById('new-trip-name').value = 'Dream Vacation (No Date Yet)';
            // Leave new-trip-date completely empty
            saveNewTrip();

            const created = trips.find(t => t.name === 'Dream Vacation (No Date Yet)');
            return {
                found: Boolean(created),
                startDate: created ? created.startDate : null,
                activeTripId: activeTripId,
                activeMatches: created ? created.id === activeTripId : false
            };
        })()`);
        console.log('Step 1 Result:', createResult);
        if (!createResult.found || createResult.startDate !== '') {
            throw new Error(`Trip creation without start date failed: ${JSON.stringify(createResult)}`);
        }

        // 2. Add 2 stops to this flexible trip
        console.log('Step 2: Adding stops to the flexible trip...');
        await evalExpr(`(() => {
            const trip = getActiveTrip();
            trip.stops = [
                { id: 's1', name: 'Kyoto', lat: 35.0116, lon: 135.7681, nights: 3, notes: ['', '', ''], transit: null, lodging: null, locked: false },
                { id: 's2', name: 'Osaka', lat: 34.6937, lon: 135.5023, nights: 2, notes: ['', ''], transit: null, lodging: null, locked: false }
            ];
            saveTrips();
            renderPlanner();
        })()`);
        await new Promise(r => setTimeout(r, 600));

        // 3. Verify Planner UI displays "Dates TBD" chip and "Days 1–X" for stops
        const plannerCheck = await evalExpr(`(() => {
            const chip = document.getElementById('planner-date-chip');
            const chipText = document.getElementById('planner-date-chip-text')?.innerText;
            const stopCards = document.querySelectorAll('#itinerary-list .stop-card');
            const stop1Subtitle = stopCards[0]?.querySelector('p')?.innerText;
            const stop2Subtitle = stopCards[1]?.querySelector('p')?.innerText;
            return {
                chipText,
                isTbdClass: chip?.classList.contains('tbd'),
                stop1Subtitle,
                stop2Subtitle
            };
        })()`);
        console.log('Step 3 Planner Check (Flexible):', plannerCheck);
        if (!plannerCheck.chipText.includes('Dates TBD') || !plannerCheck.stop1Subtitle.includes('Days 1–4')) {
            throw new Error(`Planner UI check failed: ${JSON.stringify(plannerCheck)}`);
        }

        // Capture screenshot of flexible planner
        const snap1 = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(__dirname, 'flexible-planner-no-date.png'), Buffer.from(snap1.data, 'base64'));
        console.log('Saved flexible-planner-no-date.png');

        // 4. Open Edit Trip Modal and set a date later!
        console.log('Step 4: Opening Edit Trip Modal to assign a start date...');
        await evalExpr(`openEditTripModal()`);
        await new Promise(r => setTimeout(r, 400));

        const modalCheck = await evalExpr(`(() => {
            const modal = document.getElementById('edit-trip-modal');
            const name = document.getElementById('edit-trip-name')?.value;
            const date = document.getElementById('edit-trip-date')?.value;
            return {
                modalVisible: modal?.style.display === 'flex',
                name,
                date
            };
        })()`);
        console.log('Step 4 Modal Check:', modalCheck);

        // Capture screenshot of edit modal
        const snap2 = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(__dirname, 'edit-trip-modal.png'), Buffer.from(snap2.data, 'base64'));
        console.log('Saved edit-trip-modal.png');

        // 5. Select a date e.g. 2026-11-20 and save
        console.log('Step 5: Setting start date to 2026-11-20 and saving...');
        await evalExpr(`(() => {
            const dateInput = document.getElementById('edit-trip-date');
            if (dateInput._flatpickr) {
                dateInput._flatpickr.setDate('2026-11-20', true);
            } else {
                dateInput.value = '2026-11-20';
            }
            saveEditedTrip();
        })()`);
        await new Promise(r => setTimeout(r, 500));

        // Verify Planner now shows calendar dates
        const datedPlannerCheck = await evalExpr(`(() => {
            const chip = document.getElementById('planner-date-chip');
            const chipText = document.getElementById('planner-date-chip-text')?.innerText;
            const stopCards = document.querySelectorAll('#itinerary-list .stop-card');
            const stop1Subtitle = stopCards[0]?.querySelector('p')?.innerText;
            const stop2Subtitle = stopCards[1]?.querySelector('p')?.innerText;
            return {
                chipText,
                isTbdClass: chip?.classList.contains('tbd'),
                stop1Subtitle,
                stop2Subtitle
            };
        })()`);
        console.log('Step 5 Dated Planner Check:', datedPlannerCheck);
        if (!datedPlannerCheck.chipText.includes('Nov 20') || !datedPlannerCheck.stop1Subtitle.includes('Nov 20')) {
            throw new Error(`Dated planner check failed: ${JSON.stringify(datedPlannerCheck)}`);
        }

        // 6. Check Home View rendering
        console.log('Step 6: Checking Home screen card with date & countdown badge...');
        await evalExpr(`switchTab('home')`);
        await new Promise(r => setTimeout(r, 400));

        const homeCheck = await evalExpr(`(() => {
            const cards = Array.from(document.querySelectorAll('#trip-list .trip-card'));
            const dreamCard = cards.find(c => c.innerText.includes('Dream Vacation'));
            return {
                cardFound: Boolean(dreamCard),
                cardText: dreamCard ? dreamCard.innerText.replace(/\\s+/g, ' ') : null
            };
        })()`);
        console.log('Step 6 Home Check:', homeCheck);

        // 7. Clear date back to flexible/TBD
        console.log('Step 7: Testing clearing date back to flexible TBD...');
        await evalExpr(`(() => {
            const dreamTrip = trips.find(t => t.name.includes('Dream Vacation'));
            openEditTripModal(dreamTrip.id);
            clearEditTripDate();
            saveEditedTrip();
        })()`);
        await new Promise(r => setTimeout(r, 500));

        const clearedCheck = await evalExpr(`(() => {
            const dreamTrip = trips.find(t => t.name.includes('Dream Vacation'));
            const cards = Array.from(document.querySelectorAll('#trip-list .trip-card'));
            const dreamCard = cards.find(c => c.innerText.includes('Dream Vacation'));
            return {
                startDate: dreamTrip?.startDate,
                cardText: dreamCard ? dreamCard.innerText.replace(/\\s+/g, ' ') : null
            };
        })()`);
        console.log('Step 7 Cleared Check:', clearedCheck);
        if (clearedCheck.startDate !== '' || !clearedCheck.cardText.includes('Dates TBD')) {
            throw new Error(`Clearing date failed: ${JSON.stringify(clearedCheck)}`);
        }

        const snap3 = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(__dirname, 'flexible-home-card.png'), Buffer.from(snap3.data, 'base64'));
        console.log('Saved flexible-home-card.png');

        console.log('\n🎉 ALL OPTIONAL & FLEXIBLE START DATE TESTS PASSED CLEANLY!');

    } finally {
        chrome.kill();
    }
}

testFlexibleDates().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
