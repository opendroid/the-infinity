import { describe, expect, it } from 'vitest';
import { blurb, directory, tally } from './directory';
import { allNodes } from './content';
import type { ResolvedNode } from './graph';

const node = (id: string, title: string, domain: string[], tier: 'verified' | 'frontier') =>
  ({
    id,
    title,
    domain,
    tier,
    bodies: { intuition: `What ${title} is. A second sentence.`, engineer: '', math: '' },
  }) as unknown as ResolvedNode;

describe('directory groups by the authored domain path', () => {
  const nodes = [
    node('b', 'Beta', ['Attention', 'Core'], 'frontier'),
    node('a', 'Alpha', ['Attention', 'Core'], 'verified'),
    node('z', 'Zeta', ['Attention', 'Position'], 'frontier'),
    node('m', 'Mu', ['Optimization', 'Training'], 'frontier'),
  ];

  it('makes one group per first level', () => {
    expect(directory(nodes).map((g) => g.name)).toEqual(['Attention', 'Optimization']);
  });

  it('makes one section per second level', () => {
    const [attention] = directory(nodes);
    expect(attention!.sections.map((s) => s.name)).toEqual(['Core', 'Position']);
  });

  it('counts across sections, not per section', () => {
    expect(directory(nodes)[0]!.count).toBe(3);
  });

  it('sorts groups, sections and entries by name', () => {
    // An index whose order changes between builds is not a reference.
    const [attention] = directory(nodes);
    expect(attention!.sections[0]!.entries.map((e) => e.title)).toEqual(['Alpha', 'Beta']);
  });

  it('is stable regardless of input order', () => {
    const shuffled = [nodes[3]!, nodes[1]!, nodes[2]!, nodes[0]!];
    expect(directory(shuffled)).toEqual(directory(nodes));
  });

  it('carries tier through, since the index is where 54 frontier nodes are legible at a glance', () => {
    const [attention] = directory(nodes);
    expect(attention!.sections[0]!.entries.map((e) => e.tier)).toEqual(['verified', 'frontier']);
  });

  it('parks a malformed domain somewhere visible rather than dropping it', () => {
    // The schema forbids this; the index still must not silently lose a node.
    const odd = [node('x', 'Odd', [], 'frontier')];
    const groups = directory(odd);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.sections[0]!.entries[0]!.id).toBe('x');
  });

  it('returns nothing for nothing', () => {
    expect(directory([])).toEqual([]);
  });
});

describe('blurb', () => {
  it('takes the first sentence', () => {
    expect(blurb('One thing. Then another thing entirely.')).toBe('One thing.');
  });

  it('truncates a long first sentence on a word boundary', () => {
    const long = `${'word '.repeat(40)}end.`;
    const out = blurb(long);
    expect(out.length).toBeLessThanOrEqual(119);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/wor…$/);
  });

  it('handles a body with no sentence break', () => {
    expect(blurb('no full stop here')).toBe('no full stop here');
  });

  it('does not leave a dangling comma before the ellipsis', () => {
    const out = blurb(`${'a'.repeat(100)}, and then more words that push past the limit.`);
    expect(out).not.toContain(',…');
  });
});

describe('over the real graph', () => {
  const groups = directory(allNodes);

  it('lists every published concept exactly once', () => {
    // The index cannot omit a concept that exists, nor invent one that does not.
    const listed = groups.flatMap((g) => g.sections.flatMap((s) => s.entries.map((e) => e.id)));
    expect(listed.slice().sort()).toEqual(allNodes.map((n) => n.id).slice().sort());
  });

  it('agrees with the graph on the totals', () => {
    const t = tally(groups);
    expect(t.concepts).toBe(allNodes.length);
    expect(t.verified + t.frontier).toBe(allNodes.length);
  });

  it('gives every entry a non-empty blurb', () => {
    for (const g of groups) {
      for (const s of g.sections) {
        for (const e of s.entries) expect(e.blurb.length).toBeGreaterThan(10);
      }
    }
  });
});
