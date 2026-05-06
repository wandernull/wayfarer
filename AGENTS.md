# Jounee — agent handoff

> **What this is**: a self-contained orientation for any AI coding agent (or human) opening this repo cold. Read this *before* skimming code; it captures architecture, key design decisions, and open work that aren't obvious from `git log` alone. Repo name is `wayfarer`; product is **Jounee** (renaming pending).

## Product in one paragraph

Jounee is a B2C web app at `jounee.app` that generates personalized multi-day **travel itineraries** — restaurants, cafés, sights, museums, bars — based on the user's destination, dates, vibe, and budget. Users see Day 1 free; a one-time **€4.99** Stripe Checkout charge unlocks the full trip, day-regeneration, plan-switching, and PDF export. **No subscription, no hotels, no flights.** The MVP is intentionally a "tour-day generator," not an end-to-end trip planner.

## Stack

- **Runtime**: Cloudflare Pages with Functions (`functions/api/**`).
- **Frontend**: two static files in `public/`. `index.html` is the **landing page** (hero + bottom-sheet capture form). `app.html` is the **SPA** (full onboarding flow + itinerary view). The landing form serializes `dest`, `arrival`, `departure`, `interests` as URL params and navigates to `/app.html?…`; `prefillFromQuery()` in app.html reads them on `DOMContentLoaded`, fills the first city row, fuzzy-matches interest chips, and auto-calls `startGeneration()` if the three required fields are present. No bundler. i18n in `public/translations.js` (7 languages: en, tr, es, fr, de, it, pt).
- **State**: Cloudflare KV namespace `JOURNEYS` (id `89af90c14a6149e0a2bc52fd2516b36f`), bound via `wrangler.toml`.
- **AI**: Anthropic Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) for both the planner call and the itinerary call.
- **Places data**: Google Places API (New) `searchNearby`.
- **Geocoding**: Nominatim (OpenStreetMap) for sub-area resolution.
- **Payments**: Stripe Checkout (one-time €4.99) + webhook → KV update.
- **i18n**: simple key-value lookup in `translations.js`; `t(key)` reader, `data-i18n` attribute on DOM.
- **Routing**: `/` → landing (`index.html`). `/app.html` → SPA. `/journey/<uuid>` shareable URLs are rewritten to `/app.html` via `_redirects`; the SPA inspects `location.pathname` on boot via `bootFromUrl()`.

## End-to-end pipeline

```
Form submit
  ↓
For each user-typed city, in parallel:
  POST /api/plan-destination  (Claude #1, planner)
    body: { city, days, interests, tripTypes, pace, budget, kids, adults,
            diet, startDate, endDate, accessibility, localOnly, indoorAlt,
            notes (≤500 chars), arrivalTimeOfDay }
    returns: { hasDistinctSubAreas, options:[ {id, title, tagline,
              themes[], plan:[{subArea, days, rationale}] } ] }
  ↓
Frontend scoreOption() ranks options against profile interests/tripTypes/
  pace/kids; picks highest. state.plan.byCity[city] = { ranked, picked, ... }
  ↓
buildLegs(profile, planByCity)  →  pure JS, deterministic
  Flattens picks into legs[] with { parentCity, subArea, days,
  arrivalTimeOfDay (only on first leg of each city), legStartDate,
  legEndDate, isFirstLegOfCity, isLastLegOfCity }
  ↓
fetchCandidatesForLegs()
  Geocodes each unique sub-area via Nominatim ("subArea, parentCity" for
  disambiguation). POSTs to /api/candidates which fires parallel Places
  searchNearby per bucket (restaurant, cafe, attraction, museum, plus
  conditional bar/nightclub/gym/park). Returns shaped venues with
  priceLevel ($/$$/$$$) and cuisine extracted from Place types.
  state.candidates is keyed by sub-area name.
  ↓
formatCandidatesMenu(candidates)
  Renders the menu as text grouped by sub-area, shuffled per call
  (Fisher-Yates) to encourage variety across regenerations.
  ↓
callClaude(profile, null, menu, legs)  →  Claude #2, itinerary
  Streams JSON back. Each leg becomes one cities[] entry. Day cards
  count must equal that leg's `days`. Day 1 of each leg derives its
  shape from arrivalTimeOfDay (Morning / Midday / Evening). Inter-leg
  transitions get a ground-transfer card. NO hotels, NO airport
  transfers, NO departure rule.
  ↓
showItinerary(profile, itinerary) + applyPaywallGating() + enrichPlaces()
  Render. enrichPlaces does in-memory lookup against state.candidates
  (no extra API calls when candidates exist). applyPaywallGating
  blurs Day 2+ when payment.status !== 'paid' and disables CTAs.
  ↓
saveJourney() → POST /api/journey/save
  Generates crypto.randomUUID(), writes the full record to KV with
  30-day TTL while pending. history.pushState('/journey/<uuid>').
```

### Regen-day flow

`regenDay(dayNum, cityName, cityDayNum)`:
1. Looks up the leg in `state.tripData.legs` to read `arrivalTimeOfDay`.
2. Builds a `do-not-use` list of every venue name already in the current itinerary (excluding the day being replaced) so Claude picks fresh.
3. Calls `callClaude(profile, customPrompt, /* no menu — uses the city's */ )` — wait, actually it builds a city-scoped menu inline and passes via `customPrompt`.
4. Re-renders just that day's `.timeline` and tips. Re-applies `enrichFromCandidates`. Calls `persistJourneyUpdate()` so the KV record updates if the trip is paid.

### Plan-swap flow

Clickable plan pill (top-right) **OR** `🎯 Switch plan` button (bottom action bar) → opens modal listing every option per city → confirm → re-runs the pipeline from `buildLegs` onward (no fresh planner call — reuses cached options) with the new picked option. Calls `persistJourneyUpdate()` on success when paid.

## Key state shape

```js
state = {
  currentStep: 0,
  adults: 2, kids: 0,
  tripData: {
    uuid,                                    // KV key suffix
    profile,                                 // form snapshot (see getTripProfile)
    itinerary: { tripTitle, cities:[...] },  // Claude #2 output
    candidates: { [subArea]: { restaurant:[…], cafe:[…], … } },
    planByCity, legs,
    payment: { status: 'pending'|'paid', amount, currency, paidAt }
  },
  plan: { byCity: { [city]: { options[], ranked[], picked, pickedScore } } },
  candidates: <pointer to tripData.candidates>
}
```

KV record:

```js
journey:<uuid> = {
  uuid, createdAt, updatedAt?,
  profile, itinerary, candidates, planByCity, legs,
  payment: {
    status: 'pending' | 'paid',
    amount: 499, currency: 'EUR',
    stripeSessionId, stripePaymentIntentId,
    paidAt
  }
}
// 30-day TTL while pending. Re-PUT without TTL on payment success.
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/plan-destination` | Claude #1 planner. Returns themed options per city. |
| POST | `/api/candidates` | Per-sub-area Google Places fetch, bucketed. |
| POST | `/api/itinerary` | Streaming Claude #2 call (SSE passthrough). Accepts `temperature`. |
| POST | `/api/places` | Legacy Text-Search venue verification. Used as fallback when `state.candidates` is empty. |
| POST | `/api/journey/save` | Generates UUID, stores trip with 30-day TTL. |
| GET  | `/api/journey/[id]` | Full record (payment block sanitized). 404 if expired. |
| GET  | `/api/journey/[id]/status` | Lightweight `{ status, paidAt }`. |
| POST | `/api/journey/[id]/buy` | Creates Stripe Checkout session, returns URL. Idempotent if already paid. Accepts `{ locale, productName, productDescription }` so the Stripe-hosted UI **and** the line item copy match the user's selected language. Locale is whitelisted; product strings are length-capped (60 / 500 chars) before being forwarded. |
| POST | `/api/journey/[id]/update` | Replace trip payload on a paid record (used by regen-day, plan-swap). |
| POST | `/api/stripe/webhook` | Verifies Stripe signature, flips KV record to paid on `checkout.session.completed`. |

## Design decisions worth knowing (the *why*)

1. **No hotels, no airports, no departure rule.** MVP is a tour-day generator. Including hotels meant tying us to bookings/availability we can't fulfil. Dropped entirely.
2. **`days` not `nights`.** Tour-day product → activity-day count, end-date inclusive. `daysBetween('2026-05-12','2026-05-15') === 4`. Old "nights" naming was confusing (overnights vs day-cards). Keep this terminology consistent through any new code.
3. **One Claude call per city for planning, one Claude call total for the itinerary.** Cheap, parallelizable. Don't merge them.
4. **The candidate menu IS the geographic bound.** Earlier prompts had complex GEOGRAPHIC COHERENCE rules; current prompt collapses them into "use only this sub-area's menu" because each leg is bound to one sub-area's menu block. Don't re-add the long sub-area rule lists.
5. **User notes override everything.** Tier 2 of the planner system prompt: free-text notes can override arrival proximity, accessibility filter, kids-no-nightlife filter, day-minimums, theme preferences, etc. Keep this. Don't water it down.
6. **Sub-area day minimums are differentiated by destination type.** Bali/Oahu/Phuket → min 2 days per sub-area (long transfers). Berlin/Paris/NYC → min 1 day allowed (15-min metro). See `SUB-AREA DAY MINIMUMS` block in the planner prompt.
7. **Variety mandate**: menu shuffled per call + `temperature: 1.0` explicit + regen passes a "do-not-use" list of already-chosen venues. Earlier the model echoed the same restaurant on every day; this triplet kills it.
8. **Plan-swap reuses cached options**. Doesn't call the planner again. Re-runs only legs → candidates → itinerary. Cheaper, faster, but means option content reflects the planner version that ran when the trip was first generated.
9. **Paywall = blur Day 2+, disable CTAs, banner with Buy.** Day 1 always free as the demo. `applyPaywallGating()` is idempotent — safe to call after every render. Keep it that way. The banner has three shapes selected by `state.paywallOverride`: `null` → default Buy banner, `'confirming'` → ⏳ "Confirming your payment…" (no CTA), `'confirm_timeout'` → ⏳ + refresh button (poll exhausted, webhook still hasn't landed). Override is set in `bootFromUrl` when `?paid=1` arrives and cleared by `pollPaymentStatus` on success.
10. **Re-save on paid mutations.** `regenDay` and `swapPlanOption` call `persistJourneyUpdate()` so the KV record stays fresh for shared URLs. No-op when unpaid (CTAs are disabled anyway).
11. **i18n is comprehensive**. 7 languages. **Never hardcode user-visible English** — always go through `t(key)`. Add the key to all 7 language blocks in `translations.js`. The user has flagged this multiple times. This extends to the Stripe Checkout page: `buyJourney()` forwards `currentLang` plus the localized `stripe_product_name` / `stripe_product_description` to the buy endpoint, which passes them through to Stripe so both the hosted UI **and** the line item copy match the SPA. Never use `locale: 'auto'` — explicit forwarding ensures consistency with the language the user picked in our UI. Translations stay in `translations.js` (single source of truth); the backend has English fallbacks only as a defensive default if the body is malformed.
12. **Regional vs dense-city sub-area lists** in the planner prompt are illustrative, not exhaustive. Adding new destinations only needs new examples if Claude's geography knowledge of them is shaky.
13. **Landing page is a separate file from the SPA, glued by URL params.** `/` serves a hero + bottom-sheet capture form (`public/index.html`), `/app.html` serves the full SPA (`public/app.html`). The landing form encodes `dest`, `arrival`, `departure`, `interests` into the query string and navigates; the SPA's `prefillFromQuery()` hydrates step 0, fuzzy-matches the four landing chips against `#interests` + `#tripType` chips by substring, and auto-calls `startGeneration()` if `dest && arrival && departure`. Why split them: SEO/landing copy, A/B testing the hero, and a clean form-funnel boundary without bundling. The landing chips don't 1:1 map app chips (no Beach in app, Food→Food&Wine, Culture→Cultural, Arts→Museums&Art) — that's intentional best-effort, since the SPA still lets users refine. The `_redirects` rewrite for `/journey/<uuid>` now points at `/app.html`, not `/`.

## Status: live in production (last verified 2026-05-01)

End-to-end Stripe Checkout flow has been tested with a real €4.99 purchase on `https://jounee.app`. Webhook fires reliably; KV record flips to paid; Day 2+ unblurs in place after the post-redirect poll. Production deploy is live.

Post-redirect UX: while the webhook propagates the paid state to KV, the SPA shows a ⏳ "Confirming your payment…" banner instead of the Buy CTA. `pollPaymentStatus` polls `/status` for ~21s (1s × 5 then 2s × 8). On success it re-hydrates and unlocks; on exhaustion it swaps to a "Payment is taking longer than expected — refresh" banner so a paid user never sees a Buy CTA again.

### Stripe ops cheatsheet

- **Refund a real charge**: Stripe dashboard → **Jounee** account → **Payments** → click the charge → **Refund**. Card refund lands on the customer's statement in ~5-7 business days. The journey stays unlocked in KV (refunds don't auto-revert payment.status — by design; if you need to relock, edit the KV record manually with `wrangler kv key put --binding=JOURNEYS "journey:<uuid>" '<json>'`).
- **Local dev secrets**: `.dev.vars` (gitignored) has Jounee's test-mode `STRIPE_SECRET_KEY` and the `STRIPE_WEBHOOK_SECRET` printed by `stripe listen`. **Important**: the CLI's default account is the *other* product (Plateform) — pin local `stripe listen` to Jounee with `--api-key sk_test_…`, otherwise events from Jounee Checkout never reach localhost.
- **Production secrets**: live-mode `STRIPE_SECRET_KEY` and the dashboard-registered webhook signing secret are stored as encrypted Cloudflare Pages variables (production env) on the `wayfarer` project. Set via `npx wrangler pages secret put NAME --project-name=wayfarer`. Listed alongside `ANTHROPIC_API_KEY`, `GOOGLE_PLACES_API_KEY`, and a leftover `HERE_API_KEY` (orphan, not currently used by the codebase).
- **Production webhook endpoint**: registered in Stripe → Jounee → Developers → Webhooks at `https://jounee.app/api/stripe/webhook`, listening for `checkout.session.completed`. Add `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed` later for SEPA/delayed-payment support; current handler ignores them.
- **Logs**: Cloudflare Pages → wayfarer → Functions → Logs (filter for `[webhook]`). Stripe dashboard → Webhooks → click the endpoint → Events tab shows delivery attempts + response codes.

## Open work

### Worth doing soon

- **Refund-to-relock automation.** Today: refunds in Stripe don't change KV. Most likely user behaviour: someone refunds, journey stays unlocked, they keep using it. Either accept that (free migration friction = low) or wire `charge.refunded` webhook → flip status back to pending. Decision pending.
- **Spam / abuse defense.** Anyone can generate unlimited free trips (each one burns Anthropic Haiku tokens + Google Places quota + a KV record). No rate limits, no captcha, no auth. At scale this is real money. Cheap mitigation: per-IP rate limit at Cloudflare layer (Workers Rules or rate-limiting binding) before functions ever hit upstream APIs.
- **Cross-language locale-aware pricing display.** €4.99 is hardcoded in copy and prompt. Consider `Intl.NumberFormat` for the displayed price; keep the actual Stripe charge in EUR (Stripe handles FX on the customer side).
- **Analytics / funnel tracking**. Zero visibility on form-start → generation-complete → buy-click → buy-success drop-off rates. Plausible/Posthog/even Cloudflare Web Analytics would unlock real product decisions.
- **Customer support inbox.** `support@jounee.app` is referenced in Stripe and customer emails but probably doesn't route anywhere yet. Set up forwarding to a real inbox.

### Known sharp edges

- **Sub-area name collisions.** `fetchCandidatesForLegs` dedups unique sub-area keys by name only. Two parent cities with the same sub-area name (rare — "Old Town" in Krakow vs Stockholm) would collide. Fix: key by `parentCity + ':' + subArea`.
- **Multi-city header rendering.** The route pill shows `Marais → Saint-Germain → Rome` with the parent ("Paris") only in the plan pill. Could prefix the route with the parent city.
- **PDF export** is currently `window.print()`. Fine for MVP; a server-side branded PDF is the obvious next step.
- **Currency hardcoded** to EUR / `€4.99`. Future: localized pricing display, optional FX.
- **Repo named `wayfarer`** but product is `Jounee`. Cosmetic but worth aligning.
- **Orphan code**: `buildSummary`, `selectBudget`, `calcLatestEndTime`, `nights_unit`/`sb_nights` translation keys are unused after the form rework but kept for safety. Delete in a focused cleanup commit.

### Worth doing eventually

- **Stripe events beyond `checkout.session.completed`.** `async_payment_succeeded` / `async_payment_failed` for SEPA-style delayed payments. Currently we only handle the instant card path.
- **Plan-pill swap analytics**. Log how often users swap → inform whether to keep the multi-option modal or simplify.
- **Real audit/abandonment tracking**. Right now we drop pending journeys at 30 days. We have no visibility on funnel. KV `list` won't give it; D1 would.
- **Logo / favicon assets**. Currently the brand is purely a CSS-styled wordmark (`Jou` + green italic `nee`). No image asset on disk. Brand color is `#2D6A4F`.

## Conventions

- **Function naming**: camelCase. JS, no TypeScript.
- **CSS**: BEM-ish but loose. Class names like `.day-section.locked`, `.plan-pill.swappable.paywall-locked`. Inline `style=` is OK for one-off sizing.
- **i18n key naming**: snake_case. Group by feature (`unlock_*`, `modal_*`, `journey_404_*`).
- **Translation order**: en, tr, es, fr, de, it, pt — always all 7.
- **Commits**: conventional-style first line (`feat(scope):`, `fix(scope):`, `chore:`), full body explaining the *why*, not just the *what*. Co-author trailer.
- **Console logging**: use `[plan]` `[legs]` `[candidates]` `[paywall]` `[journey]` `[buy]` `[webhook]` prefixes for grep.
- **Never log secrets** (API keys, Stripe IDs, customer email addresses).

## Local dev quickstart

```bash
source ~/.gizem-creds && export PATH="/opt/homebrew/bin:$HOME/.nvm/versions/node/v20.19.5/bin:$PATH"
cd ~/dev/projects/wayfarer
# Make sure .dev.vars has ANTHROPIC_API_KEY, GOOGLE_PLACES_API_KEY,
# STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
npx wrangler pages dev public
# In a second terminal, for Stripe webhook forwarding:
stripe listen --forward-to localhost:8788/api/stripe/webhook
```

`http://localhost:8788`. Hot reload on edits.

## How to start the next session

> Open this repo. Read `AGENTS.md` end-to-end. Read the most recent ~10 commits with `git log --oneline -15`. The user's main outstanding task is verifying Stripe end-to-end and then iterating on the product. Don't re-derive architecture from code — use this doc.
