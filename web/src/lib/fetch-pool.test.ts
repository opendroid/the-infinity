import { describe, expect, it } from 'vitest';
import { byUrl, everyFailureWasSilent, hostOf, pool, unreachableHosts, verifiedCount } from '../../scripts/fetch-pool.mjs';

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
