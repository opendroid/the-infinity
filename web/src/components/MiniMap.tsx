import { useEffect, useState } from 'react';
import { apiUrl } from '../lib/api';
import type { MiniMapNode, Neighborhood, Tier } from '../lib/graph';

/**
 * The one element on a concept page that waits on the network — deliberately.
 *
 * ADR-0003: keeping this a live call is what makes "the API is canonical, the
 * static page is a build-time cache" true rather than decorative. A page built
 * last week and cached at the CDN shows last week's tier colours; its mini-map,
 * fetched now, shows today's.
 *
 * The handoff specifies a loading skeleton here. We ship something better: the
 * build-time map IS the first paint, so there is nothing to wait for and nothing
 * to shimmer. The fetch either improves what is already on screen or changes
 * nothing at all.
 *
 * That is also why there is no error state. A failed refetch is not a failure of
 * this component — the map a reader is looking at is still correct as of the
 * last deploy, and replacing it with an apology would be strictly worse.
 */

const FILL: Record<Tier, string> = {
  verified: '#E5B54A',
  frontier: '#5FD4C4',
};

/**
 * Guards a payload before it replaces a map that is already correct.
 *
 * Exported because this is the whole risk of the component: swapping in a
 * malformed response would break a working mini-map, and "the API returned 200"
 * is not the same claim as "the API returned a neighbourhood".
 */
export function isNeighborhood(value: unknown): value is Neighborhood {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;

  const isNode = (n: unknown): boolean => {
    if (typeof n !== 'object' || n === null) return false;
    const node = n as Record<string, unknown>;
    return (
      typeof node.id === 'string' &&
      typeof node.title === 'string' &&
      (node.tier === 'verified' || node.tier === 'frontier') &&
      typeof node.x === 'number' &&
      typeof node.y === 'number' &&
      Number.isFinite(node.x) &&
      Number.isFinite(node.y)
    );
  };

  const isLink = (l: unknown): boolean => {
    if (typeof l !== 'object' || l === null) return false;
    const link = l as Record<string, unknown>;
    return (
      typeof link.from === 'string' &&
      typeof link.to === 'string' &&
      typeof link.reviewed === 'boolean'
    );
  };

  return (
    isNode(v.center) &&
    Array.isArray(v.nodes) &&
    v.nodes.every(isNode) &&
    Array.isArray(v.links) &&
    v.links.every(isLink)
  );
}

/**
 * Resolves each link's endpoints to points.
 *
 * Links name their ends by id — the shape the API returns — so a link whose
 * endpoint is missing is dropped rather than drawn to (0,0), which would put a
 * line through the corner of the box and look like a real edge.
 */
/**
 * The largest hit radius that leaves two targets touching but never overlapping.
 *
 * The API spaces a column as `height * (i+1)/(n+1)`, so the gap shrinks as a
 * concept gains edges: three neighbours on `mixture-of-experts` sit far apart,
 * six on `self-attention` sit ~19px apart, and the graph only grows.
 *
 * WHAT THIS DOES AND DOES NOT FIX, measured rather than assumed. A fixed radius
 * of 11 does NOT mislabel a node you point at: the centres stay further apart
 * than the radius, so each dot keeps its own middle. Driving a six-node column
 * in a browser with r=11 named every node correctly. The defect is narrower —
 * where two hit areas overlap, the region between the dots goes to whichever
 * was drawn last rather than to the nearer one, so aiming between two dots can
 * pick the further away. Halving the closest gap makes the boundary the true
 * midpoint, and keeps it that way at densities the graph has not reached yet.
 *
 * Exported for the tests: the property is arithmetic and worth asserting, since
 * the symptom is too small to see and too easy to reintroduce.
 */
export function hitRadius(points: Array<{ x: number; y: number }>, max = 11): number {
  let closest = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      closest = Math.min(closest, Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y));
    }
  }
  // Half the closest gap: two circles of that radius touch and never overlap.
  return Math.min(max, closest / 2);
}

export function drawableLinks(data: Neighborhood) {
  const points = new Map<string, MiniMapNode>([data.center, ...data.nodes].map((n) => [n.id, n]));
  return data.links.flatMap((link) => {
    const from = points.get(link.from);
    const to = points.get(link.to);
    return from && to ? [{ from, to, reviewed: link.reviewed }] : [];
  });
}

interface Props {
  id: string;
  /** The build-time map. Rendered immediately, and kept if the fetch fails. */
  initial: Neighborhood;
}

export default function MiniMap({ id, initial }: Props) {
  const [data, setData] = useState<Neighborhood>(initial);
  /** Which node the pointer is over; null means the concept being read. */
  const [hovered, setHovered] = useState<MiniMapNode | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch(apiUrl(`/concepts/${encodeURIComponent(id)}/neighborhood`), { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        // Only a well-formed neighbourhood displaces one that already renders.
        if (isNeighborhood(body)) setData(body);
      })
      .catch(() => {
        /* Offline, aborted, or the service is cold. The build-time map stands. */
      });

    return () => controller.abort();
  }, [id]);

  const links = drawableLinks(data);

  // ONE LABEL, IN ONE PLACE. A label per node crowds a 240x132 box and collides
  // with the edges — the same problem the landing lemniscate hit at 620px
  // (#52), where the answer was to label fewer rather than smaller. And the
  // node count is not fixed: it is however many edges the concept has, from
  // three on `mixture-of-experts` to six on `self-attention`, so any layout
  // that works at one density has to work at the others. A slot at the top of
  // the box is near no node, so it cannot overlap one at any count.
  //
  // It also replaces a label that was drawn under the centre node, which is
  // exactly where every edge converges, and which showed the id — a URL slug —
  // where the rest of the product shows the title (#129).
  const shown = hovered ?? data.center;
  const targets = [...data.nodes, data.center];
  const radius = hitRadius(targets);

  return (
    <div>
      <h2 className="mb-2.5 font-mono text-[10px] font-semibold uppercase tracking-[.18em] text-dust">
        You are here
      </h2>
      <div className="rounded-control border border-line bg-void">
        {/*
          Fixed height and a single line: the text changes on hover, and a slot
          that grew or wrapped would shift the sidebar under the reader's
          pointer. Tier is spelled out because on this map it is otherwise
          carried by colour alone (CLAUDE.md §5) — the dots have no other tell.
        */}
        <p className="flex h-[22px] items-center justify-center gap-1.5 truncate px-2 pt-1.5 text-center font-mono text-[10px] text-starlight">
          <span className="truncate">{shown.title}</span>
          <span className="shrink-0 uppercase tracking-[.12em] text-dust">· {shown.tier}</span>
        </p>
      <svg
        viewBox="0 0 240 132"
        onMouseLeave={() => setHovered(null)}
        className="w-full"
        role="img"
        aria-label={`Concepts one step from ${data.center.title}`}
      >
        {links.map((link, i) => (
          <line
            key={`${link.from.id}-${link.to.id}-${i}`}
            x1={link.from.x}
            y1={link.from.y}
            x2={link.to.x}
            y2={link.to.y}
            stroke="#8F7BFF"
            strokeWidth="1"
            opacity={link.reviewed ? '.5' : '.35'}
            strokeDasharray={link.reviewed ? undefined : '3 4'}
          />
        ))}
        {data.nodes.map((n) => (
          <circle key={n.id} cx={n.x} cy={n.y} r="5" fill={FILL[n.tier]} />
        ))}
        <circle
          cx={data.center.x}
          cy={data.center.y}
          r="8"
          fill={data.center.tier === 'frontier' ? '#5FD4C4' : '#8F7BFF'}
        />

        {/*
          Transparent hit areas, drawn last so they sit above the dots. A 5px
          radius in a 240-wide box is about six screen pixels — findable by eye
          and not by hand.
        */}
        {[...data.nodes, data.center].map((n) => (
          <circle
            key={`hit-${n.id}`}
            cx={n.x}
            cy={n.y}
            r={radius}
            fill="transparent"
            onMouseEnter={() => setHovered(n)}
          />
        ))}
      </svg>
      </div>
      {links.some((l) => !l.reviewed) && (
        <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[.12em] text-dust">
          Dashed = unreviewed edge
        </p>
      )}
    </div>
  );
}
