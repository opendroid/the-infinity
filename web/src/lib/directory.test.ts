import { describe, expect, it } from 'vitest';
import { blurb, directory, domainRoutes, slugFor, tally } from './directory';
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

describe('a domain is a route (#509, ADR-0024)', () => {
  const grouped = (names: string[]) =>
    directory(names.map((n, i) => node(`c${i}`, `C${i}`, [n, 'Core'], 'verified')));

  it('turns a domain name into its URL segment', () => {
    expect(slugFor('Foundations')).toBe('foundations');
    expect(slugFor('Dense Prediction')).toBe('dense-prediction');
    expect(slugFor('Multi-modal')).toBe('multi-modal');
  });

  it('derives a path, a count and the sections beneath it', () => {
    const routes = domainRoutes(grouped(['Attention', 'Attention', 'Systems']));
    expect(routes.map((r) => r.path)).toEqual(['/concepts/attention', '/concepts/systems']);
    expect(routes[0]?.count).toBe(2);
    expect(routes[0]?.sections).toEqual(['Core']);
  });

  it('refuses two domains that slug the same, rather than losing one silently', () => {
    // THE PLANT, AND THE REASON THIS THROWS. getStaticPaths would emit one path
    // for both, one domain would vanish from the site, and the directory card
    // would still count it as present. Nothing else in the build notices.
    expect(() => domainRoutes(grouped(['Multi-modal', 'Multi modal']))).toThrow(
      /both slug to "multi-modal"/,
    );
  });

  it('refuses a name with no usable segment, which would claim the directory itself', () => {
    expect(() => domainRoutes(grouped(['///']))).toThrow(/no usable URL segment/);
  });

  it('covers every domain in the real corpus, with no collisions', () => {
    // The guard above is only worth having if it is actually exercised against
    // what ships. 47 domains today; this fails the day one is authored that
    // collides with another.
    const routes = domainRoutes(directory(allNodes));
    expect(routes.length).toBeGreaterThan(40);
    expect(new Set(routes.map((r) => r.slug)).size).toBe(routes.length);
    expect(routes.reduce((n, r) => n + r.count, 0)).toBe(allNodes.length);
  });
});
