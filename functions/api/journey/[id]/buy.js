// POST /api/journey/<uuid>/buy
// Creates a Stripe Checkout session for this journey and returns its URL.
// The webhook (/api/stripe/webhook) flips the journey to 'paid' when the
// 'checkout.session.completed' event fires for this session.
//
// If the journey is already paid, returns { status: 'paid' } without
// creating a new session — defends against double-clicks and refresh loops.
// Stripe Checkout supports a `locale` parameter that controls the language of
// the hosted Checkout UI. We mirror Jounee's 7 supported languages so a user
// browsing in Turkish doesn't get dropped into an English Stripe page mid-flow.
// Whitelist guards against arbitrary values being forwarded to Stripe.
const SUPPORTED_LOCALES = new Set(['en', 'tr', 'es', 'fr', 'de', 'it', 'pt']);

export async function onRequestPost(context) {
  const { params, env, request } = context;
  const uuid = params.id;

  let body = {};
  try { body = await request.json(); } catch {}
  const locale = SUPPORTED_LOCALES.has(body?.locale) ? body.locale : 'en';
  // Localized product copy is forwarded from the SPA (single source of truth in
  // translations.js). Length caps + type guard defend against the client
  // forwarding garbage / overlong strings to Stripe (which would also be
  // visible on the receipt). Falls back to English defaults if missing.
  const productName = (typeof body?.productName === 'string' && body.productName.trim())
    ? body.productName.trim().slice(0, 60)
    : 'Jounee itinerary';
  const productDescription = (typeof body?.productDescription === 'string' && body.productDescription.trim())
    ? body.productDescription.trim().slice(0, 500)
    : 'Personalized multi-day travel itinerary. Unlocks the full trip, day regeneration, plan switching, and PDF export. One charge per trip — no subscription.';

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
  params2.append('line_items[0][price_data][product_data][name]', productName);
  params2.append('line_items[0][price_data][product_data][description]', productDescription);
  params2.append('line_items[0][price_data][unit_amount]', '499'); // €4.99
  params2.append('line_items[0][quantity]', '1');
  params2.append('success_url', successUrl);
  params2.append('cancel_url', cancelUrl);
  params2.append('locale', locale);
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
