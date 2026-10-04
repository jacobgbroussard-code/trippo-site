async function main() {
    for (const url of ['https://jacobgbroussard-code.github.io/trippo-site/', 'https://trippo.top/']) {
        console.log('=== Checking:', url);
        try {
            const res = await fetch(url, { redirect: 'manual' });
            console.log('Status:', res.status);
            console.log('Headers:', Object.fromEntries(res.headers.entries()));
            const text = await res.text();
            console.log('Length:', text.length);
            console.log('Title match:', text.match(/<title>.*?<\/title>/i)?.[0]);
            console.log('Body snippet:', text.slice(0, 400));
        } catch (err) {
            console.error('Error fetching', url, err.message);
        }
    }

    console.log('\n=== Direct request to GitHub Pages IP (185.199.108.153) for trippo.top:');
    const http = require('http');
    const req = http.request({
        host: '185.199.108.153',
        port: 80,
        path: '/',
        headers: { Host: 'trippo.top' }
    }, (res) => {
        console.log('GitHub Direct Status:', res.statusCode);
        console.log('GitHub Direct Headers:', res.headers);
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
            console.log('Direct Data Length:', data.length);
            console.log('Contains planner-fullscreen-btn:', data.includes('planner-fullscreen-btn'));
            console.log('Contains one-way:', data.includes('transit-flight-type'));
        });
    });
    req.on('error', e => console.error('Direct error:', e.message));
    req.end();
}
main();
