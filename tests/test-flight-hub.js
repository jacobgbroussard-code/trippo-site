const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('=============================================================');
console.log('   TRIPPO TRAVEL PLANNER - FLIGHT HUB & EXPLORE EVERYWHERE');
console.log('=============================================================\n');

let passed = 0;
let total = 0;

function check(title, fn) {
    total++;
    try {
        fn();
        console.log(`  ✅ [PASS] ${title}`);
        passed++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${title}: ${err.message}`);
    }
}

const indexHtml = fs.readFileSync('index.html', 'utf8');
const componentsCss = fs.readFileSync('styles/components.css', 'utf8');
const appJs = fs.readFileSync('js/app.js', 'utf8');
const toolsJs = fs.readFileSync('js/tools.js', 'utf8');
const swJs = fs.readFileSync('sw.js', 'utf8');


// 2. Flight Hub markup structure
check('Flight Hub card is rendered in the sidebar', () => {
    assert(indexHtml.includes('class="flight-hub-card"'), 'flight-hub-card must exist in index.html');
    assert(indexHtml.includes('id="flight-hub-origin"'), 'Input flight-hub-origin must exist');
    assert(indexHtml.includes('maxlength="3"'), 'Airport input must enforce maxlength="3"');
    assert(indexHtml.includes('id="flight-hub-save-btn"'), 'Set Default button must exist');
});

// 3. Quick select chips
check('Quick-select chips default to LFT, MSY, IAH, DFW, ATL', () => {
    assert(toolsJs.includes("['LFT', 'MSY', 'IAH', 'DFW', 'ATL']"), 'Default chip airports must be LFT, MSY, IAH, DFW, ATL');
});

// 4. Outbound launcher links
check('All 5 outbound launcher links exist with target=_blank and rel=noopener', () => {
    const linkIds = [
        'flighthub-skyscanner',
        'flighthub-googleflights',
        'flighthub-flightconnections',
        'flighthub-kayak',
        'flighthub-aviasales'
    ];
    linkIds.forEach(id => {
        assert(indexHtml.includes(`id="${id}"`), `Link ${id} must exist in index.html`);
    });
    assert(indexHtml.includes('target="_blank"'), 'Must have target="_blank"');
    assert(indexHtml.includes('rel="noopener noreferrer"'), 'Must have rel="noopener noreferrer"');
});

// 5. Logic in tools.js
check('tools.js exports Flight Hub functions and URL generator logic', () => {
    assert(toolsJs.includes('export function getFlightHubOrigin'), 'getFlightHubOrigin must be exported');
    assert(toolsJs.includes('export function updateFlightHubLinks'), 'updateFlightHubLinks must be exported');
    assert(toolsJs.includes('export function handleFlightHubOriginInput'), 'handleFlightHubOriginInput must be exported');
    assert(toolsJs.includes('export function selectFlightHubChip'), 'selectFlightHubChip must be exported');
    assert(toolsJs.includes('export function saveDefaultFlightHubOrigin'), 'saveDefaultFlightHubOrigin must be exported');
    assert(toolsJs.includes('export function initFlightHub'), 'initFlightHub must be exported');
    assert(toolsJs.includes('trippo_home_airport'), 'Must use localStorage key trippo_home_airport');
    assert(toolsJs.includes('FLIGHT_HUB_DEFAULT_AIRPORT = \'LFT\''), 'Default airport must be LFT');
    assert(toolsJs.includes('FLIGHT_HUB_AFFILIATE_MARKER'), 'Affiliate marker placeholder must be defined');
});

// 6. CSS styles
check('components.css defines complete Flight Hub styling system', () => {
    assert(componentsCss.includes('.flight-hub-card'), '.flight-hub-card class must exist');
    assert(componentsCss.includes('.flight-hub-chip'), '.flight-hub-chip class must exist');
    assert(componentsCss.includes('.flight-hub-link'), '.flight-hub-link class must exist');
    assert(componentsCss.includes('.flight-hub-save-btn'), '.flight-hub-save-btn class must exist');
});

console.log(`\n=============================================================`);
console.log(`Summary: ${passed}/${total} Checks Passed`);
console.log(`=============================================================`);

if (passed !== total) {
    process.exit(1);
}
