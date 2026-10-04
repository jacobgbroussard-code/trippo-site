const { execSync } = require('child_process');
const path = 'C:\\Users\\Jacob\\.git-bin\\cmd';

try {
    const current = execSync('powershell -Command "[Environment]::GetEnvironmentVariable(\'Path\', \'User\')"').toString().trim();
    if (!current.includes(path)) {
        const updated = current ? `${current};${path}` : path;
        execSync(`powershell -Command "[Environment]::SetEnvironmentVariable('Path', '${updated}', 'User')"`);
        console.log('✅ Added Git to User PATH.');
    } else {
        console.log('Git already in User PATH.');
    }
} catch (e) {
    console.error(e);
}
