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
      max_tokens: 16000,
      stream: true,
      messages,
      system: body.system ?? "Return ONLY raw valid JSON. No markdown, no explanation, just JSON.\nCRITICAL VENUE NAMING: Always use SPECIFIC real venue names. NEVER generic descriptions.\n- Hotels: real brand name (e.g. 'Divan Mersin', 'DoubleTree by Hilton', 'Radisson Blu'). Never '3-star hotel'.\n- Restaurants: real restaurant name (e.g. 'Guveç Dunyasi', 'Tarihi Adana Ocakbasi'). Never 'local restaurant'.\n- Gyms: real gym name (e.g. \"Gold's Gym\"). Never 'local gym'.\n- Sights: official attraction name.\nFor lesser-known cities: use the most famous real landmark/area name — always SPECIFIC.\nBe concise: max 5 events per day, descriptions under 25 words, empty details arrays.",
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
