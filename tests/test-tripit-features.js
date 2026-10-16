// Travel stats, memberships, calendar export, leave-by on travel days and documents on bookings (v2.4.57).
// Needs the dev server on :8080. Uses a fresh Chrome profile, so no real trips are touched.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const OUT = path.join(__dirname, 'artifacts', 'tripit-features');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 9341;
const PROF = path.join(require('os').tmpdir(), 'trippo-chrome-prof-features');
fs.rmSync(PROF, { recursive: true, force: true });
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROF}`, '--window-size=390,844', '--no-first-run']);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`); if (!ok) fails++; };
(async () => {
    try {
        for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch (e) { await sleep(250); } }
        const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?http://127.0.0.1:8080/`, { method: 'PUT' })).json();
        const ws = new WebSocket(tab.webSocketDebuggerUrl);
        await new Promise(r => ws.onopen = r);
        let id = 1; const pending = new Map(); const errors = [];
        ws.onmessage = e => {
            const m = JSON.parse(e.data);
            if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
            if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
            if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        };
        const send = (method, params = {}) => new Promise(r => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
        const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600)); return r.result.result.value; };
        const shot = async name => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(s.result.data, 'base64')); };
        await send('Page.enable'); await send('Runtime.enable');
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
        await send('Page.reload', { ignoreCache: true });
        for (let i = 0; i < 40; i++) { if (await ev(`typeof window.exportTripCalendar === 'function' && !!window.trips`)) break; await sleep(250); }
        await sleep(1200);
        // test trip: today Lafayette -> Hong Kong (flight late tonight) -> Shanghai -> home
        await ev(`(() => {
            const today = window.formatLocalDate(new Date());
            const t = window.trips[0];
            t.name = 'Feature test';
            t.startDate = today;
            t.stops = [
                { id: 'h', name: 'Lafayette, LA', lat: 30.22, lon: -92.02, nights: 0, transit: { method: 'plane', flightType: 'ow', bookingNumber: 'MU588', date: today, depStation: 'Lafayette Regional Airport (LFT)', arrStation: 'Hong Kong International Airport', depTime: '23:30', arrTime: '05:10', notes: '' } },
                { id: 'hk', name: 'Hong Kong', lat: 22.3193, lon: 114.1694, nights: 3, lodging: { name: 'Marriott Hong Kong, Central', bookingNumber: 'HX991', checkInTime: '3:00 PM', address: '1 Queens Rd, Hong Kong' }, transit: { method: 'train', bookingNumber: 'G80', depTime: '09:00', arrTime: '17:30', depStation: 'Hong Kong West Kowloon', arrStation: 'Shanghai Hongqiao' } },
                { id: 'sha', name: 'Shanghai, China', lat: 31.2304, lon: 121.4737, nights: 3, lodging: { name: 'Hanting Hotel Bund' }, transit: { method: 'plane' } },
                { id: 'h2', name: 'Lafayette, LA', lat: 30.22, lon: -92.02, nights: 0 }
            ];
            t.places = [
                { id: 'p1', cityIndex: 1, dayIndex: 1, name: 'Victoria Peak, Hong Kong; tram, "the" view', time: '10:00', duration: 90, lat: 22.27, lon: 114.15 },
                { id: 'p2', cityIndex: 2, dayIndex: 0, name: '外滩 The Bund', time: '19:30', duration: 60, lat: 31.24, lon: 121.49 }
            ];
            window.setActiveTripId(t.id); window.saveTrips();
            localStorage.setItem('trippo_memberships_v1', JSON.stringify([{ program: 'China Eastern Eastern Miles', number: '610123456789' }, { program: 'Marriott Bonvoy', number: 'BV-55512' }]));
        })()`);

        // 1. memberships matching
        const mm = await ev(`({
            flight: window.membershipFor('travel', { method: 'plane', bookingNumber: 'MU588' })?.number,
            spaced: window.membershipFor('travel', { method: 'plane', bookingNumber: 'mu 5101' })?.number,
            other: window.membershipFor('travel', { method: 'plane', bookingNumber: 'DL12' }),
            hotel: window.membershipFor('stay', { name: 'Marriott Hong Kong, Central' })?.number,
            hotel2: window.membershipFor('stay', { name: 'Courtyard by Marriott' })?.number,
            noHotel: window.membershipFor('stay', { name: 'Hanting Hotel Bund' })
        })`);
        check('membership matches flight MU588', mm.flight === '610123456789', JSON.stringify(mm));
        check('membership matches "mu 5101"', mm.spaced === '610123456789');
        check('no membership for DL', mm.other === null);
        check('membership matches Marriott stay', mm.hotel === 'BV-55512' && mm.hotel2 === 'BV-55512');
        check('no membership for Hanting (not saved)', mm.noHotel === null);

        // 2. leave by
        const lb = await ev(`(() => { const legs = window.travelLegs(window.getActiveTrip()); return legs.map(l => ({ i: l.index, date: l.date, m: l.method, lb: window.leaveBy(l) })); })()`);
        check('3 legs', lb.length === 3, JSON.stringify(lb));
        check('flight leave by 19:45 (3h intl + 45m)', lb[0].lb && lb[0].lb.at === '19:45', JSON.stringify(lb[0].lb));
        check('train leg dated 3 days later', lb[1].date > lb[0].date && lb[1].lb && lb[1].lb.at === '07:45', JSON.stringify(lb[1]));
        check('no leave-by without a time', lb[2].lb === null);

        // 3. calendar
        const cal = await ev(`(() => { const r = window.buildTripCalendar(window.getActiveTrip()); const lines = r.text.split('\\r\\n'); const enc = new TextEncoder(); return { count: r.count, events: (r.text.match(/BEGIN:VEVENT/g) || []).length, alarms: (r.text.match(/BEGIN:VALARM/g) || []).length, maxBytes: Math.max(...lines.map(l => enc.encode(l).length)), text: r.text }; })()`);
        fs.writeFileSync(path.join(OUT, 'trip.ics'), cal.text);
        check('calendar events (2 stays + 3 legs + 2 places)', cal.events === 7 && cal.count === 7, `events=${cal.events}`);
        check('calendar alarms (check-in + leave-by flight, leave-by train, 2 places)', cal.alarms === 5, `alarms=${cal.alarms}`);
        check('calendar lines folded to <=75 bytes', cal.maxBytes <= 75, `max=${cal.maxBytes}`);
        check('calendar escapes ; and ,', cal.text.replace(/\r\n /g, '').includes('Victoria Peak\\, Hong Kong\\; tram\\,'));
        check('flight overnight ends next day', /DTEND:\d{8}T051000/.test(cal.text) && /TRIGGER:-PT24H/.test(cal.text));
        check('membership in flight description', /China Eastern Eastern Miles: 610123456789/.test(cal.text.replace(/\r\n /g, '')));

        // 4. Today view with travel card
        await ev(`window.openTodayFor(window.getActiveTrip().id)`);
        await sleep(600);
        const today = await ev(`(() => { const c = document.querySelector('#today-body .today-travel'); return c ? { text: c.innerText, leave: c.querySelector('.today-leave')?.innerText || '', member: !!c.querySelector('.member-chip') } : null; })()`);
        check('Today shows travel card', !!today, JSON.stringify(today));
        check('Today card has leave by 7:45 PM', today && /Leave by 7:45 PM/.test(today.leave), today && today.leave);
        check('Today card shows membership chip', today && today.member);
        await shot('1-today');
        await ev(`window.closeModal && document.querySelectorAll('.modal').forEach(m => m.style.display = 'none')`);

        // 5. transit modal extras + docs
        await ev(`window.openTransitBookingModal(0)`);
        await sleep(700);
        const tx = await ev(`({ member: !!document.querySelector('#transit-extras .member-chip'), docs: !!document.querySelector('#transit-extras-docs .doc-add') })`);
        check('transit form shows membership + docs', tx.member && tx.docs, JSON.stringify(tx));
        // add a small PNG as a boarding pass
        await ev(`(async () => {
            const c = document.createElement('canvas'); c.width = 300; c.height = 140; const g = c.getContext('2d'); g.fillStyle = '#124b43'; g.fillRect(0, 0, 300, 140); g.fillStyle = '#fff'; g.font = '24px sans-serif'; g.fillText('MU588 Boarding pass', 20, 75);
            const blob = await new Promise(r => c.toBlob(r, 'image/png'));
            const file = new File([blob], 'boarding-pass.png', { type: 'image/png' });
            const fake = { dataset: { box: 'transit-extras-docs' }, files: [file], value: 'x' };
            await window.addTripDocs(fake);
            const pdf = new File(['%PDF-1.4 fake'], 'ticket.pdf', { type: 'application/pdf' });
            await window.addTripDocs({ dataset: { box: 'transit-extras-docs' }, files: [pdf, new File(['x'], 'notes.txt', { type: 'text/plain' })], value: 'x' });
        })()`);
        await sleep(500);
        const docs = await ev(`[...document.querySelectorAll('#transit-extras-docs .doc-chip')].map(d => d.innerText.replace(/\\s+/g, ' ').trim())`);
        check('two docs saved (txt rejected)', docs.length === 2, JSON.stringify(docs));
        await shot('2-transit-modal');
        await send('Runtime.evaluate', { expression: `document.querySelector('#transit-extras-docs .doc-open').click()` });
        await sleep(600);
        const viewer = await ev(`(() => { const v = document.getElementById('doc-viewer'); const img = v && v.querySelector('img'); return v ? { img: !!img, loaded: img ? img.naturalWidth : 0 } : null; })()`);
        check('doc viewer opens the image', viewer && viewer.img && viewer.loaded === 300, JSON.stringify(viewer));
        await shot('3-doc-viewer');
        await ev(`window.closeTripDoc()`);
        check('viewer closes', await ev(`!document.getElementById('doc-viewer')`));
        // reopen form: docs still listed (IndexedDB)
        await ev(`document.getElementById('transit-booking-modal').style.display='none'; window.openTransitBookingModal(0)`);
        await sleep(500);
        check('docs persist on reopen', (await ev(`document.querySelectorAll('#transit-extras-docs .doc-chip').length`)) === 2);
        await ev(`document.getElementById('transit-booking-modal').style.display='none'`);
        // Today now shows the boarding pass chip
        await ev(`window.openTodayFor(window.getActiveTrip().id)`);
        await sleep(800);
        const bp = await ev(`(() => { const b = document.querySelector('#today-body [data-docs-owner]'); return b ? { hidden: b.hidden, text: b.innerText } : null; })()`);
        check('Today shows documents chip', bp && !bp.hidden, JSON.stringify(bp));
        await ev(`document.querySelectorAll('.modal').forEach(m => m.style.display = 'none')`);

        // 6. stay form extras
        await ev(`window.openLodgingModal(1)`);
        await sleep(500);
        check('stay form shows Marriott membership', await ev(`/BV-55512/.test(document.getElementById('lodging-extras').innerText)`));
        await ev(`document.querySelectorAll('.modal').forEach(m => m.style.display = 'none')`);

        // 7. settings memberships
        await ev(`window.openSettingsModal()`);
        await sleep(400);
        const rows = await ev(`document.querySelectorAll('#memberships-settings .member-row').length`);
        check('settings lists 2 memberships', rows === 2);
        await ev(`document.getElementById('member-program').value = 'Hilton Honors'; document.getElementById('member-number').value = 'HH777'; window.addMembership()`);
        check('add membership', (await ev(`document.querySelectorAll('#memberships-settings .member-row').length`)) === 3);
        await ev(`document.getElementById('memberships-settings').scrollIntoView()`);
        await shot('4-settings');
        await ev(`window.removeMembership(2)`);
        check('remove membership (after confirm)', (await ev(`window.getMemberships().length`)) === 2);
        await ev(`window.restoreMemberships([{ program: 'Hilton Honors', number: 'H1' }, { program: 'Marriott Bonvoy', number: 'NEW' }])`);
        const rest = await ev(`window.getMemberships()`);
        check('restore merges memberships', rest.length === 3 && rest.find(m => m.program === 'Marriott Bonvoy').number === 'NEW', JSON.stringify(rest));
        await ev(`document.querySelectorAll('.modal').forEach(m => { m.style.display = 'none'; m.classList.remove('active'); })`);

        // 8. home stats + map
        await ev(`window.switchTab('home')`);
        await sleep(400);
        await ev(`window.renderHome && window.renderHome()`);
        for (let i = 0; i < 30; i++) { if (await ev(`!!document.querySelector('.stats-flags')`)) break; await sleep(500); }
        const stats = await ev(`(() => { const s = window.computeTravelStats(); return { countries: [...s.countries.keys()], cities: s.cities, nights: s.nights, km: Math.round(s.flownKm), unknown: s.unknown, card: document.getElementById('home-travel-stats').innerText.replace(/\\s+/g, ' ') }; })()`);
        check('stats: 2 cities, 6 nights', stats.cities === 2 && stats.nights === 6, JSON.stringify(stats));
        check('stats: countries looked up', stats.unknown === 0 && stats.countries.length >= 1, JSON.stringify(stats.countries));
        check('stats: flown km (LFT-HKG + SHA-LFT)', stats.km > 20000 && stats.km < 26000, String(stats.km));
        const homeToday = await ev(`document.getElementById('home-today-card').innerText`);
        check('home Today card shows leave by', /leave by 7:45 PM/.test(homeToday), homeToday);
        await ev(`document.getElementById('home-travel-stats').scrollIntoView({ block: 'center' })`);
        await shot('5-home');
        await ev(`window.openTravelStats()`);
        await sleep(1500);
        const map = await ev(`({ markers: document.querySelectorAll('#travel-stats-map path.leaflet-interactive').length, tiles: document.querySelectorAll('#travel-stats-map .leaflet-tile').length })`);
        check('stats map shows 2 places', map.markers === 2 && map.tiles > 0, JSON.stringify(map));
        await shot('6-stats-map');

        // 9. calendar export entry points don't throw
        await ev(`window.exportTripICS(); window.exportTripToICS();`);
        check('no page errors', !errors.filter(e => !/ServiceWorker/.test(e)).length, JSON.stringify(errors));
    } catch (e) { console.error(e); fails++; } finally { chrome.kill(); console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0); }
})();
