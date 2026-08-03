/**
 * llms.txt — a map of this site for a language model, in the shape
 * https://llmstxt.org/ describes: an H1, a blockquote saying what the site is,
 * and H2 sections of links with one line of context each (#85).
 *
 * Generated at build from the same content the pages are built from, sharing
 * its walk with `sitemap.xml` through `lib/siteindex`. Hand-writing it would
 * guarantee drift the first time a concept was renamed.
 *
 * LIVE SINCE #65, for the same reason as the sitemap: the crawler block came
 * off and `site` moved to the real domain in one commit. The URLs below name
 * theinfinity.ai.
 *
 * Two of #85's three open questions are answered here rather than in a comment
 * nobody reads: tier is included, and trails are not. See below.
 */
import type { APIRoute } from 'astro';
import { allNodes } from '../lib/content';
import { indexedConcepts, indexedRoutes } from '../lib/siteindex';

export const GET: APIRoute = ({ site }) => {
  if (!site) throw new Error('llms.txt needs `site` in astro.config.ts');
  const abs = (path: string) => new URL(path, site).href;

  const concepts = indexedConcepts(allNodes);
  const pages = indexedRoutes(concepts);

  const body = `# theinfinity.ai

> An infinitely explorable concept graph for AI/ML. Every concept is one page
> with a 30-second intuition, an engineer-level explanation, and the math —
> the same idea at three depths — plus typed edges to what it requires, what it
> unlocks, and what sits alongside it.

## Trust tiers

Every concept carries one, and it is a claim worth reading literally:

- **verified** — a person read the page and merged it. The merge is the review.
- **frontier** — drafted from the sources it cites, and waiting for that review.

Both are cited from primary sources. Neither is a confidence score: a frontier
page is not a guess, it is unreviewed. Where it matters, prefer verified and
follow the citations on the page.

## Pages

${pages.map((page) => `- [${page.title}](${abs(page.path)}): ${page.note ?? ''}`).join('\n')}

## Concepts

${concepts
  .map((c) => `- [${c.title}](${abs(c.path)}): ${c.domain} — ${c.tier}. ${c.summary}`)
  .join('\n')}

## Not listed here

Shared trails (\`/t/...\`) are reader-created paths through this same set of
concepts. They are unbounded and they duplicate the content above in a different
order, so indexing them would describe the graph many times over rather than
once. \`/search\` and \`/request\` are a tool and a form; neither has content.
`;

  // Printed at build, like the search index in #45: an index nobody can hold in
  // context is not an index, and this is the number that decides whether one
  // sentence per concept is still the right call as the graph grows.
  const kb = (Buffer.byteLength(body) / 1024).toFixed(1);
  console.log(`llms.txt → ${concepts.length} concepts, ${kb} KB`);

  return new Response(body);
};
