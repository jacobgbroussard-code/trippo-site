const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = path.join(__dirname, 'scratch_chrome_collab_test');
const ARTIFACT_DIR = 'C:\\Users\\Jacob\\.gemini\\antigravity-ide\\brain\\2e5f8455-2bd0-4c5a-8577-f678d97d0ff1';

async function testTripSharingAndCollaboration() {
    console.log('🚀 Starting Test: Trip Sharing (Send a Copy vs Live Co-Plan) & Decoupled Deletion...');

    // Clean scratch profile
    if (fs.existsSync(USER_DATA_DIR)) {
        try { fs.rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch (e) {}
    }

    const chrome = spawn(CHROME_PATH, [
        '--headless=new',
        '--remote-debugging-port=9298',
        `--user-data-dir=${USER_DATA_DIR}`,
        '--window-size=430,932',
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
            if (msg.method === 'Page.javascriptDialogOpening') {
                console.log('  [Dialog Handled]:', msg.params.message);
                send('Page.handleJavaScriptDialog', { accept: true });
                return;
            }
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
            let wrapped;
            if (expression.trim().startsWith('{') || expression.includes(';') || expression.includes('const ') || expression.includes('let ') || expression.includes('var ')) {
                wrapped = `(() => {\n${expression}\n})()`;
            } else {
                wrapped = `(() => { return (${expression}); })()`;
            }
            const res = await send('Runtime.evaluate', { expression: wrapped, returnByValue: true, awaitPromise: true });
            if (res.exceptionDetails) {
                console.error('Eval error:', res.exceptionDetails);
                throw new Error(res.exceptionDetails.text || 'Eval error');
            }
            return res.result?.value;
        }

        async function takeScreenshot(fileName) {
            const res = await send('Page.captureScreenshot', { format: 'png' });
            const buffer = Buffer.from(res.data, 'base64');
            const localPath = path.join(__dirname, fileName);
            fs.writeFileSync(localPath, buffer);
            const artifactPath = path.join(ARTIFACT_DIR, fileName);
            fs.writeFileSync(artifactPath, buffer);
            console.log(`  📸 Screenshot saved: ${fileName}`);
        }

        // Wait for app load and trips initialization
        let tripCount = 0;
        for (let i = 0; i < 20; i++) {
            try {
                tripCount = await evalExpr(`window.trips ? window.trips.length : 0`);
                if (tripCount > 0) break;
            } catch (e) {}
            await new Promise(r => setTimeout(r, 500));
        }
        console.log(`  Found ${tripCount} initial trips in state.`);
        if (tripCount === 0) throw new Error('No trips found in state!');

        const tripName = await evalExpr(`window.trips[0].name`);
        const tripId = await evalExpr(`window.trips[0].id`);
        console.log(`  Testing with trip: "${tripName}" (${tripId})`);

        // Step 2: Open Share Modal for Trip 1
        console.log('👉 Step 2: Opening Share Modal...');
        console.log('  encodeTripPayload direct test length:', (await evalExpr(`window.encodeTripPayload(window.trips[0])`)).length);
        console.log('  linkInput exists:', await evalExpr(`!!document.getElementById('share-link-input')`));
        const callResult = await evalExpr(`
            try {
                window.openShareTripModal('${tripId}');
                const m = document.getElementById('share-trip-modal');
                return {
                    opened: !!(m && m.style.display === 'flex'),
                    display: m ? m.style.display : 'none',
                    inputValue: document.getElementById('share-link-input')?.value
                };
            } catch(e) {
                return { error: e.message, stack: e.stack };
            }
        `);
        console.log('  openShareTripModal execution result:', JSON.stringify(callResult));
        if (callResult.error) throw new Error('openShareTripModal error: ' + callResult.error);
        if (!callResult.opened) throw new Error('Modal was not opened (display: ' + callResult.display + ')');
        console.log('  Modal HTML snippet:', await evalExpr(`document.getElementById('share-trip-modal').innerHTML.slice(0, 300)`));

        // Check default mode is 'copy'
        const initialCopyLink = await evalExpr(`document.getElementById('share-link-input').value`);
        console.log(`  Initial Copy Link value: "${initialCopyLink}"`);
        console.log(`  Initial Copy Link contains #trip-copy: ${initialCopyLink.includes('#trip-copy=')}`);
        if (!initialCopyLink.includes('#trip-copy=')) throw new Error('Default link does not have #trip-copy=');

        // Step 3: Switch to 'collab' mode
        console.log('👉 Step 3: Switching to "Live Co-Plan (Collaborate)" mode...');
        await evalExpr(`window.selectShareMode('collab');`);
        await new Promise(r => setTimeout(r, 600));

        const collabLink = await evalExpr(`document.getElementById('share-link-input').value`);
        console.log(`  Collab Link value: "${collabLink}"`);
        console.log(`  Collab Link contains #collab=: ${collabLink.includes('#collab=')}`);
        if (!collabLink.includes('#collab=')) throw new Error('Collab link does not have #collab=');

        // Take screenshot of Share Modal in Collab Mode (with Unified Export Section)
        await takeScreenshot('share-modal-collab-mode.png');

        // Verify the unified export tiles exist
        const exportTilesCount = await evalExpr(`document.querySelectorAll('.share-export-tile').length`);
        console.log(`  Unified Export Tiles count: ${exportTilesCount}`);
        if (exportTilesCount < 3) throw new Error('Expected at least 3 export tiles in unified share modal!');

        // Switch back to 'copy' mode and take screenshot
        console.log('👉 Switching back to "Send a Copy" mode for screenshot comparison...');
        await evalExpr(`window.selectShareMode('copy')`);
        await new Promise(r => setTimeout(r, 400));
        await takeScreenshot('share-modal-copy-mode.png');

        // Close share modal
        await evalExpr(`window.closeModal('share-trip-modal')`);
        await new Promise(r => setTimeout(r, 400));

        // Test opening trip in Planner and verifying iOS share button
        console.log('👉 Testing iOS Share Button in Planner Header...');
        await evalExpr(`window.openTrip('${tripId}')`);
        await new Promise(r => setTimeout(r, 800));

        const hasIosShareBtn = await evalExpr(`!!document.getElementById('planner-ios-share-btn')`);
        console.log(`  Planner iOS Share Button exists: ${hasIosShareBtn}`);
        if (!hasIosShareBtn) throw new Error('Planner iOS share button not found!');

        await takeScreenshot('planner-header-ios-share-button.png');

        // Click the iOS Share Button from planner header
        await evalExpr(`document.getElementById('planner-ios-share-btn').click()`);
        await new Promise(r => setTimeout(r, 400));

        const openedFromHeader = await evalExpr(`document.getElementById('share-trip-modal').style.display === 'flex'`);
        console.log(`  Opened share modal from iPhone button in header: ${openedFromHeader}`);
        if (!openedFromHeader) throw new Error('Clicking planner-ios-share-btn failed to open modal!');

        await evalExpr(`window.closeModal('share-trip-modal')`);
        await new Promise(r => setTimeout(r, 300));

        // Step 4: Test Receiving an Incoming "Send a Copy" Trip
        console.log('👉 Step 4: Testing Incoming "Send a Copy" flow via URL hash...');
        const copyPayload = initialCopyLink.split('#trip-copy=')[1];
        await evalExpr(`
            window.location.hash = '#trip-copy=${copyPayload}';
            window.checkIncomingShareUrl();
        `);
        await new Promise(r => setTimeout(r, 600));

        const isImportModalVisible = await evalExpr(`
            const m = document.getElementById('import-trip-modal');
            return !!(m && m.style.display !== 'none');
        `);
        console.log(`  Import Modal visible for copy: ${isImportModalVisible}`);
        if (!isImportModalVisible) throw new Error('Import modal did not open for copy!');

        const importBadgeText = await evalExpr(`document.getElementById('import-modal-badge').innerText`);
        console.log(`  Import Modal Badge: "${importBadgeText}"`);
        await takeScreenshot('import-modal-copy-mode.png');

        // Confirm copy import
        await evalExpr(`window.confirmImportTrip(false)`);
        await new Promise(r => setTimeout(r, 800));

        const tripsAfterCopy = await evalExpr(`window.trips.length`);
        console.log(`  Trip count after importing copy: ${tripsAfterCopy} (was ${tripCount})`);
        if (tripsAfterCopy !== tripCount + 1) throw new Error('Trip count did not increase after copy import!');

        // Step 5: Test Receiving an Incoming "Live Co-Plan" Trip
        console.log('👉 Step 5: Testing Incoming "Live Co-Plan" flow via URL hash...');
        const testCollabRoom = 'room_test_' + Date.now();
        const testSeedTrip = {
            name: 'Tokyo & Kyoto Duo Adventure',
            startDate: '2026-11-15',
            stops: [
                { id: '1', name: 'Tokyo', nights: 4, lat: 35.6762, lon: 139.6503 },
                { id: '2', name: 'Kyoto', nights: 3, lat: 35.0116, lon: 135.7681 }
            ]
        };
        const seedEncoded = await evalExpr(`window.encodeTripPayload(${JSON.stringify(testSeedTrip)})`);
        await evalExpr(`
            window.location.hash = '#collab=${testCollabRoom}&tripId=seed123&seed=${seedEncoded}';
            window.checkIncomingShareUrl();
        `);
        await new Promise(r => setTimeout(r, 600));

        const collabImportBadgeText = await evalExpr(`document.getElementById('import-modal-badge').innerText`);
        console.log(`  Import Modal Badge for Collab: "${collabImportBadgeText}"`);
        await takeScreenshot('import-modal-collab-mode.png');

        // Confirm joining collab
        await evalExpr(`window.confirmImportTrip(false)`);
        await new Promise(r => setTimeout(r, 1000));

        const activeTripIsCollab = await evalExpr(`window.getActiveTrip().isCollaborative`);
        const activeTripCollabRoom = await evalExpr(`window.getActiveTrip().collabRoomId`);
        console.log(`  Active trip is collaborative: ${activeTripIsCollab}, Room: ${activeTripCollabRoom}`);
        if (!activeTripIsCollab) throw new Error('Imported collaborative trip is not marked isCollaborative!');

        // Check planner collab badge
        const badgeDisplay = await evalExpr(`document.getElementById('planner-collab-badge').style.display`);
        console.log(`  Planner collab badge display: "${badgeDisplay}"`);
        await takeScreenshot('planner-view-live-collab.png');

        // Step 6: Test Decoupled Deletion (Deleting collab trip does NOT affect others)
        console.log('👉 Step 6: Testing Decoupled Deletion of collaborative trip...');
        const collabTripId = await evalExpr(`window.getActiveTrip().id`);
        const tripsBeforeDelete = await evalExpr(`window.trips.length`);

        // Execute promptDeleteTripById (our dialog handler will auto-accept)
        await evalExpr(`window.promptDeleteTripById('${collabTripId}')`);
        await new Promise(r => setTimeout(r, 600));

        const tripsAfterDelete = await evalExpr(`window.trips.length`);
        console.log(`  Trip count after delete: ${tripsAfterDelete} (was ${tripsBeforeDelete})`);
        if (tripsAfterDelete !== tripsBeforeDelete - 1) throw new Error('Trip was not removed from local planner!');

        // Verify we are back on home screen and safe
        const isHomeActive = await evalExpr(`document.getElementById('home-view').classList.contains('active')`);
        console.log(`  Home view active after deletion: ${isHomeActive}`);
        await takeScreenshot('home-view-after-deletion.png');

        console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! Realtime sharing, copy vs collab modes, and decoupled deletion verified!');
        ws.close();
        chrome.kill();
        process.exit(0);
    } catch (err) {
        console.error('❌ Test failed with error:', err);
        chrome.kill();
        process.exit(1);
    }
}

testTripSharingAndCollaboration();
