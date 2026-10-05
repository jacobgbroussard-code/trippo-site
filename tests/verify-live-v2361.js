const { spawn } = require('child_process');

async function waitForDeploy() {
    console.log('Waiting for GitHub Pages build and deployment to complete...');
    for (let i = 0; i < 25; i++) {
        try {
            const res = await fetch('https://api.github.com/repos/jacobgbroussard-code/trippo-site/actions/runs');
            if (res.ok) {
                const data = await res.json();
                if (data.workflow_runs && data.workflow_runs.length > 0) {
                    const latest = data.workflow_runs[0];
                    console.log(`[Attempt ${i + 1}] Commit: ${latest.head_commit?.id?.slice(0, 7)} | Status: ${latest.status} | Conclusion: ${latest.conclusion}`);
                    if (latest.head_commit?.id?.startsWith('0ed5394') && latest.status === 'completed' && latest.conclusion === 'success') {
                        return true;
                    }
                }
            }
        } catch (e) {}
        await new Promise(r => setTimeout(r, 5000));
    }
    return false;
}

async function verifyLive() {
    await waitForDeploy();

    console.log('\nChecking live asset URLs on https://trippo.top/ ...');
    const urls = [
        'https://trippo.top/apple-touch-icon.png',
        'https://trippo.top/apple-touch-icon-180x180.png',
        'https://trippo.top/icon-192.png',
        'https://trippo.top/icon-512.png',
        'https://trippo.top/manifest.webmanifest'
    ];

    for (const url of urls) {
        try {
            const res = await fetch(url + '?nocache=' + Date.now(), { method: 'HEAD' });
            console.log(`  ${url} -> HTTP ${res.status} (${res.headers.get('content-type')})`);
        } catch (err) {
            console.error(`  ${url} -> Fetch Error: ${err.message}`);
        }
    }

    console.log('\nVerifying live site HTML on https://trippo.top/ ...');
    const htmlRes = await fetch('https://trippo.top/?t=' + Date.now());
    const html = await htmlRes.text();
    console.log('  Live Title v2.3.61:', html.includes('Trippo Travel Planner v2.3.61'));
    console.log('  Live Apple Touch Icon:', html.includes('apple-touch-icon.png'));
    console.log('  Live Apple Title Meta:', html.includes('apple-mobile-web-app-title'));
    console.log('  Live Manifest Icon 192:', html.includes('icon-192.png'));
}

verifyLive().catch(console.error);
