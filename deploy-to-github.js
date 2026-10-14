const fs = require('fs');
const { execSync } = require('child_process');
const GIT_EXE = fs.existsSync('C:\\Program Files\\Git\\cmd\\git.exe')
    ? 'C:\\Program Files\\Git\\cmd\\git.exe'
    : 'C:\\Users\\Jacob\\.git-bin\\cmd\\git.exe';

function run(cmd) {
    console.log(`> ${cmd}`);
    execSync(cmd, { stdio: 'inherit' });
}

async function deploy() {
    try {
        // Make sure the secret-scanning commit hook is active for every tool using this folder.
        execSync(`"${GIT_EXE}" config core.hooksPath githooks`);

        console.log('📦 Staging changes...');
        run(`"${GIT_EXE}" add .`);

        // The repo is public: refuse to deploy if anything staged looks like a secret.
        try {
            run(`"${process.execPath}" secret-scan.js`);
        } catch (e) {
            console.error('\n❌ Deploy stopped: fix the secret-scan findings above first.');
            process.exitCode = 1;
            return;
        }

        const timestamp = new Date().toLocaleString();
        try {
            run(`"${GIT_EXE}" commit -m "Update Trippo site - ${timestamp}"`);
        } catch (e) {
            console.log('No new changes to commit.');
        }

        console.log('🚀 Pushing to GitHub (main branch)...');
        run(`"${GIT_EXE}" push -u origin main`);
        console.log('\n✅ Pushed to GitHub successfully! GitHub Pages will update your live site shortly.');
    } catch (err) {
        console.error('\n❌ Push failed:', err.message);
        console.log('\nTip: If you haven\'t added the remote yet, run:');
        console.log('  git remote add origin https://github.com/jacobgbroussard-code/trippo-site.git');
    }
}

deploy();
