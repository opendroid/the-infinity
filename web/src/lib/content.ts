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
 * line never renders empty; GET /v1/stats refreshes them after hydration.
 */
export function stats(): { concepts: number; grewThisWeek: number } {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return {
    concepts: allNodes.length,
    grewThisWeek: allNodes.filter(
      (n) => n.tier === 'frontier' && Date.parse(n.updated_at) >= weekAgo,
    ).length,
  };
}
