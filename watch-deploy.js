const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Load .env
function loadEnv() {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        content.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const [key, ...vals] = trimmed.split('=');
                if (key && vals.length > 0) {
                    process.env[key.trim()] = vals.join('=').trim().replace(/^["']|["']$/g, '');
                }
            }
        });
    }
}

loadEnv();

const SITE_ID = process.env.NETLIFY_SITE_ID;
const AUTH_TOKEN = process.env.NETLIFY_AUTH_TOKEN;

if (!SITE_ID || !AUTH_TOKEN) {
    console.error('❌ Missing NETLIFY_SITE_ID or NETLIFY_AUTH_TOKEN in .env');
    process.exit(1);
}

console.log('👀 [Trippo Auto-Deploy] File watcher active!');
console.log('Watching for changes in index.html, styles/, js/, etc.');
console.log('Whenever you save a file, it will automatically deploy to https://trippo.top\n');

let deployTimer = null;
let isDeploying = false;
let pendingChanges = new Set();

async function runDeploy() {
    if (isDeploying) {
        // Queue another deploy if changes occurred during deploy
        deployTimer = setTimeout(runDeploy, 2000);
        return;
    }

    isDeploying = true;
    const changedList = Array.from(pendingChanges).join(', ');
    pendingChanges.clear();

    const timestamp = new Date().toLocaleTimeString();
    console.log(`\n⚡ [${timestamp}] Changes detected in: ${changedList}`);
    console.log('📦 Bundling and uploading to Netlify...');

    const zipPath = path.join(__dirname, 'dist.zip');
    try {
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

        const filesToZip = ['index.html', 'styles', 'js', 'manifest.webmanifest', 'sw.js', 'fad.jpg']
            .filter(f => fs.existsSync(path.join(__dirname, f)))
            .join(' ');

        execSync(`tar -a -c -f dist.zip ${filesToZip}`, { cwd: __dirname });

        const zipBuffer = fs.readFileSync(zipPath);

        const res = await fetch(`https://api.netlify.com/api/v1/sites/${SITE_ID}/deploys`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AUTH_TOKEN}`,
                'Content-Type': 'application/zip'
            },
            body: zipBuffer
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`HTTP ${res.status}: ${err}`);
        }

        const data = await res.json();
        const finishTime = new Date().toLocaleTimeString();
        console.log(`✅ [${finishTime}] LIVE SITE UPDATED! 🌐 ${data.ssl_url || data.url}`);

    } catch (err) {
        if (err.message && err.message.includes('credit usage exceeded')) {
            console.error('⚠️ [Netlify Free Tier Limit] Netlify monthly build/deploy credits for this free account are currently exhausted.');
            console.error('👉 You can add free credits or re-enable deploys at: https://app.netlify.com/teams/jacobgbroussard-code/overview');
        } else {
            console.error('❌ Auto-deploy error:', err.message);
        }
    } finally {
        if (fs.existsSync(zipPath)) {
            try { fs.unlinkSync(zipPath); } catch (e) {}
        }
        isDeploying = false;
    }
}

function onFileChanged(filename) {
    if (!filename) return;
    const basename = path.basename(filename);
    if (basename.startsWith('.') || basename === 'dist.zip' || filename.includes('tests') || filename.includes('scratch') || basename === 'watch-deploy.js' || basename === 'deploy.js') {
        return;
    }

    pendingChanges.add(filename);
    clearTimeout(deployTimer);
    deployTimer = setTimeout(runDeploy, 1500); // Debounce 1.5s
}

// Watch root files
fs.watch(__dirname, (eventType, filename) => {
    onFileChanged(filename);
});

// Watch styles directory
const stylesDir = path.join(__dirname, 'styles');
if (fs.existsSync(stylesDir)) {
    fs.watch(stylesDir, (eventType, filename) => {
        onFileChanged(`styles/${filename}`);
    });
}

// Watch js directory
const jsDir = path.join(__dirname, 'js');
if (fs.existsSync(jsDir)) {
    fs.watch(jsDir, (eventType, filename) => {
        onFileChanged(`js/${filename}`);
    });
}

// Keep process running
setInterval(() => {}, 1000 * 60 * 60);
