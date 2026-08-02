import { describe, expect, it } from 'vitest';
import { buildIndex, normalise, search, type Entry } from './search';
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

  it('is small enough to send', () => {
    const bytes = Buffer.byteLength(JSON.stringify(index));
    expect(bytes).toBeLessThan(30_720); // the 30 KB budget in #45
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

  it('scores a title hit above an id-only hit', () => {
    const [title] = search(index, 'dropout', 50);
    const [domain] = search(index, 'regularization', 50);
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
