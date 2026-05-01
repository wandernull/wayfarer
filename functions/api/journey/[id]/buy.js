// POST /api/journey/<uuid>/buy
// STUB — flips payment.status to 'paid', drops the 30-day TTL by re-PUTting
// the record without expirationTtl. Will be replaced with a Stripe Checkout
// session creation later. Idempotent: a second call on a paid journey is a
// no-op and returns the same { status: 'paid', paidAt }.
export async function onRequestPost(context) {
  const { params, env } = context;
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

  let record;
  try { record = JSON.parse(raw); } catch {
    return new Response(JSON.stringify({ error: 'corrupt_record' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (record.payment?.status !== 'paid') {
    record.payment = {
      ...(record.payment || {}),
      status: 'paid',
      paidAt: new Date().toISOString(),
      // Stripe fields stay null in stub mode; set when real Checkout lands.
      stripeSessionId: record.payment?.stripeSessionId || null
    };
  }

  // Re-PUT without expirationTtl — paid journeys persist indefinitely.
  await env.JOURNEYS.put(`journey:${uuid}`, JSON.stringify(record));

  return new Response(JSON.stringify({
    status: record.payment.status,
    paidAt: record.payment.paidAt
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
  });
}
