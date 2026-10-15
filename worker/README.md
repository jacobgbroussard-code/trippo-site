# Trippo Serverless Edge AI Travel Assistant

A serverless Edge AI backend for **Trippo** powered by **Cloudflare Workers AI** and **Meta Llama 3.1 8B Instruct** (`@cf/meta/llama-3.1-8b-instruct`).

## Features
- **100% Serverless & Free-Tier**: Runs on Cloudflare's global edge network using the native `@cloudflare/ai` binding (`env.AI`).
- **Hidden System Prompt**: Strictly constrains the model to travel itinerary planning and enforces valid, structured JSON output (`title`, `destination`, `summary`, `days`, `activities`).
- **CORS-Ready**: Fully configured with permissive CORS headers (`OPTIONS` preflight + response headers) allowing direct browser calls from `trippo.top`, GitHub Pages, or local testing.
- **Offline-Resilient**: Trippo frontend detects network connectivity (`navigator.onLine`) and degrades gracefully with friendly offline messaging.

## Directory Structure
```
/worker
├── wrangler.toml      # Cloudflare Wrangler configuration with [ai] binding
├── package.json       # Project scripts and dependencies
├── README.md          # Setup & deployment instructions
└── src/
    └── index.js       # Worker entrypoint handling CORS, Prompt Injection & Llama-3 inference
```

## Real flight prices (Travelpayouts)

`GET /flight-prices?origin=IAH&destination=PVG&depart=2027-04-01&return=2027-04-10` and
`GET /flight-deals?origin=LFT` proxy the Travelpayouts Data API, which can't be called from a
web page and needs a secret token. One-time setup (the token is typed into wrangler, never committed):

```bash
npx wrangler login
npx wrangler secret put TP_TOKEN
npx wrangler deploy
```

Then put the worker's URL (e.g. `https://trippo-ai-worker.<account>.workers.dev`) in
`FLIGHT_PRICES_URL` in `js/travel-payouts.js`. Fares are what Aviasales users found recently
(cached up to a few days), not live seat inventory.

## Quick Start & Local Testing

1. Navigate to the worker directory:
   ```bash
   cd worker
   ```

2. Start the local worker with live AI bindings:
   ```bash
   npx wrangler dev
   ```
   The local server will start on `http://127.0.0.1:8787/`.

3. Send a test request:
   ```bash
   curl -X POST http://127.0.0.1:8787/ \
     -H "Content-Type: application/json" \
     -d '{"prompt": "3 days in Paris for pastry and museum lovers"}'
   ```

## Deploying to Cloudflare (Free)

1. Authenticate with your Cloudflare account (if not already logged in):
   ```bash
   npx wrangler login
   ```

2. Deploy directly to your Cloudflare Workers domain:
   ```bash
   npx wrangler deploy
   ```

3. Copy your live worker URL (e.g., `https://trippo-ai-worker.<your-subdomain>.workers.dev`) and save it in Trippo's settings or frontend `js/ai.js`.
