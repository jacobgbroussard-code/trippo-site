# Trippo — notes for AI coding agents

Shared instructions for **any** AI agent working on this repo (Claude Code, Antigravity, etc.).
`CLAUDE.md` just imports this file, so keep everything here — one source of truth.

## What this is
Trippo (https://trippo.top) is an offline-first travel-planner PWA. Plain HTML/CSS/vanilla JS
ES modules — **no build step, no bundler, no npm dependencies** for the site itself.

- `index.html` — single page, all markup and modals
- `js/` — ES modules: `app.js` (entry/boot), `state.js` (shared state + safe storage),
  `planner.js`, `places.js`, `places-autocomplete.js`, `maps.js` (Leaflet + tile providers),
  `wishlist.js`, `bookings.js` (Trip.com / Booking / Google Flights deep links),
  `travel-payouts.js`, `tools.js`, `weather.js`, `settings.js`, `collab.js` ("Plan with Friends"),
  `db.js` (Supabase auth + sync), `ai.js` (AI assistant/copilot)
- `styles/main.css`, `styles/components.css`
- `sw.js` — service worker with a static-asset cache list
- `worker/` — separate Cloudflare Worker (Gemini-backed "Edge AI"), deployed with wrangler
- `tests/` — standalone Node scripts that drive Chrome via CDP; not a test framework

## Commands
Node comes from a system install if present, otherwise Antigravity's bundled
`C:\Users\Jacob\AppData\Roaming\Antigravity\bin\agy-node.cmd`. The `.cmd`/`.ps1` launchers pick automatically.

- Local dev server: `node dev-server.js` → http://127.0.0.1:8080/
- Main regression checks: `node tests/comprehensive-verify.js`, `node tests/test-transpacific-and-locking.js`, `node tests/audit.js`
- Browser tests save screenshots to `tests/artifacts/` (gitignored)
- Deploy: `node deploy-to-github.js` — runs `git add .`, commits, pushes `main`; GitHub Pages serves it in ~30s

## Releasing a change (version bump)
The version string appears in several places and they must match, or users get stale cached files:
- `js/app.js` → `CURRENT_VERSION`
- `sw.js` → `CACHE_NAME = 'trippo-cache-vX.Y.Z'`
- `index.html` → every `?v=X.Y.Z` query string
Bump all of them together for any user-visible change. If you add a new JS/CSS/image file the app
needs offline, add it to `STATIC_ASSETS` in `sw.js`.

## Rules
- **Never commit secrets.** `.env`, `site-credentials-and-services.csv`, `SITE_MANAGEMENT_DIRECTORY.md`,
  the Telegram bot (`telegram-bridge.js`, `bot-controls/`, `scripts/`) are gitignored on purpose.
  Because deploy does `git add .`, check `git status` before deploying if you created new files.
- Don't deploy unless the user asks. Deploying = publishing to the live site.
- Keep it dependency-free vanilla JS; CDN libraries (Leaflet etc.) are loaded in `index.html`.
- Check mobile layout (iPhone safe areas) for UI changes — most users are on phones.

## Working with two AI tools
The user switches between Claude Code and Antigravity on this same folder. Git is the handoff:
commit (or at least don't leave half-finished edits) before switching, and don't have both
agents edit at the same time. Read `git log -5` / `git status` at the start of a session to see
what the other tool did.
