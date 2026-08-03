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

  return (
    <div>
      <h2 className="mb-2.5 font-mono text-[10px] font-semibold uppercase tracking-[.18em] text-dust">
        You are here
      </h2>
      <svg
        viewBox="0 0 240 132"
        className="w-full rounded-control border border-line bg-void"
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
        <text
          x={data.center.x}
          y={data.center.y + 23}
          textAnchor="middle"
          fill="#E9EBF8"
          fontFamily="JetBrains Mono"
          fontSize="8"
        >
          {data.center.id}
        </text>
      </svg>
      {links.some((l) => !l.reviewed) && (
        <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[.12em] text-dust">
          Dashed = unreviewed edge
        </p>
      )}
    </div>
  );
}
