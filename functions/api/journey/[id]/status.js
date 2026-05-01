// GET /api/journey/<uuid>/status
// Lightweight payment-status probe. Designed for polling after a Stripe
// Checkout redirect — returns just { status, paidAt } without the full
// trip payload. 404 when the UUID is unknown.
export async function onRequestGet(context) {
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

  return new Response(JSON.stringify({
    status: record.payment?.status || 'pending',
    paidAt: record.payment?.paidAt || null
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
  });
}
