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
      system: body.system ?? "CRITICAL: Every venue must be a SPECIFIC, REAL, NAMED place — never a description of a place.\nBAD (forbidden): \"local köfte house near Propholis\", \"a seafood restaurant by the harbor\", \"3-star hotel\", \"local gym\". These are descriptions, not names.\nGOOD: \"Develi Karaköy\", \"Hamdi Restaurant\", \"Divan Mersin\", \"Gold's Gym\".\nFALLBACK RULE: If you are unsure of the exact name, pick the single most famous/well-known real establishment of that type in the city — still a specific name, never a description.\nHOTELS: real brand name (e.g. \"Hilton Garden Inn\", \"Radisson Blu\"). RESTAURANTS: real restaurant name. GYMS: real gym name. SIGHTS: official attraction name.\nReturn ONLY raw valid JSON. Be concise: max 5 events per day, descriptions under 25 words, empty details arrays.",
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
