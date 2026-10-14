// Blocks commits that would publish secrets. The repo is public, so anything committed is
// readable by anyone forever (a Netlify token leaked this way in Oct 2026).
//   node secret-scan.js          -> scan staged changes (used by githooks/pre-commit and deploy)
//   node secret-scan.js --all    -> scan every tracked file
// A line that must contain a look-alike value can be allowed with a "secret-scan:allow" comment.
const { execFileSync } = require('child_process');

const BLOCKED_FILES = [
    /(^|\/)\.env$/,
    /(^|\/)\.env\.(local|production|development)$/,
    /site-credentials.*\.csv$/i,
    /SITE_MANAGEMENT_DIRECTORY\.md$/,
    /(^|\/)telegram-bridge\.js$/,
    /(^|\/)bot-controls\//,
    /\.(pem|p12|pfx|key)$/i,
];

const PATTERNS = [
    ['Netlify access token', /nfp_[A-Za-z0-9]{20,}/],
    ['GitHub token', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/],
    ['Telegram bot token', /\b\d{8,10}:AA[0-9A-Za-z_-]{30,}/],
    ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
    ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{20,}/],
    ['OpenAI API key', /\bsk-(proj-)?[A-Za-z0-9_-]{32,}/],
    ['Stripe secret key', /\b(sk|rk)_live_[A-Za-z0-9]{20,}/],
    ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
    ['Cloudflare API token', /\bCLOUDFLARE_API_TOKEN\s*=\s*['"]?[A-Za-z0-9_-]{30,}/],
    ['Private key', /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
    ['Supabase secret key', /\bsb_secret_[A-Za-z0-9_-]{20,}/],
];

// The Supabase anon key is public by design; a service_role JWT is not.
function isServiceRoleJwt(line) {
    for (const token of line.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []) {
        try {
            const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
            if (payload.role === 'service_role') return true;
        } catch (e) { /* not a JWT */ }
    }
    return false;
}

function git(args) {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

const scanAll = process.argv.includes('--all');
const files = (scanAll
    ? git(['ls-files'])
    : git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
).split('\n').map(f => f.trim()).filter(Boolean);

const problems = [];
for (const file of files) {
    if (BLOCKED_FILES.some(re => re.test(file))) {
        problems.push(`${file}: this file holds private credentials and must never be committed`);
        continue;
    }
    let content;
    try {
        content = scanAll ? git(['show', `HEAD:${file}`]) : git(['show', `:${file}`]);
    } catch (e) { continue; }
    if (content.includes('\u0000')) continue; // binary
    content.split('\n').forEach((line, i) => {
        if (line.includes('secret-scan:allow')) return;
        for (const [label, re] of PATTERNS) {
            if (re.test(line)) problems.push(`${file}:${i + 1}: looks like a ${label}`);
        }
        if (isServiceRoleJwt(line)) problems.push(`${file}:${i + 1}: Supabase service_role key (full database access)`);
    });
}

if (problems.length) {
    console.error('\n🛑 Secret scan blocked this commit — the repo is public:\n');
    problems.forEach(p => console.error('  • ' + p));
    console.error('\nMove the value to .env (gitignored) and read it from there, then unstage the file');
    console.error('with `git restore --staged <file>`. If it is a false alarm, add a "secret-scan:allow"');
    console.error('comment on that line.\n');
    process.exit(1);
}
console.log(`🔒 Secret scan passed (${files.length} file${files.length === 1 ? '' : 's'} checked).`);
