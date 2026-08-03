/**
 * The committed lemniscate layout (#52, ADR-0003).
 *
 * The landing page used to choose its own beads — `allNodes.filter(tier)
 * .slice(0, 3)`, alphabetically first — under a comment claiming the layout was
 * already committed. It was not, and the right lobe read Adam / AdamW / ALiBi.
 *
 * Read from /content the same way nodes are: via `node:fs` resolved from
 * `process.cwd()`, not `import.meta.url`, which points at the bundled chunk
 * during `astro build` and fails only there.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ResolvedNode, Tier } from './graph';

export interface LayoutBead {
  id: string;
  /** Where along the lobe, 0–1. Resolved through the curve module. */
  t: number;
  label: boolean;
}

export interface Layout {
  left: LayoutBead[];
  right: LayoutBead[];
  chips: string[];
}

/** A bead joined to the concept it names. */
export interface PlacedBead extends LayoutBead {
  title: string;
  tier: Tier;
}

const LAYOUT_PATH = join(resolve(process.cwd(), '..'), 'content/layout/lemniscate.json');

function isBead(value: unknown): value is LayoutBead {
  if (typeof value !== 'object' || value === null) return false;
  const b = value as Record<string, unknown>;
  return (
    typeof b.id === 'string' &&
    typeof b.t === 'number' &&
    b.t >= 0 &&
    b.t <= 1 &&
    typeof b.label === 'boolean'
  );
}

/**
 * Reads and shape-checks the layout.
 *
 * Throws rather than degrading: this runs at build time, and a landing page
 * that quietly fell back to alphabetical order is the exact state #52 exists to
 * end. Failing the build is the loud version.
 */
export function readLayout(path: string = LAYOUT_PATH): Layout {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

  for (const lobe of ['left', 'right'] as const) {
    if (!Array.isArray(raw[lobe]) || !raw[lobe].every(isBead)) {
      throw new Error(`${path}: "${lobe}" must be an array of { id, t: 0–1, label }`);
    }
  }
  if (!Array.isArray(raw.chips) || !raw.chips.every((c) => typeof c === 'string')) {
    throw new Error(`${path}: "chips" must be an array of concept ids`);
  }

  return { left: raw.left as LayoutBead[], right: raw.right as LayoutBead[], chips: raw.chips as string[] };
}

/** The layout joined to the concepts it names, ready to render. */
export function placeLayout(layout: Layout, nodes: ResolvedNode[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const join = (beads: LayoutBead[]): PlacedBead[] =>
    beads.map((bead) => {
      const node = byId.get(bead.id);
      if (!node) throw new Error(`lemniscate layout names "${bead.id}", which does not exist`);
      return { ...bead, title: node.title, tier: node.tier };
    });

  return {
    left: join(layout.left),
    right: join(layout.right),
    chips: layout.chips.map((id) => {
      const node = byId.get(id);
      if (!node) throw new Error(`lemniscate chips name "${id}", which does not exist`);
      return node;
    }),
  };
}
