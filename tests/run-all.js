// Runs the Trippo regression suite one script at a time and prints a summary.
//   node tests/run-all.js              -> the core suite below
//   node tests/run-all.js --all        -> core suite plus every other test-*.js feature test
//   node tests/run-all.js <name> ...   -> just those scripts (with or without .js)
// Browser tests need the dev server on http://127.0.0.1:8080 (node dev-server.js).
// A failing script is retried once so a one-off hiccup (slow Chrome start, network blip to a
// CDN) doesn't fail the run; anything that passes only on retry is flagged in the output.
const { spawnSync } = require('child_process');
const path = require('path');
const http = require('http');

const SUITE = [
    // Static checks (no browser)
    'audit',
    'check-template-onclicks',
    'test-transit-direction-modes',
    // Core browser regression
    'comprehensive-verify',
    'test-transpacific-and-locking',
    'test-offline-sync',
    'test-route-distances-and-settings',
    'test-wishlist-to-trip',
    'test-trip-sharing-collab',
    'test-flexible-dates',
];

const TIMEOUT_MS = 240000;
const FAIL_PATTERN = /❌|\bFAIL(ED)?\b|Test error|Test failed|Missing template onclick functions: \[\s*'|missing from exports: \[\s*'/;

function serverUp() {
    return new Promise(resolve => {
        const req = http.get('http://127.0.0.1:8080/', res => { res.resume(); resolve(true); });
        req.on('error', () => resolve(false));
        req.setTimeout(3000, () => { req.destroy(); resolve(false); });
    });
}

function runOnce(name) {
    const started = Date.now();
    const r = spawnSync(process.execPath, [path.join(__dirname, name + '.js')], {
        cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: TIMEOUT_MS,
    });
    const output = (r.stdout || '') + (r.stderr || '');
    const timedOut = r.error && r.error.code === 'ETIMEDOUT';
    const ok = !timedOut && r.status === 0 && !FAIL_PATTERN.test(output);
    return { ok, output, timedOut, secs: Math.round((Date.now() - started) / 1000) };
}

(async () => {
    const args = process.argv.slice(2);
    const everyTest = () => require('fs').readdirSync(__dirname).filter(f => /^test-.*\.js$/.test(f)).map(f => f.slice(0, -3));
    const names = (args[0] === '--all' ? [...new Set([...SUITE, ...everyTest()])] : args.length ? args : SUITE)
        .map(n => n.replace(/\.js$/, ''));
    if (!(await serverUp())) {
        console.log('⚠️  Dev server not reachable on :8080 — start it with `node dev-server.js`; browser tests will fail.\n');
    }
    const results = [];
    for (const name of names) {
        process.stdout.write(`▶ ${name} ... `);
        let r = runOnce(name);
        let retried = false;
        if (!r.ok) { retried = true; r = runOnce(name); }
        results.push({ name, ...r, retried });
        console.log(r.ok ? `✅ ${r.secs}s${retried ? ' (passed on retry)' : ''}` : `❌ ${r.timedOut ? 'timed out' : 'failed'}`);
        if (!r.ok) {
            const tail = r.output.trim().split('\n').filter(l => l.trim()).slice(-8).join('\n    ');
            console.log('    ' + tail);
        }
    }
    const passed = results.filter(r => r.ok).length;
    console.log(`\n${passed}/${results.length} scripts passed`);
    process.exit(passed === results.length ? 0 : 1);
})();
