import { describe, expect, it } from 'vitest';
import { neighborhood, resolveGraph, splitEmphasis, tierOf, type AuthoredNode } from './graph';

const node = (id: string, over: Partial<AuthoredNode> = {}): AuthoredNode => ({
  id,
  title: id,
  domain: ['Domain', 'Sub'],
  bodies: { intuition: 'i', engineer: 'e', math: 'm' },
  viz: { primitive: 'router-dispatch', params: {}, param_controls: [], caption: 'c' },
  edges: { requires: [], adjacent: [] },
  citations: [{ ref: 'r', title: 't', url: 'u' }],
  review: { reviewed_by: 'someone', reviewed_at: '2026-01-01' },
  updated_at: '2026-01-01',
  ...over,
});

describe('tierOf', () => {
  const cases = [
    { name: 'a reviewer makes it verified', input: node('a'), want: 'verified' },
    {
      name: 'no reviewer makes it frontier',
      input: node('b', { review: undefined, provenance: { drafted_at: '2026-01-01' } }),
      want: 'frontier',
    },
  ] as const;

  for (const c of cases) {
    it(c.name, () => expect(tierOf(c.input)).toBe(c.want));
  }
});

describe('resolveGraph', () => {
  it('inverts requires into unlocks on the target', () => {
    const g = resolveGraph([node('a', { edges: { requires: [{ id: 'b', reviewed: true }], adjacent: [] } }), node('b')]);

    expect(g.get('a')?.edges.requires.map((e) => e.id)).toEqual(['b']);
    expect(g.get('b')?.edges.unlocks.map((e) => e.id)).toEqual(['a']);
    // The inverse is derived, never authored — 'b' declares nothing.
    expect(g.get('b')?.edges.requires).toEqual([]);
  });

  it('carries the authored reviewed flag onto the derived inverse', () => {
    const g = resolveGraph([
      node('a', { edges: { requires: [{ id: 'b', reviewed: false }], adjacent: [] } }),
      node('b'),
    ]);
    expect(g.get('b')?.edges.unlocks[0]?.reviewed).toBe(false);
  });

  it('symmetrizes adjacency declared from one side only', () => {
    const g = resolveGraph([node('a', { edges: { requires: [], adjacent: [{ id: 'b', reviewed: true }] } }), node('b')]);
    expect(g.get('a')?.edges.adjacent.map((e) => e.id)).toEqual(['b']);
    expect(g.get('b')?.edges.adjacent.map((e) => e.id)).toEqual(['a']);
  });

  it('does not duplicate adjacency declared from both sides', () => {
    const g = resolveGraph([
      node('a', { edges: { requires: [], adjacent: [{ id: 'b', reviewed: true }] } }),
      node('b', { edges: { requires: [], adjacent: [{ id: 'a', reviewed: true }] } }),
    ]);
    expect(g.get('a')?.edges.adjacent).toHaveLength(1);
    expect(g.get('b')?.edges.adjacent).toHaveLength(1);
  });

  it('denormalizes the target title and tier onto the edge', () => {
    const g = resolveGraph([
      node('a', { edges: { requires: [{ id: 'b', reviewed: true }], adjacent: [] } }),
      node('b', { title: 'Bee', review: undefined, provenance: { drafted_at: '2026-01-01' } }),
    ]);
    expect(g.get('a')?.edges.requires[0]).toMatchObject({ title: 'Bee', tier: 'frontier' });
  });

  it('resolves contradictory two-sided adjacency to unreviewed', () => {
    // Keeping the first arrival would resolve this on slug order, and half the
    // time render an explicitly unchecked claim as a solid, verified edge.
    const g = resolveGraph([
      node('a', { edges: { requires: [], adjacent: [{ id: 'b', reviewed: true }] } }),
      node('b', { edges: { requires: [], adjacent: [{ id: 'a', reviewed: false }] } }),
    ]);
    expect(g.get('a')?.edges.adjacent[0]?.reviewed).toBe(false);
    expect(g.get('b')?.edges.adjacent[0]?.reviewed).toBe(false);
  });

  const twoWays = [
    {
      name: 'one target in two authored groups',
      nodes: [
        node('a', { edges: { requires: [{ id: 'b', reviewed: true }], adjacent: [{ id: 'b', reviewed: true }] } }),
        node('b'),
      ],
    },
    {
      name: 'a mutual requires, which is a circular prerequisite',
      nodes: [
        node('a', { edges: { requires: [{ id: 'b', reviewed: true }], adjacent: [] } }),
        node('b', { edges: { requires: [{ id: 'a', reviewed: true }], adjacent: [] } }),
      ],
    },
    {
      name: 'a prerequisite that the other side calls adjacent',
      nodes: [
        node('a', { edges: { requires: [{ id: 'b', reviewed: true }], adjacent: [] } }),
        node('b', { edges: { requires: [], adjacent: [{ id: 'a', reviewed: true }] } }),
      ],
    },
  ] as const;

  for (const c of twoWays) {
    // Each of these would place one concept twice in the mini-map, at two
    // coordinates, leaving a line on the wrong circle and a circle orphaned.
    it(`throws on ${c.name}`, () => {
      expect(() => resolveGraph([...c.nodes])).toThrow(/related in two ways at once/);
    });
  }

  it('throws on an edge to a node that does not exist', () => {
    expect(() => resolveGraph([node('a', { edges: { requires: [{ id: 'ghost', reviewed: true }], adjacent: [] } })])).toThrow(
      /"ghost", which does not exist/,
    );
  });

  it('never emits a stored tier or authored unlocks back onto the node', () => {
    const g = resolveGraph([node('a')]);
    const resolved = g.get('a');
    expect(resolved?.tier).toBe('verified');
    expect(Object.keys(resolved?.edges ?? {}).sort()).toEqual(['adjacent', 'requires', 'unlocks']);
  });
});

describe('neighborhood', () => {
  const graph = resolveGraph([
    node('center', {
      edges: { requires: [{ id: 'req', reviewed: true }], adjacent: [{ id: 'adj', reviewed: true }] },
    }),
    node('req'),
    node('adj'),
    node('unl', { edges: { requires: [{ id: 'center', reviewed: false }], adjacent: [] } }),
  ]);

  it('places requires left of centre and unlocks right', () => {
    const n = neighborhood(graph, 'center');
    const req = n.nodes.find((x) => x.id === 'req');
    const unl = n.nodes.find((x) => x.id === 'unl');
    expect(req?.x).toBeLessThan(n.center.x);
    expect(unl?.x).toBeGreaterThan(n.center.x);
  });

  it('keeps every node inside the 240x132 viewBox', () => {
    const n = neighborhood(graph, 'center');
    for (const p of [n.center, ...n.nodes]) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(240);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(132);
    }
  });

  it('is deterministic — the same graph yields identical coordinates', () => {
    expect(neighborhood(graph, 'center')).toEqual(neighborhood(graph, 'center'));
  });

  it('names link endpoints by id, so the API payload can replace this one', () => {
    const n = neighborhood(graph, 'center');
    const ids = new Set([n.center.id, ...n.nodes.map((x) => x.id)]);
    for (const link of n.links) {
      expect(ids.has(link.from), `link from "${link.from}" has no node`).toBe(true);
      expect(ids.has(link.to), `link to "${link.to}" has no node`).toBe(true);
    }
  });

  it('points a prerequisite inwards and an unlocked concept outwards', () => {
    const n = neighborhood(graph, 'center');
    expect(n.links.find((l) => l.type === 'requires')).toMatchObject({ from: 'req', to: 'center' });
    expect(n.links.find((l) => l.type === 'unlocks')).toMatchObject({ from: 'center', to: 'unl' });
  });

  it('marks an unreviewed edge so the mini-map can dash it', () => {
    const n = neighborhood(graph, 'center');
    expect(n.links.some((l) => !l.reviewed)).toBe(true);
  });

  it('throws on an unknown node', () => {
    expect(() => neighborhood(graph, 'nope')).toThrow(/unknown node/);
  });
});

describe('splitEmphasis', () => {
  const cases = [
    { name: 'splits around the phrase', body: 'a b c', phrase: 'b', want: ['a ', 'b', ' c'] },
    { name: 'no phrase leaves the body whole', body: 'a b c', phrase: undefined, want: ['a b c', '', ''] },
    { name: 'a phrase that no longer matches degrades to plain text', body: 'a b c', phrase: 'zz', want: ['a b c', '', ''] },
    { name: 'splits on the first occurrence only', body: 'x y x', phrase: 'x', want: ['', 'x', ' y x'] },
  ] as const;

  for (const c of cases) {
    it(c.name, () => expect(splitEmphasis(c.body, c.phrase)).toEqual(c.want));
  }
});
