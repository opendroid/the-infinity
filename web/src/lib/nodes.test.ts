/**
 * Shape and invariant checks over the real nodes in /content/nodes.
 *
 * These are the ADR-0002 rules made executable. Without them the decisions live
 * only in a document, and the first node authored from memory drifts.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveGraph, type AuthoredNode } from './graph';

const NODES_DIR = resolve(process.cwd(), '../content/nodes');

const files = readdirSync(NODES_DIR).filter((f) => f.endsWith('.json'));
const nodes: { file: string; node: AuthoredNode & Record<string, unknown> }[] = files.map((file) => ({
  file,
  node: JSON.parse(readFileSync(join(NODES_DIR, file), 'utf8')),
}));

describe('content/nodes', () => {
  it('has nodes to check', () => {
    expect(nodes.length).toBeGreaterThan(0);
  });

  /**
   * EVERY PAGE OFFERS SOMEWHERE TO GO THAT IS NOT BACK.
   *
   * CLAUDE.md's third principle is that the graph never dead-ends. A page with
   * ONE link satisfies that in letter and fails it in practice: a reader arrived
   * from somewhere, and if the only thread to pull is the one they arrived by,
   * the page is a cul-de-sac with a return path.
   *
   * REACHABILITY IS UNDIRECTED, WHICH IS EASY TO GET WRONG. `graph.ts` inverts
   * `requires` into `unlocks` and symmetrises `adjacent`, so every authored edge
   * puts each endpoint on the other's page. Counting authored direction instead
   * suggests 103 nodes "nothing points at", and that number is an artefact — all
   * 103 are reachable. This counts both ends of each edge, which is what a reader
   * can actually click.
   *
   * THE FLOOR WAS TWO AND IS NOW THREE (#317). #277 raised it to two and left
   * three open, on the honest ground that nobody knew whether the 56 nodes then
   * at the floor had a real third link or would need padding. #315 answered
   * that by finding one for all 38 that remained — every target taken from the
   * node's OWN BODY rather than from what sat nearby in the domain tree, which
   * changed five of the picks. None had to be invented.
   *
   *     links      #277        after #315
   *       1           2   ->      0
   *       2          54   ->      0
   *       3         117   ->    197
   *       4          82   ->    103
   *       5          54   ->     55
   *       6+        111   ->    126
   *      21           -          1
   *
   * SO THIS RAISE CHANGES NOTHING TODAY, which is the point. It is the same
   * guard the floor of two always was — the corpus cleared two before that
   * assertion existed too. What it stops is the next node shipping with two
   * links, one of them the way in, which #315 found happens by default: an
   * author names the neighbours they had in mind and nothing goes back to add
   * the reverse links a later node should have made. `elo-rating` shipped three
   * rounds ago and nothing linked into it until #315.
   *
   * FOUR IS NOT THE NEXT STEP. 197 nodes sit at exactly three, so raising again
   * would be a corpus-wide authoring pass rather than a guard, and there is no
   * evidence a third onward thread is too few. Deliberately not proposed.
   */
  it('gives every concept at least three links a reader can follow', () => {
    const degree = new Map<string, number>();
    const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1);
    for (const { node } of nodes) {
      for (const type of ['requires', 'adjacent'] as const) {
        for (const edge of node.edges[type]) {
          bump(node.id);
          bump(edge.id);
        }
      }
    }
    const lonely = nodes.map(({ node }) => node.id).filter((id) => (degree.get(id) ?? 0) < 3);
    expect(lonely).toEqual([]);
  });

  describe.each(nodes)('$file', ({ file, node }) => {
    it('id matches the filename, because the id is the URL', () => {
      expect(node.id).toBe(basename(file, '.json'));
    });

    it('is kebab-case', () => {
      expect(node.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    });

    it('does not store tier — it is derived from `review` (ADR-0002)', () => {
      expect(node).not.toHaveProperty('tier');
    });

    it('does not author unlocks — it is inverted from requires (ADR-0002)', () => {
      expect(node.edges).not.toHaveProperty('unlocks');
    });

    it('carries exactly one of review / provenance, agreeing with its tier', () => {
      expect([Boolean(node.review), Boolean(node.provenance)].filter(Boolean)).toHaveLength(1);
    });

    it('keeps citations top-level and tier-independent (ADR-0002)', () => {
      expect(Array.isArray(node.citations)).toBe(true);
      expect(node.citations.length).toBeGreaterThan(0);
      expect(node.provenance ?? {}).not.toHaveProperty('sources');
    });

    it('cites resolvable URLs', () => {
      for (const citation of node.citations) {
        expect(citation.url).toMatch(/^https:\/\//);
      }
    });

    it('has a two-level domain path', () => {
      expect(node.domain).toHaveLength(2);
    });

    it('ships all three depth bodies', () => {
      for (const depth of ['intuition', 'engineer', 'math'] as const) {
        expect(node.bodies[depth]?.length ?? 0).toBeGreaterThan(0);
      }
    });

    it('emphasises a verbatim substring of the body it belongs to', () => {
      for (const [depth, phrase] of Object.entries(node.emphasis ?? {})) {
        expect(node.bodies[depth as 'intuition']).toContain(phrase);
      }
    });

    it('exposes at most one draggable viz parameter', () => {
      expect(node.viz.param_controls.length).toBeLessThanOrEqual(1);
    });

    it('names a viz parameter that actually exists', () => {
      for (const control of node.viz.param_controls) {
        expect(Object.keys(node.viz.params)).toContain(control.name);
      }
    });

    it('marks every edge as reviewed or not', () => {
      for (const edge of [...node.edges.requires, ...node.edges.adjacent]) {
        expect(typeof edge.reviewed).toBe('boolean');
      }
    });

    it('uses updated_at, not updated', () => {
      expect(node.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(node).not.toHaveProperty('updated');
    });
  });

  it('resolves without a dangling edge', () => {
    expect(() => resolveGraph(nodes.map((n) => n.node))).not.toThrow();
  });

  it('exercises the empty-edge-group state on at least one node', () => {
    const graph = resolveGraph(nodes.map((n) => n.node));
    const anyEmpty = [...graph.values()].some(
      (n) => n.edges.requires.length === 0 || n.edges.unlocks.length === 0,
    );
    expect(anyEmpty).toBe(true);
  });

  /**
   * Both tier colours have a node, so both are exercised.
   *
   * THIS IS ONE OF THE TWO PLACES AN EMPTY FRONTIER BREAKS THE BUILD (#283).
   * The other is the lemniscate check in `validate-content.mjs`. Verifying the
   * last frontier batch takes the corpus to zero frontier nodes and fails both,
   * which is why a verification cannot land without a seed beside it.
   *
   * That coupling is deliberate as far as it goes — the landing page's argument
   * is reviewed core flowing into new growth, and there is no defined
   * appearance for the figure with nothing growing. Whether steady state should
   * be representable is the open question; this assertion is not the place to
   * settle it, only the place it is felt.
   */
  it('has at least one node of each tier, so both colours are exercised', () => {
    const graph = resolveGraph(nodes.map((n) => n.node));
    const tiers = new Set([...graph.values()].map((n) => n.tier));
    expect([...tiers].sort(), 'an empty frontier also fails validate:content — see #283').toEqual([
      'frontier',
      'verified',
    ]);
  });
});
