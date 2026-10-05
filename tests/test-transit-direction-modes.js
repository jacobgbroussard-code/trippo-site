/* ==========================================================================
   Trippo Travel Planner - Transit Direction Modes & Segment Selection Test
   tests/test-transit-direction-modes.js
   ========================================================================== */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('=============================================================');
console.log('   TRIPPO - TRANSIT DIRECTION TYPE & SEGMENT ROUTE TEST');
console.log('=============================================================\n');

let passed = 0;
let total = 0;

function check(desc, fn) {
    total++;
    try {
        fn();
        console.log(`  ✅ ${desc}`);
        passed++;
    } catch (e) {
        console.error(`  ❌ ${desc}`);
        console.error(`     Error: ${e.message}`);
    }
}

// 1. Verify HTML template additions
const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
check('index.html contains #edit-poi-transit-mode-group', () => {
    assert(indexHtml.includes('id="edit-poi-transit-mode-group"'), 'Missing edit-poi-transit-mode-group');
    assert(indexHtml.includes('id="edit-poi-transit-mode"'), 'Missing edit-poi-transit-mode select');
    assert(indexHtml.includes('value="walking"'), 'Missing walking option');
    assert(indexHtml.includes('value="driving"'), 'Missing driving option');
    assert(indexHtml.includes('value="transit"'), 'Missing transit option');
});

check('index.html has bumped version in title, assets, and app.js', () => {
    assert(/Trippo Travel Planner v2\.3\.\d+/.test(indexHtml), 'Missing valid version title');
    assert(/styles\/main\.css\?v=2\.3\.\d+/.test(indexHtml), 'Missing main.css version');
    assert(/styles\/components\.css\?v=2\.3\.\d+/.test(indexHtml), 'Missing components.css version');
    assert(/js\/app\.js\?v=2\.3\.\d+/.test(indexHtml), 'Missing app.js version');
});

// 2. Verify state.js exports
const stateJs = fs.readFileSync(path.join(rootDir, 'js/state.js'), 'utf8');
check('state.js exports calculateTransitEstimate and openDirectionsLink', () => {
    assert(stateJs.includes('export function calculateTransitEstimate'), 'Missing calculateTransitEstimate export');
    assert(stateJs.includes('export function openDirectionsLink'), 'Missing openDirectionsLink export');
    assert(stateJs.includes('window.calculateTransitEstimate = calculateTransitEstimate'), 'Missing window.calculateTransitEstimate');
    assert(stateJs.includes('window.openDirectionsLink = openDirectionsLink'), 'Missing window.openDirectionsLink');
});

// 3. Verify maps.js segment polylines & mode popup
const mapsJs = fs.readFileSync(path.join(rootDir, 'js/maps.js'), 'utf8');
check('maps.js contains getPlaceModeStyle and getSegmentPopupHTML', () => {
    assert(mapsJs.includes('function getPlaceModeStyle'), 'Missing getPlaceModeStyle');
    assert(mapsJs.includes('function getSegmentPopupHTML'), 'Missing getSegmentPopupHTML');
    assert(mapsJs.includes('#10b981'), 'Missing walking color #10b981');
    assert(mapsJs.includes('#2563eb'), 'Missing driving color #2563eb');
    assert(mapsJs.includes('#8b5cf6'), 'Missing transit color #8b5cf6');
});

check('maps.js drawPlacesMapRoute renders per-segment polylines and midpoint mode badges', () => {
    assert(mapsJs.includes('currentMode = toPlace.transitMode'), 'Missing toPlace.transitMode reading');
    assert(mapsJs.includes('transit-seg-icon'), 'Missing transit-seg-icon midpoint badge');
    assert(mapsJs.includes('segmentLayer.bindPopup(popupHTML)'), 'Missing segmentLayer.bindPopup');
    assert(mapsJs.includes('badgeMarker.bindPopup(popupHTML)'), 'Missing badgeMarker.bindPopup');
});

// 4. Verify places.js switcher & transit mode handling
const placesJs = fs.readFileSync(path.join(rootDir, 'js/places.js'), 'utf8');
check('places.js contains setPlaceTransitMode and transit-mode-switcher', () => {
    assert(placesJs.includes('export function setPlaceTransitMode'), 'Missing setPlaceTransitMode export');
    assert(placesJs.includes('window.setPlaceTransitMode = setPlaceTransitMode'), 'Missing window.setPlaceTransitMode');
    assert(placesJs.includes('transit-mode-switcher'), 'Missing transit-mode-switcher markup');
    assert(placesJs.includes('mode-icon-btn'), 'Missing mode-icon-btn classes');
});

// 5. Verify CSS styling for switcher and popups
const compCss = fs.readFileSync(path.join(rootDir, 'styles/components.css'), 'utf8');
check('components.css contains .transit-mode-switcher and .map-segment-popup', () => {
    assert(compCss.includes('.transit-mode-switcher'), 'Missing .transit-mode-switcher CSS');
    assert(compCss.includes('.mode-icon-btn'), 'Missing .mode-icon-btn CSS');
    assert(compCss.includes('.map-segment-popup'), 'Missing .map-segment-popup CSS');
    assert(compCss.includes('.segment-mode-btn'), 'Missing .segment-mode-btn CSS');
    assert(compCss.includes('body.dark-mode .map-segment-popup'), 'Missing dark mode segment popup CSS');
});

// 6. Functional test for calculateTransitEstimate
const { calculateTransitEstimate, getDistance } = await import('../js/state.js');
check('calculateTransitEstimate returns accurate times and icons for all 3 modes', () => {
    // Lafayette to Baton Rouge (~85 km)
    const lat1 = 30.2241, lon1 = -92.0198;
    const lat2 = 30.4515, lon2 = -91.1871;
    
    const walkEst = calculateTransitEstimate(lat1, lon1, lat2, lon2, 'walking');
    assert.strictEqual(walkEst.mode, 'walking');
    assert.strictEqual(walkEst.icon, '🚶');
    assert(walkEst.mins > 600, 'Walking 85km should be over 600 mins');

    const driveEst = calculateTransitEstimate(lat1, lon1, lat2, lon2, 'driving');
    assert.strictEqual(driveEst.mode, 'driving');
    assert.strictEqual(driveEst.icon, '🚗');
    assert(driveEst.mins >= 100, 'Driving 85km should be around 170 mins');

    const transitEst = calculateTransitEstimate(lat1, lon1, lat2, lon2, 'transit');
    assert.strictEqual(transitEst.mode, 'transit');
    assert.strictEqual(transitEst.icon, '🚆');
    assert(transitEst.text.includes('transit'), 'Transit text should mention transit');
});

// 7. Verify version consistency across all files
const swJs = fs.readFileSync(path.join(rootDir, 'sw.js'), 'utf8');
const appJs = fs.readFileSync(path.join(rootDir, 'js/app.js'), 'utf8');
const toolsJs = fs.readFileSync(path.join(rootDir, 'js/tools.js'), 'utf8');

check('Version is consistent across sw.js, app.js, and tools.js', () => {
    assert(/trippo-cache-v2\.3\.\d+/.test(swJs), 'sw.js cache version mismatch');
    assert(/CURRENT_VERSION = '2\.3\.\d+'/.test(appJs), 'app.js version mismatch');
    assert(/version: "2\.3\.\d+"/.test(toolsJs), 'tools.js version mismatch');
});

console.log('\n=============================================================');
console.log(`Summary: ${passed}/${total} Transit Direction Mode Checks Passed`);
console.log('=============================================================\n');

if (passed !== total) process.exit(1);
