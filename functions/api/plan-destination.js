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
    arrivalTime = '',
    arrivalAirport = ''
  } = body;

  if (!city || !nights) {
    return new Response(JSON.stringify({ error: 'city and nights are required' }), { status: 400 });
  }

  const arrivalLine = arrivalTime
    ? `ARRIVAL: ${arrivalTime}${arrivalAirport ? ' via ' + arrivalAirport : ''}`
    : 'ARRIVAL: unspecified';

  const userPrompt = `DESTINATION: ${city}
TOTAL NIGHTS: ${nights}
GROUP: ${adults} adults${kids > 0 ? `, ${kids} kids` : ''}
INTERESTS: ${interests.join(', ') || 'general'}
VIBE: ${tripTypes.join(', ') || 'general'}
PACE: ${pace || 'Balanced'}
BUDGET: ${budget || 'Mid-range'}
STAY: ${accom || 'Hotel'}
DIET: ${diet.join(', ') || 'none'}
${arrivalLine}

Analyze this destination and return options as strict JSON.`;

  const systemPrompt = `You are an expert travel planner who analyzes destinations and proposes trip bases.
Return ONLY raw valid JSON. No markdown, no backticks, no explanation.

For any destination + trip length, decide whether it has GENUINELY DISTINCT sub-areas (town-scale or neighborhood-scale) where travelers with different interests would want different home bases.

Examples WITH distinct sub-areas:
- Bali → Ubud (culture/yoga), Seminyak (beach/nightlife), Canggu (surf/hip), Uluwatu (cliffs/surf), Kuta (budget/beach), Jimbaran (seafood), Sanur (family-calm)
- Oahu → Waikiki (tourist/beach), North Shore (surf/quiet), Kailua (windward/beach)
- Tokyo → Shibuya, Asakusa, Shinjuku, Ginza (each walkable and distinct-flavored)
- Istanbul → Sultanahmet (historic), Beyoğlu (modern/nightlife), Kadıköy (local/Asian side)
- LA → Santa Monica, Venice, Hollywood, Downtown
- Paris → Marais, Saint-Germain, Montmartre, Latin Quarter
- Phuket → Patong (party), Phuket Town (culture), Kata (family-beach)
- New York → Midtown/Lower Manhattan, Brooklyn, Williamsburg
- Rome → Centro Storico, Trastevere, Monti

Examples WITHOUT distinct sub-areas (single base works):
- Small/medium walkable cities: Mersin, Antalya old town, Bologna, Lyon, Porto, Krakow, Ljubljana
- Single-flavor compact destinations: Florence, Bruges, Venice, most European weekend cities

If distinct sub-areas exist, generate 2-3 DIFFERENTIATED options. Each option must commit to a distinct theme (culture, beach, nightlife, wellness, food, etc.) and pick 1-3 sub-areas consistent with that theme. Options must feel genuinely different — not permutations of the same flavor.

If no distinct sub-areas exist, return exactly 1 option whose plan has the city itself as the single sub-area, and set hasDistinctSubAreas: false.

Canonical theme vocabulary (pick 1-3 per option ONLY from this list):
culture, history, art, food, nightlife, beach, nature, wellness, adventure, shopping, family, romantic, relaxation, active

Output schema — return EXACTLY this shape, no extra fields:
{
  "destination": "<city>",
  "hasDistinctSubAreas": true | false,
  "options": [
    {
      "id": "kebab-case-slug",
      "title": "Short catchy title (3-4 words)",
      "tagline": "One-line description under 70 chars",
      "themes": ["culture", "wellness"],
      "plan": [
        { "subArea": "Ubud", "nights": 2, "rationale": "One sentence on why this sub-area fits this theme and this user." }
      ]
    }
  ]
}

Rules:
- nights across sub-areas in each option MUST sum exactly to the requested total nights.
- Sub-areas listed in sensible visit order (arrival proximity first, then pacing).
- No duplicate sub-areas within one option's plan.
- Minimum 2 nights per sub-area stay (don't split a 3-night trip into 3 single-night stays). Only exception: 2-night trips may split 1+1 if themes truly require it.
- Trips of 1-2 nights → always exactly 1 sub-area per option.
- Titles distinct across options; theme mixes distinct across options.
- If kids > 0, avoid nightlife-dominant options; favor family-friendly sub-areas.
- If arrival time is after 20:00 or airport is far from any candidate sub-area, make the first sub-area the one closest to the airport.
- Rationale must be ONE sentence and explicitly reference something from the user profile (interests, pace, group, etc.).`;

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

  // Robust JSON parse: raw → strip markdown fences → extract first {...} block.
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

  // Validate nights sum per option — drop malformed options.
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
