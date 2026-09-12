import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildIndex, normalise, search, queryUrl, suggest, type Entry } from './search';
import { allNodes } from './content';

const index = buildIndex(allNodes);
const ids = (q: string, limit?: number) => search(index, q, limit).map((h) => h.id);

describe('the index', () => {
  it('holds every published concept', () => {
    expect(index).toHaveLength(allNodes.length);
  });

  it('carries only what a result row needs', () => {
    // This ships to every searcher; a body in here would be a download, not an index.
    expect(Object.keys(index[0]!).sort()).toEqual(['domain', 'id', 'tier', 'title']);
  });

  /**
   * BUDGETED IN GZIPPED BYTES, WHICH IS WHAT A READER DOWNLOADS.
   *
   * This shipped asserting the raw string length against #45's "roughly 30 KB",
   * and went red at 297 concepts. The obvious fixes are to raise the number or
   * to shrink the index. Measuring the second says why neither is right:
   *
   *   encoding                                  raw     gzip   brotli
   *   {id, title, domain, tier} per node      30.7 KB   5.7 KB  4.8 KB
   *   domains interned to a table + index     21.9 KB   5.8 KB  4.9 KB
   *   tuples [id, title, domainIdx, tierBit]  17.3 KB   5.5 KB  4.6 KB
   *   + title derived from id where it matches 13.6 KB  4.5 KB  3.8 KB
   *
   * Interning the 158 domain strings cuts raw bytes by 29% and makes the
   * TRANSFERRED bytes larger. That is not a surprise once said out loud: LZ77
   * back-references are what interning does, and gzip does it better because it
   * does not have to ship the table. So the raw count is a proxy for nothing a
   * reader experiences, and every restructuring it would push us toward buys a
   * second index shape and an encode/decode step in exchange for ~100 bytes.
   *
   * The table is here so the next person to see this fail does not re-derive it
   * before reaching for the interning that does not work (#254).
   *
   * `perf-budget.json` (#60) has always been denominated this way — gzipped
   * bytes, `gzipSync` at level 9 — so this is the codebase's existing unit, not
   * a new one invented to escape a red test. #45's number was scoped to "the
   * current graph" of 57 concepts and was a snapshot, not a ceiling.
   *
   * TEN KILOBYTES against 5.7 measured. Entries compress to about 20 gzipped
   * bytes each at 297 concepts, so the budget bites somewhere past 500 — the
   * next conversation about whether client-side search still makes sense, rather
   * than a conversation every eighth node. It is not slack: giving each entry a
   * 120-character summary takes the index to 20.3 KB gzipped and fails here,
   * which is the growth this is actually watching for.
   *
   * What stops a body field landing in here is the assertion above, which pins
   * the exact key set. This one is about volume; that one is about shape.
   */
  it('is small enough to send', () => {
    const wire = gzipSync(JSON.stringify(index), { level: 9 }).length;
    expect(wire).toBeLessThan(10_240);
  });

  it('joins the domain path the way the page displays it', () => {
    expect(index.find((e) => e.id === 'attention')?.domain).toBe('Attention / Core');
  });
});

describe('the matching rule', () => {
  it('finds a concept by the start of its title', () => {
    expect(ids('atten')[0]).toBe('attention');
  });

  it('finds one by a word inside the title', () => {
    expect(ids('head')).toContain('multi-head-attention');
  });

  it('finds one by its domain', () => {
    expect(ids('sparsity', 50)).toContain('mixture-of-experts');
  });

  it('finds one by its id, which is what a pasted URL gives you', () => {
    expect(ids('kv-cache')).toContain('kv-cache');
  });

  it('is case-insensitive', () => {
    expect(ids('LORA')).toEqual(ids('lora'));
  });

  it('ignores accents on either side', () => {
    expect(normalise('Résidual')).toBe('residual');
    expect(ids('résidual')).toContain('residual-connection');
  });
});

describe('ranking is by where the match landed', () => {
  it('puts a title-prefix match above a domain-only match', () => {
    const hits = search(index, 'attention', 50);
    // `attention` itself, not something merely filed under Attention.
    expect(hits[0]!.id).toBe('attention');
  });

  // THE DOMAIN-ONLY TERM HAS TO BE ONE NO CONCEPT WILL EVER BE TITLED. This was
  // `regularization`, which was domain-only until a node called Regularization
  // was seeded (#308) — then the query scored as a title hit and the assertion
  // failed on content rather than on ranking. `Regimes` is a shelf label, not a
  // concept, so it cannot be claimed the same way; 23 nodes are filed under it.
  it('scores a title hit above an id-only hit', () => {
    const [title] = search(index, 'dropout', 50);
    const [domain] = search(index, 'regimes', 50);
    expect(title!.score).toBeGreaterThan(domain!.score);
  });

  it('breaks ties by title so results do not reorder between renders', () => {
    expect(search(index, 'attention', 50)).toEqual(search(index, 'attention', 50));
  });
});

describe('multiple terms are AND, not OR', () => {
  it('narrows rather than widens', () => {
    const one = ids('attention', 50);
    const two = ids('attention multi', 50);
    expect(two.length).toBeLessThan(one.length);
    for (const id of two) expect(one).toContain(id);
  });

  it('returns nothing when one term matches nothing', () => {
    // OR would return every attention concept and rank the noise.
    expect(ids('attention zzzzz')).toEqual([]);
  });
});

describe('the edges of the box', () => {
  it('returns nothing for an empty query', () => {
    // An empty box has not asked a question. Answering with the whole graph
    // makes the list flash every concept on the way back to nothing.
    expect(ids('')).toEqual([]);
    expect(ids('   ')).toEqual([]);
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(ids('qwertyuiop')).toEqual([]);
  });

  it('handles a query matching every node without returning every node', () => {
    // Every id contains a letter; the limit is what stops the panel becoming
    // the whole index rendered into a dropdown.
    const everything: Entry[] = index.map((e) => ({ ...e, title: 'aaa', domain: 'aaa', id: e.id }));
    expect(search(everything, 'a').length).toBe(12);
    expect(search(everything, 'a', 3).length).toBe(3);
  });

  it('survives regex-ish and punctuation input', () => {
    for (const q of ['.*', '(', '[a-z]+', '\\', '???', '—']) {
      expect(() => search(index, q)).not.toThrow();
    }
  });

  it('treats a hyphen as a word break, so "self attention" finds self-attention', () => {
    expect(ids('self attention')).toContain('self-attention');
  });
});

/**
 * #451. "attention mechanism" and "positional embedding" are how people ask for
 * concepts that exist, and both answered with nothing — the second while
 * Positional Encoding sits on the landing page as a suggested concept.
 *
 * The matching rule itself is unchanged and deliberately so; these are offered
 * as suggestions beside the zero state, never as results.
 */
describe('the zero state offers the closest concepts', () => {
  const names = (q: string, n = 4) => suggest(index, q, n).map((h) => h.title);

  it('answers a query whose extra word matches nothing', () => {
    const out = names('attention mechanism');
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain('Attention');
  });

  it('offers Positional Encoding for "positional embedding"', () => {
    expect(names('positional embedding', 6)).toContain('Positional Encoding');
  });

  /**
   * Breadth beats strength. Built on a synthetic index because the real corpus
   * cannot separate the two rules: "self attention" puts Self-Attention first
   * under either, so asserting on it proves nothing — which is what planting
   * the weighting showed, with all 27 tests still green.
   *
   * Here "Alpha" answers ONE term as strongly as possible (title prefix, 4) and
   * "Zeta" answers BOTH as weakly as possible (domain only, 1 + 1). Ranked by
   * raw score Alpha wins; ranked by terms matched Zeta does, and Zeta is the
   * better suggestion because it addresses more of what was typed.
   */
  it('ranks an entry matching more terms above one matching fewer but harder', () => {
    const synthetic: Entry[] = [
      { id: 'alpha', title: 'Alpha', domain: 'Unrelated / Things', tier: 'verified' },
      { id: 'zeta', title: 'Zeta', domain: 'Alpha / Beta', tier: 'verified' },
    ];
    expect(suggest(synthetic, 'alpha beta').map((h) => h.title)).toEqual(['Zeta', 'Alpha']);
  });

  it('still puts a two-term match first on the real corpus', () => {
    expect(names('self attention')[0]).toBe('Self-Attention');
  });

  it('says nothing for a single term — that is a typo, not a partial match', () => {
    expect(suggest(index, 'attenton')).toEqual([]);
    expect(suggest(index, 'attention')).toEqual([]);
  });

  it('says nothing when no term matches anything', () => {
    expect(suggest(index, 'qwertyuiop zxcvbnm')).toEqual([]);
  });

  it('respects its limit', () => {
    expect(suggest(index, 'attention zzzzz', 2).length).toBeLessThanOrEqual(2);
  });

  /**
   * The guard that matters. `search` keeps requiring every term: suggestions
   * are a separate call, so a relaxation here can never leak into results.
   */
  it('does not change what search itself returns', () => {
    expect(search(index, 'attention zzzzz')).toEqual([]);
    expect(search(index, 'attention mechanism')).toEqual([]);
  });
});

/**
 * #452. The URL is the question on /search, and it was written only on submit —
 * so clearing the box left ?q= behind and a reload brought the cleared query
 * back.
 */
describe('the URL carries the question', () => {
  it('sets q for a query', () => {
    expect(queryUrl('/search', '', 'attention')).toBe('/search?q=attention');
  });

  it('drops q entirely when the box is cleared', () => {
    expect(queryUrl('/search', '?q=attention', '')).toBe('/search');
    // Whitespace is not a question either — the panel returns no hits for it.
    expect(queryUrl('/search', '?q=attention', '   ')).toBe('/search');
  });

  it('replaces rather than appends when the query changes', () => {
    expect(queryUrl('/search', '?q=attention', 'softmax')).toBe('/search?q=softmax');
  });

  it('keeps a query the reader can still read back', () => {
    // Round-trips: what the URL says is what the box gets on reload.
    const url = queryUrl('/search', '', 'mixture of experts');
    expect(new URLSearchParams(url.split('?')[1]).get('q')).toBe('mixture of experts');
  });

  it('leaves other parameters alone', () => {
    // Nothing uses one today; silently dropping someone else's would be a
    // surprise the moment something does.
    expect(queryUrl('/search', '?from=%2Fc%2Fattention', 'kv cache'))
      .toBe('/search?from=%2Fc%2Fattention&q=kv+cache');
  });
});

/**
 * #454. A zero-width space inside an otherwise perfect term made it match
 * nothing, while looking exactly like the word that matches twelve things — so
 * a reader concludes the concept does not exist rather than that their paste
 * carried an invisible.
 */
describe('invisible characters from a clipboard', () => {
  it('finds a term split by a zero-width space', () => {
    expect(search(index, 'atten\u200btion').map((h) => h.id))
      .toEqual(search(index, 'attention').map((h) => h.id));
  });

  it('handles the whole invisible family', () => {
    const want = search(index, 'softmax').map((h) => h.id);
    expect(want.length).toBeGreaterThan(0);
    for (const c of ['\u200b', '\u200c', '\u200d', '\u2060', '\ufeff']) {
      expect(search(index, `soft${c}max`).map((h) => h.id)).toEqual(want);
    }
  });

  /**
   * Passes with the strip REMOVED too, and is kept for that reason rather than
   * as evidence for it: JavaScript's \s already matches U+FEFF, so splitting the
   * query on whitespace discarded a leading one before this change existed.
   * U+200B and U+2060 are NOT \s, which is why they needed the strip and this
   * did not. Recorded so nobody reads it as coverage it does not provide.
   */
  it('was already fine with a leading byte-order mark', () => {
    expect(search(index, '\ufeffattention').map((h) => h.id))
      .toEqual(search(index, 'attention').map((h) => h.id));
  });

  it('leaves ordinary text alone', () => {
    // The strip must not eat anything a reader can see.
    expect(normalise('Mixture-of-Experts')).toBe('mixture-of-experts');
    expect(normalise('KV Cache')).toBe('kv cache');
    expect(normalise('Résidual')).toBe('residual');
  });

  it('still separates words on a real space', () => {
    // A zero-width space is not a word break; a real one is. Collapsing both
    // would make "flowmatching" match "flow matching".
    expect(normalise('flow matching')).toContain(' ');
    expect(normalise('flow\u200bmatching')).toBe('flowmatching');
  });
});
