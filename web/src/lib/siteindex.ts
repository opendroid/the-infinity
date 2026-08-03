/**
 * The one walk over the graph that every machine-readable index is built from.
 *
 * `sitemap.xml` (#62) and `llms.txt` (#85) both describe what this site
 * contains. Two traversals would be two descriptions free to disagree, and this
 * repo has been bitten by that shape repeatedly — the fake store against the
 * real one, the two graph derivations, the lemniscate comment that claimed a
 * committed layout there was none of. So there is one traversal, here, and both
 * endpoints consume it.
 *
 * Both are live as of the DNS cutover (#65). They were built and served for a
 * while before that, on the pre-launch host and behind `Disallow: /` — asking
 * to be ignored, which was coherent because the site was.
 */
import type { ResolvedNode, Tier } from './graph';

export interface IndexedPage {
  /** Absolute path, no trailing slash — `trailingSlash: false` in firebase.json. */
  path: string;
  title: string;
  /** ISO date, from the node's `updated_at`. */
  lastmod: string;
  /** How important this page is relative to the others, for sitemap consumers. */
  priority: string;
  /** What this page is, for a reader who only has the index. `llms.txt` only. */
  note?: string;
}

export interface IndexedConcept extends IndexedPage {
  domain: string;
  tier: Tier;
  /** One sentence. See `summarise`. */
  summary: string;
}

/**
 * The first sentence of the intuition body.
 *
 * `llms.txt` is a map, not a copy of the site: the convention wants an entry a
 * model can skim. Measured before choosing — at 57 nodes the whole intuition
 * body is 22.5 KB against 11.1 KB for first sentences, and at the ~300 nodes
 * PLAN.md targets that is 118 KB against 58 KB. An index nobody can hold in
 * context is not an index.
 *
 * A sentence rather than a character count, because these bodies open with a
 * complete thought — "A model reading a sentence needs to decide, for each
 * word, which other words matter." — and a truncation would cut it mid-clause.
 */
export function summarise(intuition: string): string {
  const text = intuition.trim().replace(/\s+/g, ' ');
  const match = /^.*?[.!?](?=\s|$)/.exec(text);
  return (match ? match[0] : text).trim();
}

/**
 * Every concept page, in a stable order.
 *
 * Built from the same `allNodes` the pages are rendered from, so it cannot list
 * a concept that does not exist nor miss one that does — the property both
 * issues ask for, and it is structural rather than tested.
 */
export function indexedConcepts(nodes: ResolvedNode[]): IndexedConcept[] {
  return nodes
    .map((node) => ({
      path: `/c/${node.id}`,
      title: node.title,
      lastmod: node.updated_at,
      priority: '0.8',
      domain: node.domain.join(' / '),
      tier: node.tier,
      summary: summarise(node.bodies.intuition),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The fixed routes worth indexing, and the reasoning for what is missing.
 *
 * `lastmod` is the newest concept, because these pages are views over the graph
 * and change exactly when it does.
 *
 * NOT HERE, deliberately:
 *   /t/**    user-created, unbounded, and duplicate content by construction —
 *            several trails cover the same concepts in a different order, so
 *            listing them invites a crawler to index a growing set of
 *            near-identical pages.
 *   /search  a tool, not a destination. Search-results pages are the canonical
 *            example of what not to put in a sitemap.
 *   /request a form.
 *   /404     obviously.
 */
export function indexedRoutes(concepts: IndexedConcept[]): IndexedPage[] {
  const newest = concepts.reduce((a, c) => (c.lastmod > a ? c.lastmod : a), '0000-00-00');
  return [
    {
      path: '/',
      title: 'theinfinity.ai',
      lastmod: newest,
      priority: '1.0',
      note: 'the landing page — search, and a way into the graph',
    },
    {
      path: '/concepts',
      title: 'Every concept',
      lastmod: newest,
      priority: '0.9',
      note: 'the full index, grouped by domain, with each concept’s tier',
    },
  ];
}

/** Everything a sitemap lists: the fixed routes, then the concepts. */
export function sitemapPages(nodes: ResolvedNode[]): IndexedPage[] {
  const concepts = indexedConcepts(nodes);
  return [...indexedRoutes(concepts), ...concepts];
}
