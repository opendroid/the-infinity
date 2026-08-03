import { describe, expect, it } from 'vitest';
import { drawableLinks, hitRadius, isNeighborhood } from './MiniMap';
import type { Neighborhood } from '../lib/graph';

const valid: Neighborhood = {
  center: { id: 'moe', title: 'Mixture-of-Experts', tier: 'verified', x: 120, y: 66 },
  nodes: [{ id: 'ffn', title: 'Feed-Forward Network', tier: 'verified', x: 40, y: 66 }],
  links: [{ from: 'ffn', to: 'moe', type: 'requires', reviewed: true }],
};

/**
 * The guard is the whole risk of this component. The build-time map on screen is
 * already correct as of the last deploy; swapping in a malformed payload would
 * replace something right with something broken, and "the API returned 200" is
 * not the same claim as "the API returned a neighbourhood".
 */
describe('isNeighborhood', () => {
  it('accepts a real payload', () => {
    expect(isNeighborhood(valid)).toBe(true);
  });

  it('accepts a lone node with no edges', () => {
    expect(isNeighborhood({ ...valid, nodes: [], links: [] })).toBe(true);
  });

  const rejected: { name: string; value: unknown }[] = [
    { name: 'null', value: null },
    { name: 'a string', value: 'nope' },
    { name: 'an empty object', value: {} },
    { name: 'a missing centre', value: { nodes: [], links: [] } },
    {
      name: 'nodes that are not an array',
      value: { ...valid, nodes: {} },
    },
    {
      // The failure that motivated the guard: a tier outside the two the design
      // knows would index FILL to undefined and render an invisible node.
      name: 'an unknown tier',
      value: { ...valid, nodes: [{ ...valid.nodes[0], tier: 'provisional' }] },
    },
    {
      // Coordinates arriving as strings would concatenate into the SVG and
      // silently place nothing.
      name: 'coordinates as strings',
      value: { ...valid, center: { ...valid.center, x: '120' } },
    },
    {
      name: 'a NaN coordinate',
      value: { ...valid, center: { ...valid.center, y: Number.NaN } },
    },
    {
      name: 'a link missing an endpoint',
      value: { ...valid, links: [{ from: 'ffn', type: 'requires', reviewed: true }] },
    },
    {
      name: 'reviewed as a string',
      value: { ...valid, links: [{ ...valid.links[0], reviewed: 'true' }] },
    },
  ];

  for (const c of rejected) {
    it(`rejects ${c.name}`, () => {
      expect(isNeighborhood(c.value)).toBe(false);
    });
  }
});

describe('drawableLinks', () => {
  it('resolves both ends to points', () => {
    const [link] = drawableLinks(valid);
    expect(link?.from).toMatchObject({ x: 40, y: 66 });
    expect(link?.to).toMatchObject({ x: 120, y: 66 });
  });

  it('drops a link whose endpoint is not in the map', () => {
    // Rather than drawing to (0,0), which puts a line through the corner of the
    // box and reads as a real edge to something that is not there.
    const orphaned: Neighborhood = {
      ...valid,
      links: [...valid.links, { from: 'ghost', to: 'moe', type: 'requires', reviewed: true }],
    };
    expect(drawableLinks(orphaned)).toHaveLength(1);
  });

  it('carries the reviewed flag through, since it is what dashes the line', () => {
    const unreviewed: Neighborhood = {
      ...valid,
      links: [{ from: 'ffn', to: 'moe', type: 'requires', reviewed: false }],
    };
    expect(drawableLinks(unreviewed)[0]?.reviewed).toBe(false);
  });
});

describe('hitRadius keeps the boundary between targets at the midpoint', () => {
  // The API spaces a column as 132 * (i+1)/(n+1). The node count is whatever
  // the concept has — three neighbours on mixture-of-experts, six on
  // self-attention — so the spacing is not a constant to design against.
  const column = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ x: 40, y: Math.round((132 * (i + 1)) / (n + 1)) }));

  it('uses the full radius when nodes are far apart', () => {
    // Today's densest column is four (causal-masking), 26px apart.
    expect(hitRadius(column(4))).toBe(11);
  });

  it('shrinks rather than overlap once a column gets dense', () => {
    // Six in a column sit ~19px apart, so r=11 overlaps. Verified in a browser
    // that this does NOT mislabel the dots themselves — it decides the region
    // between them by draw order instead of by proximity.
    const r = hitRadius(column(6));
    expect(r).toBeLessThan(11);
    expect(r * 2).toBeLessThanOrEqual(132 / 7 + 0.01);
  });

  it('never lets two targets overlap, at any count', () => {
    for (let n = 1; n <= 12; n++) {
      const points = column(n);
      const r = hitRadius(points);
      for (let i = 1; i < points.length; i++) {
        const gap = points[i]!.y - points[i - 1]!.y;
        expect(2 * r).toBeLessThanOrEqual(gap + 0.01);
      }
    }
  });

  it('handles a lone node, where there is nothing to collide with', () => {
    expect(hitRadius([{ x: 120, y: 66 }])).toBe(11);
    expect(hitRadius([])).toBe(11);
  });
});
