const https = require('https');

async function check() {
    try {
        const res = await fetch('https://api.github.com/repos/jacobgbroussard-code/trippo-site/pages', {
            headers: { 'User-Agent': 'node-fetch' }
        });
        const data = await res.json();
        console.log('=== GitHub Pages API Info ===');
        console.log('Status:', res.status);
        console.log('Data:', JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('API Error:', e.message);
    }

    console.log('\n=== Testing HTTPS handshake to trippo.top ===');
    const req = https.request('https://trippo.top', { method: 'HEAD', timeout: 5000 }, (res) => {
        console.log('HTTPS Status:', res.statusCode);
        const cert = res.socket.getPeerCertificate();
        console.log('Cert Subject:', cert.subject);
        console.log('Cert Issuer:', cert.issuer);
        console.log('Cert Valid To:', cert.valid_to);
    });
    req.on('error', (err) => {
        console.log('HTTPS Error Code:', err.code);
        console.log('HTTPS Error Message:', err.message);
    });
    req.end();
}

check();
