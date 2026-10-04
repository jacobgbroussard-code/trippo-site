async function checkLive() {
    const urls = [
        'https://trippo.top/',
        'https://trippo.top/styles/main.css',
        'https://trippo.top/styles/components.css',
        'https://trippo.top/js/app.js',
        'https://trippo.top/js/state.js',
        'https://trippo.top/js/maps.js',
        'https://trippo.top/js/planner.js',
        'https://trippo.top/js/places.js',
        'https://trippo.top/js/wishlist.js',
        'https://trippo.top/js/bookings.js',
        'https://trippo.top/js/tools.js',
        'https://trippo.top/sw.js'
    ];
    for (const u of urls) {
        try {
            const res = await fetch(u);
            console.log(res.status, u, 'size:', (await res.text()).length);
        } catch (e) {
            console.log('FAIL:', u, e.message);
        }
    }
}
checkLive();
