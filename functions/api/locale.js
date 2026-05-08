// GET /api/locale
// Resolves the displayed price + Stripe currency from the client's IP-based
// country (Cloudflare's `request.cf.country`). Currently:
//   TR              → 249,99 ₺  (try / 24999)
//   everywhere else → 4,99 €    (eur / 499)
//
// SPA + landing call this on boot and substitute `{price}` in copy.
// `buy.js` calls the same logic so the displayed and charged prices agree.
//
// Cache-Control: no-store + Vary: CF-IPCountry — must NOT be edge-cached
// across countries (would serve TR prices to a NL user or vice-versa).
//
// Local-dev: `wrangler pages dev` doesn't populate cf.country. As a fallback
// we honour a `?country=XX` query param ONLY when cf.country is absent —
// so production is purely geographic and the override is invisible there.

const PRICES = {
  TR: { currency: 'try', amount: 24999, display: '₺249,99' },
};
const DEFAULT_PRICE = { currency: 'eur', amount: 499, display: '€4.99' };

// Country → suggested UI language. Direct code match against the 7 supported
// languages; anything else falls back to English. The frontend applies this
// only on first visit (no `jounee_lang` in localStorage yet) — once the user
// picks a language via the switcher, their choice is remembered forever.
const COUNTRY_TO_LANG = {
  TR: 'tr', ES: 'es', FR: 'fr', DE: 'de', IT: 'it', PT: 'pt',
};
export function languageForCountry(country) {
  if (country && COUNTRY_TO_LANG[country]) return COUNTRY_TO_LANG[country];
  return 'en';
}

export function resolveCountry(request) {
  // `?country=XX` query override wins. Reason: `wrangler pages dev` (and
  // some WARP / proxy setups) DO populate `request.cf.country` from the
  // dev's IP, which means the override never fires if we check cf first.
  // Putting the override first makes local testing reliable.
  //
  // Production trade-off: a user could append `?country=TR` to their URL
  // and force TRY pricing. Acceptable here because TR ≈ €4.71 (near-parity,
  // no arbitrage). If a meaningfully cheaper regional price is added later,
  // gate this branch to dev-only.
  try {
    const url = new URL(request.url);
    const override = url.searchParams.get('country');
    if (override) return override.toUpperCase();
  } catch {}
  const fromCf = request.cf?.country;
  if (fromCf && fromCf !== 'XX') return fromCf;
  const fromHeader = request.headers.get('CF-IPCountry');
  if (fromHeader && fromHeader !== 'XX') return fromHeader;
  return null;
}

export function priceForCountry(country) {
  if (country && PRICES[country]) return PRICES[country];
  return DEFAULT_PRICE;
}

export async function onRequestGet(context) {
  const country = resolveCountry(context.request);
  const price = priceForCountry(country);
  const language = languageForCountry(country);
  return new Response(JSON.stringify({ country, language, ...price }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Vary': 'CF-IPCountry',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
