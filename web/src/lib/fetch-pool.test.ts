import { describe, expect, it } from 'vitest';
import {
  byUrl,
  everyFailureWasSilent,
  hostOf,
  politeFetch,
  pool,
  retryAfterSeconds,
  THROTTLED,
  unreachableHosts,
  verifiedCount,
} from '../../scripts/fetch-pool.mjs';

/**
 * The fetch policy both link checkers share (#373).
 *
 * All four are pure or take an injected worker, so none of this touches the
 * network — which matters, because the thing being tested is what happens when
 * the network misbehaves.
 */

const ok = { ok: true, status: 200 };
const gone = { ok: false, status: 404 };
const silent = { ok: false, status: 0, error: 'fetch failed' };

describe('byUrl collapses entries onto the page they point at', () => {
  it('groups a shared url once, keeping every entry', () => {
    const groups = byUrl([
      { node: 'vocoder', url: 'https://huggingface.co/learn/audio-course' },
      { node: 'spectrogram', url: 'https://huggingface.co/learn/audio-course' },
      { node: 'attention', url: 'https://d2l.ai/index.html' },
    ]);
    expect(groups.size).toBe(2);
    expect(groups.get('https://huggingface.co/learn/audio-course')).toHaveLength(2);
  });

  it('keeps insertion order within a group, so the first entry is a stable representative', () => {
    // check-explainers fetches groups.get(url)[0]. If that were arbitrary the
    // failure message would name a different concept run to run.
    const groups = byUrl([
      { node: 'a', url: 'https://d2l.ai/x.html' },
      { node: 'b', url: 'https://d2l.ai/x.html' },
    ]);
    expect(groups.get('https://d2l.ai/x.html')?.[0].node).toBe('a');
  });
});

describe('pool caps concurrency per host', () => {
  it('never exceeds the cap on any one host, and visits every url exactly once', async () => {
    const urls = [
      ...Array.from({ length: 9 }, (_, i) => `https://d2l.ai/${i}.html`),
      ...Array.from({ length: 5 }, (_, i) => `https://colah.github.io/${i}/`),
    ];
    const live = new Map<string, number>();
    const peak = new Map<string, number>();
    const visits = new Map<string, number>();

    const results = await pool(
      urls,
      async (url: string) => {
        const host = hostOf(url);
        const now = (live.get(host) ?? 0) + 1;
        live.set(host, now);
        peak.set(host, Math.max(peak.get(host) ?? 0, now));
        visits.set(url, (visits.get(url) ?? 0) + 1);
        await new Promise((r) => setTimeout(r, 1));
        live.set(host, (live.get(host) ?? 1) - 1);
        return ok;
      },
      { perHost: 3 },
    );

    expect(results.size).toBe(urls.length);
    expect([...visits.values()].every((n) => n === 1)).toBe(true);
    expect(peak.get('d2l.ai')).toBeLessThanOrEqual(3);
    expect(peak.get('colah.github.io')).toBeLessThanOrEqual(3);
    // Hosts run alongside each other; the cap is per host, not global.
    expect(peak.get('d2l.ai')).toBe(3);
  });

  it('does not spawn more workers than there are urls', async () => {
    let started = 0;
    await pool(['https://d2l.ai/only.html'], async () => {
      started += 1;
      return ok;
    }, { perHost: 8 });
    expect(started).toBe(1);
  });
});

describe('verifiedCount reads the half everyFailureWasSilent does not', () => {
  it('counts successes, which is the number the caller must report (#390)', () => {
    // The bug: a run that verified 126 of 134 pages exited under a name meaning
    // "nothing was verified", because only failures were ever consulted.
    const r = new Map([
      ['https://d2l.ai/a.html', ok],
      ['https://d2l.ai/b.html', ok],
      ['https://www.youtube.com/watch?v=x', silent],
    ]);
    expect(verifiedCount(r)).toBe(2);
    // Still true — every FAILURE was silent — and the caller still exits 2,
    // because nobody asked to skip that host. The name now says which.
    expect(everyFailureWasSilent(r)).toBe(true);
  });

  it('is zero when nothing answered at all', () => {
    expect(verifiedCount(new Map([['https://www.youtube.com/watch?v=a', silent]]))).toBe(0);
  });
});

describe('a host that answered nothing is not a host with dead pages', () => {
  it('names a host whose every failure got no response', () => {
    const r = new Map([
      ['https://www.youtube.com/watch?v=a', silent],
      ['https://www.youtube.com/watch?v=b', silent],
      ['https://d2l.ai/fine.html', ok],
    ]);
    expect(unreachableHosts(r)).toEqual([{ host: 'youtube.com', urls: 2 }]);
    expect(everyFailureWasSilent(r)).toBe(true);
  });

  it('does NOT excuse a host whose pages 404 — the server answered', () => {
    // The earlier version of this asked whether a host failed *identically*,
    // which is true of a blocked host and equally true of three deleted posts.
    const r = new Map([
      ['https://colah.github.io/a/', gone],
      ['https://colah.github.io/b/', gone],
      ['https://colah.github.io/c/', gone],
    ]);
    expect(unreachableHosts(r)).toEqual([]);
    expect(everyFailureWasSilent(r)).toBe(false);
  });

  it('one real status anywhere means the run found something', () => {
    const r = new Map([
      ['https://www.youtube.com/watch?v=a', silent],
      ['https://colah.github.io/gone/', gone],
    ]);
    expect(unreachableHosts(r).map((d) => d.host)).toEqual(['youtube.com']);
    // A blocked host alongside a genuine 404 is still a run with something to fix.
    expect(everyFailureWasSilent(r)).toBe(false);
  });

  it('an all-green run is not "nothing was verified"', () => {
    expect(everyFailureWasSilent(new Map([['https://d2l.ai/x.html', ok]]))).toBe(false);
  });
});

/**
 * A host saying "slow down" is not a page saying "I am gone" (#408).
 *
 * CI went red on en.wikipedia.org/wiki/AI_alignment with HTTP 429, reported as
 * an unresolvable page affecting eleven concepts. The page answered 200 from
 * another network minutes later. Acting on that message means deleting eleven
 * working entries — the direction ADR-0020 exists to prevent.
 */
describe('retryAfterSeconds reads what the host actually asked for', () => {
  const cases: { name: string; header: string | null; want: number | null }[] = [
    { name: 'delta-seconds, the common form', header: '120', want: 120 },
    { name: 'zero is a real answer, not an absent one', header: '0', want: 0 },
    { name: 'an HTTP-date, relative to now', header: 'Thu, 10 Sep 2026 01:02:00 GMT', want: 120 },
    { name: 'a date already past is a wait of zero, never negative', header: 'Thu, 10 Sep 2026 00:00:00 GMT', want: 0 },
    { name: 'absent', header: null, want: null },
    { name: 'empty', header: '   ', want: null },
    // Unreadable must be null, not 0: reading it as zero would turn "slow down"
    // into "retry immediately", which is worse than not reading it at all.
    { name: 'unparseable', header: 'soon please', want: null },
    { name: 'not an integer', header: '12.5', want: null },
  ];

  const now = Date.parse('Thu, 10 Sep 2026 01:00:00 GMT');
  for (const c of cases) {
    it(c.name, () => expect(retryAfterSeconds(c.header, now)).toBe(c.want));
  }
});

describe('politeFetch retries a host that says "not now"', () => {
  /** A Response-shaped stub: only `status` and `headers.get` are read. */
  const res = (status: number, retryAfter?: string) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (n: string) => (n.toLowerCase() === 'retry-after' ? (retryAfter ?? null) : null) },
  });

  const run = async (queue: ReturnType<typeof res>[], opts = {}) => {
    const slept: number[] = [];
    let calls = 0;
    const out = await politeFetch('https://en.wikipedia.org/wiki/AI_alignment', {}, {
      fetchImpl: async () => { calls += 1; return queue[Math.min(calls - 1, queue.length - 1)]; },
      sleep: async (ms: number) => { slept.push(ms); },
      ...opts,
    });
    return { out, slept, calls };
  };

  it('returns a 200 without sleeping at all', async () => {
    const { out, slept, calls } = await run([res(200)]);
    expect(out.status).toBe(200);
    expect(slept).toEqual([]);
    expect(calls).toBe(1);
  });

  it('retries a 429 and returns the answer that follows', async () => {
    const { out, calls } = await run([res(429), res(200)]);
    expect(out.status).toBe(200);
    expect(calls).toBe(2);
  });

  it('waits what Retry-After asks for, in seconds', async () => {
    const { slept } = await run([res(429, '7'), res(200)]);
    expect(slept).toEqual([7000]);
  });

  it('accepts the HTTP-date form of Retry-After', async () => {
    const at = new Date(Date.now() + 4000).toUTCString();
    const { slept } = await run([res(503, at), res(200)]);
    // Rounded to the second, and the clock moves between the two lines.
    expect(slept).toHaveLength(1);
    expect(slept[0]).toBeGreaterThanOrEqual(3000);
    expect(slept[0]).toBeLessThanOrEqual(5000);
  });

  it('falls back to 5s then 15s when the host states nothing', async () => {
    // Not 1s/2s: #400 priced a backoff too short to clear a rate window — every
    // attempt fails together and it is the same as having no retry.
    const { slept, calls } = await run([res(429)]);
    expect(slept).toEqual([5000, 15000]);
    expect(calls).toBe(3);
  });

  it('caps a host that asks for an hour, so the job cannot hang on it', async () => {
    const { slept } = await run([res(429, '3600'), res(200)]);
    expect(slept).toEqual([30_000]);
  });

  it('gives the throttled response back rather than throwing, and lets the caller judge', async () => {
    const { out, calls } = await run([res(429)]);
    expect(out.status).toBe(429);
    expect(calls).toBe(3);
    expect(THROTTLED.has(out.status)).toBe(true);
  });

  it('never retries a 404 — that one IS a claim about the page', async () => {
    // The check exists to catch invented references. Softening this would be
    // the invented-reference rule quietly stopping.
    const { out, slept, calls } = await run([res(404)]);
    expect(out.status).toBe(404);
    expect(calls).toBe(1);
    expect(slept).toEqual([]);
    expect(THROTTLED.has(404)).toBe(false);
  });
});
