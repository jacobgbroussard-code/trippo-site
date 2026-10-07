/**
 * Trippo - Serverless Edge AI Travel Assistant
 * Powered by Cloudflare Workers AI & Llama 3 8B Instruct
 * worker/src/index.js
 */

export default {
  async fetch(request, env, ctx) {
    // Standard CORS headers allowing requests from Trippo web app (GitHub Pages, custom domains, or localhost)
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
      "Access-Control-Max-Age": "86400",
      "Content-Type": "application/json",
    };

    // 1. Handle CORS Preflight OPTIONS Request
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    const url = new URL(request.url);

    // 2. Health check endpoint
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return new Response(
        JSON.stringify({
          status: "online",
          service: "Trippo Serverless Edge AI Travel Assistant",
          model: "@cf/meta/llama-3-8b-instruct",
          timestamp: new Date().toISOString(),
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    // 3. AI Itinerary Generation Endpoint (POST / or POST /generate)
    if (request.method === "POST") {
      try {
        let requestBody;
        try {
          requestBody = await request.json();
        } catch (e) {
          return new Response(
            JSON.stringify({ success: false, error: "Invalid JSON in request body." }),
            { status: 400, headers: corsHeaders }
          );
        }

        const mode = requestBody?.mode || "plan";
        const userPrompt = (requestBody?.prompt || "").trim();
        if (!userPrompt && (!Array.isArray(requestBody?.messages) || requestBody.messages.length === 0)) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Missing required 'prompt' or 'messages' field. Please provide your travel question or idea.",
            }),
            { status: 400, headers: corsHeaders }
          );
        }

        // Check for Cloudflare Workers AI binding
        if (!env.AI) {
          console.error("Cloudflare Workers AI binding (env.AI) is missing or undefined.");
          return new Response(
            JSON.stringify({
              success: false,
              error: "Workers AI binding is not configured. Please ensure [ai] binding is active in wrangler.toml.",
            }),
            { status: 500, headers: corsHeaders }
          );
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
2. If the user asks you to delete, cancel, wipe, clear, remove, or replace any trips, cities, days, stops, or places (e.g., "delete my trip", "remove this stop", "clear Day 1", "wipe my itinerary"), you MUST decline politely and explain:
   {"reply": "I am designed to suggest and add new travel ideas without altering or deleting your existing plans. To remove or edit any existing places, stops, or trips, you can safely use the trash icon 🗑️ or edit buttons directly in the planner.", "suggestions": []}
3. You are strictly restricted to travel planning, itineraries, restaurants, sightseeing, and local cultural advice.
4. If the user's inquiry is completely unrelated to travel or geography, politely decline:
   {"reply": "I am your Trippo travel assistant and can only help with travel recommendations, itineraries, dining, and activities!", "suggestions": []}
5. Provide an engaging, concise conversational reply (1-3 paragraphs) answering their request for ${city}.
6. If recommending specific spots, activities, or an itinerary, ALWAYS provide them in the structured "suggestions" array:
   - "name": Official name of the place/activity
   - "category": "● Eat & Drink" or "● See & Do"
   - "time": "Morning" | "Lunch" | "Afternoon" | "Evening" | "Night"
   - "description": Why it's recommended and practical advice
   - "address": Neighborhood or area in ${city}
7. Return a valid JSON object matching this schema EXACTLY:
{
  "reply": "Friendly conversational advice...",
  "suggestions": [
    {
      "name": "Senso-ji Temple",
      "category": "● See & Do",
      "time": "Morning",
      "description": "Tokyo's oldest and most iconic temple with bustling market stalls.",
      "address": "Asakusa, Tokyo"
    }
  ]
}
8. If the user asked a general question without venue recommendations, set "suggestions": [].
9. DO NOT wrap output in markdown codeblocks (no \`\`\`json). Output RAW JSON only.`;

          const conversationMessages = [
            { role: "system", content: chatSystemPrompt },
          ];

          if (Array.isArray(requestBody.messages)) {
            requestBody.messages.slice(-8).forEach((m) => {
              if (m.role && m.content) conversationMessages.push({ role: m.role, content: m.content });
            });
          } else {
            conversationMessages.push({ role: "user", content: userPrompt });
          }

          const aiResponse = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
            messages: conversationMessages,
            temperature: 0.35,
            max_tokens: 1600,
          });

          const rawContent = (aiResponse?.response || "").trim();
          let cleanedJson = rawContent
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();

          let parsedChat = null;
          try {
            parsedChat = JSON.parse(cleanedJson);
          } catch (e) {
            const match = cleanedJson.match(/\{[\s\S]*\}/);
            if (match) {
              try { parsedChat = JSON.parse(match[0]); } catch (e2) {}
            }
          }

          if (!parsedChat) {
            return new Response(
              JSON.stringify({
                success: true,
                mode: "chat",
                reply: rawContent.replace(/```/g, "").trim(),
                suggestions: [],
              }),
              { status: 200, headers: corsHeaders }
            );
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
        // MODE B: FULL TRIP ITINERARY GENERATOR (mode === "plan")
        // ----------------------------------------------------
        const systemPrompt = `You are the core AI travel assistant for Trippo, a modern travel planner web app.
CRITICAL INSTRUCTIONS:
1. You are STRICTLY RESTRICTED to travel planning, vacations, itineraries, city guides, cultural landmarks, and activities.
2. If the user's prompt is completely unrelated to travel or geography (e.g., coding, math, politics), return this JSON:
   {"error": "I can only assist with travel itineraries and vacation planning. Please share a travel destination or trip idea!"}
3. DURATION FIDELITY: If the user requests a specific number of days or weeks (e.g. "7 days in southern china", "10 days in japan", "weekend in rome"), you MUST generate an itinerary with EXACTLY that number of days in the "days" array, and set "durationDays" to that exact number. Do NOT shorten to 3 days if they asked for 7 days!
4. MULTI-CITY & REGIONAL CLARIFICATION: When the user asks for a region, country, or multi-city route (e.g., "Southern China", "Northern Italy", "Southeast Asia", "Japan Golden Route"), you MUST explicitly name and visit real, specific cities in the itinerary (e.g., for Southern China: Guangzhou, Guilin/Yangshuo, Hong Kong/Shenzhen). Specify the city name clearly in the day theme, activity names, and activity locations.
5. For travel requests, you MUST return a valid JSON object matching the following structure EXACTLY:
{
  "title": "A captivating, concise title (e.g. 7 Days in Southern China: Guangzhou, Guilin & Hong Kong)",
  "destination": "Main Cities, Region or Country (e.g. Southern China: Guangzhou, Guilin, Hong Kong)",
  "durationDays": 7,
  "summary": "A 2-3 sentence engaging summary highlighting the route, cultural vibe, food specialties, and practical tips.",
  "days": [
    {
      "day": 1,
      "theme": "City Name: Theme or neighborhood (e.g. Guangzhou: Historic Shamian Island & Dim Sum)",
      "activities": [
        {
          "time": "Morning",
          "name": "Shamian Island Heritage Walk",
          "description": "Explore colonial architecture, shaded banyan lanes, and riverside promenades.",
          "location": "Shamian Island, Guangzhou"
        },
        {
          "time": "Afternoon",
          "name": "Traditional Dim Sum Lunch & Chen Clan Ancestral Hall",
          "description": "Savor authentic Cantonese har gow and admire intricate Lingnan wood and brick carvings.",
          "location": "Liwan District, Guangzhou"
        },
        {
          "time": "Evening",
          "name": "Canton Tower & Pearl River Illuminated Cruise",
          "description": "Take in glittering panoramic views of the modern skyline from the river.",
          "location": "Haizhu District, Guangzhou"
        }
      ]
    }
  ]
}
6. DO NOT wrap the output in markdown codeblocks (no \`\`\`json). Output RAW JSON only.
7. Provide between 2 to 4 activities per day with actionable, realistic suggestions.`;

        // Check for Cloudflare Workers AI binding
        if (!env.AI) {
          console.error("Cloudflare Workers AI binding (env.AI) is missing or undefined.");
          return new Response(
            JSON.stringify({
              success: false,
              error: "Workers AI binding is not configured. Please ensure [ai] binding is active in wrangler.toml.",
            }),
            { status: 500, headers: corsHeaders }
          );
        }

        // Call fast free-tier model: @cf/meta/llama-3-8b-instruct
        const aiResponse = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Plan a travel itinerary for: "${userPrompt}"` },
          ],
          temperature: 0.35,
          max_tokens: 1600,
        });

        const rawContent = (aiResponse?.response || "").trim();

        // Extract and parse JSON safely
        let cleanedJson = rawContent
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();

        let parsedItinerary = null;
        try {
          parsedItinerary = JSON.parse(cleanedJson);
        } catch (firstErr) {
          // Attempt to extract the first balanced JSON object if additional conversational text was included
          const match = cleanedJson.match(/\{[\s\S]*\}/);
          if (match) {
            try {
              parsedItinerary = JSON.parse(match[0]);
            } catch (secondErr) {
              console.error("Failed secondary JSON parse:", secondErr);
            }
          }
        }

        if (!parsedItinerary) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "AI model response could not be parsed into a structured itinerary. Please try a different query.",
              raw: rawContent.slice(0, 300),
            }),
            { status: 502, headers: corsHeaders }
          );
        }

        if (parsedItinerary.error) {
          return new Response(
            JSON.stringify({
              success: false,
              error: parsedItinerary.error,
            }),
            { status: 400, headers: corsHeaders }
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            model: "@cf/meta/llama-3-8b-instruct",
            itinerary: parsedItinerary,
          }),
          { status: 200, headers: corsHeaders }
        );
      } catch (err) {
        console.error("Cloudflare Worker AI execution error:", err);
        return new Response(
          JSON.stringify({
            success: false,
            error: err.message || "An unexpected error occurred while communicating with Edge AI.",
          }),
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
