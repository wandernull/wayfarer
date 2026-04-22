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

  const FIELD_MASK = 'places.displayName,places.formattedAddress,places.rating,places.location,places.googleMapsUri,places.userRatingCount,places.businessStatus,places.primaryType,places.types';

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

  const shape = (places, prefix) => places.map((p, i) => ({
    id: `${prefix}${i + 1}`,
    name: p.displayName.text,
    primaryType: p.primaryType || null,
    rating: p.rating ? Math.round(p.rating * 10) / 10 : null,
    reviews: p.userRatingCount || 0,
    address: p.formattedAddress || '',
    lat: p.location?.latitude || null,
    lng: p.location?.longitude || null,
    mapsUrl: p.googleMapsUri || null
  }));

  // Bucket definitions — (key, includedTypes, maxResults, prefix, enabled)
  const bucketDefs = [
    { key: 'lodging', types: ['lodging'], max: 12, prefix: 'H', on: true },
    { key: 'restaurant', types: ['restaurant'], max: 25, prefix: 'R', on: true },
    { key: 'cafe', types: ['cafe'], max: 10, prefix: 'C', on: true },
    { key: 'attraction', types: ['tourist_attraction'], max: 12, prefix: 'S', on: true },
    { key: 'museum', types: ['museum'], max: 8, prefix: 'M', on: true },
    { key: 'bar', types: ['bar'], max: 8, prefix: 'B', on: wantsNightlife },
    { key: 'nightclub', types: ['night_club'], max: 6, prefix: 'N', on: wantsNightlife },
    { key: 'gym', types: ['gym'], max: 6, prefix: 'G', on: wantsActive },
    { key: 'park', types: ['park'], max: 8, prefix: 'P', on: wantsNature }
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
        return [b.key, shape(places, b.prefix)];
      })
    );
    return [c.name, Object.fromEntries(bucketArr)];
  }));

  const candidates = Object.fromEntries(cityResults.filter(([_, v]) => v));

  return new Response(JSON.stringify({ candidates }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
