const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('=============================================================');
console.log('   TRIPPO TRAVEL PLANNER - v2.3.67 NEW FEATURES VERIFICATION');
console.log('   (Printable Pocket Itinerary, Live GPS, .ics Export, Packing)');
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
const mapsJs = fs.readFileSync('js/maps.js', 'utf8');
const toolsJs = fs.readFileSync('js/tools.js', 'utf8');
const swJs = fs.readFileSync('sw.js', 'utf8');


// 2. Live GPS Buttons and styling
check('Live GPS buttons rendered on Planner, Places, and Wishlist maps', () => {
    assert(indexHtml.includes('id="planner-gps-btn"'), 'planner-gps-btn must exist in index.html');
    assert(indexHtml.includes('id="places-gps-btn"'), 'places-gps-btn must exist in index.html');
    assert(indexHtml.includes('id="wishlist-gps-btn"'), 'wishlist-gps-btn must exist in index.html');
    assert(indexHtml.includes("toggleUserLocation('planner')"), 'toggleUserLocation(planner) must be bound');
    assert(indexHtml.includes("toggleUserLocation('places')"), 'toggleUserLocation(places) must be bound');
    assert(indexHtml.includes("toggleUserLocation('wishlist')"), 'toggleUserLocation(wishlist) must be bound');
});

check('CSS contains GPS pulsing dot animation and active-mode styling', () => {
    assert(componentsCss.includes('.gps-user-pulse'), '.gps-user-pulse class must exist');
    assert(componentsCss.includes('.gps-user-dot'), '.gps-user-dot class must exist');
    assert(componentsCss.includes('@keyframes gps-pulse'), '@keyframes gps-pulse must exist');
    assert(componentsCss.includes('.map-btn.active-mode'), '.map-btn.active-mode must exist');
});

check('maps.js exports toggleUserLocation with geolocation handling and cleanup', () => {
    assert(mapsJs.includes('export function toggleUserLocation'), 'toggleUserLocation must be exported');
    assert(mapsJs.includes('navigator.geolocation'), 'Must check navigator.geolocation');
    assert(mapsJs.includes('navigator.geolocation.watchPosition'), 'Must use watchPosition for real-time tracking');
    assert(mapsJs.includes('navigator.geolocation.clearWatch'), 'Must clear watchPosition on toggle off');
    assert(mapsJs.includes('targetMap.flyTo'), 'Must fly to user location on discovery');
});

// 3. Smart Packing Checklist
check('Smart Packing Checklist modal and sidebar entry point exist', () => {
    assert(indexHtml.includes('onclick="openPackingModal()"'), 'openPackingModal onclick must exist in sidebar');
    assert(indexHtml.includes('id="packing-modal"'), '#packing-modal must exist in index.html');
    assert(indexHtml.includes('id="packing-items-list"'), '#packing-items-list must exist');
    assert(indexHtml.includes('id="packing-progress-bar"'), '#packing-progress-bar must exist');
    assert(indexHtml.includes('id="packing-new-item-input"'), '#packing-new-item-input must exist');
});

check('tools.js exports packing list management functions and presets', () => {
    assert(toolsJs.includes('export const DEFAULT_PACKING_ITEMS'), 'DEFAULT_PACKING_ITEMS must be exported');
    assert(toolsJs.includes('export function openPackingModal'), 'openPackingModal must be exported');
    assert(toolsJs.includes('export function renderPackingList'), 'renderPackingList must be exported');
    assert(toolsJs.includes('export function togglePackingItem'), 'togglePackingItem must be exported');
    assert(toolsJs.includes('export function addCustomPackingItem'), 'addCustomPackingItem must be exported');
    assert(toolsJs.includes('export function deletePackingItem'), 'deletePackingItem must be exported');
    assert(toolsJs.includes('export function resetPackingList'), 'resetPackingList must be exported');
    assert(toolsJs.includes('saveTrips()'), 'Must persist packing list changes to trip');
});

// 4. Printable / PDF Pocket Itinerary
check('Printable pocket itinerary container, trigger, and print media CSS exist', () => {
    assert(indexHtml.includes("closeModal('settings-modal'); printPocketItinerary();"), 'printPocketItinerary button must exist in App Settings');
    assert(indexHtml.includes('id="printable-itinerary-container"'), '#printable-itinerary-container must exist');
    assert(componentsCss.includes('@media print'), '@media print query must exist in CSS');
    assert(componentsCss.includes('body > *:not(#printable-itinerary-container)'), 'Print CSS must hide app UI');
    assert(componentsCss.includes('page-break-inside: avoid'), 'Print cards must prevent awkward page breaks');
});

check('tools.js exports printPocketItinerary with complete itinerary sections', () => {
    assert(toolsJs.includes('export function printPocketItinerary'), 'printPocketItinerary must be exported');
    assert(toolsJs.includes('window.print()'), 'Must call window.print()');
    assert(toolsJs.includes('Route Overview'), 'Must render Route Overview');
    assert(toolsJs.includes('Accommodations'), 'Must render Accommodations / Lodging');
    assert(toolsJs.includes('Onward travel'), 'Must render Transit details');
    assert(toolsJs.includes('Emergency & Offline Contacts'), 'Must render Emergency & Offline Contacts');
});

// 5. Universal .ics Calendar Export
check('tools.js exports exportTripToICS with RFC 5545 compliant calendar format', () => {
    assert(indexHtml.includes('onclick="exportTripToICS()"'), 'exportTripToICS onclick must exist in sidebar');
    assert(toolsJs.includes('export function exportTripToICS'), 'exportTripToICS must be exported');
    // since v2.4.57 the calendar is built in js/travel-days.js (stays, legs with alerts, timed plans)
    const daysJs = fs.readFileSync('js/travel-days.js', 'utf8');
    assert(toolsJs.includes('exportTripCalendar'), 'exportTripToICS must use exportTripCalendar');
    assert(daysJs.includes('BEGIN:VCALENDAR'), 'Must generate BEGIN:VCALENDAR');
    assert(daysJs.includes('VERSION:2.0'), 'Must specify VERSION:2.0');
    assert(daysJs.includes('BEGIN:VEVENT'), 'Must generate VEVENT blocks for stays');
    assert(daysJs.includes('UID:'), 'Must generate unique event IDs');
    assert(daysJs.includes('.ics'), 'Must download filename ending with .ics');
});

console.log(`\n=============================================================`);
console.log(`Summary: ${passed}/${total} Checks Passed`);
console.log(`=============================================================`);

if (passed !== total) {
    process.exit(1);
}
