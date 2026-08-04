import type { Depth } from './graph';

/**
 * Where the reader's depth comes from, and where it goes.
 *
 * `DepthToggle` shipped with the keyboard half of its job — arrow keys, roving
 * tabindex, real tablist semantics (#138) — and none of the state half, which
 * is the title of #42. `?depth=` was neither read nor written, and the choice
 * did not survive a click to the next concept. A reader who wants Engineer
 * wants it on the next page too, and a depth you cannot link is a depth you
 * cannot share.
 *
 * The precedence is pure and lives here rather than in the component, so it can
 * be tested without a DOM. The component owns the effects; this owns the rule.
 *
 * DEFAULT is `intuition` because that is what the server renders. Anything else
 * would make the no-JavaScript page disagree with the resolved one.
 */

export const DEFAULT: Depth = 'intuition';

/** The query parameter, and the storage key. Both are public surface. */
export const PARAM = 'depth';
const KEY = 'depth';

const DEPTHS: readonly Depth[] = ['intuition', 'engineer', 'math'];

/**
 * A `Depth` or null, never a throw.
 *
 * Both inputs are reader-controlled — a hand-typed URL, a localStorage entry
 * editable in devtools — so `?depth=banana` has to fall through to the next
 * source rather than render a panel that does not exist.
 */
export function parseDepth(value: string | null | undefined): Depth | null {
  return DEPTHS.includes(value as Depth) ? (value as Depth) : null;
}

/**
 * THE URL WINS OVER STORAGE.
 *
 * This is the case the issue names, and it is the one that matters: a link is
 * an explicit instruction from whoever sent it, while storage is a standing
 * preference. Someone sharing `?depth=math` is saying "read this bit" — letting
 * a stored Engineer silently override that would make shared links mean
 * different things to different people, which is the whole value of linking a
 * depth in the first place.
 *
 * Invalid values at either level fall through rather than failing, so a mangled
 * link still lands on a readable page.
 */
export function resolve(url: string | null, stored: string | null): Depth {
  return parseDepth(url) ?? parseDepth(stored) ?? DEFAULT;
}

/** The `?depth=` value of a URL, or null. Takes a full URL or a search string. */
export function fromSearch(search: string): string | null {
  return new URLSearchParams(search).get(PARAM);
}

/**
 * What the address bar should read for a given depth.
 *
 * `intuition` REMOVES THE PARAMETER rather than writing `?depth=intuition`. The
 * default needs no announcing, so an ordinary read produces an ordinary URL and
 * only a deliberate depth leaves a mark. It also means switching back to
 * Intuition cleans up after itself instead of leaving a stale parameter that
 * says nothing.
 */
export function searchFor(search: string, depth: Depth): string {
  const params = new URLSearchParams(search);
  if (depth === DEFAULT) params.delete(PARAM);
  else params.set(PARAM, depth);
  const q = params.toString();
  return q === '' ? '' : `?${q}`;
}

// Every access is guarded. localStorage throws rather than returning null when
// storage is disabled — Safari private mode, an embedded browser, a reader who
// turned it off — and a reading control must not take the page down with it.

export function read(): Depth | null {
  try {
    return parseDepth(window.localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function write(depth: Depth): void {
  try {
    window.localStorage.setItem(KEY, depth);
  } catch {
    // A reader with storage off still gets the toggle, just not the memory.
  }
}
