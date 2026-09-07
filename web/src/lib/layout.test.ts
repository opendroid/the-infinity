/**
 * The lemniscate layout at every lobe size, including the ones a corpus reaches
 * only when someone has finished reviewing it.
 *
 * ADR-0015 made an empty frontier a state rather than a build failure. #283's
 * acceptance criteria asked that the empty and one-bead cases be CHECKED rather
 * than assumed, because the three-bead case was the only one anything had ever
 * rendered — the two guards that used to break the build meant the others could
 * not occur.
 */
import { describe, expect, it } from 'vitest';
import { placeLayout, type Layout } from './layout';
import type { ResolvedNode } from './graph';

const node = (id: string, title: string, tier: 'verified' | 'frontier') =>
  ({ id, title, tier, domain: ['Foundations', 'Optimization'] }) as unknown as ResolvedNode;

const corpus = [
  node('a', 'Alpha', 'verified'),
  node('b', 'Beta', 'verified'),
  node('c', 'Gamma', 'verified'),
  node('x', 'Xi', 'frontier'),
];

const layout = (right: Layout['right']): Layout => ({
  left: [
    { id: 'a', t: 0.2, label: true },
    { id: 'b', t: 0.5, label: false },
    { id: 'c', t: 0.8, label: true },
  ],
  right,
  chips: ['a'],
});

describe('the lemniscate at every lobe size', () => {
  it('places an empty right lobe, which is what a fully reviewed corpus renders', () => {
    const placed = placeLayout(layout([]), corpus);
    expect(placed.right).toEqual([]);
    // The left lobe is untouched: the figure still has its reviewed core, and
    // Thread.astro draws the stroke from the curve rather than from the beads.
    expect(placed.left).toHaveLength(3);
  });

  it('places a single frontier bead', () => {
    const placed = placeLayout(layout([{ id: 'x', t: 0.5, label: true }]), corpus);
    expect(placed.right).toHaveLength(1);
    expect(placed.right[0]).toMatchObject({ id: 'x', title: 'Xi', tier: 'frontier' });
  });

  it('still refuses a bead naming a concept that does not exist, at any size', () => {
    expect(() => placeLayout(layout([{ id: 'ghost', t: 0.5, label: true }]), corpus)).toThrow(
      /lemniscate layout names "ghost"/,
    );
  });
});
