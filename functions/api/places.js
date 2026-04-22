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

  const results = await Promise.all(events.map(async (event) => {
    try {
      const { id, type, lat, lon } = event;
      const typeKey = (type || '').toLowerCase().replace(/[\s_]+/g, '');
      const includedTypes = typeMap[typeKey] || ['point_of_interest'];
      if (!lat || !lon || isNaN(parseFloat(lat)) || isNaN(parseFloat(lon))) return { id, skip: true };

      const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_API_KEY,
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.rating,places.location,places.googleMapsUri,places.userRatingCount'
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

      if (!res.ok) return { id, skip: true };
      const data = await res.json();
      const places = (data.places || []).filter(p => p.displayName?.text && p.location);
      if (!places.length) return { id, skip: true };
      const top = places.sort((a, b) => (b.rating || 0) - (a.rating || 0))[0];

      return {
        id,
        realName: top.displayName.text,
        address: top.formattedAddress || null,
        mapsUrl: top.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(top.displayName.text)}`,
        rating: top.rating ? Math.round(top.rating * 10) / 10 : null,
        ratingCount: top.userRatingCount || null
      };
    } catch (e) {
      return { id: event.id, skip: true };
    }
  }));

  return new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
