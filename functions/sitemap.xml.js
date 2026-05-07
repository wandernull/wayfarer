// GET /sitemap.xml
// Dynamic for the same reason as robots.txt — `<loc>` must reflect the
// current host. Also references /sitemap.xsl so opening this URL in a browser
// renders a styled HTML page (Jounee-branded table) instead of raw XML.
// Crawlers ignore the stylesheet and parse the XML directly.
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;
  const body =
`<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="${origin}/sitemap.xsl"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>${origin}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
    <xhtml:link rel="alternate" hreflang="en" href="${origin}/"/>
    <xhtml:link rel="alternate" hreflang="tr" href="${origin}/"/>
    <xhtml:link rel="alternate" hreflang="es" href="${origin}/"/>
    <xhtml:link rel="alternate" hreflang="fr" href="${origin}/"/>
    <xhtml:link rel="alternate" hreflang="de" href="${origin}/"/>
    <xhtml:link rel="alternate" hreflang="it" href="${origin}/"/>
    <xhtml:link rel="alternate" hreflang="pt" href="${origin}/"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${origin}/"/>
  </url>
  <url>
    <loc>${origin}/plan</loc>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
</urlset>
`;
  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}
