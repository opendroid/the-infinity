import { describe, expect, it } from 'vitest';
import { readCitations, structuralProblems } from '../../scripts/check-citations.mjs';

/**
 * The offline half of the citation check.
 *
 * These are the fabrications a model produces most often: an id and a URL that
 * were invented independently, and a date that could not have happened. Neither
 * needs the network to catch, which matters because the network is exactly what
 * a restricted environment does not have.
 */

interface Citation {
  ref: string;
  title: string;
  url: string;
  node: string;
}

const real: Citation = {
  node: 'muon-optimizer',
  ref: 'arXiv:2502.16982',
  title: 'Muon is Scalable for LLM Training',
  url: 'https://arxiv.org/abs/2502.16982',
};

const TODAY = new Date('2026-08-02');

describe('structuralProblems accepts what is well-formed', () => {
  it('a real arXiv citation', () => {
    expect(structuralProblems([real], TODAY)).toEqual([]);
  });

  it('a versioned arXiv id', () => {
    const c = { ...real, ref: 'arXiv:2502.16982v3' };
    expect(structuralProblems([c], TODAY)).toEqual([]);
  });

  it('a pre-2007 arXiv id', () => {
    const c = { ...real, ref: 'arXiv:cs.LG/0701001', url: 'https://arxiv.org/abs/cs.LG/0701001' };
    expect(structuralProblems([c], TODAY)).toEqual([]);
  });

  it('a non-arXiv source', () => {
    const c = { ...real, ref: 'Vaswani 2017', url: 'https://papers.nips.cc/paper/7181' };
    expect(structuralProblems([c], TODAY)).toEqual([]);
  });

  it('the same paper cited twice at the same url', () => {
    expect(structuralProblems([real, { ...real, node: 'other' }], TODAY)).toEqual([]);
  });
});

describe('structuralProblems catches fabrication shapes', () => {
  const cases: { name: string; citation: Citation; expect: RegExp }[] = [
    {
      // The single most common one: the id and the link were invented separately.
      name: 'a ref and url naming different papers',
      citation: { ...real, url: 'https://arxiv.org/abs/1706.03762' },
      expect: /url does not contain the arXiv id 2502\.16982/,
    },
    {
      name: 'an impossible month',
      citation: { ...real, ref: 'arXiv:2513.16982', url: 'https://arxiv.org/abs/2513.16982' },
      expect: /month 13 does not exist/,
    },
    {
      name: 'month zero',
      citation: { ...real, ref: 'arXiv:2500.16982', url: 'https://arxiv.org/abs/2500.16982' },
      expect: /month 0 does not exist/,
    },
    {
      // A model asked for recent work will happily date it past today.
      name: 'a future date',
      citation: { ...real, ref: 'arXiv:2712.99999', url: 'https://arxiv.org/abs/2712.99999' },
      expect: /dated in the future/,
    },
    {
      name: 'an http url',
      citation: { ...real, url: 'http://arxiv.org/abs/2502.16982' },
      expect: /not https/,
    },
    {
      name: 'an arxiv url whose ref is not an arXiv id',
      citation: { ...real, ref: 'Jordan 2025', url: 'https://arxiv.org/abs/2502.16982' },
      expect: /ref that is not an arXiv id/,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const problems = structuralProblems([c.citation], TODAY);
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.join('\n')).toMatch(c.expect);
    });
  }

  it('the same ref pointing at two different urls', () => {
    // One of the two was invented; which one is a question for a human.
    const problems = structuralProblems(
      [real, { ...real, node: 'elsewhere', url: 'https://arxiv.org/abs/2502.16982v9' }],
      TODAY,
    );
    expect(problems.join('\n')).toMatch(/cited elsewhere as/);
  });
});

describe('the committed corpus', () => {
  it('has no structural citation problems', () => {
    // Runs against real /content/nodes, so a fabricated citation in a future
    // seed batch fails here rather than in a reader's browser.
    expect(structuralProblems(readCitations(), TODAY)).toEqual([]);
  });
});
