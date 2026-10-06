const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SITE_ID = '884d84e4-c5e0-4d92-b3c1-7b8313fa3333';
const AUTH_TOKEN = process.env.NETLIFY_AUTH_TOKEN || '';
const ROOT_DIR = path.join(__dirname, '..');

async function deployNow() {
    const zipPath = path.join(ROOT_DIR, 'test-dist.zip');
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

    const filesToZip = ['index.html', 'styles', 'js', 'manifest.webmanifest', 'sw.js', 'fad.jpg']
        .filter(f => fs.existsSync(path.join(ROOT_DIR, f)))
        .join(' ');

    console.log('Files to zip:', filesToZip);
    execSync(`tar -a -c -f test-dist.zip ${filesToZip}`, { cwd: ROOT_DIR });
    const zipBuffer = fs.readFileSync(zipPath);

    console.log('Attempting deploy to Netlify... Zip size:', zipBuffer.length);
    const res = await fetch(`https://api.netlify.com/api/v1/sites/${SITE_ID}/deploys`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${AUTH_TOKEN}`,
            'Content-Type': 'application/zip'
        },
        body: zipBuffer
    });

    console.log('Deploy response HTTP status:', res.status);
    const body = await res.text();
    console.log('Deploy response body:', body.slice(0, 300));
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
}

deployNow().catch(console.error);
