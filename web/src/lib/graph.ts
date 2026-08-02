/**
 * Build-time derivation over the authored nodes in /content/nodes.
 *
 * This is a miniature of the publish tool that lands in Phase 4, and it exists
 * because ADR-0002 deliberately does *not* store what can be computed:
 *
 *   - `tier` is derived from the presence of `review`, so a verified node with
 *     no reviewer is unrepresentable rather than merely detectable.
 *   - `unlocks` is inverted from `requires`, so the same fact cannot be written
 *     in two files that disagree.
 *   - `adjacent` is symmetrized, so it can be declared from whichever side
 *     reads naturally.
 *
 * Mini-map coordinates are computed here too (ADR-0003): deterministic
 * placement by edge type, no force simulation, so the map is byte-identical
 * across builds unless the graph actually changed.
 */

export type Depth = 'intuition' | 'engineer' | 'math';
export type Tier = 'verified' | 'frontier';
export type EdgeType = 'requires' | 'unlocks' | 'adjacent';

/** An edge as authored: a target id plus whether a human checked the claim. */
export interface AuthoredEdge {
  id: string;
  reviewed: boolean;
}

export interface Citation {
  ref: string;
  title: string;
  url: string;
}

export interface AuthoredNode {
  id: string;
  title: string;
  domain: string[];
  bodies: Record<Depth, string>;
  emphasis?: Partial<Record<Depth, string>>;
  viz: {
    primitive: string;
    params: Record<string, number>;
    param_controls: { name: string; min: number; max: number; step: number }[];
    caption: string;
    /** Replaces `caption` at the Engineer depth. Absent means "use `caption`" (ADR-0005). */
    caption_engineer?: string;
  };
  edges: { requires: AuthoredEdge[]; adjacent: AuthoredEdge[] };
  citations: Citation[];
  review?: { reviewed_by: string; reviewed_at: string };
  provenance?: { drafted_at: string };
  updated_at: string;
}

/** An edge as served: denormalized with the target's title and tier. */
export interface ResolvedEdge {
  id: string;
  title: string;
  tier: Tier;
  reviewed: boolean;
}

export interface ResolvedNode extends Omit<AuthoredNode, 'edges'> {
  tier: Tier;
  edges: Record<EdgeType, ResolvedEdge[]>;
}

export interface MiniMapNode {
  id: string;
  title: string;
  tier: Tier;
  x: number;
  y: number;
}

/**
 * A link names its endpoints by id, not by coordinate — the same shape
 * `GET /api/v1/concepts/{id}/neighborhood` returns, so the mini-map island can
 * swap the server-rendered payload for a fresh one without a translation layer.
 *
 * The direction follows the relationship rather than the traversal: a `requires`
 * link runs from the prerequisite into the centre, an `unlocks` link runs out of
 * it.
 */
export interface MiniMapLink {
  from: string;
  to: string;
  type: EdgeType;
  reviewed: boolean;
}

export interface Neighborhood {
  center: MiniMapNode;
  nodes: MiniMapNode[];
  links: MiniMapLink[];
}

/** ADR-0002: verified iff the node carries a reviewer. Never stored. */
export function tierOf(node: Pick<AuthoredNode, 'review'>): Tier {
  return node.review ? 'verified' : 'frontier';
}

/**
 * Resolves authored nodes into the served shape.
 *
 * Throws on an edge pointing at a node that does not exist — a dangling edge is
 * a content bug, and failing the build is the cheapest place to catch it.
 */
export function resolveGraph(authored: AuthoredNode[]): Map<string, ResolvedNode> {
  const byId = new Map(authored.map((n) => [n.id, n]));

  const target = (from: string, edge: AuthoredEdge): ResolvedEdge => {
    const node = byId.get(edge.id);
    if (!node) {
      throw new Error(`node "${from}" has an edge to "${edge.id}", which does not exist`);
    }
    return { id: node.id, title: node.title, tier: tierOf(node), reviewed: edge.reviewed };
  };

  // Seed every node with its authored edges, then fill the derived ones.
  const out = new Map<string, ResolvedNode>();
  for (const node of authored) {
    const { edges: _authoredEdges, ...rest } = node;
    out.set(node.id, {
      ...rest,
      tier: tierOf(node),
      edges: { requires: [], unlocks: [], adjacent: [] },
    });
  }

  // Merges rather than first-wins: when the two sides of an adjacency disagree
  // about `reviewed`, first-wins would resolve on slug order and half the time
  // publish an explicitly unchecked claim as a verified one. An unreviewed
  // assertion from either side has to survive.
  const push = (nodeId: string, type: EdgeType, edge: ResolvedEdge) => {
    const group = out.get(nodeId)?.edges[type];
    if (!group) return;
    const existing = group.find((e) => e.id === edge.id);
    if (existing) existing.reviewed = existing.reviewed && edge.reviewed;
    else group.push(edge);
  };

  for (const node of authored) {
    for (const edge of node.edges.requires) {
      push(node.id, 'requires', target(node.id, edge));
      // The inverse: if A requires B, then B unlocks A. Authored once.
      push(edge.id, 'unlocks', {
        id: node.id,
        title: node.title,
        tier: tierOf(node),
        reviewed: edge.reviewed,
      });
    }
    for (const edge of node.edges.adjacent) {
      push(node.id, 'adjacent', target(node.id, edge));
      // Adjacency is symmetric — declare it from either side.
      push(edge.id, 'adjacent', {
        id: node.id,
        title: node.title,
        tier: tierOf(node),
        reviewed: edge.reviewed,
      });
    }
  }

  // Stable ordering so the built HTML is byte-identical across runs.
  for (const node of out.values()) {
    for (const group of Object.values(node.edges)) {
      group.sort((a, b) => a.id.localeCompare(b.id));
    }
    assertOneRelationship(node);
  }

  return out;
}

/**
 * A pair of concepts is related in exactly one way.
 *
 * Two groups naming the same target has no coherent reading — B cannot be both
 * a prerequisite for A and merely adjacent to it — and mutual `requires` lands
 * here too, which is a circular prerequisite.
 *
 * It is also what breaks the mini-map: the layout places one circle per edge per
 * group, so a target in two groups gets two circles at two coordinates, and the
 * renderer resolves link endpoints by id — one line lands on the wrong circle
 * and the other circle is orphaned.
 */
function assertOneRelationship(node: ResolvedNode): void {
  const seen = new Map<string, EdgeType>();
  for (const type of ['requires', 'unlocks', 'adjacent'] as const) {
    for (const edge of node.edges[type]) {
      const first = seen.get(edge.id);
      if (first) {
        throw new Error(
          `concepts "${node.id}" and "${edge.id}" are related in two ways at once (${first} and ${type}): ` +
            'a pair of concepts has exactly one relationship',
        );
      }
      seen.set(edge.id, type);
    }
  }
}

const VIEWBOX = { w: 240, h: 132 } as const;

/**
 * One-hop neighborhood laid out deterministically (ADR-0003).
 *
 * Requires on the left, unlocks on the right, adjacent along the vertical —
 * which is how the mockup already draws it, so the placement carries the same
 * meaning as the edge type rather than being arbitrary.
 */
export function neighborhood(graph: Map<string, ResolvedNode>, id: string): Neighborhood {
  const node = graph.get(id);
  if (!node) throw new Error(`unknown node "${id}"`);

  const cx = VIEWBOX.w / 2;
  const cy = VIEWBOX.h / 2;
  const center: MiniMapNode = { id: node.id, title: node.title, tier: node.tier, x: cx, y: cy };

  const column = (edges: ResolvedEdge[], x: number): MiniMapNode[] =>
    edges.map((edge, i) => ({
      id: edge.id,
      title: edge.title,
      tier: edge.tier,
      x,
      // Spread evenly down the column: n items get n+1 gaps.
      y: Math.round((VIEWBOX.h * (i + 1)) / (edges.length + 1)),
    }));

  const row = (edges: ResolvedEdge[]): MiniMapNode[] =>
    edges.map((edge, i) => ({
      id: edge.id,
      title: edge.title,
      tier: edge.tier,
      x: Math.round((VIEWBOX.w * (i + 1)) / (edges.length + 1)),
      y: i % 2 === 0 ? 22 : VIEWBOX.h - 22,
    }));

  const placed = [
    ...column(node.edges.requires, 40),
    ...column(node.edges.unlocks, VIEWBOX.w - 40),
    ...row(node.edges.adjacent),
  ];

  const links: MiniMapLink[] = [];
  for (const type of ['requires', 'unlocks', 'adjacent'] as const) {
    for (const edge of node.edges[type]) {
      if (!placed.some((p) => p.id === edge.id)) continue;
      // A prerequisite points inwards; everything else points out from centre.
      const inbound = type === 'requires';
      links.push({
        from: inbound ? edge.id : node.id,
        to: inbound ? node.id : edge.id,
        type,
        reviewed: edge.reviewed,
      });
    }
  }

  return { center, nodes: placed, links };
}

/** Splits a body into [before, emphasis, after]; the phrase is verbatim. */
export function splitEmphasis(body: string, phrase: string | undefined): [string, string, string] {
  if (!phrase) return [body, '', ''];
  const at = body.indexOf(phrase);
  // A phrase that no longer matches its body renders as plain text rather than
  // throwing. CI is where that mismatch should fail, not a reader's page.
  if (at === -1) return [body, '', ''];
  return [body.slice(0, at), phrase, body.slice(at + phrase.length)];
}
