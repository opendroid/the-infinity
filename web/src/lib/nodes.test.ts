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

  it('has at least one node of each tier, so both colours are exercised', () => {
    const graph = resolveGraph(nodes.map((n) => n.node));
    const tiers = new Set([...graph.values()].map((n) => n.tier));
    expect([...tiers].sort()).toEqual(['frontier', 'verified']);
  });
});
