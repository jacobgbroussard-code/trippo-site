const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('=============================================================');
console.log('   TRIPPO TRAVEL PLANNER - GOOGLE SIGN-IN & AUTH VERIFICATION');
console.log('=============================================================\n');

let passed = 0;
let total = 0;

function check(title, fn) {
    total++;
    try {
        fn();
        console.log(`  ✅ [PASS] ${title}`);
        passed++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${title}: ${err.message}`);
    }
}

const indexHtml = fs.readFileSync('index.html', 'utf8');
const dbJs = fs.readFileSync('js/db.js', 'utf8');
const componentsCss = fs.readFileSync('styles/components.css', 'utf8');
const appJs = fs.readFileSync('js/app.js', 'utf8');
const toolsJs = fs.readFileSync('js/tools.js', 'utf8');
const swJs = fs.readFileSync('sw.js', 'utf8');

// 1. Version consistency check for v2.3.68
check('v2.3.68 version consistency across all files', () => {
    assert(indexHtml.includes('Trippo Travel Planner v2.3.68'), 'index.html title must be v2.3.68');
    assert(indexHtml.includes('js/app.js?v=2.3.68'), 'index.html script tag must be v2.3.68');
    assert(indexHtml.includes('v2.3.68</span></span>'), 'index.html header version badge must be v2.3.68');
    assert(appJs.includes("CURRENT_VERSION = '2.3.68'"), 'js/app.js CURRENT_VERSION must be 2.3.68');
    assert(toolsJs.includes('version: "2.3.68"'), 'js/tools.js backup version must be 2.3.68');
    assert(swJs.includes('trippo-cache-v2.3.68'), 'sw.js CACHE_NAME must be trippo-cache-v2.3.68');
});

// 2. Google Sign-In button in index.html
check('Google Sign-In button rendered in sidebar auth form', () => {
    assert(indexHtml.includes('class="google-signin-btn"'), 'google-signin-btn class must exist in index.html');
    assert(indexHtml.includes('onclick="handleGoogleSignIn()"'), 'onclick handler handleGoogleSignIn() must exist');
    assert(indexHtml.includes('Continue with Google'), 'Button text "Continue with Google" must be present');
    assert(indexHtml.includes('<svg width="18" height="18" viewBox="0 0 48 48">'), 'Google 4-color SVG icon must be embedded');
    assert(indexHtml.includes('letter-spacing:0.5px;">or</span>'), 'Divider between Google Sign-In and email login must exist');
});

// 3. CSS styles for .google-signin-btn
check('CSS styling for .google-signin-btn including dark theme', () => {
    assert(componentsCss.includes('.google-signin-btn {'), '.google-signin-btn base rules must exist');
    assert(componentsCss.includes('.google-signin-btn:hover {'), '.google-signin-btn hover rules must exist');
    assert(componentsCss.includes('[data-theme="dark"] .google-signin-btn {'), 'Dark theme override must exist');
    assert(componentsCss.includes('[data-theme="dark"] .google-signin-btn:hover {'), 'Dark theme hover override must exist');
});

// 4. db.js handleGoogleSignIn logic
check('handleGoogleSignIn exported and correctly calls Supabase signInWithOAuth', () => {
    assert(dbJs.includes('export async function handleGoogleSignIn()'), 'handleGoogleSignIn must be exported');
    assert(dbJs.includes("provider: 'google'"), 'signInWithOAuth must specify provider google');
    assert(dbJs.includes('window.location.origin + window.location.pathname'), 'OAuth redirectTo must be properly constructed');
});

// 5. db.js updateAuthUI metadata display
check('updateAuthUI properly handles OAuth display name and user metadata', () => {
    assert(dbJs.includes('user.user_metadata?.full_name'), 'updateAuthUI should check full_name from metadata');
    assert(dbJs.includes('user.user_metadata?.name'), 'updateAuthUI should check name from metadata');
    assert(dbJs.includes('escapeHTML(displayName)'), 'displayName must be safely escaped before HTML insertion');
});

console.log(`\n=============================================================`);
console.log(`Summary: ${passed}/${total} Checks Passed`);
console.log(`=============================================================`);

if (passed !== total) {
    process.exit(1);
}
