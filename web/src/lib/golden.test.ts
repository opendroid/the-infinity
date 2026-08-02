/**
 * The other half of the derivation contract.
 *
 * `/content/derived.golden.json` is written by the Go publish tool — the thing
 * that produces what the API serves. This asserts that graph.ts, which produces
 * what the pre-rendered pages show, derives exactly the same values from exactly
 * the same nodes.
 *
 * Two implementations of one derivation is not an accident to be tidied up
 * later: the static page must render without calling the API (ADR-0003), and the
 * API must answer without a Node runtime. What the arrangement cannot survive is
 * the two quietly disagreeing — a reader would see a page whose edge list and
 * mini-map describe different graphs. So they meet on one file, and changing
 * either side alone turns a test red.
 *
 * If this fails after a content edit, regenerate: `cd api && make golden`.
 * If it fails after a derivation change, the other side needs the same change.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allNodes, graph } from './content';
import { neighborhood, type MiniMapLink, type MiniMapNode, type ResolvedEdge, type Tier } from './graph';

interface GoldenConcept {
  id: string;
  title: string;
  domain: string;
  tier: Tier;
  edges: { requires: ResolvedEdge[]; unlocks: ResolvedEdge[]; adjacent: ResolvedEdge[] };
}

interface GoldenNeighborhood {
  id: string;
  center: MiniMapNode;
  nodes: MiniMapNode[];
  links: MiniMapLink[];
}

interface GoldenFile {
  concepts: GoldenConcept[];
  neighborhoods: GoldenNeighborhood[];
}

// Resolved from cwd, like content.ts — vitest and astro both run from /web.
const GOLDEN_PATH = resolve(process.cwd(), '../content/derived.golden.json');
const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as GoldenFile;

const stale = (what: string) =>
  `${what} does not match content/derived.golden.json. ` +
  'If the content changed, regenerate with `cd api && make golden`. ' +
  'If the derivation changed, api/internal/publish needs the same change.';

describe('the derivation matches the publish tool', () => {
  it('covers every node, so neither side can pass by omitting one', () => {
    expect(golden.concepts.map((c) => c.id)).toEqual(allNodes.map((n) => n.id));
    expect(golden.neighborhoods.map((n) => n.id)).toEqual(allNodes.map((n) => n.id));
  });

  it('derives the same tier, domain path, and edges', () => {
    const derived: GoldenConcept[] = allNodes.map((n) => ({
      id: n.id,
      title: n.title,
      // The served `domain` is a string; the authored one is a two-level path.
      domain: n.domain.join(' / '),
      tier: n.tier,
      edges: n.edges,
    }));

    expect(derived, stale('the resolved graph')).toEqual(golden.concepts);
  });

  it('lays every mini-map out on the same coordinates', () => {
    const derived: GoldenNeighborhood[] = allNodes.map((n) => ({
      id: n.id,
      ...neighborhood(graph, n.id),
    }));

    expect(derived, stale('the mini-map layout')).toEqual(golden.neighborhoods);
  });
});
