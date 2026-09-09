import { describe, expect, it } from 'vitest';
import { durationSeconds, inDegree, queryFor, score, targets } from '../../scripts/find-video-explainers.mjs';

/**
 * The pure half of the video-explainer finder (#384).
 *
 * The API half is not tested here and deliberately so: a test that mocks
 * YouTube proves this file agrees with its own mock. What IS worth pinning is
 * the targeting order, the duration parser, and the shape of the ranking —
 * because those decide what a reviewer sees first, and a reviewer reads the top
 * of the list.
 */

/** The shape targets() returns — the .mjs carries no types of its own. */
type Target = {
  scope: 'concept' | 'domain';
  key: string;
  title: string;
  covers?: number;
  sample?: string[];
};

const node = (id: string, domain: string[], adjacent: string[] = []) => ({
  id,
  title: id,
  domain,
  edges: { requires: [], adjacent: adjacent.map((a) => ({ id: a, reviewed: false })) },
});

describe('targets picks domains first, biggest first', () => {
  it('orders domains by how many concepts they cover', () => {
    // Not cosmetic. Quota runs out mid-run by design, so when it does it should
    // have covered the most concepts rather than the alphabetically luckiest.
    const t = targets([
      node('a', ['Foundations']),
      node('b', ['Foundations']),
      node('c', ['Foundations']),
      node('d', ['Alignment']),
      node('e', ['Methods']),
      node('f', ['Methods']),
    ]);
    expect(t.map((x: Target) => x.key)).toEqual(['Foundations', 'Methods', 'Alignment']);
    expect(t[0]).toMatchObject({ scope: 'domain', covers: 3 });
  });

  it('counts a concept once per domain it belongs to', () => {
    const t = targets([node('a', ['Foundations', 'Methods']), node('b', ['Methods'])]);
    expect(t.find((x: Target) => x.key === 'Methods')?.covers).toBe(2);
    expect(t.find((x: Target) => x.key === 'Foundations')?.covers).toBe(1);
  });

  it('picks the most-referenced concepts to stand for a domain', () => {
    // Half the domain names are filing labels — "Methods", "Core" — so the
    // query is built from what the domain CONTAINS. Alphabetical order would
    // make every domain look like whatever its "A" concepts are, hence
    // in-degree.
    // DELIBERATELY IN THE WRONG ORDER. Listed most-obscure-first, so corpus
    // order and centrality order disagree — otherwise dropping the sort would
    // still pass and this test would prove nothing.
    const nodes = [
      node('zzz-obscure', ['Core']),
      node('gpt', ['Core'], ['transformer']),
      node('transformer', ['Core'], ['softmax', 'attention']),
      node('attention', ['Core'], ['softmax']),
      node('softmax', ['Core']),
    ];
    // Five members, three sampled: softmax(2), attention(1), transformer(1).
    // gpt and zzz-obscure are referenced by nothing and fall out.
    const core = targets(nodes).find((t: Target) => t.key === 'Core');
    expect(core?.sample).toContain('softmax');
    expect(core?.sample).not.toContain('zzz-obscure');
  });

  it('builds a domain query from the samples, not the label alone', () => {
    const nodes = [node('softmax', ['Core']), node('attention', ['Core'], ['softmax'])];
    const core = targets(nodes).find((t: Target) => t.key === 'Core');
    expect(queryFor(core)).toContain('softmax');
  });

  it('switches to concept scope on request', () => {
    const t = targets([node('speculative-decoding', ['Inference'])], { concepts: true });
    expect(t).toEqual([{ scope: 'concept', key: 'speculative-decoding', title: 'speculative-decoding' }]);
    // No sample: a concept target is already as specific as it gets.
    expect(t[0]).not.toHaveProperty('sample');
  });
});

describe('inDegree counts who points at whom', () => {
  it('counts references across every edge kind, and zero for the unreferenced', () => {
    const d = inDegree([node('a', ['X'], ['b', 'c']), node('b', ['X'], ['c'])]);
    expect(d.get('c')).toBe(2);
    expect(d.get('b')).toBe(1);
    expect(d.get('a')).toBeUndefined();
  });
});

describe('queryFor asks a different question at each scope', () => {
  it('collapses whitespace when a domain has no samples', () => {
    expect(queryFor({ scope: 'domain', title: 'Alignment' })).toBe('Alignment explained');
  });
  it('asks about the concept itself at concept scope', () => {
    expect(queryFor({ scope: 'concept', title: 'attention' })).toBe('attention explained');
  });
});

describe('durationSeconds reads the shapes YouTube emits', () => {
  it.each([
    ['PT12M30S', 750],
    ['PT1H2M3S', 3723],
    ['PT45S', 45],
    ['PT2H', 7200],
  ])('%s → %i', (iso, secs) => {
    expect(durationSeconds(iso)).toBe(secs);
  });

  it('returns null rather than 0 for something it cannot read', () => {
    // 0 would score as "too short" and quietly bury the candidate. Null means
    // "unknown", which the scorer leaves alone.
    expect(durationSeconds('P1D')).toBeNull();
    expect(durationSeconds(undefined)).toBeNull();
  });
});

describe('score ranks plausibly and says why', () => {
  const target = { scope: 'domain' as const, title: 'Attention', key: 'Attention' };
  const base = {
    channelId: 'UC-unknown',
    title: 'Attention explained',
    author: 'Some Channel',
    durationSeconds: 900,
    views: '10000',
  };

  it('puts an allowlisted channel above an unknown one, all else equal', () => {
    const allowed = new Set(['UC-good']);
    const good = score({ ...base, channelId: 'UC-good' }, target, allowed);
    const unknown = score(base, target, allowed);
    expect(good.score).toBeGreaterThan(unknown.score);
    expect(good.reasons).toContain('allowlisted channel');
  });

  it('credits a named author even off the allowlist', () => {
    const r = score({ ...base, author: 'Andrej Karpathy' }, target, new Set());
    expect(r.reasons).toContain('named author');
  });

  it('penalises a short, and rewards a teachable length', () => {
    const short = score({ ...base, durationSeconds: 45 }, target, new Set());
    const teachable = score(base, target, new Set());
    expect(short.reasons).toContain('too short');
    expect(teachable.reasons).toContain('teachable length');
    expect(teachable.score).toBeGreaterThan(short.score);
  });

  it('does not let views outweigh relevance', () => {
    // A wildly popular video about nothing related must not outrank a modest
    // one that is actually on topic. This is the guard on that.
    const popularIrrelevant = score(
      { ...base, title: 'my holiday vlog', views: '900000000' },
      target,
      new Set(),
    );
    const modestRelevant = score({ ...base, views: '500' }, target, new Set());
    expect(modestRelevant.score).toBeGreaterThan(popularIrrelevant.score);
  });

  it('scores relevance against a domain’s samples, not just its label', () => {
    // The bug this guards: with only the label, a video titled "Research
    // Methods" scores full overlap on the domain "Methods" while teaching
    // nothing in it.
    const labelOnly = { scope: 'domain' as const, title: 'Core', key: 'Core' };
    const withSamples = { ...labelOnly, sample: ['Attention', 'Softmax'] };
    const onTopic = { ...base, title: 'Attention and Softmax, explained' };
    expect(score(onTopic, withSamples, new Set()).score).toBeGreaterThan(
      score(onTopic, labelOnly, new Set()).score,
    );
  });

  it('stays within 0..1', () => {
    const best = score(
      { ...base, channelId: 'UC-good', author: 'Andrej Karpathy', views: '99999999' },
      target,
      new Set(['UC-good']),
    );
    expect(best.score).toBeLessThanOrEqual(1);
    expect(best.score).toBeGreaterThanOrEqual(0);
  });
});
