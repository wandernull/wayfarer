// POST /api/stripe/webhook
// Receives Stripe webhook events. Verifies the signature using
// STRIPE_WEBHOOK_SECRET, then on 'checkout.session.completed' flips the
// matching journey record to paid (idempotently).
//
// Locally, run `stripe listen --forward-to localhost:8788/api/stripe/webhook`
// to forward events; the CLI prints a webhook signing secret — drop it into
// .dev.vars as STRIPE_WEBHOOK_SECRET. Production: configure the webhook
// endpoint in the Stripe dashboard pointing at https://<host>/api/stripe/webhook
// and listen for at least the 'checkout.session.completed' event.
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.JOURNEYS) return new Response('KV binding missing', { status: 500 });
  if (!env.STRIPE_WEBHOOK_SECRET) return new Response('webhook secret missing', { status: 500 });

  const signature = request.headers.get('stripe-signature');
  if (!signature) return new Response('missing signature header', { status: 400 });

  const rawBody = await request.text();

  const ok = await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!ok) {
    console.warn('[webhook] signature verification failed');
    return new Response('invalid signature', { status: 400 });
  }

  let event;
  try { event = JSON.parse(rawBody); } catch {
    return new Response('invalid JSON', { status: 400 });
  }

  // We only act on completed Checkout sessions. Every other event is ack'd
  // with 200 so Stripe stops retrying.
  if (event.type !== 'checkout.session.completed') {
    return new Response(JSON.stringify({ ok: true, ignored: event.type }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const session = event.data?.object;
  const uuid = session?.metadata?.journey_uuid || session?.client_reference_id;
  if (!uuid) {
    console.warn('[webhook] no journey_uuid on session', session?.id);
    return new Response(JSON.stringify({ ok: true, warning: 'no journey uuid' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const raw = await env.JOURNEYS.get(`journey:${uuid}`);
  if (!raw) {
    console.warn('[webhook] journey not found', uuid);
    // Still ack — TTL may have expired. Don't make Stripe retry.
    return new Response(JSON.stringify({ ok: true, warning: 'journey not in KV' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let record;
  try { record = JSON.parse(raw); } catch {
    return new Response('corrupt record', { status: 500 });
  }

  // Idempotent — multiple webhook deliveries won't double-process.
  if (record.payment?.status !== 'paid') {
    // The session has invoice creation enabled, so it carries an `invoice` ID.
    // One follow-up API call gets us the customer-facing hosted URL + PDF —
    // we persist those so the SPA can offer a "Download invoice" link on the
    // post-payment success modal without ever touching the Stripe key client-
    // side. Best-effort: if the lookup fails, we still mark the trip as paid
    // and skip the invoice block (user can email support if needed).
    let invoiceMeta = null;
    if (session.invoice && env.STRIPE_SECRET_KEY) {
      try {
        const invRes = await fetch(`https://api.stripe.com/v1/invoices/${encodeURIComponent(session.invoice)}`, {
          headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }
        });
        if (invRes.ok) {
          const inv = await invRes.json();
          invoiceMeta = {
            id: inv.id,
            number: inv.number || null,
            hostedUrl: inv.hosted_invoice_url || null,
            pdfUrl: inv.invoice_pdf || null
          };
        } else {
          console.warn('[webhook] invoice fetch failed', session.invoice, invRes.status);
        }
      } catch (e) {
        console.warn('[webhook] invoice fetch threw', e?.message);
      }
    }

    record.payment = {
      ...(record.payment || {}),
      status: 'paid',
      paidAt: new Date().toISOString(),
      stripeSessionId: session.id,
      stripePaymentIntentId: session.payment_intent || null,
      amount: session.amount_total ?? record.payment?.amount ?? 499,
      currency: ((session.currency || record.payment?.currency || 'eur') + '').toUpperCase(),
      invoice: invoiceMeta
    };
    // Re-PUT WITHOUT expirationTtl — paid trips persist indefinitely.
    await env.JOURNEYS.put(`journey:${uuid}`, JSON.stringify(record));
    console.log('[webhook] journey unlocked', uuid, session.id, invoiceMeta?.number || '(no invoice)');
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// Verify Stripe's signature header. The header is "t=TIMESTAMP,v1=SIG[,v0=...]"
// and the signed payload is `${timestamp}.${rawBody}` HMAC-SHA256'd with the
// webhook signing secret. Implementation uses Web Crypto so it runs on Workers.
async function verifyStripeSignature(payload, header, secret) {
  if (!header) return false;
  const parts = {};
  for (const seg of header.split(',')) {
    const [k, v] = seg.split('=');
    if (k && v) (parts[k] = parts[k] || []).push(v);
  }
  const timestamp = parts.t?.[0];
  const signatures = parts.v1 || [];
  if (!timestamp || !signatures.length) return false;

  // Reject very stale signatures (> 5 minutes) to mitigate replay.
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${payload}`));
  const computed = Array.from(new Uint8Array(sigBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time compare against any of the v1 signatures.
  for (const expected of signatures) {
    if (computed.length !== expected.length) continue;
    let diff = 0;
    for (let i = 0; i < computed.length; i++) {
      diff |= computed.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    if (diff === 0) return true;
  }
  return false;
}
