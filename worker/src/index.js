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

        const userPrompt = (requestBody?.prompt || "").trim();
        if (!userPrompt) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Missing required 'prompt' field. Please provide your travel destination or idea.",
            }),
            { status: 400, headers: corsHeaders }
          );
        }

        // Hidden System Prompt: Strictly restricts the model to travel planning and enforces structured JSON
        const systemPrompt = `You are the core AI travel assistant for Trippo, a modern travel planner web app.
CRITICAL INSTRUCTIONS:
1. You are STRICTLY RESTRICTED to travel planning, vacations, itineraries, city guides, cultural landmarks, and activities.
2. If the user's prompt is completely unrelated to travel or geography (e.g., coding, math, politics), return this JSON:
   {"error": "I can only assist with travel itineraries and vacation planning. Please share a travel destination or trip idea!"}
3. For travel requests, you MUST return a valid JSON object matching the following structure EXACTLY:
{
  "title": "A captivating, concise title (e.g. 5 Days in Tokyo: Shrines, Anime & Street Food)",
  "destination": "Main City, Country (e.g. Tokyo, Japan)",
  "durationDays": 5,
  "summary": "A 2-3 sentence engaging summary highlighting the vibe, food specialties, and practical tips.",
  "days": [
    {
      "day": 1,
      "theme": "Theme or neighborhood (e.g. Historic Asakusa & Akihabara)",
      "activities": [
        {
          "time": "Morning",
          "name": "Senso-ji Temple & Nakamise Street",
          "description": "Explore Tokyo's oldest temple and sample freshly made melonpan and dango.",
          "location": "Asakusa, Tokyo"
        },
        {
          "time": "Afternoon",
          "name": "Akihabara Electric Town",
          "description": "Browse multi-story retro arcade halls, manga shops, and electronics boutiques.",
          "location": "Akihabara, Tokyo"
        },
        {
          "time": "Evening",
          "name": "Izakaya Alley Dining in Ueno",
          "description": "Savor authentic yakitori and local craft beers beneath the train tracks.",
          "location": "Ueno, Tokyo"
        }
      ]
    }
  ]
}
4. DO NOT wrap the output in markdown codeblocks (no \`\`\`json). Output RAW JSON only.
5. Provide between 2 to 4 activities per day with actionable, realistic suggestions.`;

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
