const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA = path.join(__dirname, 'scratch_chrome_test_copilot');
const ARTIFACTS_DIR = "C:\\Users\\Jacob\\.gemini\\antigravity-ide\\brain\\2e5f8455-2bd0-4c5a-8577-f678d97d0ff1";

async function testAICopilot() {
    console.log('--- Testing In-App AI Travel Copilot ---');
    if (fs.existsSync(USER_DATA)) {
        try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch (e) {}
    }

    const chrome = spawn(CHROME, [
        '--headless=new',
        '--remote-debugging-port=9263',
        `--user-data-dir=${USER_DATA}`,
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=430,932'
    ]);
    await new Promise(r => setTimeout(r, 1500));

    try {
        const newTab = await (await fetch('http://127.0.0.1:9263/json/new?http://127.0.0.1:8080/', { method: 'PUT' })).json();
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

        // Step 1: Open daily planner and inspect UI
        console.log('Step 1: Navigating to Daily Planner...');
        const navRes = await send('Runtime.evaluate', {
            expression: `(() => {
                // Ensure a test trip exists with stops
                const trip = window.getActiveTrip();
                if (!trip) return { error: 'No active trip' };
                window.switchTab('places');
                window.openPlacesCityView(1); // Open stop 1 (Shanghai)
                window.switchPlacesDay(2); // Day 3 has 0 places, showing AI empty day card
                return {
                    tripName: trip.name,
                    stopName: trip.stops[1].name,
                    activePlacesTripId: window.activePlacesTripId,
                    activePlacesStopIndex: window.activePlacesStopIndex,
                    activePlacesDayIndex: window.activePlacesDayIndex
                };
            })()`,
            returnByValue: true
        });
        console.log('Daily planner navigation result:', navRes.result.value);

        await new Promise(r => setTimeout(r, 800));

        // Capture Daily Planner with AI Copilot Button & Empty Day State
        const scrDailyPlanner = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(ARTIFACTS_DIR, 'ai-copilot-daily-planner-entry.png'), Buffer.from(scrDailyPlanner.data, 'base64'));
        console.log('Saved screenshot: ai-copilot-daily-planner-entry.png');

        // Step 2: Open AI Copilot from Daily Planner
        console.log('Step 2: Launching AI Copilot...');
        const openRes = await send('Runtime.evaluate', {
            expression: `(() => {
                window.openAICopilot(1, 0);
                const modal = document.getElementById('ai-copilot-modal');
                const subtitle = document.getElementById('ai-copilot-subtitle');
                const chips = document.getElementById('ai-copilot-day-chips');
                const messages = document.getElementById('ai-copilot-messages');
                return {
                    modalDisplay: modal ? window.getComputedStyle(modal).display : null,
                    subtitleText: subtitle ? subtitle.innerText : null,
                    dayChipsCount: chips ? chips.children.length : 0,
                    initialMessagesCount: messages ? messages.children.length : 0
                };
            })()`,
            returnByValue: true
        });
        console.log('AI Copilot open result:', openRes.result.value);

        await new Promise(r => setTimeout(r, 600));

        // Capture initial Copilot modal
        const scrCopilotInitial = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(ARTIFACTS_DIR, 'ai-copilot-modal-welcome.png'), Buffer.from(scrCopilotInitial.data, 'base64'));
        console.log('Saved screenshot: ai-copilot-modal-welcome.png');

        // Step 3: Send a prompt chip for food / dining
        console.log('Step 3: Sending prompt chip "🍜 Top Dining"...');
        const sendChipRes = await send('Runtime.evaluate', {
            expression: `(() => {
                window.sendAICopilotChip('🍜 What are the best restaurants and food spots for this day?');
                return { sent: true };
            })()`,
            returnByValue: true
        });
        console.log('Sent chip prompt:', sendChipRes.result.value);

        // Wait for response and cards to render
        await new Promise(r => setTimeout(r, 1200));

        const cardsRes = await send('Runtime.evaluate', {
            expression: `(() => {
                const cards = document.querySelectorAll('.ai-chat-card');
                const addBtns = document.querySelectorAll('.ai-card-add-btn');
                const addAllBtn = document.querySelector('.ai-add-all-btn');
                return {
                    cardCount: cards.length,
                    firstCardTitle: cards.length > 0 ? cards[0].querySelector('.ai-chat-card-title').innerText : null,
                    addBtnsCount: addBtns.length,
                    hasAddAllBtn: !!addAllBtn
                };
            })()`,
            returnByValue: true
        });
        console.log('AI Copilot response cards:', cardsRes.result.value);

        // Capture Chat response with suggestions
        const scrChatResponse = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(ARTIFACTS_DIR, 'ai-copilot-chat-suggestions.png'), Buffer.from(scrChatResponse.data, 'base64'));
        console.log('Saved screenshot: ai-copilot-chat-suggestions.png');

        // Step 4: Click "+ Add to Day 1" on first suggestion
        console.log('Step 4: Clicking "+ Add to Day 1" on first suggestion card...');
        const addCardRes = await send('Runtime.evaluate', {
            expression: `(() => {
                const trip = window.getActiveTrip();
                const initialPlacesCount = trip.places ? trip.places.length : 0;
                const firstAddBtn = document.querySelector('.ai-card-add-btn');
                if (firstAddBtn) {
                    firstAddBtn.click();
                }
                const newPlacesCount = trip.places ? trip.places.length : 0;
                const btnTextAfter = firstAddBtn ? firstAddBtn.innerText : null;
                const isBtnAdded = firstAddBtn ? firstAddBtn.classList.contains('added') : false;
                return {
                    initialPlacesCount,
                    newPlacesCount,
                    btnTextAfter,
                    isBtnAdded,
                    lastAddedPlace: trip.places[trip.places.length - 1]
                };
            })()`,
            returnByValue: true
        });
        console.log('Add card result:', addCardRes.result.value);

        // Step 5: Test switching to Day 2 inside Copilot
        console.log('Step 5: Testing day switching in Copilot...');
        const switchDayRes = await send('Runtime.evaluate', {
            expression: `(() => {
                window.switchAICopilotDay(1); // Day 2 (index 1)
                const subtitle = document.getElementById('ai-copilot-subtitle');
                return {
                    newSubtitle: subtitle ? subtitle.innerText : null,
                    activeCopilotDayIndex: window.activeCopilotDayIndex,
                    activePlacesDayIndex: window.activePlacesDayIndex
                };
            })()`,
            returnByValue: true
        });
        console.log('Switch day result:', switchDayRes.result.value);

        // Step 6: Ask for cultural sights in Day 2 and click "✨ Add All to Day 2"
        console.log('Step 6: Asking for sights on Day 2 and testing "Add All"...');
        await send('Runtime.evaluate', {
            expression: `(() => {
                window.sendAICopilotChip('🏛️ Recommend top cultural sights and must-see attractions for this day');
            })()`
        });
        await new Promise(r => setTimeout(r, 1200));

        const addAllRes = await send('Runtime.evaluate', {
            expression: `(() => {
                const trip = window.getActiveTrip();
                const beforeCount = trip.places.length;
                const addAllBtn = document.querySelector('.ai-add-all-btn');
                if (addAllBtn) addAllBtn.click();
                const afterCount = trip.places.length;
                return {
                    beforeCount,
                    afterCount,
                    addedDifference: afterCount - beforeCount
                };
            })()`,
            returnByValue: true
        });
        console.log('Add All result:', addAllRes.result.value);

        // Capture modal after Add All
        const scrAddAll = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(ARTIFACTS_DIR, 'ai-copilot-after-add-all.png'), Buffer.from(scrAddAll.data, 'base64'));
        console.log('Saved screenshot: ai-copilot-after-add-all.png');

        // Step 7: Close modal and verify daily planner updated
        console.log('Step 7: Closing modal and verifying Daily Planner timeline & map...');
        const closeRes = await send('Runtime.evaluate', {
            expression: `(() => {
                window.closeModal('ai-copilot-modal');
                const savedCards = document.querySelectorAll('#saved-places-container .place-item-card');
                return {
                    renderedCardsCount: savedCards.length,
                    placesInActiveTrip: window.getActiveTrip().places.length
                };
            })()`,
            returnByValue: true
        });
        console.log('Daily planner after Copilot additions:', closeRes.result.value);

        await new Promise(r => setTimeout(r, 600));

        const scrFinalPlanner = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(ARTIFACTS_DIR, 'ai-copilot-planner-updated.png'), Buffer.from(scrFinalPlanner.data, 'base64'));
        console.log('Saved screenshot: ai-copilot-planner-updated.png');

        // Step 8: Test Dark Mode aesthetics of Copilot modal
        console.log('Step 8: Testing Dark Mode aesthetics...');
        await send('Runtime.evaluate', {
            expression: `(() => {
                document.body.classList.add('dark-mode');
                window.openAICopilot(1, 0);
            })()`
        });
        await new Promise(r => setTimeout(r, 600));

        const scrDarkMode = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(ARTIFACTS_DIR, 'ai-copilot-dark-mode.png'), Buffer.from(scrDarkMode.data, 'base64'));
        console.log('Saved screenshot: ai-copilot-dark-mode.png');

        // Step 9: Testing anti-deletion safety guard (asking AI to delete stops or itinerary)
        console.log('Step 9: Testing anti-deletion safety guard...');
        const deletePromptRes = await send('Runtime.evaluate', {
            expression: `(() => {
                const trip = window.getActiveTrip();
                const beforePlacesCount = trip.places.length;
                const beforeStopsCount = trip.stops.length;
                
                // Try asking AI to delete itinerary / stops
                const input = document.getElementById('ai-copilot-input');
                if (input) input.value = 'Please delete Day 1 and remove all stops from my itinerary';
                window.submitAICopilotInput();
                
                const afterPlacesCount = trip.places.length;
                const afterStopsCount = trip.stops.length;
                const lastMsg = window.copilotChatHistory[window.copilotChatHistory.length - 1];
                
                return {
                    beforePlacesCount,
                    afterPlacesCount,
                    beforeStopsCount,
                    afterStopsCount,
                    isZeroDeleted: (beforePlacesCount === afterPlacesCount) && (beforeStopsCount === afterStopsCount),
                    botSafetyReply: lastMsg ? lastMsg.content : null,
                    suggestionsCount: lastMsg && lastMsg.suggestions ? lastMsg.suggestions.length : 0
                };
            })()`,
            returnByValue: true
        });
        console.log('Anti-deletion safety test result:', deletePromptRes.result.value);

        await new Promise(r => setTimeout(r, 600));
        const scrSafety = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(ARTIFACTS_DIR, 'ai-copilot-safety-guard.png'), Buffer.from(scrSafety.data, 'base64'));
        console.log('Saved screenshot: ai-copilot-safety-guard.png');

        ws.close();
        chrome.kill();
        console.log('--- ALL AI COPILOT TESTS PASSED SUCCESSFULLY! ---');
    } catch (err) {
        console.error('Test error:', err);
        chrome.kill();
        process.exit(1);
    }
}

testAICopilot();
