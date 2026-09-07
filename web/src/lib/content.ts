/**
 * Loads the authored concept nodes from /content/nodes at build time.
 *
 * Read straight off disk rather than through Vite's glob: the content lives
 * outside /web on purpose (it is the canonical graph, not a web asset), and
 * every route pre-renders, so this only ever runs during the build.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { resolveGraph, type AuthoredNode, type ResolvedNode } from './graph';

// Resolved from the working directory, NOT from import.meta.url. During
// `astro build` this module is bundled into dist/.prerender/chunks/, so
// import.meta.url points at the emitted chunk and a source-relative path lands
// in the wrong place — it fails only at build, never in dev. Astro always runs
// with cwd = /web, so this is stable in both.
const NODES_DIR = resolve(process.cwd(), '../content/nodes');

function loadAuthored(): AuthoredNode[] {
  return readdirSync(NODES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const node = JSON.parse(readFileSync(join(NODES_DIR, f), 'utf8')) as AuthoredNode;
      if (node.id !== basename(f, '.json')) {
        throw new Error(`node id "${node.id}" does not match its filename "${f}"`);
      }
      return node;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** The resolved graph — tier derived, unlocks inverted, adjacency symmetrized. */
export const graph: Map<string, ResolvedNode> = resolveGraph(loadAuthored());

export const allNodes: ResolvedNode[] = [...graph.values()];

export function nodeOrThrow(id: string): ResolvedNode {
  const node = graph.get(id);
  if (!node) throw new Error(`unknown node "${id}"`);
  return node;
}

/**
 * Landing-page stats. ADR-0003: these ship as build-time values so the pulse
 * line never renders empty. The refresh that ADR describes never happens — the
 * landing page settled at zero JavaScript, so these values are the only ones it
 * ever shows, and `/` is served must-revalidate so they are never more than one
 * deploy old (#353).
 */
export function stats(): { concepts: number; grewThisWeek: number; frontier: number } {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const frontier = allNodes.filter((n) => n.tier === 'frontier');
  return {
    concepts: allNodes.length,
    // Frontier nodes touched in the last week — new growth that ARRIVED
    // recently, which is a narrower thing than the frontier existing. Zero here
    // is routine and does not mean the corpus is fully reviewed; `frontier`
    // below is the count that does (ADR-0015).
    grewThisWeek: frontier.filter((n) => Date.parse(n.updated_at) >= weekAgo).length,
    frontier: frontier.length,
  };
}
