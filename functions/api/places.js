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
    hotel:         ['lodging'],
    accommodation: ['lodging'],
    meal:          ['restaurant'],
    restaurant:    ['restaurant'],
    dinner:        ['restaurant'],
    lunch:         ['restaurant'],
    breakfast:     ['cafe', 'restaurant'],
    bar:           ['bar'],
    nightlife:     ['night_club', 'bar'],
    sight:         ['tourist_attraction', 'museum', 'art_gallery'],
    sightseeing:   ['tourist_attraction', 'museum'],
    activity:      ['tourist_attraction', 'amusement_park', 'park'],
    attraction:    ['tourist_attraction', 'museum'],
    sport:         ['gym', 'stadium', 'sports_club'],
    gym:           ['gym'],
    fitness:       ['gym'],
    coffee:        ['cafe'],
    cafe:          ['cafe'],
    park:          ['park', 'natural_feature'],
    museum:        ['museum'],
    beach:         ['natural_feature', 'park'],
  };

  const results = await Promise.all(events.map(async (event) => {
    try {
      const { id, type, lat, lon } = event;
      const typeKey = (type || '').toLowerCase().replace(/[\s_]+/g, '');
      const includedTypes = typeMap[typeKey] || ['point_of_interest'];

      if (!lat || !lon || isNaN(lat) || isNaN(lon)) {
        return { id, skip: true };
      }

      const searchBody = {
        includedTypes,
        maxResultCount: 10,
        locationRestriction: {
          circle: {
            center: { latitude: parseFloat(lat), longitude: parseFloat(lon) },
            radius: 5000.0
          }
        },
        rankPreference: 'RATING'
      };

      const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_API_KEY,
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.rating,places.location,places.googleMapsUri,places.userRatingCount'
        },
        body: JSON.stringify(searchBody)
      });

      if (!res.ok) {
        const err = await res.text();
        console.error('Google Places error:', err);
        return { id, skip: true };
      }

      const data = await res.json();
      const places = data.places || [];

      if (places.length === 0) return { id, skip: true };

      const sorted = places
        .filter(p => p.displayName?.text && p.location)
        .sort((a, b) => (b.rating || 0) - (a.rating || 0));

      const top = sorted[0];
      if (!top) return { id, skip: true };

      return {
        id,
        realName: top.displayName.text,
        address: top.formattedAddress || null,
        mapsUrl: top.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(top.displayName.text)}`,
        rating: top.rating ? Math.round(top.rating * 10) / 10 : null,
        ratingCount: top.userRatingCount || null
      };
    } catch (e) {
      console.error('Places error for event', event.id, e);
      return { id: event.id, skip: true };
    }
  }));

  return new Response(JSON.stringify({ results }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
