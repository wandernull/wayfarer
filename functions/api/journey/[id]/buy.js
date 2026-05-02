// POST /api/journey/<uuid>/buy
// Creates a Stripe Checkout session for this journey and returns its URL.
// The webhook (/api/stripe/webhook) flips the journey to 'paid' when the
// 'checkout.session.completed' event fires for this session.
//
// If the journey is already paid, returns { status: 'paid' } without
// creating a new session — defends against double-clicks and refresh loops.
export async function onRequestPost(context) {
  const { params, env, request } = context;
  const uuid = params.id;

  if (!env.JOURNEYS) {
    return json({ error: 'JOURNEYS KV binding missing' }, 500);
  }
  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: 'STRIPE_SECRET_KEY missing' }, 500);
  }
  if (!uuid || !/^[0-9a-f-]{16,}$/i.test(uuid)) {
    return json({ error: 'invalid_uuid' }, 400);
  }

  const raw = await env.JOURNEYS.get(`journey:${uuid}`);
  if (!raw) return json({ error: 'not_found' }, 404);

  let record;
  try { record = JSON.parse(raw); } catch {
    return json({ error: 'corrupt_record' }, 500);
  }

  // Already paid — return immediately, no new Checkout session needed.
  if (record.payment?.status === 'paid') {
    return json({ status: 'paid', paidAt: record.payment.paidAt, url: null });
  }

  // Build URLs that bring the user back to this journey.
  const reqUrl = new URL(request.url);
  const base = `${reqUrl.protocol}//${reqUrl.host}`;
  const successUrl = `${base}/journey/${uuid}?paid=1&session={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${base}/journey/${uuid}`;

  // Create the Checkout session via Stripe REST. Form-encoded params, not JSON.
  const params2 = new URLSearchParams();
  params2.append('mode', 'payment');
  params2.append('payment_method_types[]', 'card');
  params2.append('line_items[0][price_data][currency]', 'eur');
  params2.append('line_items[0][price_data][product_data][name]', 'Jounee itinerary');
  params2.append(
    'line_items[0][price_data][product_data][description]',
    'Personalized multi-day travel itinerary. Unlocks the full trip, day regeneration, plan switching, and PDF export. One charge per trip — no subscription.'
  );
  params2.append('line_items[0][price_data][unit_amount]', '499'); // €4.99
  params2.append('line_items[0][quantity]', '1');
  params2.append('success_url', successUrl);
  params2.append('cancel_url', cancelUrl);
  params2.append('metadata[journey_uuid]', uuid);
  params2.append('payment_intent_data[metadata][journey_uuid]', uuid);
  params2.append('client_reference_id', uuid);

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params2
  });

  if (!stripeRes.ok) {
    const errText = await stripeRes.text();
    console.error('[stripe] session create failed', stripeRes.status, errText);
    return json({ error: 'stripe_session_failed', detail: errText }, 502);
  }

  const session = await stripeRes.json();

  // Persist the session ID so the webhook can locate this record by metadata
  // OR by the session ID if metadata is missing (defense in depth).
  record.payment = {
    ...(record.payment || {}),
    status: 'pending',
    stripeSessionId: session.id
  };
  await env.JOURNEYS.put(`journey:${uuid}`, JSON.stringify(record), {
    expirationTtl: 30 * 24 * 60 * 60
  });

  return json({ status: 'pending', url: session.url, sessionId: session.id });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
  });
}
