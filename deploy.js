const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Load .env if present
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

const SITE_ID = process.env.NETLIFY_SITE_ID || process.argv[2];
const AUTH_TOKEN = process.env.NETLIFY_AUTH_TOKEN || process.argv[3];

async function deploy() {
    console.log('🚀 [Trippo Deploy] Preparing live deployment to Netlify...\n');

    if (!SITE_ID || !AUTH_TOKEN) {
        console.error('❌ Error: Missing Netlify credentials.\n');
        console.log('Please provide your Netlify Site ID and Personal Access Token:');
        console.log('1. In a .env file:');
        console.log('   NETLIFY_SITE_ID=your-site-id');
        console.log('   NETLIFY_AUTH_TOKEN=your-personal-access-token\n');
        console.log('2. Or pass as command arguments:');
        console.log('   node deploy.js <SITE_ID> <AUTH_TOKEN>\n');
        console.log('--- Where to find these ---');
        console.log('• Site ID: Netlify Dashboard -> Select Site -> Site configuration -> General -> Site details -> Site ID');
        console.log('• Access Token: Netlify User Settings (profile icon) -> Applications -> Personal access tokens -> New access token');
        process.exit(1);
    }

    const zipPath = path.join(__dirname, 'dist.zip');
    try {
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

        console.log('📦 Bundling static files into deployment archive...');
        // Package site files with tar for standard forward-slash directory paths
        const filesToZip = ['index.html', 'styles', 'js', 'manifest.webmanifest', 'sw.js', 'fad.jpg']
            .filter(f => fs.existsSync(path.join(__dirname, f)))
            .join(' ');

        execSync(`tar -a -c -f dist.zip ${filesToZip}`, {
            cwd: __dirname,
            stdio: 'inherit'
        });

        const zipStats = fs.statSync(zipPath);
        console.log(`📦 Archive ready (${(zipStats.size / 1024).toFixed(1)} KB). Uploading to Netlify...`);

        const zipBuffer = fs.readFileSync(zipPath);

        const response = await fetch(`https://api.netlify.com/api/v1/sites/${SITE_ID}/deploys`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AUTH_TOKEN}`,
                'Content-Type': 'application/zip'
            },
            body: zipBuffer
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Netlify API returned HTTP ${response.status}: ${errText}`);
        }

        const data = await response.json();
        console.log('\n✅ Deployment successfully created and published!');
        console.log(`🌐 Live URL:      ${data.ssl_url || data.url}`);
        console.log(`🔍 Deploy Preview: ${data.deploy_ssl_url || data.deploy_url}`);
        console.log(`🆔 Deploy ID:     ${data.id}`);
        console.log(`⏱️ State:         ${data.state}`);

    } catch (err) {
        console.error('\n❌ Deployment failed:', err.message);
        process.exit(1);
    } finally {
        if (fs.existsSync(zipPath)) {
            try { fs.unlinkSync(zipPath); } catch (e) {}
        }
    }
}

deploy();
