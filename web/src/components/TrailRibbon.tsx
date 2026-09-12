import { useEffect, useState } from 'react';
import type { Depth, Tier } from '../lib/graph';
import { postCreate, type Created } from '../lib/submit';
import { dropStops, read, recordDepth, shareBody, subscribe, visit, type Stop } from '../lib/trail';
import LiveRegion from './LiveRegion';
import TierDot from './TierDot';

/**
 * The thread, on the concept page: beads joined by a violet wire, current node
 * violet and bold, collapsing to tier dots on mobile.
 *
 * This was an Astro component fed `const trail = [node]` — one bead on every
 * page, forever — with a `Share trail` button that had no handler (#114). Both
 * halves are fixed here, because they are one thing: a share button is only
 * honest if there is a walk behind it.
 *
 * WHY AN ISLAND AND NOT ASTRO. Astro renders this to HTML at build time, so a
 * reader with no JavaScript still gets the ribbon — seeded with the current
 * node, which is the true trail for someone whose browser cannot remember one.
 * After hydration it reads localStorage and shows the walk. The no-JS case is
 * not a fallback bolted on; it is the server-rendered initial state.
 *
 * The Share button is the exception: it renders only once mounted, because a
 * button that posts JSON cannot work without JavaScript, and shipping one that
 * does nothing is the defect this issue is about (#111, #114).
 */

interface Props {
  id: string;
  title: string;
  tier: Tier;
  /** The depth the server rendered. The reader may change it; see below. */
  depth?: Depth;
}

/**
 * Shown only when the API gave us nothing readable — it is offline, or a proxy
 * answered with HTML. Every rejection it CAN explain now speaks for itself; the
 * string this replaced said "It may be too long" for all six of them, including
 * a 36-stop walk against a cap of 200 (#445).
 */
const CANNOT_SHARE = 'That trail could not be shared. The graph is still here.';

type Share =
  | { name: 'idle' }
  | { name: 'sending' }
  | { name: 'error'; message: string };

function narrowTrail(value: unknown): { slug: string; url: string } | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.slug !== 'string' || typeof v.url !== 'string') return null;
  // The reader is about to be sent here. A relative path from our own API is
  // the only thing worth following; anything else is not ours to navigate to.
  if (!v.url.startsWith('/t/')) return null;
  return { slug: v.slug, url: v.url };
}

export default function TrailRibbon({ id, title, tier, depth = 'intuition' }: Props) {
  const seed: Stop[] = [{ id, title, tier, depth_read_at: depth, ts: 0 }];
  const [stops, setStops] = useState<Stop[]>(seed);
  const [mounted, setMounted] = useState(false);
  const [share, setShare] = useState<Share>({ name: 'idle' });

  useEffect(() => {
    setMounted(true);
    // Recording here rather than in a recorder of its own: the ribbon is the
    // trail's view, and a page view is the event. `visit` is idempotent for a
    // repeated view, so the topbar count recording the same thing is harmless
    // and neither island has to mount first.
    //
    // The scope's attribute wins over the prop when it is already set — a
    // reader arriving back on a page whose depth toggle has run should be
    // recorded at the depth they are actually looking at.
    const scope = document.querySelector('[data-depth-scope]');
    const onScreen = scope instanceof HTMLElement ? scope.dataset.depth : undefined;
    setStops(visit({ id, title, tier, depth_read_at: currentDepth(onScreen ?? depth) }, Date.now()));
    return subscribe(() => setStops(read()));
  }, [id, title, tier, depth]);

  // The depth toggle publishes `data-depth` on the scope element and nothing
  // reads it in JavaScript — ADR-0005 anticipated exactly this reader: "the
  // trail records the depth a reader landed on". Observing the attribute keeps
  // the toggle from having to know a trail exists.
  useEffect(() => {
    const scope = document.querySelector('[data-depth-scope]');
    if (!(scope instanceof HTMLElement)) return;
    const observer = new MutationObserver(() => {
      recordDepth(id, currentDepth(scope.dataset.depth));
    });
    observer.observe(scope, { attributes: true, attributeFilter: ['data-depth'] });
    return () => observer.disconnect();
  }, [id]);

  async function onShare() {
    // The guard, not `disabled`, is what stops a second send (#405). Disabling
    // the button the reader is standing on hands focus to <body>, and on the
    // failure path nothing gives it back.
    if (share.name === 'sending') return;
    setShare({ name: 'sending' });
    const trail = read();
    const result = await send(trail.length > 0 ? trail : seed);
    if (!result.ok) {
      setShare({ name: 'error', message: result.message });
      return;
    }
    window.location.href = result.value.url;
  }

  /**
   * Posts the walk, repairing a stale trail once.
   *
   * A trail is localStorage and outlives a concept being renamed or removed in
   * /content/nodes, so one dead bead used to refuse the whole walk (#445). The
   * API now names those stops; dropping them and retrying shares the walk the
   * reader actually has. They were already broken — following one 404s — so
   * this is a repair, and `dropStops` writes it, which is what makes the beads
   * disappear from the ribbon rather than the trail quietly disagreeing with
   * what was shared.
   *
   * ONCE. The second attempt takes the answer it gets, whatever it is: a server
   * that keeps naming stops we have already dropped is a bug, not a loop to
   * run.
   */
  async function send(walk: Stop[], repaired = false): Promise<Created<{ slug: string; url: string }>> {
    const result = await postCreate('/trails', shareBody(walk), CANNOT_SHARE, narrowTrail);
    if (result.ok || repaired) return result;

    const stale = result.missingStops ?? [];
    if (stale.length === 0) return result;
    const kept = dropStops(stale);
    // Every stop stale cannot happen — this page's own concept is in the walk
    // and it plainly exists — but an empty retry would be a 400 about nothing.
    if (kept.length === 0) return result;
    return send(kept, true);
  }

  return (
    <nav
      aria-label="Your thread"
      className="flex flex-wrap items-center gap-y-2.5 border-t border-line bg-nebula-2 px-[26px] py-4"
    >
      <span className="mr-4 font-mono text-[10px] uppercase tracking-[.16em] text-dust">Your thread</span>

      {stops.map((stop, i) => (
        <span key={stop.id} className="flex items-center">
          <a
            href={`/c/${stop.id}`}
            className={[
              'whitespace-nowrap text-[13px] no-underline max-md:hidden',
              stop.id === id ? 'font-bold text-thread' : 'text-starlight',
            ].join(' ')}
          >
            {stop.title}
          </a>
          <span className="md:hidden">
            <TierDot tier={stop.tier} size={9} decorative={false} />
          </span>
          {i < stops.length - 1 && <span className="mx-2 h-px w-[26px] bg-thread opacity-50" />}
        </span>
      ))}

      {mounted && (
        <span className="ml-auto flex items-center gap-3 max-md:mt-2.5 max-md:w-full">
          {/*
            Present before it has anything to say (#406). This was a bare
            `<span role="alert">` rendered only once there was an error — the
            region and its text in one render, which is a new subtree rather
            than the change a reader is listening for, and #137 replaced
            exactly that shape everywhere except here. Not carried by colour
            either way: the text says what happened.
          */}
          <LiveRegion
            assertive
            message={share.name === 'error' ? share.message : ''}
            className="text-[13px] text-starlight"
          />
          <button
            type="button"
            onClick={() => void onShare()}
            aria-disabled={share.name === 'sending'}
            className="cursor-pointer rounded-row border border-thread bg-transparent px-[18px] py-[9px] text-[14px] font-medium text-thread aria-disabled:opacity-50 max-md:w-full max-md:bg-thread max-md:font-bold max-md:text-void"
          >
            {share.name === 'sending' ? 'Sharing…' : 'Share trail'}
          </button>
        </span>
      )}
    </nav>
  );
}

/** The depth actually on screen, falling back to what the server rendered. */
function currentDepth(value: string | undefined): Depth {
  return value === 'engineer' || value === 'math' || value === 'intuition' ? value : 'intuition';
}
