# Trippo tests

Plain Node scripts (no test framework). Browser tests launch headless Chrome and drive the
app over the DevTools protocol, so they need the dev server running first:

```
node dev-server.js          # serves http://127.0.0.1:8080
node tests/run-all.js       # core suite, prints a pass/fail summary
```

`run-all.js` retries a failing script once and flags anything that only passed on retry.
`node tests/run-all.js --all` runs every test; `node tests/run-all.js test-offline-sync
test-flexible-dates` runs just those. Any script also runs on its own: `node tests/<name>.js`.

## Core suite (`run-all.js`)

| Script | Covers |
| --- | --- |
| `audit.js` | Every function `index.html` calls is exported from `js/` |
| `check-template-onclicks.js` | Same check for `onclick`s built inside JS templates |
| `test-transit-direction-modes.js` | Transit mode helpers, CSS, version strings match |
| `comprehensive-verify.js` | Boot, all tabs, maps, Google, settings, service worker |
| `test-transpacific-and-locking.js` | Route math, date-line routes, stop locking, version bump |
| `test-offline-sync.js` | Offline-first cloud sync against a fake Supabase |
| `test-route-distances-and-settings.js` | Route distance dividers, settings modal, nights stepper |
| `test-wishlist-to-trip.js` | Wishlist pins and adding them to trips |
| `test-trip-sharing-collab.js` | Share links (copy and live co-plan), trip deletion |
| `test-flexible-dates.js` | Trips without a start date |

## Feature tests (run on demand)

The other `test-*.js` scripts each cover one feature area (AI assistant and copilot,
flight hub, hotels, transit, Google Places search, mobile layouts and safe areas, map
touch handling, Travelpayouts, icons, and so on). Run them when you change that area.

## Conventions

- Screenshots go to `tests/artifacts/` (gitignored). Each script keeps its own Chrome
  profile in `tests/scratch_*` (gitignored, safe to delete).
- Every browser test uses its own `--remote-debugging-port`; pick an unused one for a new
  test, and poll `http://127.0.0.1:<port>/json/version` before opening a tab.
- Wait for `window.trippoReady === true` before driving the app; it is set once boot,
  including the startup sign-in check, has finished.
- Read the version from `js/app.js` (`CURRENT_VERSION`) instead of hard-coding it.
