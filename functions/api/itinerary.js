export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const messages = body.messages ?? (body.prompt ? [{ role: "user", content: body.prompt }] : []);

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 20000,
      stream: true,
      messages,
      system: body.system ?? "Return ONLY raw valid JSON. No markdown, no explanation, just JSON.\n\nDAY STRUCTURE RULES (follow strictly):\n1. GEOGRAPHIC COHERENCE: Assign each day a specific neighborhood, district, or area of the city. Every single event on that day — breakfast, sights, lunch, activities, dinner — must be within that zone or within 15 minutes of each other. Never put events from different parts of the city on the same day. For example, if Day 2 is in Ubud (Bali), ALL events that day must be in or near Ubud — not Kuta, not Seminyak, not Denpasar.\n2. MANDATORY MEALS: Every day MUST include breakfast, lunch, and dinner as separate events. No exceptions. Even on arrival day (if time allows) and last day (before departure buffer).\n3. DAY ORDER: Structure each day as: Breakfast → Morning activity → Lunch → Afternoon activity → Dinner → (optional: evening/nightlife if interests include it). Adjust timing realistically.\n4. ARRIVAL DAY: Start from arrival time. If arriving after 18:00, only include dinner + hotel check-in. If arriving before 14:00, include afternoon activity + dinner.\n5. DEPARTURE DAY: Work backwards from the latest activity end time provided. Include breakfast always. Include lunch only if time allows before the departure buffer.\n6. TRAVEL BETWEEN ZONES: If the trip visits multiple neighborhoods across different days, the first event of the new day can be in the new zone — but add a brief travel note in the description.\n\nCRITICAL VENUE NAMING: Always use SPECIFIC real venue names. NEVER generic descriptions.\n- Hotels: real brand name (e.g. 'Four Seasons Ubud', 'Alaya Resort'). Never 'nice hotel'.\n- Restaurants: real restaurant name. Never 'local restaurant' or 'beachside cafe'.\n- Gyms: real gym name. Never 'local gym'.\n- Sights: official attraction name.\nFor lesser-known cities: use the most famous real landmark — always a SPECIFIC name.\nMax 5 events per day (excluding meals — meals are mandatory on top), descriptions under 25 words, empty details arrays.",
    }),
  });

  if (!upstream.ok) {
    const err = await upstream.text();
    return new Response(err, { status: upstream.status, headers: { "Content-Type": "application/json" } });
  }

  // Pass the SSE stream straight through to the client
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
