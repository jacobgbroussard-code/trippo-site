const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

async function testIosIcon() {
    console.log('====================================================');
    console.log('  TESTING iOS APPLE-TOUCH-ICON & PWA ICON SETUP');
    console.log('====================================================\n');

    let passed = 0;
    let total = 0;
    function assert(name, condition) {
        total++;
        if (condition) {
            console.log(`  [PASS] ${name}`);
            passed++;
        } else {
            console.error(`  [FAIL] ${name}`);
        }
    }

    const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const manifestJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.webmanifest'), 'utf8'));
    const swJs = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

    // 1. Check index.html iOS & PWA tags
    assert('index.html contains apple-mobile-web-app-title', indexHtml.includes('<meta name="apple-mobile-web-app-title" content="Trippo">'));
    assert('index.html contains apple-touch-icon link', indexHtml.includes('rel="apple-touch-icon"') && indexHtml.includes('apple-touch-icon.png'));
    assert('index.html contains 180x180 apple-touch-icon link', indexHtml.includes('sizes="180x180"') && indexHtml.includes('apple-touch-icon-180x180.png'));
    assert('index.html contains 192x192 icon link', indexHtml.includes('sizes="192x192"') && indexHtml.includes('icon-192.png'));
    assert('index.html contains 512x512 icon link', indexHtml.includes('sizes="512x512"') && indexHtml.includes('icon-512.png'));

    // 2. Check manifest.webmanifest
    assert('manifest has apple-touch-icon.png', manifestJson.icons.some(i => i.src === 'apple-touch-icon.png' && i.sizes === '180x180'));
    assert('manifest has icon-192.png', manifestJson.icons.some(i => i.src === 'icon-192.png' && i.sizes === '192x192'));
    assert('manifest has icon-512.png', manifestJson.icons.some(i => i.src === 'icon-512.png' && i.sizes === '512x512'));
    assert('manifest has fad.jpg', manifestJson.icons.some(i => i.src === 'fad.jpg'));

    // 3. Check sw.js caching
    assert('sw.js caches apple-touch-icon.png', swJs.includes("'./apple-touch-icon.png'"));
    assert('sw.js caches apple-touch-icon-180x180.png', swJs.includes("'./apple-touch-icon-180x180.png'"));
    assert('sw.js caches icon-192.png', swJs.includes("'./icon-192.png'"));
    assert('sw.js caches icon-512.png', swJs.includes("'./icon-512.png'"));
    assert('sw.js caches fad.jpg', swJs.includes("'./fad.jpg'"));
    assert('sw.js is updated with cache version', swJs.includes("trippo-cache-v2.3."));

    // 4. Verify file sizes and PNG magic headers on disk
    function checkPng(filename, expectedW, expectedH) {
        const filePath = path.join(__dirname, '..', filename);
        const exists = fs.existsSync(filePath);
        if (!exists) return false;
        const buf = fs.readFileSync(filePath);
        // PNG magic number: 89 50 4E 47 0D 0A 1A 0A
        const isPng = buf.length > 24 && buf.readUInt32BE(0) === 0x89504E47 && buf.readUInt32BE(4) === 0x0D0A1A0A;
        const width = buf.readUInt32BE(16);
        const height = buf.readUInt32BE(20);
        return isPng && width === expectedW && height === expectedH;
    }

    assert('apple-touch-icon.png is valid 180x180 PNG', checkPng('apple-touch-icon.png', 180, 180));
    assert('apple-touch-icon-180x180.png is valid 180x180 PNG', checkPng('apple-touch-icon-180x180.png', 180, 180));
    assert('icon-192.png is valid 192x192 PNG', checkPng('icon-192.png', 192, 192));
    assert('icon-512.png is valid 512x512 PNG', checkPng('icon-512.png', 512, 512));

    console.log(`\nResults: ${passed}/${total} Checks Passed.`);
    if (passed !== total) {
        process.exit(1);
    }
}

testIosIcon().catch(err => {
    console.error(err);
    process.exit(1);
});
