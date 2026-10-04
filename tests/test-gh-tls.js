const https = require('https');
const tls = require('tls');

function testGithubHttps() {
    const socket = tls.connect({
        host: '185.199.108.153',
        port: 443,
        servername: 'trippo.top',
        rejectUnauthorized: false
    }, () => {
        console.log('Connected to GitHub Pages IP 185.199.108.153:443');
        const cert = socket.getPeerCertificate();
        console.log('Cert Subject:', cert.subject);
        console.log('Cert Issuer:', cert.issuer);
        console.log('Cert Valid From:', cert.valid_from);
        console.log('Cert Valid To:', cert.valid_to);
        console.log('Cert Subject Alt Names:', cert.subjectaltname);
        console.log('Authorized:', socket.authorized);
        console.log('Authorization Error:', socket.authorizationError);
        socket.end();
    });

    socket.on('error', (err) => {
        console.error('TLS Connection Error to GitHub:', err.message);
    });
}

testGithubHttps();
