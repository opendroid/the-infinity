import { useEffect, useState } from 'react';
import LiveRegion from './LiveRegion';
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
  /** The concept has since been deleted from git (ADR-0012). */
  missing?: boolean;
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
    stops.push({
      n: s.n,
      id: s.id,
      title: s.title,
      tier: s.tier,
      depth_read_at: s.depth_read_at,
      // Absent on every stop that still resolves, so its absence is the
      // ordinary case rather than something to default.
      missing: s.missing === true,
    });
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

/**
 * What a reader who cannot see the page is told when the fetch resolves (#140).
 *
 * Empty while loading: the page has only just arrived, and a live region
 * populated at mount announces nothing anyway. Every other state is a change to
 * that region, which is the mutation a screen reader is listening for.
 *
 * The ready message deliberately does not repeat the trail's title — the `<h1>`
 * two lines below already carries it. It says the thing that is otherwise
 * invisible: it arrived, and how far it goes.
 */
export function arrival(state: State): string {
  switch (state.name) {
    case 'loading':
      return '';
    case 'ready':
      return `Trail loaded — ${state.trail.stops.length} ${state.trail.stops.length === 1 ? 'concept' : 'concepts'}.`;
    case 'missing':
      return 'No such trail.';
    case 'unreachable':
      return 'The live graph is offline.';
  }
}

export default function SharedTrail() {
  const [state, setState] = useState<State>({ name: 'loading' });

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

  // ONE REGION ACROSS ALL FOUR STATES. Each state is a whole-page swap, so a
  // region living inside a branch is unmounted by the next one — which is how
  // this route came to announce nothing at all when its content arrived. As the
  // first child of the same fragment every time, React keeps the same DOM node
  // and only its text changes.
  return (
    <>
      <LiveRegion message={arrival(state)} />
      {state.name === 'loading' ? (
        <Skeleton />
      ) : state.name === 'missing' ? (
        <Missing />
      ) : state.name === 'unreachable' ? (
        <Unreachable />
      ) : (
        <Ready trail={state.trail} />
      )}
    </>
  );
}

/**
 * The trail itself, extracted so the region above can be its sibling.
 *
 * `copied` lives here rather than a level up, which is the reason this route
 * keeps TWO live regions rather than merging them into one. They belong to
 * different lifetimes: the arrival fires once when the fetch resolves, and
 * "Link copied" only on demand, long after and only in this state. Merging
 * them would lift copy state out of the component that owns it to buy nothing —
 * the two can never speak at the same moment, because the button announcing
 * one does not exist until the other has already fired.
 */
function Ready({ trail }: { trail: Trail }) {
  const [copied, setCopied] = useState(false);

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
    // Land on the first stop that still exists. Walking a trail whose opening
    // concept was deleted would drop the reader straight onto a 404 — the one
    // place the tombstone would be worse than useless, because they never see
    // the trail page that explains it.
    const first = (trail.stops.find((s) => !s.missing) ?? trail.stops[0]!).id;
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
            <TierDot tier={stop.tier} size={8} decorative={false} />
            {/*
              A TOMBSTONE, NOT A GAP (ADR-0012). The concept was deleted from git
              after this walk happened. The stop keeps its number, its title and
              the tier it had when it was read — that is what the reader saw —
              and stops being a link, because the only thing behind it now is a
              404 they would find by clicking.

              Rendered rather than hidden: removing it would renumber the walk
              and make the trail claim to be something it was not.
            */}
            {stop.missing ? (
              <span className="min-w-0 flex-1 text-[15px] text-dust">
                {stop.title}
                <span className="ml-2 font-mono text-[10px] uppercase tracking-[.12em]">
                  no longer in the graph
                </span>
              </span>
            ) : (
              <a href={`/c/${stop.id}`} className="min-w-0 flex-1 text-[15px] text-starlight no-underline hover:text-thread">
                {stop.title}
              </a>
            )}
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
      {/*
        No role here. This text is on the page at mount, and a live region
        populated at mount announces nothing — the role was a claim the browser
        could not honour. The route-level region above owns every announcement
        on this route now, including the one that says the pulling finished.
      */}
      <p className="mt-4 text-[15px] text-dust">Pulling the thread…</p>
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
