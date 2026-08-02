import { describe, expect, it } from 'vitest';
import { drawableLinks, isNeighborhood } from './MiniMap';
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
