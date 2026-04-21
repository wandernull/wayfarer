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
      system: body.system ?? "CRITICAL: Always use SPECIFIC real venue names — never generic descriptions.\nHOTELS: Name the actual hotel brand (e.g. \"Divan Mersin\", \"DoubleTree by Hilton\", \"Radisson Blu\"). Never write \"3-star hotel\" or \"city center hotel\".\nRESTAURANTS: Name the actual restaurant (e.g. \"Güveç Dünyası\", \"Tarihi Adana Ocakbaşı\"). Never write \"a local restaurant\" or \"seafood place\".\nGYMS: Name the actual gym (e.g. \"Gold's Gym\", \"FitLife\"). Never write \"local gym\".\nSIGHTS: Use the official attraction name.\nFor less-known cities: use the most famous real landmark or well-known local spot name — but always a SPECIFIC NAME.\nReturn ONLY raw valid JSON. Be concise: max 5 events per day, descriptions under 15 words, empty details arrays.",
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
