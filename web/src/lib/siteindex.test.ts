import { describe, expect, it } from 'vitest';
import { indexedConcepts, indexedRoutes, sitemapPages, summarise } from './siteindex';
import { allNodes } from './content';

const concepts = indexedConcepts(allNodes);
const pages = sitemapPages(allNodes);

describe('the concept walk', () => {
  it('lists every published concept, once', () => {
    expect(concepts).toHaveLength(allNodes.length);
    expect(new Set(concepts.map((c) => c.path)).size).toBe(allNodes.length);
  });

  it('cannot list a concept that does not exist', () => {
    // The property both #62 and #85 ask for, and the reason there is one walk
    // rather than two: this comes from `allNodes`, which is what the pages are
    // rendered from, so the set is the same set by construction.
    const ids = new Set(allNodes.map((n) => n.id));
    for (const c of concepts) expect(ids.has(c.path.replace('/c/', ''))).toBe(true);
  });

  it('takes lastmod from the node', () => {
    const attention = allNodes.find((n) => n.id === 'attention')!;
    expect(concepts.find((c) => c.path === '/c/attention')?.lastmod).toBe(attention.updated_at);
  });

  it('is in a stable order, so the built files diff cleanly', () => {
    expect(concepts.map((c) => c.path)).toEqual([...concepts.map((c) => c.path)].sort());
  });

  it('joins the domain path the way the page displays it', () => {
    expect(concepts.find((c) => c.path === '/c/attention')?.domain).toBe('Attention / Core');
  });
});

describe('what the sitemap lists', () => {
  it('includes the landing page and the index', () => {
    expect(pages.map((p) => p.path)).toEqual(expect.arrayContaining(['/', '/concepts']));
  });

  it('lists those two routes and the concepts, and nothing else', () => {
    // The exact set, not a pattern that excludes today's routes: a pattern
    // passes for a route nobody thought to name, and the whole risk here is a
    // route added later that quietly ends up in the sitemap. Trails are the one
    // that matters — unbounded and duplicate by construction. See the comment
    // on `indexedRoutes` for why /search, /request and /404 are out too.
    expect(pages.map((p) => p.path)).toEqual(['/', '/concepts', ...concepts.map((c) => c.path)]);
  });

  it('matches the canonical URLs — no trailing slash except the root', () => {
    // Base.astro strips the trailing slash from every canonical link. A sitemap
    // pointing at /c/attention/ while the page says /c/attention is two URLs
    // for one page, which is the exact thing a canonical tag exists to stop.
    for (const page of pages) {
      if (page.path !== '/') expect(page.path.endsWith('/')).toBe(false);
    }
  });

  it('dates the derived pages from the newest concept', () => {
    const newest = concepts.map((c) => c.lastmod).sort().at(-1);
    expect(indexedRoutes(concepts).map((p) => p.lastmod)).toEqual([newest, newest]);
  });
});

describe('the one-line summary', () => {
  it('takes the first sentence', () => {
    expect(summarise('One thing. Then another.')).toBe('One thing.');
  });

  it('keeps a question or an exclamation whole', () => {
    expect(summarise('Why does this work? Nobody agrees.')).toBe('Why does this work?');
  });

  it('does not stop at a decimal point', () => {
    // `1.5` is a full stop with no space after it. Requiring whitespace-or-end
    // is what separates a number from a sentence boundary.
    expect(summarise('It runs 1.5x faster. Twice on a good day.')).toBe('It runs 1.5x faster.');
  });

  it('collapses a wrapped line into one', () => {
    // These end up as a markdown bullet; a newline inside one would end the
    // list item and silently drop the rest of the sentence.
    expect(summarise('A model reads\n  a sentence. Then decides.')).toBe(
      'A model reads a sentence.',
    );
  });

  it('returns the whole text when there is no sentence end', () => {
    expect(summarise('no full stop here')).toBe('no full stop here');
  });

  it('stays one line, and short, for every concept we actually have', () => {
    for (const c of concepts) {
      expect(c.summary).not.toContain('\n');
      expect(c.summary.length).toBeLessThan(260);
      expect(c.summary.length).toBeGreaterThan(10);
    }
  });
});
