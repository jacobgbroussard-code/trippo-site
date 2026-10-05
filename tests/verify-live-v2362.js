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
                    if (latest.head_commit?.id?.startsWith('04df9dd') && latest.status === 'completed' && latest.conclusion === 'success') {
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

    console.log('\nVerifying live site HTML on https://trippo.top/ ...');
    const htmlRes = await fetch('https://trippo.top/?t=' + Date.now());
    const html = await htmlRes.text();
    console.log('  Live Title v2.3.62:', html.includes('Trippo Travel Planner v2.3.62'));
    console.log('  Live Add Wishlist Pin to Trip Modal:', html.includes('id="add-wishlist-to-trip-modal"'));
    console.log('  Live Wishlist Picker in Place Search:', html.includes('id="toggle-wishlist-picker-btn"'));
}

verifyLive().catch(console.error);
