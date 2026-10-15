/**
 * Trippo - Serverless Edge AI Travel Assistant
 * Powered by Google Gemini 1.5 Flash (with Search Grounding)
 * worker/src/index.js
 */

// Only the Trippo site (and local dev) may use this worker, so other sites can't spend the
// Gemini quota. Scripts can fake an Origin header, which is what the per-IP rate limit is for.
const ALLOWED_ORIGINS = new Set(["https://trippo.top", "https://www.trippo.top"]);
const LOCAL_DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_PROMPT_CHARS = 2000;
const MAX_MESSAGE_CHARS = 4000;
const MAX_MESSAGES = 8; // the chat handler only ever uses the last 8
const TP_MARKER = "581802"; // Travelpayouts partner marker (public; it's in every affiliate link)
const IATA = /^[A-Z]{3}$/;
const MONTH_OR_DAY = /^\d{4}-\d{2}(-\d{2})?$/;

// Real recent fares from the Travelpayouts Data API (cached Aviasales searches, not live seat inventory).
// The API has no CORS, and the token must stay secret, so the app asks this worker.
async function flightPrices(url, env) {
  const origin = String(url.searchParams.get("origin") || "").toUpperCase();
  const destination = String(url.searchParams.get("destination") || "").toUpperCase();
  const depart = String(url.searchParams.get("depart") || "");
  const ret = String(url.searchParams.get("return") || "");
  if (!IATA.test(origin) || !IATA.test(destination)) return { status: 400, body: { success: false, error: "Use 3-letter airport codes." } };
  const api = new URL("https://api.travelpayouts.com/aviasales/v3/prices_for_dates");
  api.searchParams.set("origin", origin);
  api.searchParams.set("destination", destination);
  if (MONTH_OR_DAY.test(depart)) api.searchParams.set("departure_at", depart);
  if (MONTH_OR_DAY.test(ret)) api.searchParams.set("return_at", ret);
  api.searchParams.set("one_way", MONTH_OR_DAY.test(ret) ? "false" : "true");
  api.searchParams.set("currency", "usd");
  api.searchParams.set("sorting", "price");
  api.searchParams.set("limit", "5");
  const res = await fetch(api.toString(), { headers: { "X-Access-Token": env.TP_TOKEN }, cf: { cacheTtl: 1800, cacheEverything: true } });
  if (!res.ok) return { status: 502, body: { success: false, error: `Flight prices are unavailable right now (${res.status}).` } };
  const json = await res.json();
  const fares = (Array.isArray(json.data) ? json.data : []).slice(0, 5).map((f) => ({
    price: f.price,
    airline: f.airline,
    flightNumber: f.flight_number,
    departAt: f.departure_at,
    returnAt: f.return_at || null,
    transfers: f.transfers,
    returnTransfers: f.return_transfers,
    durationMinutes: f.duration_to || f.duration || null,
    link: f.link ? `https://www.aviasales.com${f.link}${String(f.link).includes("?") ? "&" : "?"}marker=${TP_MARKER}` : null,
  }));
  return { status: 200, body: { success: true, currency: "usd", fares } };
}

// Cheapest recent fares from one airport to anywhere (the sidebar's "Top Getaways")
async function flightDeals(url, env) {
  const origin = String(url.searchParams.get("origin") || "").toUpperCase();
  if (!IATA.test(origin)) return { status: 400, body: { success: false, error: "Use a 3-letter airport code." } };
  const res = await fetch(`https://api.travelpayouts.com/v1/prices/cheap?origin=${origin}&currency=usd`, { headers: { "X-Access-Token": env.TP_TOKEN }, cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) return { status: 502, body: { success: false, error: `Flight deals are unavailable right now (${res.status}).` } };
  return { status: 200, body: await res.json() };
}

function isAllowedOrigin(origin) {
  return ALLOWED_ORIGINS.has(origin) || LOCAL_DEV_ORIGIN.test(origin);
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const corsHeaders = {
      "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : "https://trippo.top",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
      "Access-Control-Max-Age": "86400",
      "Content-Type": "application/json",
      "Vary": "Origin",
    };
    const reject = (status, error) =>
      new Response(JSON.stringify({ success: false, error }), { status, headers: corsHeaders });

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method === "POST") {
      if (!isAllowedOrigin(origin)) {
        return reject(403, "This AI service only works from trippo.top.");
      }
      // RATE_LIMITER is configured in wrangler.toml (per visitor IP).
      if (env.RATE_LIMITER) {
        const ip = request.headers.get("CF-Connecting-IP") || "unknown";
        const { success } = await env.RATE_LIMITER.limit({ key: ip });
        if (!success) return reject(429, "Too many AI requests. Please wait a minute and try again.");
      }
      const contentLength = Number(request.headers.get("Content-Length") || 0);
      if (contentLength > MAX_BODY_BYTES) {
        return reject(413, "Request is too large.");
      }
    }

    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/flight-prices" || url.pathname === "/flight-deals")) {
      if (!isAllowedOrigin(origin)) return reject(403, "Flight prices only work from trippo.top.");
      if (env.RATE_LIMITER) {
        const ip = request.headers.get("CF-Connecting-IP") || "unknown";
        const { success } = await env.RATE_LIMITER.limit({ key: ip });
        if (!success) return reject(429, "Too many requests. Please wait a minute.");
      }
      if (!env.TP_TOKEN) return reject(503, "Flight prices aren't set up yet.");
      try {
        const out = url.pathname === "/flight-prices" ? await flightPrices(url, env) : await flightDeals(url, env);
        return new Response(JSON.stringify(out.body), { status: out.status, headers: { ...corsHeaders, "Cache-Control": "public, max-age=1800" } });
      } catch (e) {
        return reject(502, "Flight prices are unavailable right now.");
      }
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return new Response(
        JSON.stringify({
          status: "online",
          service: "Trippo Serverless Edge AI (Gemini Edition)",
          model: "gemini-1.5-flash",
          timestamp: new Date().toISOString(),
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    if (request.method === "POST") {
      try {
        let requestBody;
        try {
          const rawBody = await request.text(); // Content-Length can be absent (chunked)
          if (rawBody.length > MAX_BODY_BYTES) return reject(413, "Request is too large.");
          requestBody = JSON.parse(rawBody);
        } catch (e) {
          return new Response(JSON.stringify({ success: false, error: "Invalid JSON in request body." }), { status: 400, headers: corsHeaders });
        }
        if (typeof requestBody?.prompt === "string") {
          requestBody.prompt = requestBody.prompt.slice(0, MAX_PROMPT_CHARS);
        }
        if (Array.isArray(requestBody?.messages)) {
          requestBody.messages = requestBody.messages.slice(-MAX_MESSAGES).map((m) => ({
            role: m?.role === "assistant" ? "assistant" : "user",
            content: String(m?.content ?? "").slice(0, MAX_MESSAGE_CHARS),
          }));
        }

        const mode = requestBody?.mode || "plan";
        const userPrompt = (requestBody?.prompt || "").trim();
        if (!userPrompt && (!Array.isArray(requestBody?.messages) || requestBody.messages.length === 0)) {
          return new Response(JSON.stringify({ success: false, error: "Missing required 'prompt' or 'messages' field." }), { status: 400, headers: corsHeaders });
        }

        if (!env.GEMINI_API_KEY) {
          console.error("GEMINI_API_KEY is missing.");
          return new Response(JSON.stringify({ success: false, error: "GEMINI_API_KEY is not configured in Cloudflare secrets." }), { status: 500, headers: corsHeaders });
        }

        // Helper function to call Gemini API
        async function callGeminiAPI(systemInstruction, conversationMessages, enableSearch) {
          const contents = conversationMessages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          }));

          const payload = {
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: contents,
            generationConfig: {
              temperature: 0.35,
              topP: 0.9,
              responseMimeType: "application/json"
            }
          };

          if (enableSearch) {
            payload.tools = [{ googleSearch: {} }];
          }

          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          
          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Gemini API Error (${res.status}): ${errText}`);
          }
          
          const json = await res.json();
          if (!json.candidates || json.candidates.length === 0) {
             throw new Error("No response candidates returned from Gemini.");
          }
          return json.candidates[0].content.parts[0].text;
        }

        // ----------------------------------------------------
        // MODE A: IN-APP DAILY PLANNER COPILOT CHATBOT
        // ----------------------------------------------------
        if (mode === "chat") {
          const context = requestBody?.context || {};
          const city = context.city || "your destination";
          const day = context.day || 1;
          const tripName = context.tripName || "Vacation";
          const existingPlaces = Array.isArray(context.existingPlaces) && context.existingPlaces.length > 0
            ? context.existingPlaces.join(", ")
            : "None scheduled yet";

          const chatSystemPrompt = `You are the in-app AI Travel Copilot for Trippo, assisting a traveler currently planning their daily itinerary.
Current Context:
- Destination City: ${city}
- Active Day: Day ${day}
- Trip: ${tripName}
- Already Scheduled Places for Day ${day}: ${existingPlaces}

CRITICAL INSTRUCTIONS & SAFETY CONSTRAINTS:
1. STRICT IMMUTABILITY & NO-DELETION RESTRICTION: You are strictly an ADDITIVE recommendation assistant. You do NOT have any authority, ability, or permission to delete, modify, clear, remove, or overwrite existing trips, itineraries, stops, or places.
2. If the user asks you to delete, cancel, wipe, clear, remove, or replace any trips, cities, days, stops, or places, you MUST decline politely and explain:
   {"reply": "I am designed to suggest and add new travel ideas without altering or deleting your existing plans. To remove or edit any existing places, stops, or trips, you can safely use the trash icon 🗑️ or edit buttons directly in the planner.", "suggestions": []}
3. You are strictly restricted to travel planning, itineraries, restaurants, sightseeing, and local cultural advice.
4. If the user's inquiry is completely unrelated to travel or geography, politely decline.
5. Use Google Search Grounding to find REAL, currently open restaurants and attractions. Do not invent places!
6. If recommending specific spots, activities, or an itinerary, ALWAYS provide them in the structured "suggestions" array.
7. You MUST return a valid JSON object matching this schema EXACTLY:
{
  "reply": "Friendly conversational advice...",
  "suggestions": [
    {
      "name": "Official name of the place/activity",
      "category": "● See & Do",
      "time": "Morning",
      "description": "Why it's recommended and practical advice",
      "address": "Neighborhood or area in ${city}"
    }
  ]
}`;

          const conversationMessages = [];
          if (Array.isArray(requestBody.messages)) {
            requestBody.messages.slice(-8).forEach((m) => {
              if (m.role && m.content) conversationMessages.push({ role: m.role, content: m.content });
            });
          } else {
            conversationMessages.push({ role: "user", content: userPrompt });
          }

          const rawContent = await callGeminiAPI(chatSystemPrompt, conversationMessages, true);
          
          let parsedChat = null;
          try {
            parsedChat = JSON.parse(rawContent);
          } catch (e) {
            parsedChat = { reply: rawContent, suggestions: [] };
          }

          return new Response(
            JSON.stringify({
              success: true,
              mode: "chat",
              reply: parsedChat.reply || "Here are some recommendations for your itinerary:",
              suggestions: Array.isArray(parsedChat.suggestions) ? parsedChat.suggestions : [],
            }),
            { status: 200, headers: corsHeaders }
          );
        }

        // ----------------------------------------------------
        // MODE B: FULL TRIP ITINERARY GENERATOR
        // ----------------------------------------------------
        const systemPrompt = `You are the core AI travel assistant for Trippo, a modern travel planner web app.
CRITICAL INSTRUCTIONS:
1. STRICT DOMAIN CONSTRAINT: You are STRICTLY RESTRICTED to travel planning, vacations, itineraries, city guides, cultural landmarks, and activities.
2. DURATION FIDELITY: If the user requests a specific number of days, you MUST generate an itinerary with EXACTLY that number of days in the "days" array, and set "durationDays" to that exact number.
3. MULTI-CITY & REGIONAL CLARIFICATION: When the user asks for a region, country, or multi-city route, explicitly name and visit real, specific cities in the itinerary.
4. GEOGRAPHIC CLUSTERING & REALISTIC PACING: Group activities each day by physical proximity or neighborhood.
5. LOCATION SPECIFICITY: Every activity's "location" field MUST include a specific neighborhood, street, or landmark district.
6. TRANSIT & CONNECTIVITY GUIDANCE: When an activity involves inter-city travel, briefly mention transit details in the description.
7. Use Google Search Grounding to ensure all restaurants, hotels, and attractions are REAL, verified locations that actually exist!
8. You MUST return a valid JSON object matching the following structure EXACTLY:
{
  "title": "A captivating, concise title",
  "destination": "Main Cities, Region or Country",
  "durationDays": 7,
  "summary": "A 2-3 sentence engaging summary highlighting the route, cultural vibe, food specialties, and practical tips.",
  "days": [
    {
      "day": 1,
      "theme": "City Name: Theme or neighborhood",
      "activities": [
        {
          "time": "Morning",
          "name": "Shamian Island Heritage Walk",
          "category": "● See & Do",
          "description": "Explore colonial architecture, shaded banyan lanes, and riverside promenades.",
          "location": "Shamian Island, Guangzhou"
        }
      ]
    }
  ]
}`;

        const explicitDuration = requestBody.durationDays ? `\nREQUIREMENT: You MUST generate exactly ${requestBody.durationDays} days.` : '';
        const explicitCities = requestBody.resolvedCities && requestBody.resolvedCities.length > 0 
          ? `\nREQUIREMENT: You MUST include stops in these cities: ${requestBody.resolvedCities.join(', ')}.` 
          : '';

        const userContextPrompt = `Plan a travel itinerary for: "${userPrompt}"${explicitDuration}${explicitCities}`;
        
        const rawContent = await callGeminiAPI(systemPrompt, [{ role: "user", content: userContextPrompt }], true);
        
        let parsedItinerary = null;
        try {
          parsedItinerary = JSON.parse(rawContent);
        } catch (e) {
          // Fallback parsing just in case responseMimeType is ignored
          let cleanedJson = rawContent.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
          try {
              parsedItinerary = JSON.parse(cleanedJson);
          } catch(e2) {
              return new Response(JSON.stringify({ success: false, error: "AI returned invalid JSON.", raw: rawContent.slice(0, 300) }), { status: 502, headers: corsHeaders });
          }
        }

        if (parsedItinerary.error) {
          return new Response(JSON.stringify({ success: false, error: parsedItinerary.error }), { status: 400, headers: corsHeaders });
        }

        return new Response(
          JSON.stringify({
            success: true,
            model: "gemini-1.5-flash-grounded",
            itinerary: parsedItinerary,
          }),
          { status: 200, headers: corsHeaders }
        );
      } catch (err) {
        console.error("Gemini AI execution error:", err);
        return new Response(
          JSON.stringify({ success: false, error: err.message || "An unexpected error occurred while communicating with Edge AI." }),
          { status: 500, headers: corsHeaders }
        );
      }
    }

    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed. Use POST / or GET /health." }),
      { status: 405, headers: corsHeaders }
    );
  },
};
