/* ==========================================================================
   Trippo Travel Planner - Anonymous crash reports
   js/error-report.js

   Sends uncaught script errors to the Supabase `client_errors` table
   (supabase/client-errors.sql) so problems on people's phones show up without
   anyone having to copy a log. Only the error text, stack, app version, browser
   and page path are sent: no account, trip, location or URL-hash data (share
   links carry whole trips in the hash).
   ========================================================================== */

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './db.js';

const MAX_REPORTS_PER_SESSION = 5;
// Errors we can't act on: browser quirks, extensions, third-party scripts.
const IGNORED = [
    /ResizeObserver loop/i,
    /^Script error\.?$/i, // cross-origin script, no details available
    /Travelpayouts|tp-em\.com/i,
    /Non-Error promise rejection captured/i,
];

const sent = new Set();
let reportsSent = 0;
let tableMissing = false;

function isOwnScript(source) {
    if (!source) return true; // inline HTML event handlers report no file
    try { return new URL(source, location.href).origin === location.origin; } catch (e) { return false; }
}

function report(message, source, stack) {
    message = String(message || '').slice(0, 1000);
    if (!message || tableMissing || reportsSent >= MAX_REPORTS_PER_SESSION) return;
    if (!navigator.onLine || location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;
    if (IGNORED.some(re => re.test(message)) || !isOwnScript(source)) return;
    const key = message + '|' + (source || '');
    if (sent.has(key)) return;
    sent.add(key);
    reportsSent++;

    let appVersion = '';
    try { appVersion = localStorage.getItem('trippo_app_version') || ''; } catch (e) {}

    fetch(`${SUPABASE_URL}/rest/v1/client_errors`, {
        method: 'POST',
        keepalive: true,
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
        },
        body: JSON.stringify({
            app_version: appVersion.slice(0, 20),
            message,
            source: String(source || '').replace(location.origin, '').split('?')[0].slice(0, 300),
            stack: String(stack || '').replace(new RegExp(location.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '').slice(0, 4000),
            user_agent: navigator.userAgent.slice(0, 300),
            page: location.pathname.slice(0, 300),
        }),
    }).then(res => {
        if (res.status === 404) tableMissing = true; // SQL not run yet: stop trying
    }).catch(() => {});
}

window.addEventListener('error', (e) => {
    if (e.error || e.message) report(e.message, e.filename, e.error && e.error.stack);
});

window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    const message = reason && reason.message ? reason.message : String(reason);
    report('Unhandled promise rejection: ' + message, (reason && reason.fileName) || '', reason && reason.stack);
});

// For testing from the console: reportErrorForTest('hello')
export function reportErrorForTest(message) {
    report(message, '', new Error(message).stack);
}
