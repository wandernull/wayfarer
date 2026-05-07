// GET /api/journey/<uuid>
// Returns the saved journey record. The payment block is stripped of any
// sensitive fields (e.g. stripeSessionId) before being returned to the client.
// 404 when the UUID isn't present (TTL expired or never existed).
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

  // Strip stripeSessionId / any other server-only fields from the payment block.
  // Invoice URLs (hosted page + PDF) ARE customer-facing and safe to expose —
  // they're already pre-signed for public access by Stripe.
  const safePayment = {
    status: record.payment?.status || 'pending',
    amount: record.payment?.amount ?? 499,
    currency: record.payment?.currency || 'EUR',
    paidAt: record.payment?.paidAt || null,
    invoice: record.payment?.invoice || null
  };

  return new Response(JSON.stringify({ ...record, payment: safePayment }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
  });
}
