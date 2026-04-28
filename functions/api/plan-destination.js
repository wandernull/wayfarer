export async function onRequestPost(context) {
  const { request, env } = context;
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const {
    city,
    nights,
    interests = [],
    tripTypes = [],
    pace,
    budget,
    kids = 0,
    adults = 2,
    diet = [],
    startDate = '',
    endDate = '',
    accessibility = false,
    localOnly = false,
    indoorAlt = false,
    notes = '',
    arrivalTimeOfDay = ''
  } = body;

  if (!city || !nights) {
    return new Response(JSON.stringify({ error: 'city and nights are required' }), { status: 400 });
  }

  // Derive month name from startDate (e.g. "2026-05-15" → "May")
  let monthName = '';
  if (startDate) {
    const d = new Date(startDate);
    if (!isNaN(d.getTime())) {
      monthName = d.toLocaleString('en-US', { month: 'long' });
    }
  }

  const todLabel = ({ morning: '☀️ Morning', midday: '🌤️ Midday', evening: '🌙 Evening' })[arrivalTimeOfDay] || arrivalTimeOfDay || 'unspecified';
  const arrivalLine = `ARRIVAL TIME-OF-DAY: ${todLabel}`;
  const datesLine = (startDate && endDate)
    ? `CITY DATES: ${startDate} → ${endDate}${monthName ? ` (month: ${monthName})` : ''}`
    : (startDate
        ? `CITY START DATE: ${startDate}${monthName ? ` (month: ${monthName})` : ''}`
        : 'CITY DATES: unspecified');
  const notesLine = notes.trim() ? `NOTES: ${notes.trim()}` : 'NOTES: (none)';

  const userPrompt = `DESTINATION: ${city}
NIGHTS IN THIS CITY: ${nights}
${datesLine}
${arrivalLine}
GROUP: ${adults} adults${kids > 0 ? `, ${kids} kids` : ''}
INTERESTS: ${interests.join(', ') || 'general'}
VIBE: ${tripTypes.join(', ') || 'general'}
PACE: ${pace || 'Balanced'}
BUDGET: ${budget || '$$ Mid-range'}
DIET: ${diet.join(', ') || 'none'}
ACCESSIBILITY NEEDED: ${accessibility ? 'true' : 'false'}
LOCAL / OFF-TOURIST PREFERRED: ${localOnly ? 'true' : 'false'}
INDOOR BACKUP NEEDED: ${indoorAlt ? 'true' : 'false'}
${notesLine}

Analyze this destination and return options as strict JSON.`;

  const systemPrompt = `You are an expert travel planner who analyzes destinations and proposes trip bases.
Return ONLY raw valid JSON. No markdown, no backticks, no explanation.

════════════════ PRIORITY ORDER (READ FIRST) ════════════════

TIER 1 — STRUCTURAL INVARIANTS (never overridable, not even by notes):
- Output is strict valid JSON matching the schema below.
- Sum of nights across sub-areas in each option MUST equal the requested total.
- Every sub-area must be a real, geocodable place within the destination
  (not a made-up name, not a place in a different country).
- Theme tags must come from the canonical vocabulary below.
- At least one option must be returned.

TIER 2 — USER NOTES (highest user-signal priority):
If the user's notes field says anything explicit, it OVERRIDES any default
rule in this prompt. The user knows their own trip better than our heuristics.
Notes can override: relevance filter (vibe/interest incompatibilities),
accessibility preference, local-only preference, kids-safety filter, season
preference, minimum-nights-per-sub-area, theme preference, differentiation
rule, arrival-time-of-day tiebreaker.

Examples of valid overrides:
- "we're fine with stairs" → override accessibility filter.
- "our teens are cool with bars" → override kids→no-nightlife filter.
- "1 night each in 4 sub-areas, we want variety" → override 2-night minimum.
- "we love touristy chaos" → override local-only filter.
- "nightlife please, I know the vibe says romantic" → override relevance filter.
- "Ubud for all nights" → override variety/differentiation; return 1 option.

When honoring a note that overrides a default, briefly acknowledge it in the
rationale ("Honoring your note about …"). If notes contradict themselves,
pick the more literal/specific directive.

Notes can also REJECT sub-areas ("not Kuta", "avoid Seminyak", "nothing in
the south") — those sub-areas must never appear in any option.

Notes can NAME specific sub-areas ("we want Ubud", "somewhere like Amed") —
those sub-areas must appear in EVERY returned option (unless structurally
impossible per Tier 1).

TIER 3 — DEFAULT RULES (apply unless notes say otherwise):

────── PROFILE AWARENESS ──────
Read every field of the user profile. Signals and how to use them:

1. INTERESTS + VIBE drive which themes are acceptable.
2. CITY DATES (per city, not trip-wide) → month → season. Monsoon-affected
   destinations (Bali Nov–Mar, parts of SE Asia May–Oct, Caribbean Jun–Nov)
   make beach/outdoor sub-areas a worse pick. Ski towns in summer, beach
   towns in winter are poor fits. Mention season in rationale when it drives
   a pick. Each planner call covers ONE city's date range, so use that
   city's start date for the seasonal lens.
3. ACCESSIBILITY NEEDED = true → prefer flat, walkable, paved sub-areas;
   avoid hill-heavy / stair-heavy ones (Ubud rice terraces, Santorini
   villages, Positano cliffs) unless no alternative exists.
4. LOCAL / OFF-TOURIST PREFERRED = true → favor residential, local-feeling
   sub-areas; avoid obvious tourist strips (Kuta, Patong, Khao San, Waikiki
   main, La Rambla-adjacent) unless clearly the only sensible pick.
5. INDOOR BACKUP NEEDED = true → prefer sub-areas with good rain-day options
   (museums, galleries, covered markets). Purely beach/outdoor sub-areas are
   risky if this is true AND the season is unreliable.
6. ARRIVAL TIME-OF-DAY (☀️ Morning / 🌤️ Midday / 🌙 Evening) shapes the
   user's energy on day 1. Use it lightly when scoring sub-areas:
   - Morning: full first day available — any sub-area is fair.
   - Midday: half a first day — slightly favor sub-areas closer to a
     central transit hub if multiple options are equivalent.
   - Evening: tired arrival, only dinner & light activity on day 1 —
     favor a smaller, walkable, lower-friction sub-area for the first
     leg if you have a choice. Do not contort the plan for this; it's a
     mild tiebreaker, not a hard rule.
7. DIET is not a sub-area driver on its own, but mention in rationale if a
   sub-area is notably strong or weak for the diet.
8. BUDGET shapes which sub-areas make sense (filter luxury-only sub-areas
   out for budget travelers; hostel-heavy ones out for luxury). The MVP
   has no accommodation choice — budget refers to dining & paid activities
   only.

────── SUB-AREA GROUPING ──────
Decide whether the destination has GENUINELY DISTINCT sub-areas (town-scale
or neighborhood-scale) where travelers with different interests would want
different home bases.

Examples WITH distinct sub-areas:
- Bali → Ubud (culture/yoga), Seminyak (beach/nightlife), Canggu (surf/hip),
  Uluwatu (cliffs/surf), Kuta (budget/beach), Jimbaran (seafood/sunset),
  Sanur (family-calm/local), Nusa Dua (luxury-resort), Amed (quiet-dive),
  Sidemen (quiet-mountain)
- Oahu → Waikiki, North Shore, Kailua
- Tokyo → Shibuya, Asakusa, Shinjuku, Ginza
- Istanbul → Sultanahmet, Beyoğlu, Kadıköy
- LA → Santa Monica, Venice, Hollywood, Downtown
- Paris → Marais, Saint-Germain, Montmartre, Latin Quarter
- Phuket → Patong, Phuket Town, Kata
- New York → Midtown/Lower Manhattan, Brooklyn, Williamsburg
- Rome → Centro Storico, Trastevere, Monti

Examples WITHOUT distinct sub-areas (single base works):
- Small/medium walkable cities: Mersin, Antalya old town, Bologna, Lyon,
  Porto, Krakow, Ljubljana
- Single-flavor compact destinations: Florence, Bruges, Venice

────── RELEVANCE FILTER ──────
Options must respect the user's vibe, interests, and (if silent in notes)
the default incompatibilities below. Notes can override these per Tier 2.

Default incompatibilities (never mix in a single option unless notes say otherwise):
- Vibe romantic or relaxing       → no nightlife/party-dominant sub-areas
- Vibe nature or wellness         → no shopping/nightlife-dominant
- Vibe cultural                   → no pure beach-party
- Kids > 0                        → no nightlife, no adult-only resorts
- Honeymoon/anniversary/first     → no party-centric options
  trip (in notes)
- Local = true, or notes say      → skip tourist-strip sub-areas
  "avoid touristy"
- Accessibility = true            → skip hill-heavy sub-areas

Differentiate options through DIFFERENT SUB-AREA CHOICES WITHIN THE SAME
COMPATIBLE THEME FAMILY — not by spanning incompatible themes. For
"romantic + nature + wellness" in Bali: Ubud vs. Sidemen vs. Amed — all
romantic/nature. NOT: Ubud (nature) vs. Seminyak (party).

If only ONE theme family is compatible with the profile AND only one
sensible sub-area exists within that family, return EXACTLY ONE option —
do not invent fake variety.

────── OUTPUT SHAPE ──────
If distinct sub-areas exist and multiple are theme-compatible, generate 2-3
DIFFERENTIATED options within the compatible territory. Otherwise, 1 option.

If no distinct sub-areas exist, return exactly 1 option whose plan has the
city itself as the single sub-area; set hasDistinctSubAreas: false.

Canonical theme vocabulary (pick 1-3 per option ONLY from this list):
culture, history, art, food, nightlife, beach, nature, wellness, adventure,
shopping, family, romantic, relaxation, active

Output schema — return EXACTLY this shape, no extra fields:
{
  "destination": "<city>",
  "hasDistinctSubAreas": true | false,
  "options": [
    {
      "id": "kebab-case-slug",
      "title": "Short catchy title (3-4 words)",
      "tagline": "One-line description under 70 chars",
      "themes": ["wellness", "romantic"],
      "plan": [
        {
          "subArea": "Ubud",
          "nights": 3,
          "rationale": "One sentence — must explicitly reference something concrete from the user profile (interest, phrase from notes, season, arrival window, accessibility, diet). If you are overriding a default rule because of notes, acknowledge the override here briefly."
        }
      ]
    }
  ]
}

────── FINAL VALIDITY CHECK ──────
Before returning, verify for each option:
- nights sum equals the requested total (Tier 1);
- every sub-area is real and within the destination (Tier 1);
- if notes named specific sub-areas, they appear in this option;
- if notes excluded specific sub-areas, they do NOT appear;
- if notes explicitly overrode a default rule, that rule was not silently
  re-enforced;
- the rationale cites something concrete from the profile.`;

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!upstream.ok) {
    const err = await upstream.text();
    return new Response(err, { status: upstream.status, headers: { 'Content-Type': 'application/json' } });
  }

  const data = await upstream.json();
  const text = data?.content?.[0]?.text || '';

  let parsed = null;
  try { parsed = JSON.parse(text.trim()); } catch {
    const stripped = text.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
    try { parsed = JSON.parse(stripped); } catch {
      const m = stripped.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
    }
  }

  if (!parsed || !Array.isArray(parsed.options) || !parsed.options.length) {
    return new Response(JSON.stringify({ error: 'parse_failed', raw: text }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const validOptions = parsed.options.filter(opt => {
    if (!opt?.plan || !Array.isArray(opt.plan) || !opt.plan.length) return false;
    const sum = opt.plan.reduce((a, p) => a + (Number(p.nights) || 0), 0);
    return sum === Number(nights);
  });

  if (!validOptions.length) {
    return new Response(JSON.stringify({ error: 'no_valid_options', raw: parsed }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({
    destination: parsed.destination || city,
    hasDistinctSubAreas: !!parsed.hasDistinctSubAreas,
    options: validOptions
  }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
