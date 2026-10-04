const { spawnSync } = require('child_process');
const path = require('path');
const keyPath = path.join(process.env.USERPROFILE, '.ssh', 'id_ed25519');

const res = spawnSync('ssh-keygen', ['-t', 'ed25519', '-C', 'jacobgbroussard@gmail.com', '-f', keyPath, '-N', ''], {
    stdio: 'inherit'
});

console.log('Result code:', res.status);
