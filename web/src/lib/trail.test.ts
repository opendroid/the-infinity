import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_STOPS,
  append,
  durationS,
  parse,
  read,
  recordDepth,
  replace,
  shareBody,
  subscribe,
  visit,
  withDepth,
  type Stop,
} from './trail';

const T0 = 1_754_000_000_000;

function stop(id: string, over: Partial<Stop> = {}): Stop {
  return { id, title: id, tier: 'verified', depth_read_at: 'intuition', ts: T0, ...over };
}

const ids = (trail: Stop[]) => trail.map((s) => s.id);

describe('parse tolerates whatever is actually in localStorage', () => {
  it('reads a trail it wrote', () => {
    expect(parse(JSON.stringify([stop('attention')]))).toEqual([stop('attention')]);
  });

  it('treats absent, empty, and malformed alike', () => {
    // A reader can edit this by hand, and it survives deploys that change the
    // shape. None of that is worth a crash on a concept page.
    for (const raw of [null, '', 'not json', '{}', '"a string"', '42', '[']) {
      expect(parse(raw)).toEqual([]);
    }
  });

  it('drops entries that are not stops rather than rendering undefined', () => {
    const raw = JSON.stringify([
      stop('good'),
      { id: 'no-title', tier: 'verified', depth_read_at: 'intuition', ts: T0 },
      { ...stop('bad-tier'), tier: 'gold' },
      { ...stop('bad-depth'), depth_read_at: 'expert' },
      null,
      'attention',
      stop('also-good'),
    ]);
    expect(ids(parse(raw))).toEqual(['good', 'also-good']);
  });

  it('caps a stored trail that is somehow too long', () => {
    const long = Array.from({ length: MAX_STOPS + 50 }, (_, i) => stop(`c${i}`));
    expect(parse(JSON.stringify(long))).toHaveLength(MAX_STOPS);
  });
});

describe('append — order is the content', () => {
  it('adds a new concept to the end', () => {
    const t = append(append([], stop('a')), stop('b'));
    expect(ids(t)).toEqual(['a', 'b']);
  });

  it('moves a revisit to the end rather than duplicating it', () => {
    // A loop back to attention is a return, not a second attention.
    let t: Stop[] = [];
    for (const id of ['a', 'b', 'c']) t = append(t, stop(id));
    t = append(t, stop('a'));
    expect(ids(t)).toEqual(['b', 'c', 'a']);
  });

  it('is idempotent for the same concept at the same depth', () => {
    // Both islands on a concept page record independently; whichever mounts
    // first wins and the second must be a no-op, not a second stop.
    const once = append([stop('a')], stop('b'));
    const twice = append(once, stop('b'));
    expect(twice).toEqual(once);
  });

  it('does not extend the walk when re-recording the same view', () => {
    // ts is the arrival time. Re-recording must not make the walk look longer.
    const first = append([], stop('a', { ts: T0 }));
    const again = append(first, stop('a', { ts: T0 + 60_000 }));
    expect(again[0]!.ts).toBe(T0);
  });

  it('updates the depth in place when the reader toggles', () => {
    const t = append([stop('a')], stop('a', { depth_read_at: 'math' }));
    expect(t).toHaveLength(1);
    expect(t[0]!.depth_read_at).toBe('math');
  });

  it('drops the oldest stops past the cap the API enforces', () => {
    // Hitting the client cap means the API's 400 is never reached, so the
    // reader never gets a rejection they cannot act on.
    let t: Stop[] = [];
    for (let i = 0; i < MAX_STOPS + 10; i++) t = append(t, stop(`c${i}`));
    expect(t).toHaveLength(MAX_STOPS);
    expect(t[0]!.id).toBe('c10');
    expect(t[t.length - 1]!.id).toBe(`c${MAX_STOPS + 9}`);
  });
});

describe('what gets shared', () => {
  it('sends only what the API asked for', () => {
    const body = shareBody([stop('a'), stop('b', { depth_read_at: 'engineer' })], T0);
    expect(body.stops).toEqual([
      { id: 'a', depth_read_at: 'intuition' },
      { id: 'b', depth_read_at: 'engineer' },
    ]);
    // Titles and tiers are the API's to resolve — sending ours would let a
    // stale client rename a concept on someone else's shared page.
    expect(JSON.stringify(body)).not.toContain('tier');
  });

  it('measures the walk from the first stop', () => {
    expect(durationS([stop('a', { ts: T0 })], T0 + 90_000)).toBe(90);
    expect(durationS([], T0)).toBe(0);
  });

  it('never reports a negative duration', () => {
    // A clock that moved backwards, or a trail from a machine that is ahead.
    expect(durationS([stop('a', { ts: T0 })], T0 - 5_000)).toBe(0);
  });
});

describe('withDepth only rewrites the stop being read', () => {
  const walked = [stop('a'), stop('b')];

  it('sets the depth on the current stop', () => {
    expect(withDepth(walked, 'b', 'math').map((s) => s.depth_read_at)).toEqual(['intuition', 'math']);
  });

  it('ignores a stop the reader has already walked past', () => {
    // A page restored from bfcache, or a second tab, must not be able to
    // rewrite the depth of a stop that is no longer on screen.
    expect(withDepth(walked, 'a', 'engineer')).toBe(walked);
  });

  it('ignores an unknown id and an empty trail', () => {
    expect(withDepth(walked, 'zzz', 'math')).toBe(walked);
    expect(withDepth([], 'a', 'math')).toEqual([]);
  });

  it('returns the same array when nothing changed, so no write is issued', () => {
    expect(withDepth(walked, 'b', 'intuition')).toBe(walked);
  });
});

/**
 * The storage layer is thin on purpose — every decision above is pure — but
 * "thin" is not "obviously right", and its two real failure modes are worth
 * exercising: storage that throws, and subscribers that must fire.
 *
 * A hand-written window rather than jsdom. It is a devDependency and a config
 * change to test five functions, and this fake says exactly what it provides,
 * which is what makes `throws: true` below a one-line change instead of a mock
 * of a mock.
 */
function fakeWindow(opts: { throws?: boolean } = {}) {
  const data = new Map<string, string>();
  const session = new Map<string, string>();
  const listeners = new Map<string, Set<(e: unknown) => void>>();

  const win = {
    localStorage: {
      getItem(k: string) {
        if (opts.throws) throw new Error('SecurityError');
        return data.get(k) ?? null;
      },
      setItem(k: string, v: string) {
        if (opts.throws) throw new Error('QuotaExceededError');
        data.set(k, v);
      },
    },
    sessionStorage: {
      getItem: (k: string) => {
        if (opts.throws) throw new Error('SecurityError');
        return session.get(k) ?? null;
      },
      setItem: (k: string, v: string) => {
        if (opts.throws) throw new Error('SecurityError');
        session.set(k, v);
      },
      removeItem: (k: string) => void session.delete(k),
    },
    addEventListener(type: string, fn: (e: unknown) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (e: unknown) => void) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(e: { type: string }) {
      listeners.get(e.type)?.forEach((fn) => fn(e));
      return true;
    },
    CustomEvent: class {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    },
  };

  // @ts-expect-error assigning a minimal stand-in for the browser global
  globalThis.window = win;
  // The module builds events with `new CustomEvent(...)` from the global scope.
  // @ts-expect-error same
  globalThis.CustomEvent = win.CustomEvent;
  return win;
}

afterEach(() => {
  // @ts-expect-error clearing the stand-in
  delete globalThis.window;
});

describe('storage', () => {
  const attention = { id: 'attention', title: 'Attention', tier: 'verified', depth_read_at: 'intuition' } as const;

  it('round-trips a visit', () => {
    fakeWindow();
    visit(attention, T0);
    expect(ids(read())).toEqual(['attention']);
  });

  it('two islands recording the same view produce one stop', () => {
    fakeWindow();
    visit(attention, T0);
    visit(attention, T0 + 10);
    expect(read()).toHaveLength(1);
  });

  it('records a depth change through to storage', () => {
    fakeWindow();
    visit(attention, T0);
    recordDepth('attention', 'math');
    expect(read().map((s) => s.depth_read_at)).toEqual(['math']);
  });

  it('replace swaps the whole trail, for "Walk this trail"', () => {
    fakeWindow();
    visit(attention, T0);
    replace([stop('x'), stop('y')]);
    expect(ids(read())).toEqual(['x', 'y']);
  });

  describe('adopting a trail keeps its author\'s order', () => {
    const adopted = [stop('a'), stop('b'), stop('c')];
    const arriveAtA = { id: 'a', title: 'a', tier: 'verified', depth_read_at: 'intuition' } as const;

    it('does not move the landing stop to the end', () => {
      // Without this, clicking "Walk this trail" reorders the trail to
      // [b, c, a] the instant you arrive — the button destroying the path it
      // just promised to load.
      fakeWindow();
      replace(adopted, 'a');
      expect(ids(visit(arriveAtA, T0))).toEqual(['a', 'b', 'c']);
    });

    it('is one-shot: a genuine return later still moves to the end', () => {
      fakeWindow();
      replace(adopted, 'a');
      visit(arriveAtA, T0);
      // Walk on to b, then come back to a. That IS a return.
      visit({ id: 'b', title: 'b', tier: 'verified', depth_read_at: 'intuition' }, T0);
      expect(ids(visit(arriveAtA, T0))).toEqual(['c', 'b', 'a']);
    });

    it('only excuses the stop that was named', () => {
      fakeWindow();
      replace(adopted, 'a');
      // Landing on b, not the named a: an ordinary visit, so b moves to the
      // end. Asserted on b rather than c, which is already last and would pass
      // whether or not the marker were consulted.
      expect(ids(visit({ id: 'b', title: 'b', tier: 'verified', depth_read_at: 'intuition' }, T0))).toEqual(['a', 'c', 'b']);
    });

    it('replace without a landing stop reorders as usual', () => {
      fakeWindow();
      replace(adopted);
      expect(ids(visit(arriveAtA, T0))).toEqual(['b', 'c', 'a']);
    });
  });

  it('survives storage being unavailable', () => {
    // Safari's private mode throws on setItem; blocking site data throws on
    // both. A reader who turned off storage gets a graph with no trail, not a
    // page that fails to hydrate.
    fakeWindow({ throws: true });
    expect(() => read()).not.toThrow();
    expect(read()).toEqual([]);
    expect(() => visit(attention, T0)).not.toThrow();
  });

  it('notifies subscribers so the ribbon and the count agree', () => {
    const win = fakeWindow();
    const seen = vi.fn();
    const off = subscribe(seen);

    visit(attention, T0);
    expect(seen).toHaveBeenCalledTimes(1);

    off();
    visit({ ...attention, id: 'b', title: 'B' }, T0);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(win).toBeDefined();
  });

  it('notifies on another tab writing the same key, and ignores other keys', () => {
    const win = fakeWindow();
    const seen = vi.fn();
    const off = subscribe(seen);

    win.dispatchEvent({ type: 'storage', key: 'trail' } as never);
    expect(seen).toHaveBeenCalledTimes(1);

    win.dispatchEvent({ type: 'storage', key: 'depth' } as never);
    expect(seen).toHaveBeenCalledTimes(1);

    off();
  });

  it('does not notify when the write failed', () => {
    // A subscriber told the trail changed would re-read and find it unchanged,
    // which is how a count starts disagreeing with the ribbon.
    fakeWindow({ throws: true });
    const seen = vi.fn();
    const off = subscribe(seen);
    visit(attention, T0);
    expect(seen).not.toHaveBeenCalled();
    off();
  });
});
