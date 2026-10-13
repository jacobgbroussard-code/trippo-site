/* ==========================================================================
   Trippo Travel Planner - Cloud Sync & Supabase Database
   js/db.js
   ========================================================================== */

import {
    trips,
    setTrips,
    wishlistPins,
    setWishlistPins,
    normalizeCategory,
    showNotification,
    toggleSidebar,
    escapeHTML
} from './state.js';

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

export function updateAuthUI(user) {
    currentUser = user;
    const statusBadge = document.getElementById('cloud-status-badge');
    const inView = document.getElementById('sidebar-auth-logged-in');
    const outView = document.getElementById('sidebar-auth-form');
    const userEmailEl = document.getElementById('sidebar-user-email');

    if (user) {
        const displayName = user.user_metadata?.full_name || user.user_metadata?.name || (user.email ? user.email.split('@')[0] : 'User');
        if (statusBadge) statusBadge.innerHTML = `☁️ Synced (${escapeHTML(displayName)})`;
        if (inView) inView.style.display = 'block';
        if (outView) outView.style.display = 'none';
        if (userEmailEl) userEmailEl.innerText = user.email;

        // Restore Gemini API Key if it exists in metadata
        if (user.user_metadata?.gemini_api_key) {
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
        updateAuthUI(session ? session.user : null);
        if (session) {
            await pullCloudData();
        }

        client.auth.onAuthStateChange(async (event, newSession) => {
            updateAuthUI(newSession ? newSession.user : null);
            if (newSession && (event === 'SIGNED_IN' || event === 'USER_UPDATED')) {
                await pullCloudData();
            }
        });
    } catch (e) {
        console.warn("Session check deferred:", e);
    }
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
    if (!client) return;
    await client.auth.signOut();
    updateAuthUI(null);
    toggleSidebar(false);
    showNotification("Signed out. Using local storage.");
}

export async function pullCloudData() {
    const client = getSupabase();
    if (!currentUser || !client) return;
    try {
        const { data: cTrips, error: tErr } = await client.from('trips').select('*');
        if (!tErr && cTrips && cTrips.length > 0) {
            const cloudTrips = cTrips.map(t => ({
                id: t.id,
                name: t.name,
                startDate: t.start_date,
                stops: t.stops || [],
                places: t.places || [],
                budgetTravelers: t.budget_travelers || 2,
                expenses: t.expenses || [],
                isExample: false
            }));

            const mergedTrips = [...cloudTrips];
            trips.forEach(localT => {
                if (localT.isExample && localT.name === "Asia Adventure") return;
                const matchIndex = mergedTrips.findIndex(ct => ct.id === localT.id);
                if (matchIndex === -1) {
                    mergedTrips.push(localT);
                } else if ((localT.stops && localT.stops.length > mergedTrips[matchIndex].stops.length) ||
                           (localT.places && localT.places.length > mergedTrips[matchIndex].places.length)) {
                    mergedTrips[matchIndex] = localT;
                }
            });

            setTrips(mergedTrips);
            localStorage.setItem('myTrips', JSON.stringify(trips));
            if (window.renderHome) window.renderHome();
        }

        const { data: cWish, error: wErr } = await client.from('wishlist').select('*');
        if (!wErr && cWish && cWish.length > 0) {
            const cloudWishlist = cWish.map(w => ({
                id: w.id,
                wishlistId: w.wishlist_id || 'master',
                name: w.name,
                category: normalizeCategory(w.category),
                lat: w.lat,
                lon: w.lon,
                notes: w.notes
            }));

            const mergedWishlist = [...cloudWishlist];
            wishlistPins.forEach(localP => {
                if (!mergedWishlist.some(cp => cp.id === localP.id || (cp.name === localP.name && Math.abs(cp.lat - localP.lat) < 0.001))) {
                    mergedWishlist.push(localP);
                }
            });

            setWishlistPins(mergedWishlist);
            localStorage.setItem('myWishlist', JSON.stringify(wishlistPins));
            const wishDetail = document.getElementById('wishlist-detail-view');
            if (wishDetail && wishDetail.style.display === 'flex') {
                if (window.renderWishlistPins) window.renderWishlistPins(false);
            } else {
                if (window.renderWishlistCollections) window.renderWishlistCollections();
            }
        }
        showNotification("☁️ Data synced from cloud!");
    } catch(e) {
        console.error("Cloud pull error:", e);
    }
}

export async function pushLocalToCloud() {
    const client = getSupabase();
    if (!currentUser || !client) return;
    try {
        for (let trip of trips) {
            if (trip.isExample && trip.name === "Asia Adventure") continue;

            await client.from('trips').upsert({
                id: trip.id,
                user_id: currentUser.id,
                name: trip.name,
                start_date: trip.startDate,
                stops: trip.stops,
                places: trip.places
            });
        }
        for (let pin of wishlistPins) {
            const payload = {
                id: pin.id,
                user_id: currentUser.id,
                name: pin.name,
                category: pin.category,
                lat: pin.lat,
                lon: pin.lon,
                notes: pin.notes
            };
            let { error } = await client.from('wishlist').upsert({ ...payload, wishlist_id: pin.wishlistId || 'master' });
            if (error && error.message && error.message.includes('wishlist_id')) {
                await client.from('wishlist').upsert(payload);
            }
        }
    } catch(e) {
        console.error("Cloud push error:", e);
    }
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
