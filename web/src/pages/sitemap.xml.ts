/**
 * The sitemap, emitted at build from the same content the pages are built from
 * (#62). It shares its walk with `llms.txt` through `lib/siteindex` — two
 * traversals would be two descriptions of the graph free to disagree.
 *
 * INERT UNTIL #65. `public/robots.txt` is `Disallow: /` and `firebase.json`
 * sets `X-Robots-Tag: noindex, nofollow` on `**`, so no crawler that respects
 * either will read this file. Both come off at the DNS cutover, together with
 * the `site` in `astro.config.ts` — and the `Sitemap:` line in `robots.txt`
 * goes in at the same moment, because pointing a crawler at an index of a site
 * we are asking it not to crawl is a contradiction, not a head start.
 *
 * No `Response` headers: a static build writes the body to `dist/sitemap.xml`
 * and discards everything else. Caching and content type are Hosting's.
 */
import type { APIRoute } from 'astro';
import { allNodes } from '../lib/content';
import { sitemapPages } from '../lib/siteindex';

/** The five predefined XML entities. `loc` is spec-required to be escaped. */
function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const GET: APIRoute = ({ site }) => {
  // `site` is set in astro.config.ts and a sitemap is absolute URLs by
  // definition, so its absence is a build failure rather than a relative
  // fallback that would produce a file no crawler could use.
  if (!site) throw new Error('sitemap.xml needs `site` in astro.config.ts');

  const pages = sitemapPages(allNodes);
  const urls = pages
    .map((page) => {
      // Matches the canonical link in Base.astro exactly — same origin, same
      // no-trailing-slash paths. A sitemap that disagrees with the canonical
      // tag on the page it points at is a crawler telling you so, later.
      const loc = new URL(page.path, site).href;
      return `  <url>
    <loc>${xml(loc)}</loc>
    <lastmod>${xml(page.lastmod)}</lastmod>
    <priority>${xml(page.priority)}</priority>
  </url>`;
    })
    .join('\n');

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  console.log(`sitemap → ${pages.length} URLs, ${(Buffer.byteLength(body) / 1024).toFixed(1)} KB`);
  return new Response(body);
};
