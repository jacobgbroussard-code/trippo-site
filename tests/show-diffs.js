const fs = require('fs');
const path = require('path');

async function showDiffs() {
    const localHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const remoteHtml = await (await fetch('https://trippo.top/index.html')).text();

    console.log('--- INDEX.HTML DIFF SUMMARY ---');
    console.log('Local lines:', localHtml.split('\n').length);
    console.log('Remote lines:', remoteHtml.split('\n').length);

    // Check components.css
    const localCss = fs.readFileSync(path.join(__dirname, '..', 'styles/components.css'), 'utf8');
    const remoteCss = await (await fetch('https://trippo.top/styles/components.css')).text();
    console.log('\n--- COMPONENTS.CSS DIFF SUMMARY ---');
    console.log('Local lines:', localCss.split('\n').length);
    console.log('Remote lines:', remoteCss.split('\n').length);
    
    // Check bookings.js
    const localBookings = fs.readFileSync(path.join(__dirname, '..', 'js/bookings.js'), 'utf8');
    const remoteBookings = await (await fetch('https://trippo.top/js/bookings.js')).text();
    console.log('\n--- BOOKINGS.JS DIFF SUMMARY ---');
    console.log('Local lines:', localBookings.split('\n').length);
    console.log('Remote lines:', remoteBookings.split('\n').length);
}

showDiffs();
