/* ==========================================================================
   Trippo Travel Planner - Cloud Sync & Supabase Database
   js/db.js
   ========================================================================== */

import {
    showNotification,
    toggleSidebar,
    escapeHTML
} from './state.js';
import { syncNow, schedulePush, onSyncStatus, pendingChangeCount, initSyncTriggers } from './sync.js';

export const SUPABASE_URL = 'https://lbmxfczgvtznhfhzogla.supabase.co';
export const SUPABASE_ANON_KEY = atob('ZXlKaGJHY2lPaUpJVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SnBjM01pT2lKemRYQmhZbUZ6WlNJc0luSmxaaUk2SW14aWJYaG1ZM3BuZG5SNmJtaG1hSHB2WjJ4aElpd2ljbTlzWlNJNkltRnViMjRpTENKcFlYUWlPakUzT1RBNU1EUTBOVEVzSW1WNGNDSTZNakV3TmpRNE1EUTFNWDAuMVZvaUViWi0yNFRQa0huM1NPN2xUcnFuaTdJVnJEWkZ0QWxYNFIxZEd3MA==');

let supabaseClient = null;
export let currentUser = null;

export function getSupabase() {
    if (supabaseClient) return supabaseClient;
    try {
        if (window.supabase && typeof window.supabase.createClient === 'function') {
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                auth: {
                    flowType: 'implicit',
                    persistSession: true,
                    autoRefreshToken: true,
                    // The OAuth return URL is handled explicitly in handleAuthRedirect() so failures
                    // are visible instead of silently leaving the user signed out
                    detectSessionInUrl: false
                }
            });
        }
    } catch (e) {
        console.warn("Supabase init deferred:", e);
    }
    return supabaseClient;
}

// Small persistent log of sign-in attempts (Settings → read via getAuthLog() in the console)
function logAuth(message) {
    console.log('[Trippo Auth]', message);
    try {
        const log = JSON.parse(localStorage.getItem('trippo_auth_log') || '[]');
        log.push(`${new Date().toISOString()} ${message}`);
        localStorage.setItem('trippo_auth_log', JSON.stringify(log.slice(-15)));
    } catch (e) { /* storage full or blocked — nothing else to do */ }
}
export function getAuthLog() {
    try { return JSON.parse(localStorage.getItem('trippo_auth_log') || '[]'); } catch (e) { return []; }
}

/**
 * Finish a Google (OAuth) sign-in when the page loads with Supabase's response in the URL:
 * #access_token=…&refresh_token=… (implicit), ?code=… (PKCE), or #error=…/?error=… on failure.
 * Shows the real error instead of failing silently, then strips the auth params from the URL.
 */
async function handleAuthRedirect(client) {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const query = new URLSearchParams(window.location.search);
    const err = hash.get('error_description') || query.get('error_description') || hash.get('error') || query.get('error');
    const accessToken = hash.get('access_token');
    const refreshToken = hash.get('refresh_token');
    const code = query.get('code');
    if (!err && !accessToken && !code) return;

    const cleanUrl = () => {
        try { history.replaceState(null, '', window.location.pathname); } catch (e) {}
    };

    if (err) {
        logAuth(`OAuth error returned: ${err}`);
        showNotification(`Google sign-in failed: ${err.replace(/\+/g, ' ')}`, 8000);
        cleanUrl();
        return;
    }

    try {
        const { error } = accessToken
            ? await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken || '' })
            : await client.auth.exchangeCodeForSession(code);
        if (error) throw error;
        logAuth('Sign-in completed from redirect');
    } catch (e) {
        const msg = e?.message || String(e);
        logAuth(`Could not save session: ${msg}`);
        showNotification(/quota|storage/i.test(msg)
            ? 'Sign-in failed: phone storage for Trippo is full. Free up space or clear old data, then try again.'
            : `Sign-in failed: ${msg}`, 8000);
    }
    cleanUrl();
}

export function setCurrentUser(user) {
    currentUser = user;
}

const LAST_USER_KEY = 'trippo_last_user';

function displayNameOf(user) {
    return user?.user_metadata?.full_name || user?.user_metadata?.name || (user?.email ? user.email.split('@')[0] : 'User');
}

// Cloud badge reflects sync state: synced / syncing / offline with pending changes / error
function renderSyncBadge(status, detail) {
    const statusBadge = document.getElementById('cloud-status-badge');
    if (!statusBadge || !currentUser) return;
    const name = escapeHTML(displayNameOf(currentUser));
    const pending = pendingChangeCount();
    if (status === 'syncing') {
        statusBadge.innerHTML = `🔄 Syncing…`;
    } else if (status === 'offline') {
        statusBadge.innerHTML = pending ? `📴 Offline · ${pending} to sync` : `📴 Offline (${name})`;
    } else if (status === 'error') {
        statusBadge.innerHTML = `⚠️ Sync paused`;
        logAuth(`Sync error: ${detail || 'unknown'}`);
        statusBadge.title = `Changes are safe on this device. ${detail || ''}`;
    } else {
        statusBadge.innerHTML = `☁️ Synced (${name})`;
        statusBadge.title = '';
    }
}
onSyncStatus(renderSyncBadge);

export function updateAuthUI(user, { offline = false } = {}) {
    currentUser = user;
    const statusBadge = document.getElementById('cloud-status-badge');
    const inView = document.getElementById('sidebar-auth-logged-in');
    const outView = document.getElementById('sidebar-auth-form');
    const userEmailEl = document.getElementById('sidebar-user-email');

    if (user) {
        const displayName = displayNameOf(user);
        // Remember who's signed in so the app can stay "signed in" while offline
        try {
            localStorage.setItem(LAST_USER_KEY, JSON.stringify({ id: user.id, email: user.email, user_metadata: { full_name: user.user_metadata?.full_name, name: user.user_metadata?.name } }));
        } catch (e) {}
        if (statusBadge) statusBadge.innerHTML = offline ? `📴 Offline (${escapeHTML(displayName)})` : `☁️ Synced (${escapeHTML(displayName)})`;
        if (inView) inView.style.display = 'block';
        if (outView) outView.style.display = 'none';
        if (userEmailEl) userEmailEl.innerText = user.email;

        // Older versions stored the Gemini key in account metadata; restore it once onto this
        // device (saving a key in Settings now clears that cloud copy).
        if (user.user_metadata?.gemini_api_key && !localStorage.getItem('trippoGeminiApiKey')) {
            localStorage.setItem('trippoGeminiApiKey', user.user_metadata.gemini_api_key);
            const keyInput = document.getElementById('gemini-api-key-input');
            if (keyInput) keyInput.value = user.user_metadata.gemini_api_key;
        }
        if (outView) outView.style.display = 'none';
        if (userEmailEl) userEmailEl.innerText = user.email || displayName;
    } else {
        if (statusBadge) statusBadge.innerHTML = `☁️ Cloud Sync`;
        if (inView) inView.style.display = 'none';
        if (outView) outView.style.display = 'block';
    }
}

export async function checkAuthSession() {
    const client = getSupabase();
    if (!client) {
        if (/access_token=|[?&]code=|error_description=/.test(window.location.href)) {
            logAuth('Returned from Google but Supabase library failed to load');
            showNotification('Sign-in failed: cloud library did not load. Check your connection and try again.', 8000);
        }
        return;
    }
    try {
        await handleAuthRedirect(client);
        const { data: { session }, error: sessionError } = await client.auth.getSession();
        if (sessionError) logAuth(`getSession error: ${sessionError.message}`);

        if (session) {
            updateAuthUI(session.user);
            syncNow();
        } else if (hasStoredSession() && (navigator.onLine === false || isNetworkError(sessionError))) {
            // Offline with a saved login: stay signed in using the cached profile; the
            // session refreshes and everything syncs once the connection is back.
            const cached = getCachedUser();
            if (cached) {
                updateAuthUI(cached, { offline: true });
                renderSyncBadge('offline');
            } else {
                updateAuthUI(null);
            }
        } else {
            updateAuthUI(null);
        }

        if (!authListenerAttached) {
            authListenerAttached = true;
            client.auth.onAuthStateChange((event, newSession) => {
                if (event === 'SIGNED_OUT') {
                    updateAuthUI(null);
                    return;
                }
                if (newSession) updateAuthUI(newSession.user);
                if (newSession && (event === 'SIGNED_IN' || event === 'USER_UPDATED')) {
                    // Don't await Supabase calls inside this callback (can deadlock the auth lock)
                    setTimeout(() => syncNow(), 0);
                }
            });
        }
    } catch (e) {
        console.warn("Session check deferred:", e);
    }
}

let authListenerAttached = false;
let syncTriggersAttached = false;

function getCachedUser() {
    try { return JSON.parse(localStorage.getItem(LAST_USER_KEY) || 'null'); } catch (e) { return null; }
}

function hasStoredSession() {
    try { return Object.keys(localStorage).some(k => k.startsWith('sb-') && k.endsWith('-auth-token')); } catch (e) { return false; }
}

function isNetworkError(err) {
    return !!err && /fetch|network|load failed|offline/i.test(err.message || '');
}

/** Wire up automatic sync (back online, app foregrounded). Called once at startup. */
export function initCloudSync() {
    if (syncTriggersAttached) return;
    syncTriggersAttached = true;
    // Back online: refresh the session first (it may have expired while offline), then sync
    initSyncTriggers(() => checkAuthSession());
}

export async function handlePasswordSignIn() {
    const client = getSupabase();
    if (!client) {
        showNotification("Connecting to cloud... check your connection.");
        return;
    }
    const email = document.getElementById('sidebar-email-input').value.trim();
    const password = document.getElementById('sidebar-pass-input').value;

    if (!email || !password) {
        showNotification("Please enter both email and password.");
        return;
    }

    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
        showNotification(error.message);
    } else if (data.user) {
        updateAuthUI(data.user);
        toggleSidebar(false);
        await pullCloudData();
        showNotification("Signed in successfully!");
    }
}

export async function handlePasswordSignUp() {
    const client = getSupabase();
    if (!client) {
        showNotification("Connecting to cloud... check your connection.");
        return;
    }
    const email = document.getElementById('sidebar-email-input').value.trim();
    const password = document.getElementById('sidebar-pass-input').value;

    if (!email || !password) {
        showNotification("Please provide both email and a password.");
        return;
    }

    const { data, error } = await client.auth.signUp({ email, password });
    if (error) {
        showNotification(error.message);
    } else if (data.user) {
        updateAuthUI(data.user);
        toggleSidebar(false);
        await pushLocalToCloud();
        showNotification("Account created and synced!");
    }
}

export async function handleMagicLinkSignIn() {
    const client = getSupabase();
    if (!client) return;
    const email = document.getElementById('sidebar-email-input').value.trim();
    if (!email) {
        showNotification("Please enter an email address.");
        return;
    }
    const { error } = await client.auth.signInWithOtp({
        email: email,
        options: { emailRedirectTo: window.location.origin }
    });
    if (error) {
        showNotification(error.message);
    } else {
        showNotification("Check your inbox for your login link!");
        toggleSidebar(false);
    }
}

export async function handleGoogleSignIn() {
    const client = getSupabase();
    if (!client) {
        showNotification("Connecting to cloud... check your connection.");
        return;
    }
    try {
        const redirectUrl = window.location.origin + window.location.pathname;
        logAuth(`Starting Google sign-in (standalone app: ${window.matchMedia?.('(display-mode: standalone)').matches || !!navigator.standalone})`);
        const { error } = await client.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: redirectUrl
            }
        });
        if (error) {
            showNotification("Google Sign-In: " + error.message);
        }
    } catch (e) {
        console.error("Google Sign-In failed:", e);
        showNotification("Could not initiate Google Sign-In.");
    }
}

export async function handleSignOut() {
    const client = getSupabase();
    // Try to upload anything still pending before signing out
    if (client && currentUser && navigator.onLine !== false) {
        try { await syncNow({ pullFirst: false }); } catch (e) {}
    }
    if (client) {
        try {
            // 'local' signs out this device only (doesn't kill your other devices' sessions)
            // and always clears the saved session, even offline
            const { error } = await client.auth.signOut({ scope: 'local' });
            if (error) logAuth(`Sign-out error (cleared locally anyway): ${error.message}`);
        } catch (e) {
            logAuth(`Sign-out threw: ${e?.message || e}`);
        }
    }
    // Belt and braces: make sure no stale session or sync bookkeeping blocks the next sign-in
    try {
        Object.keys(localStorage).filter(k => k.startsWith('sb-')).forEach(k => localStorage.removeItem(k));
        localStorage.removeItem(LAST_USER_KEY);
    } catch (e) {}
    logAuth('Signed out');
    updateAuthUI(null);
    toggleSidebar(false);
    showNotification("Signed out. Your trips stay on this device.");
}

// Cloud sync lives in sync.js (offline-first, queued uploads). These names are kept because
// other modules call them: saveTrips()/saveWishlist() -> pushLocalToCloud(), sign-in -> pullCloudData().
export async function pullCloudData() {
    await syncNow();
}

export async function pushLocalToCloud() {
    schedulePush();
}

/** "Sync Cloud Now" button: sync and say what happened. */
export async function manualSync() {
    if (!currentUser) {
        showNotification('Sign in to sync your trips to the cloud.');
        return;
    }
    if (navigator.onLine === false) {
        showNotification('Offline — your changes are saved on this device and will sync when you reconnect.', 5000);
        return;
    }
    await syncNow();
    const pending = pendingChangeCount();
    showNotification(pending ? `⚠️ ${pending} change(s) couldn't sync yet — they're safe on this device.` : '☁️ Everything is synced!');
}

/** Sidebar "Sign-in trouble? Show log" */
export function toggleAuthLog(elementId = 'auth-log-view') {
    const el = document.getElementById(elementId);
    if (!el) return;
    const show = el.style.display === 'none';
    el.textContent = getAuthLog().slice().reverse().join('\n') || 'No sign-in attempts recorded on this device yet.';
    el.style.display = show ? 'block' : 'none';
}
export async function saveUserGeminiKeyToCloud(key) {
    const client = getSupabase();
    if (!currentUser || !client) return;
    const { data, error } = await client.auth.updateUser({
        data: { gemini_api_key: key }
    });
    if (error) {
        console.error('Failed to sync Gemini API key to cloud:', error);
    } else {
        console.log('Gemini API key synced to cloud securely.');
    }
}
