export async function onRequestPost(context) {
  const { request, env } = context;
  const GOOGLE_API_KEY = env.GOOGLE_PLACES_API_KEY;

  if (!GOOGLE_API_KEY) {
    return new Response(JSON.stringify({ candidates: {}, error: 'missing_api_key' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const { cities = [], interests = [], tripTypes = [], kids = 0 } = body;
  const interestText = [...interests, ...tripTypes].join(' ').toLowerCase();
  const wantsNightlife = /night|club|bar|party/.test(interestText);
  const wantsActive = /active|sport|fitness|gym|yoga|run|hike/.test(interestText);
  const wantsNature = /nature|outdoor|park|hike|beach/.test(interestText) || kids > 0;

  const FIELD_MASK = 'places.displayName,places.formattedAddress,places.rating,places.location,places.googleMapsUri,places.userRatingCount,places.businessStatus,places.primaryType,places.types,places.priceLevel';

  // Map Google's PRICE_LEVEL_* enum to a compact $/$$/$$$ string.
  const priceLevelToSymbol = (lvl) => {
    if (!lvl) return null;
    const m = {
      PRICE_LEVEL_FREE: null,
      PRICE_LEVEL_INEXPENSIVE: '$',
      PRICE_LEVEL_MODERATE: '$$',
      PRICE_LEVEL_EXPENSIVE: '$$$',
      PRICE_LEVEL_VERY_EXPENSIVE: '$$$$'
    };
    return m[lvl] || null;
  };

  // Derive a human cuisine label from Google's types[]. Returns null if no
  // recognizable cuisine type is found. Only meaningful for restaurants/cafes.
  const CUISINE_TYPE_MAP = {
    italian_restaurant: 'Italian', french_restaurant: 'French',
    japanese_restaurant: 'Japanese', chinese_restaurant: 'Chinese',
    korean_restaurant: 'Korean', thai_restaurant: 'Thai',
    vietnamese_restaurant: 'Vietnamese', indian_restaurant: 'Indian',
    mexican_restaurant: 'Mexican', spanish_restaurant: 'Spanish',
    greek_restaurant: 'Greek', turkish_restaurant: 'Turkish',
    middle_eastern_restaurant: 'Middle Eastern', lebanese_restaurant: 'Lebanese',
    mediterranean_restaurant: 'Mediterranean', american_restaurant: 'American',
    brazilian_restaurant: 'Brazilian', african_restaurant: 'African',
    indonesian_restaurant: 'Indonesian', ramen_restaurant: 'Ramen',
    sushi_restaurant: 'Sushi', steak_house: 'Steakhouse',
    seafood_restaurant: 'Seafood', vegetarian_restaurant: 'Vegetarian',
    vegan_restaurant: 'Vegan', pizza_restaurant: 'Pizza',
    barbecue_restaurant: 'BBQ', breakfast_restaurant: 'Breakfast',
    brunch_restaurant: 'Brunch', cafe: 'Cafe', coffee_shop: 'Coffee',
    bakery: 'Bakery', dessert_shop: 'Dessert',
    fast_food_restaurant: 'Fast food', fine_dining_restaurant: 'Fine dining'
  };
  const deriveCuisine = (types) => {
    if (!Array.isArray(types)) return null;
    for (const t of types) if (CUISINE_TYPE_MAP[t]) return CUISINE_TYPE_MAP[t];
    return null;
  };

  const fetchBucket = async ({ includedTypes, maxResults, lat, lon, radius = 10000 }) => {
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_API_KEY,
          'X-Goog-FieldMask': FIELD_MASK
        },
        body: JSON.stringify({
          includedTypes,
          maxResultCount: maxResults,
          locationRestriction: {
            circle: {
              center: { latitude: parseFloat(lat), longitude: parseFloat(lon) },
              radius
            }
          },
          rankPreference: 'RATING'
        })
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.places || []).filter(p =>
        p.displayName?.text &&
        p.location &&
        (p.businessStatus === 'OPERATIONAL' || !p.businessStatus)
      );
    } catch { return []; }
  };

  const shape = (places, prefix, includeFood) => places.map((p, i) => ({
    id: `${prefix}${i + 1}`,
    name: p.displayName.text,
    primaryType: p.primaryType || null,
    rating: p.rating ? Math.round(p.rating * 10) / 10 : null,
    reviews: p.userRatingCount || 0,
    priceLevel: priceLevelToSymbol(p.priceLevel),
    cuisine: includeFood ? deriveCuisine(p.types) : null,
    address: p.formattedAddress || '',
    lat: p.location?.latitude || null,
    lng: p.location?.longitude || null,
    mapsUrl: p.googleMapsUri || null
  }));

  // Bucket definitions — lodging dropped (MVP no longer plans accommodation).
  // includeFood=true → derive cuisine from Google types and surface priceLevel.
  const bucketDefs = [
    { key: 'restaurant', types: ['restaurant'], max: 25, prefix: 'R', on: true, food: true },
    { key: 'cafe', types: ['cafe'], max: 10, prefix: 'C', on: true, food: true },
    { key: 'attraction', types: ['tourist_attraction'], max: 12, prefix: 'S', on: true, food: false },
    { key: 'museum', types: ['museum'], max: 8, prefix: 'M', on: true, food: false },
    { key: 'bar', types: ['bar'], max: 8, prefix: 'B', on: wantsNightlife, food: true },
    { key: 'nightclub', types: ['night_club'], max: 6, prefix: 'N', on: wantsNightlife, food: false },
    { key: 'gym', types: ['gym'], max: 6, prefix: 'G', on: wantsActive, food: false },
    { key: 'park', types: ['park'], max: 8, prefix: 'P', on: wantsNature, food: false }
  ];

  const cityResults = await Promise.all(cities.map(async (c) => {
    const lat = parseFloat(c.lat);
    const lon = parseFloat(c.lon);
    if (!lat || !lon || isNaN(lat) || isNaN(lon)) return [c.name, null];

    const bucketArr = await Promise.all(
      bucketDefs.filter(b => b.on).map(async (b) => {
        const places = await fetchBucket({
          includedTypes: b.types,
          maxResults: b.max,
          lat, lon
        });
        return [b.key, shape(places, b.prefix, b.food)];
      })
    );
    return [c.name, Object.fromEntries(bucketArr)];
  }));

  const candidates = Object.fromEntries(cityResults.filter(([_, v]) => v));

  return new Response(JSON.stringify({ candidates }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
