const ENRICHABLE = new Set(['meal', 'sight', 'bar', 'nightlife', 'activity']);

export async function onRequestPost(context) {
  const { env, request } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { events = [] } = body;
  const toEnrich = events.filter(e => ENRICHABLE.has(e.type));

  const results = await Promise.all(
    toEnrich.map(async (ev) => {
      try {
        const q = encodeURIComponent(`${ev.title} ${ev.city}`);
        const url = `https://discover.search.hereapi.com/v1/discover?q=${q}&at=${ev.lat},${ev.lon}&limit=1&apiKey=${env.HERE_API_KEY}`;
        const res = await fetch(url);
        if (!res.ok) return { id: ev.id };
        const data = await res.json();
        const item = data.items?.[0];
        if (!item) return { id: ev.id };
        const lat = item.position?.lat;
        const lng = item.position?.lng;
        return {
          id: ev.id,
          realName: item.title,
          address: item.address?.label,
          mapsUrl: lat && lng
            ? `https://maps.here.com/?map=${lat},${lng},15,normal&poi=${lat},${lng}`
            : undefined,
        };
      } catch {
        return { id: ev.id };
      }
    })
  );

  return new Response(JSON.stringify({ events: results }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
