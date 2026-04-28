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
  // Clamp temperature to Anthropic's [0, 1] range; default to 1.0 for variety.
  const rawTemp = typeof body.temperature === "number" ? body.temperature : 1.0;
  const temperature = Math.max(0, Math.min(1, rawTemp));

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
      temperature,
      messages,
      system: body.system ?? "Return ONLY raw valid JSON. No markdown, no explanation, just JSON. Do NOT include hotel events, airport transfers, or accommodation in this MVP — focus on the activity flow (meals, sights, bars, gyms, parks). Vary venues across days; do not reuse the same restaurant or cafe.",
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
