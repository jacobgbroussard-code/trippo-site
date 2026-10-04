async function checkPublished() {
    const urls = [
        'https://jacobgbroussard-code.github.io/trippo-site/',
        'https://trippo.top/'
    ];
    for (const u of urls) {
        try {
            const res = await fetch(u);
            const text = await res.text();
            console.log(u);
            console.log('  HTTP status:', res.status);
            console.log('  Version:', text.match(/v2\.3\.\d+/)?.[0]);
            console.log('  Has Full Map button:', text.includes('planner-fullscreen-btn'));
            console.log('  Has One-Way flight:', text.includes('triptype=ow'));
        } catch (e) {
            console.log(u, 'Error:', e.message);
        }
    }
}
checkPublished();
