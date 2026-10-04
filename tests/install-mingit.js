const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TARGET_DIR = path.join(process.env.USERPROFILE || 'C:\\Users\\Jacob', '.git-bin');
const ZIP_PATH = path.join(TARGET_DIR, 'mingit.zip');
const MINGIT_URL = 'https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.1/MinGit-2.56.0-64-bit.zip';

async function installMinGit() {
    console.log(`Setting up Git in: ${TARGET_DIR}`);
    if (!fs.existsSync(TARGET_DIR)) {
        fs.mkdirSync(TARGET_DIR, { recursive: true });
    }

    const gitExe = path.join(TARGET_DIR, 'cmd', 'git.exe');
    if (fs.existsSync(gitExe)) {
        console.log('git.exe already exists, verifying...');
        const version = execSync(`"${gitExe}" --version`).toString().trim();
        console.log('✅ Found:', version);
        return gitExe;
    }

    console.log(`Downloading MinGit from ${MINGIT_URL}...`);
    const res = await fetch(MINGIT_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status} downloading MinGit`);

    const arrayBuffer = await res.arrayBuffer();
    fs.writeFileSync(ZIP_PATH, Buffer.from(arrayBuffer));
    console.log(`Downloaded ${fs.statSync(ZIP_PATH).size} bytes. Extracting...`);

    execSync(`tar -xf "${ZIP_PATH}" -C "${TARGET_DIR}"`, { stdio: 'inherit' });
    if (fs.existsSync(ZIP_PATH)) fs.unlinkSync(ZIP_PATH);

    const version = execSync(`"${gitExe}" --version`).toString().trim();
    console.log('🎉 Successfully installed Git:', version);
    return gitExe;
}

installMinGit().catch(console.error);
