import { useEffect, useState } from 'react';
import { apiUrl } from '../lib/api';
import type { Depth, Tier } from '../lib/graph';
import { replace, type Stop } from '../lib/trail';
import TierDot from './TierDot';
import TrailThread from './TrailThread';

/**
 * Route 3 — a wander turned into a shareable artifact.
 *
 * The whole page is this island, because a trail slug is minted at runtime by a
 * reader and cannot be pre-rendered. ADR-0008 chose a static shell plus this
 * fetch over server-rendering the route; the consequences it records are real,
 * and two of them are visible here: the loading state has to be designed rather
 * than thrown in, and this is the one route in the product that says nothing
 * useful without JavaScript.
 *
 * Before this, `/t/[slug]` pre-rendered a single fixture through
 * `getStaticPaths`, so the only shareable URL that resolved was the sample one.
 * Its `Copy link` button had no handler, and `Walk this trail` navigated to
 * stop 1 without loading the trail — so it did not, in fact, let you walk it.
 */

interface TrailStop {
  n: number;
  id: string;
  title: string;
  tier: Tier;
  depth_read_at: Depth;
}

interface Trail {
  slug: string;
  title: string;
  created_at: string;
  duration_s?: number;
  stops: TrailStop[];
}

type State =
  | { name: 'loading' }
  | { name: 'ready'; trail: Trail }
  | { name: 'missing' }
  | { name: 'unreachable' };

/** Narrowed rather than cast: this drives navigation and localStorage. */
function narrowTrail(value: unknown): Trail | null {
  if (typeof value !== 'object' || value === null) return null;
  const t = value as Record<string, unknown>;
  if (typeof t.slug !== 'string' || typeof t.title !== 'string' || typeof t.created_at !== 'string') return null;
  if (!Array.isArray(t.stops)) return null;

  const stops: TrailStop[] = [];
  for (const raw of t.stops) {
    if (typeof raw !== 'object' || raw === null) return null;
    const s = raw as Record<string, unknown>;
    if (typeof s.n !== 'number' || typeof s.id !== 'string' || typeof s.title !== 'string') return null;
    if (s.tier !== 'verified' && s.tier !== 'frontier') return null;
    if (s.depth_read_at !== 'intuition' && s.depth_read_at !== 'engineer' && s.depth_read_at !== 'math') return null;
    stops.push({ n: s.n, id: s.id, title: s.title, tier: s.tier, depth_read_at: s.depth_read_at });
  }
  if (stops.length === 0) return null;

  return {
    slug: t.slug,
    title: t.title,
    created_at: t.created_at,
    duration_s: typeof t.duration_s === 'number' ? t.duration_s : undefined,
    stops,
  };
}

/**
 * The slug is the last path segment. Validated against the same pattern
 * `openapi.yaml` puts on the parameter, so a junk URL becomes "no such trail"
 * here instead of a request the API will reject.
 */
export function slugFromPath(pathname: string): string | null {
  const last = pathname.replace(/\/+$/, '').split('/').pop() ?? '';
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(last) ? last : null;
}

export default function SharedTrail() {
  const [state, setState] = useState<State>({ name: 'loading' });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const slug = slugFromPath(window.location.pathname);
    if (slug === null) {
      setState({ name: 'missing' });
      return;
    }

    let live = true;
    (async () => {
      try {
        const res = await fetch(apiUrl(`/trails/${slug}`));
        if (!live) return;
        if (res.status === 404) {
          setState({ name: 'missing' });
          return;
        }
        if (!res.ok) {
          setState({ name: 'unreachable' });
          return;
        }
        const trail = narrowTrail(await res.json());
        setState(trail ? { name: 'ready', trail } : { name: 'unreachable' });
      } catch {
        // Offline, or Cloud Run cold and slow. Distinct from "no such trail":
        // one is worth retrying and the other never will be.
        if (live) setState({ name: 'unreachable' });
      }
    })();

    return () => {
      live = false;
    };
  }, []);

  if (state.name === 'loading') return <Skeleton />;
  if (state.name === 'missing') return <Missing />;
  if (state.name === 'unreachable') return <Unreachable />;

  const { trail } = state;
  const last = trail.stops[trail.stops.length - 1];
  const minutes = Math.round((trail.duration_s ?? 0) / 60);
  const url = `${window.location.origin}/t/${trail.slug}`;

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is denied outside a secure context and in some
      // embedded browsers. Selecting the URL is the honest fallback — it is
      // already on screen, so say so rather than pretending the copy worked.
      setCopied(false);
      window.prompt('Copy this link', url);
    }
  }

  function onWalk() {
    // "Loads the trail into localStorage, opens stop 1." Without the load this
    // is just a link to a concept, which is what it used to be.
    const now = Date.now();
    const stops: Stop[] = trail.stops.map((s, i) => ({
      id: s.id,
      title: s.title,
      tier: s.tier,
      depth_read_at: s.depth_read_at,
      // Spaced so the walk keeps its order without inventing a duration.
      ts: now + i,
    }));
    const first = trail.stops[0]!.id;
    replace(stops, first);
    window.location.href = `/c/${first}`;
  }

  return (
    <main className="px-[34px] pb-9 pt-10 max-md:px-[22px]">
      <p className="font-mono text-[10px] uppercase tracking-[.16em] text-dust">
        Shared thread · {trail.stops.length} {trail.stops.length === 1 ? 'concept' : 'concepts'}
        {minutes > 0 && ` · ${minutes} min of wandering`}
      </p>

      <h1 className="mt-2 max-w-[34ch] font-display text-[28px] font-semibold leading-[1.2] max-md:text-[23px]">
        {trail.title} — one pull of the <span className="text-thread">thread</span>
      </h1>

      <p className="mb-[30px] mt-1.5 text-[14px] text-dust">
        Walked {trail.created_at}
        {last && `, ending on ${last.title}`}
      </p>

      <TrailThread beads={trail.stops.map((s) => s.tier)} />

      {/* Numbering is legitimate here and nowhere else: order IS the content. */}
      <ol className="mb-[26px] mt-[18px] list-none">
        {trail.stops.map((stop, i) => (
          <li
            key={`${stop.n}-${stop.id}`}
            className={['flex items-center gap-4 py-3', i < trail.stops.length - 1 ? 'border-b border-line' : ''].join(' ')}
          >
            <span className="w-[22px] shrink-0 font-mono text-[11px] text-dust">
              {String(stop.n).padStart(2, '0')}
            </span>
            <TierDot tier={stop.tier} size={8} />
            <a href={`/c/${stop.id}`} className="min-w-0 flex-1 text-[15px] text-starlight no-underline hover:text-thread">
              {stop.title}
            </a>
            <span className="font-mono text-[10px] uppercase tracking-[.12em] text-dust">{stop.depth_read_at}</span>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-3 rounded-control border border-line bg-void px-4 py-3.5">
        <code className="min-w-[200px] flex-1 break-words font-mono text-[12px] text-dust">{url}</code>
        <button
          type="button"
          onClick={() => void onCopy()}
          className="cursor-pointer rounded-row border border-line bg-transparent px-[18px] py-[9px] text-[14px] text-starlight max-md:w-full"
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <button
          type="button"
          onClick={onWalk}
          className="cursor-pointer rounded-row border-0 bg-thread px-[18px] py-[9px] text-[14px] font-bold text-void max-md:order-first max-md:w-full"
        >
          Walk this trail
        </button>
      </div>
      {/* Announced, not only recoloured. */}
      <p role="status" className="sr-only">
        {copied ? 'Link copied' : ''}
      </p>
    </main>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return <main className="px-[34px] pb-9 pt-10 max-md:px-[22px]">{children}</main>;
}

function Skeleton() {
  return (
    <Frame>
      <p className="font-mono text-[10px] uppercase tracking-[.16em] text-dust">Shared thread</p>
      <p className="mt-4 text-[15px] text-dust" role="status">
        Pulling the thread…
      </p>
    </Frame>
  );
}

function Missing() {
  return (
    <Frame>
      <h1 className="max-w-[34ch] font-display text-[28px] font-semibold leading-[1.2]">No such trail</h1>
      <p className="mt-3 max-w-[62ch] text-[15px] text-dust">
        This link does not lead anywhere. Trails are made by walking, so the fastest way to get one is to
        take a few steps yourself.
      </p>
      {/* The graph never dead-ends. */}
      <a
        href="/concepts"
        className="mt-6 inline-block rounded-row bg-thread px-[18px] py-[9px] text-[14px] font-bold text-void no-underline"
      >
        Start from the concepts
      </a>
    </Frame>
  );
}

function Unreachable() {
  return (
    <Frame>
      <h1 className="max-w-[34ch] font-display text-[28px] font-semibold leading-[1.2]">
        The live graph is offline
      </h1>
      <p className="mt-3 max-w-[62ch] text-[15px] text-dust">
        A shared trail is read from the live graph, so this page needs it and the rest of the site does
        not. The concepts are still here.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="cursor-pointer rounded-row border border-thread bg-transparent px-[18px] py-[9px] text-[14px] text-thread"
        >
          Retry
        </button>
        <a
          href="/concepts"
          className="rounded-row border border-line px-[18px] py-[9px] text-[14px] text-starlight no-underline"
        >
          Browse the concepts
        </a>
      </div>
    </Frame>
  );
}
