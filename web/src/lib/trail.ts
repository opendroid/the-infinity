/**
 * The trail: the path a reader took through the graph.
 *
 * The handoff calls it "the only persistent client state", and it lives in
 * localStorage because it is exactly that — interaction state, written by the
 * reader, never authored in git (ADR-0002). Nothing server-side knows it exists
 * until the reader presses Share.
 *
 * Until #114 this was a comment describing a mechanism that had not been built:
 * the concept page rendered `const trail = [node]` and deferred to "the real
 * trail from localStorage after hydration", and nothing in /web read or wrote
 * localStorage at all. The ribbon showed one bead on every page, forever, and
 * the topbar permanently said `trail · 1 node`.
 *
 * ORDER IS THE CONTENT. A trail is a sequence, not a set — the shared page
 * numbers its stops, and numbering is legitimate there and nowhere else in the
 * product. Re-visiting a concept therefore MOVES it to the end rather than
 * duplicating it: the trail is where you have been, in the order that made
 * sense of it, and a loop back to attention is a return, not a second attention.
 */
import type { Depth, Tier } from './graph';

/** One stop, in the shape the handoff specifies. */
export interface Stop {
  id: string;
  title: string;
  tier: Tier;
  /** The depth left on screen. Updated in place when the reader toggles. */
  depth_read_at: Depth;
  /** Epoch millis. Only used to derive the walk's duration when sharing. */
  ts: number;
}

const KEY = 'trail';

/**
 * `openapi.yaml` caps a shared trail at 200 stops, so the client caps at the
 * same number rather than letting a reader build something the API will reject
 * with a 400 they cannot act on. Oldest stops fall off the front: a walk that
 * long is a session, and its recent end is the part worth sharing.
 */
export const MAX_STOPS = 200;

/**
 * Fired on `window` whenever the trail changes, so the ribbon and the topbar
 * count stay in step.
 *
 * A module-level subscriber list would be tidier and is not obviously safe:
 * these two islands hydrate independently, and whether a bundler hands them one
 * copy of this module or two is a property of the build, not of the source.
 * `window` is shared by construction. The `storage` event is picked up for the
 * same reason — two tabs open on the graph should agree about the count.
 */
export const CHANGED = 'trail:changed';

function isStop(value: unknown): value is Stop {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    typeof s.title === 'string' &&
    (s.tier === 'verified' || s.tier === 'frontier') &&
    (s.depth_read_at === 'intuition' || s.depth_read_at === 'engineer' || s.depth_read_at === 'math') &&
    typeof s.ts === 'number'
  );
}

/**
 * Parses stored JSON into stops, discarding anything malformed.
 *
 * Pure and string-taking so the validation is testable without a DOM. Every
 * entry is checked rather than trusted: localStorage is editable by the reader,
 * survives deploys that change this shape, and a half-valid trail rendering as
 * `undefined` in the ribbon would be a corrupted page from a corrupted string.
 * A trail is not worth a crash — bad entries are dropped, and what survives is
 * still a trail.
 */
export function parse(raw: string | null): Stop[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.filter(isStop).slice(-MAX_STOPS);
}

/**
 * Appends a visit, moving an existing stop to the end rather than duplicating.
 *
 * Pure: takes the current trail and returns the next one. IDEMPOTENT for a
 * repeated visit to the same concept at the same depth, which is what lets both
 * islands on a concept page record independently without caring which mounted
 * first. Only `ts` would differ, and it is deliberately preserved when the node
 * is already last: re-recording the same view must not extend the walk's
 * apparent duration.
 */
export function append(trail: Stop[], stop: Stop): Stop[] {
  const last = trail[trail.length - 1];
  if (last && last.id === stop.id) {
    // Already here. Keep the arrival time; take the (possibly new) depth.
    if (last.depth_read_at === stop.depth_read_at) return trail;
    return [...trail.slice(0, -1), { ...last, depth_read_at: stop.depth_read_at }];
  }
  const without = trail.filter((s) => s.id !== stop.id);
  return [...without, stop].slice(-MAX_STOPS);
}

/**
 * Sets the depth on a named stop, but only if it is the one being read.
 *
 * Pure so the guard is testable without a DOM. The guard is the point: a stale
 * island — a page restored from bfcache, a second tab — must not be able to
 * rewrite the depth of a stop the reader has already walked past.
 */
export function withDepth(trail: Stop[], id: string, depth: Depth): Stop[] {
  const last = trail[trail.length - 1];
  if (!last || last.id !== id || last.depth_read_at === depth) return trail;
  return [...trail.slice(0, -1), { ...last, depth_read_at: depth }];
}

/** How long the walk took, in seconds — first stop to last. */
export function durationS(trail: Stop[], now: number): number {
  const first = trail[0];
  if (!first) return 0;
  return Math.max(0, Math.round((now - first.ts) / 1000));
}

/** The payload `POST /api/v1/trails` expects. */
export function shareBody(trail: Stop[], now: number) {
  return {
    stops: trail.map((s) => ({ id: s.id, depth_read_at: s.depth_read_at })),
    duration_s: durationS(trail, now),
  };
}

// --- storage ---------------------------------------------------------------
//
// Every access is guarded. localStorage throws rather than returning null in
// Safari's private mode and wherever site data is blocked, and a reader who has
// turned off storage should get a graph that works without a trail, not a page
// that fails to hydrate.

export function read(): Stop[] {
  try {
    return parse(window.localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

function write(trail: Stop[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(trail));
  } catch {
    // Quota, private mode, or storage disabled. The trail is a convenience;
    // losing it must not take the page with it.
    return;
  }
  window.dispatchEvent(new CustomEvent(CHANGED));
}

/**
 * The one-shot marker that says "the next arrival is a resume, not a return".
 *
 * ADOPTING A TRAIL AND WALKING ONE ARE DIFFERENT ACTS, and the two rules
 * collide exactly once. Walking says a revisit moves a node to the end, because
 * a loop back to attention is a return. Adopting says the order is someone
 * else's and you are starting at their stop 1 — so applying the walking rule on
 * arrival would move stop 1 to the end and scramble the path the button had
 * just promised to load. Found by clicking "Walk this trail" and watching the
 * ribbon reorder itself.
 *
 * sessionStorage because it must survive exactly one navigation, in one tab,
 * and then be gone.
 */
const RESUMING = 'trail:resuming';

/**
 * Records that this concept was read, and returns the trail including it.
 *
 * Safe to call from more than one island on the same page — see `append`.
 */
export function visit(stop: Omit<Stop, 'ts'>, now: number): Stop[] {
  const trail = read();
  if (takeResuming() === stop.id && trail.some((s) => s.id === stop.id)) {
    // Arriving at a stop of a trail just adopted. Already recorded, in the
    // order its author walked it.
    return trail;
  }
  const next = append(trail, { ...stop, ts: now });
  write(next);
  return next;
}

function takeResuming(): string | null {
  try {
    const id = window.sessionStorage.getItem(RESUMING);
    if (id !== null) window.sessionStorage.removeItem(RESUMING);
    return id;
  } catch {
    return null;
  }
}

/** Updates the depth on the current stop after the reader toggles. */
export function recordDepth(id: string, depth: Depth): void {
  const trail = read();
  const next = withDepth(trail, id, depth);
  if (next !== trail) write(next);
}

/**
 * Adopts a trail — "Walk this trail" on a shared page.
 *
 * `landingOn` is the stop the reader is about to be sent to. Naming it here
 * rather than guessing on arrival is what keeps the adopted order intact; see
 * RESUMING above.
 */
export function replace(trail: Stop[], landingOn?: string): void {
  write(trail.slice(-MAX_STOPS));
  if (landingOn === undefined) return;
  try {
    window.sessionStorage.setItem(RESUMING, landingOn);
  } catch {
    // Storage refused. The trail still loads; the first stop just moves to the
    // end, which is wrong but not broken.
    return;
  }
}

/** Subscribes to changes, including from another tab. Returns an unsubscribe. */
export function subscribe(fn: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === KEY) fn();
  };
  window.addEventListener(CHANGED, fn);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGED, fn);
    window.removeEventListener('storage', onStorage);
  };
}
