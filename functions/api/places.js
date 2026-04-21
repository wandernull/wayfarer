export async function onRequestPost(context) {
  const { request, env } = context;
  const HERE_API_KEY = env.HERE_API_KEY;

  const body = await request.json();
  const { events } = body;

  if (!HERE_API_KEY) {
    return new Response(JSON.stringify({ results: [] }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // HERE Places category IDs
  const categoryMap = {
    hotel:         '700-7000-0000',
    accommodation: '700-7000-0000',
    meal:          '100-1000-0000',
    restaurant:    '100-1000-0000',
    bar:           '200-2000-0000',
    nightlife:     '200-2000-0000',
    sight:         '300-3000-0000',
    activity:      '300-3000-0000',
    sport:         '800-8300-0000',
    gym:           '800-8300-0000',
    coffee:        '100-1100-0000',
    cafe:          '100-1100-0000'
  };

  const results = await Promise.all(events.map(async (event) => {
    try {
      const { id, type, lat, lon } = event;
      const typeKey = (type || '').toLowerCase();
      const categoryId = categoryMap[typeKey];

      if (!categoryId || !lat || !lon) return { id, skip: true };

      // Use HERE Browse API: category-based search at city coordinates
      const url = `https://browse.search.hereapi.com/v1/browse?at=${lat},${lon}&categories=${categoryId}&limit=10&apiKey=${HERE_API_KEY}`;
      const res = await fetch(url);
      const data = await res.json();

      if (!data.items || data.items.length === 0) return { id, skip: true };

      // Sort by rating descending, pick top rated
      const sorted = data.items
        .filter(item => item.title && item.position)
        .sort((a, b) => {
          const rA = a.rating?.value ?? a.averageRating ?? 0;
          const rB = b.rating?.value ?? b.averageRating ?? 0;
          return rB - rA;
        });

      const top = sorted[0];
      if (!top) return { id, skip: true };

      const rating = top.rating?.value ?? top.averageRating ?? null;

      return {
        id,
        realName: top.title,
        address: top.address?.label || top.vicinity,
        mapsUrl: `https://maps.here.com/?map=${top.position.lat},${top.position.lng},17,normal&q=${encodeURIComponent(top.title)}`,
        rating: rating ? Math.round(rating * 10) / 10 : null
      };
    } catch (e) {
      console.error('HERE API error for event', event.id, e);
      return { id: event.id, skip: true };
    }
  }));

  return new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
