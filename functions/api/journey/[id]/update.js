// POST /api/journey/<uuid>/update
// Re-PUTs the trip record after a paid mutation (regen-day, plan-swap).
// Only paid journeys can be updated — pending journeys' CTAs are disabled
// in the UI so this should never fire for them.
//
// Body: any subset of { profile, itinerary, candidates, planByCity, legs }.
// uuid, createdAt, and payment are preserved server-side. No TTL — paid
// records persist indefinitely.
export async function onRequestPost(context) {
  const { request, params, env } = context;
  const uuid = params.id;

  if (!env.JOURNEYS) {
    return new Response(JSON.stringify({ error: 'JOURNEYS KV binding missing' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  if (!uuid || !/^[0-9a-f-]{16,}$/i.test(uuid)) {
    return new Response(JSON.stringify({ error: 'invalid_uuid' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const raw = await env.JOURNEYS.get(`journey:${uuid}`);
  if (!raw) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let existing;
  try { existing = JSON.parse(raw); } catch {
    return new Response(JSON.stringify({ error: 'corrupt_record' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (existing.payment?.status !== 'paid') {
    return new Response(JSON.stringify({ error: 'payment_required' }), {
      status: 403,
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

  const updated = {
    ...existing,
    profile: body.profile ?? existing.profile,
    itinerary: body.itinerary ?? existing.itinerary,
    candidates: body.candidates ?? existing.candidates,
    planByCity: body.planByCity ?? existing.planByCity,
    legs: body.legs ?? existing.legs,
    updatedAt: new Date().toISOString()
  };

  await env.JOURNEYS.put(`journey:${uuid}`, JSON.stringify(updated));

  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
  });
}
