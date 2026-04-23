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
    accom,
    kids = 0,
    adults = 2,
    diet = [],
    startDate = '',
    accessibility = false,
    localOnly = false,
    indoorAlt = false,
    notes = '',
    arrivalTime = '',
    arrivalAirport = '',
    departureTime = '',
    departureAirport = ''
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

  const arrivalLine = arrivalTime
    ? `ARRIVAL: ${arrivalTime}${arrivalAirport ? ' via ' + arrivalAirport : ''}`
    : 'ARRIVAL: unspecified';
  const departureLine = departureTime
    ? `DEPARTURE: ${departureTime}${departureAirport ? ' via ' + departureAirport : ''}`
    : 'DEPARTURE: unspecified';
  const startLine = startDate
    ? `START DATE: ${startDate}${monthName ? ` (month: ${monthName})` : ''}`
    : 'START DATE: unspecified';
  const notesLine = notes.trim() ? `NOTES: ${notes.trim()}` : 'NOTES: (none)';

  const userPrompt = `DESTINATION: ${city}
TOTAL NIGHTS: ${nights}
${startLine}
${arrivalLine}
${departureLine}
GROUP: ${adults} adults${kids > 0 ? `, ${kids} kids` : ''}
INTERESTS: ${interests.join(', ') || 'general'}
VIBE: ${tripTypes.join(', ') || 'general'}
PACE: ${pace || 'Balanced'}
BUDGET: ${budget || 'Mid-range'}
STAY: ${accom || 'Hotel'}
DIET: ${diet.join(', ') || 'none'}
ACCESSIBILITY NEEDED: ${accessibility ? 'true' : 'false'}
LOCAL / OFF-TOURIST PREFERRED: ${localOnly ? 'true' : 'false'}
INDOOR BACKUP NEEDED: ${indoorAlt ? 'true' : 'false'}
${notesLine}

Analyze this destination and return options as strict JSON.`;

  const systemPrompt = `You are an expert travel planner who analyzes destinations and proposes trip bases.
Return ONLY raw valid JSON. No markdown, no backticks, no explanation.

──────────────── PROFILE AWARENESS ────────────────
The user profile contains multiple signals. ALL of them shape your options.
Do not ignore fields just because they aren't about sub-areas directly.

1. INTERESTS + VIBE drive which themes are acceptable.
2. NOTES (free text) can contain decisive context — occasions (honeymoon,
   anniversary, first trip), constraints (scared of heights, stroller,
   gluten-free), preferences (quiet mornings, sunset drinks). READ notes
   carefully and let them override softer signals. Honeymoon or anniversary
   always implies romantic. "Avoid touristy" strengthens the LOCAL-ONLY skew
   even if that flag is off. Medical or phobic constraints are hard filters.
3. START DATE → month → season. Monsoon-affected destinations (Bali Nov–Mar,
   parts of SE Asia May–Oct, Caribbean Jun–Nov hurricane season) make beach/
   outdoor sub-areas a worse pick. Ski towns in summer and beach towns in
   winter are poor fits. Mention season in rationale when it drives a pick.
4. ACCESSIBILITY NEEDED = true → prefer flat, walkable, paved sub-areas.
   Avoid hill-heavy or stair-heavy ones (Ubud's rice terraces, Santorini's
   stepped villages, Positano's cliffs) unless no alternative exists.
5. LOCAL / OFF-TOURIST PREFERRED = true → favor residential, local-feeling
   sub-areas. Avoid obvious tourist strips (Kuta, Patong, Khao San, Waikiki
   main, La Rambla-adjacent) unless clearly the only reasonable pick.
6. INDOOR BACKUP NEEDED = true → prefer sub-areas with good rain-day options
   (museums, galleries, covered markets, indoor activities). Purely beach or
   outdoor sub-areas are risky if this is true AND the season is unreliable.
7. ARRIVAL TIME / AIRPORT → the FIRST sub-area must be reachable from the
   airport without a brutal late-night haul.
   - Arrival after 20:00 → first sub-area within ~1 hour ground transfer of
     the airport, even if a better thematic fit exists further away.
   - Arrival 14:00–20:00 → up to ~2 hours from airport is acceptable.
   - Arrival before 14:00 → any sub-area is fair.
8. DEPARTURE TIME / AIRPORT → the LAST sub-area must be reachable back to
   the departure airport with comfortable buffer — mirror the arrival rule.
9. DIET is not a sub-area driver on its own, but mention in rationale if a
   sub-area is notably strong or weak for the diet.
10. BUDGET + STAY shape which sub-areas make sense (filter luxury-only
    sub-areas out for budget travelers, hostel-heavy ones out for luxury).

──────────────── SUB-AREA GROUPING ────────────────
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

──────────────── RELEVANCE FILTER — HARD RULE ────────────────
EVERY option you return MUST respect the user's vibe, interests, and notes.
DO NOT propose options that contradict them, even to create variety.

Hard incompatibilities (never mix in a single option):
- Vibe "romantic" or "relaxing"    → no nightlife- or party-dominant sub-areas
- Vibe "nature" or "wellness"      → no shopping- or nightlife-dominant
- Vibe "cultural"                  → no pure beach-party
- Kids > 0                         → no nightlife, no adult-only resort
                                     sub-areas
- Notes mention "honeymoon",       → no party-centric options
  "anniversary", "first trip"
- LOCAL = true, or notes mention   → skip tourist-strip sub-areas (Kuta,
  "avoid touristy" / "off the        Patong, Waikiki main, Khao San,
  beaten path"                       La Rambla-adjacent, etc.)
- ACCESSIBILITY = true             → skip hill-heavy sub-areas unless
                                     explicitly the only option

Differentiate options through DIFFERENT SUB-AREA CHOICES WITHIN THE SAME
COMPATIBLE THEME FAMILY — not by spanning incompatible themes. For
"romantic + nature + wellness" in Bali: Ubud (culture + rice paddies) vs.
Sidemen (quiet mountain) vs. Amed (quiet coast) — all romantic/nature.
NOT: Ubud (nature) vs. Seminyak (party).

If only ONE theme family is compatible with the profile AND only one
sensible sub-area exists within that family for this destination, return
EXACTLY ONE option — do not invent fake variety.

──────────────── OUTPUT ────────────────
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
          "rationale": "One sentence — must explicitly reference something concrete from the user profile (interest, note phrase, season, arrival window, accessibility, diet, etc.)."
        }
      ]
    }
  ]
}

──────────────── VALIDITY RULES ────────────────
- nights across sub-areas in each option MUST sum exactly to the requested total.
- Sub-areas listed in sensible visit order: arrival proximity first, departure
  proximity last, best pacing in between.
- First sub-area satisfies the ARRIVAL proximity rule above.
- Last sub-area satisfies the DEPARTURE proximity rule above.
- No duplicate sub-areas within one option's plan.
- Minimum 2 nights per sub-area (exception: 2-night trips may split 1+1).
- Trips of 1-2 nights → always exactly 1 sub-area per option.
- Titles distinct across options.
- Rationale must be ONE sentence and explicitly reference something concrete
  from the user profile (an interest, a phrase from notes, the season, the
  arrival window, accessibility, diet, etc.).`;

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
