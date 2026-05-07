// GET /robots.txt
// Dynamic so the Sitemap line reflects whichever host is serving the request
// (jounee.app in prod, localhost:8788 in `wrangler pages dev`, preview-*.pages.dev
// for branch deploys). Static files can't do that — hardcoding a host means
// non-prod hosts emit the wrong sitemap URL.
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;
  const body =
`# Jounee — robots.txt
# Allow crawling of public pages, block API endpoints (no SEO value, just noise).
# Journey URLs (/journey/<uuid>) aren't in the sitemap and aren't linked from
# public pages, so they don't get organically indexed — but they're not
# disallowed either, since users sometimes share their trip link socially.

User-agent: *
Allow: /
Disallow: /api/

Sitemap: ${origin}/sitemap.xml
`;
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}
