// POST /api/journey/save
// Body: { profile, itinerary, candidates, planByCity, legs }
// Persists the full trip payload under a fresh UUID with a 30-day TTL while
// the journey is in 'pending' payment state. Returns { uuid }.
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.JOURNEYS) {
    return new Response(JSON.stringify({ error: 'JOURNEYS KV binding missing' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!body?.itinerary?.cities?.length) {
    return new Response(JSON.stringify({ error: 'itinerary required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const uuid = crypto.randomUUID();
  const record = {
    uuid,
    createdAt: new Date().toISOString(),
    profile: body.profile || null,
    itinerary: body.itinerary,
    candidates: body.candidates || null,
    planByCity: body.planByCity || null,
    legs: body.legs || null,
    payment: {
      status: 'pending',
      amount: 499,
      currency: 'EUR',
      stripeSessionId: null,
      paidAt: null
    }
  };

  // 30-day TTL while pending. When payment lands (next commit) the record is
  // re-PUT without expirationTtl so paid trips persist indefinitely.
  await env.JOURNEYS.put(`journey:${uuid}`, JSON.stringify(record), {
    expirationTtl: 30 * 24 * 60 * 60
  });

  return new Response(JSON.stringify({ uuid }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
