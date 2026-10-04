const fs = require('fs');
const path = require('path');

async function compareFiles() {
    const files = [
        'index.html',
        'styles/main.css',
        'styles/components.css',
        'js/app.js',
        'js/state.js',
        'js/maps.js',
        'js/planner.js',
        'js/places.js',
        'js/wishlist.js',
        'js/bookings.js',
        'js/tools.js'
    ];

    for (const f of files) {
        const local = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
        const res = await fetch(`https://trippo.top/${f}`);
        const remote = await res.text();
        if (local === remote) {
            console.log(`✅ ${f} matches exactly`);
        } else {
            console.log(`⚠️ ${f} DIFFERS! Local length: ${local.length}, Remote length: ${remote.length}`);
        }
    }
}

compareFiles().catch(console.error);
