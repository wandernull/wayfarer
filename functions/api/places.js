export async function onRequestPost(context) {
  const { request, env } = context;
  const GOOGLE_API_KEY = env.GOOGLE_PLACES_API_KEY;

  if (!GOOGLE_API_KEY) {
    return new Response(JSON.stringify({ results: [] }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const { events = [] } = body;

  const typeMap = {
    hotel: ['lodging'], accommodation: ['lodging'],
    meal: ['restaurant'], restaurant: ['restaurant'],
    dinner: ['restaurant'], lunch: ['restaurant'],
    breakfast: ['cafe', 'restaurant'],
    bar: ['bar'], nightlife: ['night_club', 'bar'],
    sight: ['tourist_attraction', 'museum'], sightseeing: ['tourist_attraction', 'museum'],
    activity: ['tourist_attraction', 'amusement_park', 'park'],
    attraction: ['tourist_attraction', 'museum'],
    sport: ['gym', 'sports_club'], gym: ['gym'], fitness: ['gym'],
    coffee: ['cafe'], cafe: ['cafe'],
    park: ['park'], museum: ['museum'], beach: ['park'],
  };

  const FIELD_MASK = 'places.displayName,places.formattedAddress,places.rating,places.location,places.googleMapsUri,places.userRatingCount,places.businessStatus';

  const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'of', 'de', 'la', 'le', 'el',
    'restaurant', 'restaurante', 'ristorante', 'hotel', 'bar', 'cafe', 'café', 'club',
    'gym', 'museum', 'park', 'house', 'room', 'kitchen', 'grill', 'bistro']);

  const normalize = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

  const significantWords = (s) => normalize(s).split(' ').filter(w => w.length > 2 && !STOP_WORDS.has(w));

  const nameLooksLikeMatch = (claudeName, googleName) => {
    const claudeWords = significantWords(claudeName);
    const googleWords = new Set(significantWords(googleName));
    if (!claudeWords.length || !googleWords.size) return false;
    const overlap = claudeWords.filter(w => googleWords.has(w)).length;
    return overlap >= 1;
  };

  const textSearch = async (query, lat, lon) => {
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_API_KEY,
          'X-Goog-FieldMask': FIELD_MASK
        },
        body: JSON.stringify({
          textQuery: query,
          locationBias: {
            circle: {
              center: { latitude: parseFloat(lat), longitude: parseFloat(lon) },
              radius: 20000.0
            }
          },
          maxResultCount: 5
        })
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.places || []).filter(p => p.displayName?.text && p.location);
    } catch { return []; }
  };

  const nearbySearch = async (includedTypes, lat, lon) => {
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
          maxResultCount: 10,
          locationRestriction: {
            circle: {
              center: { latitude: parseFloat(lat), longitude: parseFloat(lon) },
              radius: 5000.0
            }
          },
          rankPreference: 'RATING'
        })
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.places || []).filter(p => p.displayName?.text && p.location);
    } catch { return []; }
  };

  const formatResult = (id, place, { replaced = false, verified = false } = {}) => ({
    id,
    realName: place.displayName.text,
    address: place.formattedAddress || null,
    mapsUrl: place.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.displayName.text)}`,
    rating: place.rating ? Math.round(place.rating * 10) / 10 : null,
    ratingCount: place.userRatingCount || null,
    verified,
    replaced
  });

  const results = await Promise.all(events.map(async (event) => {
    try {
      const { id, title, city, type, lat, lon } = event;
      const typeKey = (type || '').toLowerCase().replace(/[\s_]+/g, '');
      const includedTypes = typeMap[typeKey] || ['point_of_interest'];
      if (!lat || !lon || isNaN(parseFloat(lat)) || isNaN(parseFloat(lon))) return { id, skip: true };

      // Step 1: verify Claude's named venue via Text Search.
      if (title && title.trim()) {
        const query = city ? `${title} ${city}` : title;
        const textPlaces = await textSearch(query, lat, lon);
        const verified = textPlaces.find(p =>
          p.businessStatus === 'OPERATIONAL' &&
          nameLooksLikeMatch(title, p.displayName.text)
        );
        if (verified) return formatResult(id, verified, { verified: true });
      }

      // Step 2: fall back to nearby-top-rated as a replacement.
      const nearby = await nearbySearch(includedTypes, lat, lon);
      const open = nearby.filter(p => p.businessStatus === 'OPERATIONAL' || !p.businessStatus);
      if (!open.length) return { id, skip: true };
      const top = open.sort((a, b) => (b.rating || 0) - (a.rating || 0))[0];
      return formatResult(id, top, { replaced: true });
    } catch (e) {
      return { id: event.id, skip: true };
    }
  }));

  return new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
