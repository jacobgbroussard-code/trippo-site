/**
 * Trippo - Serverless Edge AI Travel Assistant
 * Powered by Google Gemini 1.5 Flash (with Search Grounding)
 * worker/src/index.js
 */

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
      "Access-Control-Max-Age": "86400",
      "Content-Type": "application/json",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

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
          requestBody = await request.json();
        } catch (e) {
          return new Response(JSON.stringify({ success: false, error: "Invalid JSON in request body." }), { status: 400, headers: corsHeaders });
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
