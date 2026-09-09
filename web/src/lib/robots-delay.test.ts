import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { partitionByDelay, pool, skippedNotice, starGroupDelay } from '../../scripts/fetch-pool.mjs';

/**
 * Crawl-delay: reading it, honouring it, and saying what was skipped (ADR-0020).
 *
 * THE FIXTURES ARE THE REAL FILES, fetched on 2026-09-08 and committed. A
 * hand-written imitation of a robots.txt tests the parser against what its author
 * believed the format was, and the belief is the thing that was wrong: Wikipedia's
 * `Crawl-delay: 5` was very nearly recorded as Wikipedia's policy when it is
 * SemrushBot's. That file is in here specifically so the parser has to get it right.
 */

const fixture = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', `robots-${name}.txt`), 'utf8');

describe('starGroupDelay reads the `*` group and only the `*` group', () => {
  it('finds arxiv.org’s 15 seconds among 300 lines of other agents', () => {
    // The `*` group is first, followed by Yahoo! Slurp at 1s and several others.
    expect(starGroupDelay(fixture('arxiv'))).toBe(15);
  });

  it('does NOT read Wikipedia’s SemrushBot delay as Wikipedia’s policy', () => {
    // The file contains `Crawl-delay: 5`. It belongs to `User-agent: SemrushBot`;
    // the `*` group is sixty lines further down and states no delay at all. A
    // grep says five. The format says none.
    expect(fixture('wikipedia')).toContain('Crawl-delay: 5');
    expect(starGroupDelay(fixture('wikipedia'))).toBeNull();
  });

  it('returns null for a file that permits everything', () => {
    expect(starGroupDelay(fixture('huggingface'))).toBeNull();
  });

  it('honours consecutive User-agent lines sharing one group', () => {
    // Two agents, one group — the format allows it and a line-at-a-time reader
    // would miss the delay entirely.
    expect(starGroupDelay('User-agent: Bingbot\nUser-agent: *\nCrawl-delay: 7\n')).toBe(7);
  });

  it('starts a new group when a User-agent follows a directive', () => {
    // Without this the `*` above would swallow the delay stated below it.
    expect(starGroupDelay('User-agent: *\nDisallow: /x\n\nUser-agent: Slurp\nCrawl-delay: 3\n')).toBeNull();
  });

  it('ignores a delay it cannot read rather than treating it as none', () => {
    expect(starGroupDelay('User-agent: *\nCrawl-delay: soon\nCrawl-delay: 4\n')).toBe(4);
  });

  it('ignores commented-out directives', () => {
    expect(starGroupDelay('User-agent: *\n# Crawl-delay: 9\nDisallow: /\n')).toBeNull();
  });
});

describe('pool waits the stated delay on a delayed host', () => {
  it('runs one at a time, with the gap between requests', async () => {
    // The clock is injected, so this proves the interval without spending it.
    const slept: number[] = [];
    const order: string[] = [];
    let live = 0;
    let peak = 0;

    const urls = ['a', 'b', 'c'].map((p) => `https://arxiv.org/abs/${p}`);
    await pool(
      urls,
      async (url: string) => {
        live += 1;
        peak = Math.max(peak, live);
        order.push(url);
        await new Promise((r) => setTimeout(r, 1));
        live -= 1;
        return { ok: true, status: 200 };
      },
      { perHost: 4, delays: new Map([['arxiv.org', 15]]), sleep: async (ms: number) => { slept.push(ms); } },
    );

    expect(peak).toBe(1);
    expect(order).toEqual(urls);
    // Two gaps for three requests: between them, not after the last one. Three
    // sleeps would add fifteen seconds to every run for nothing.
    expect(slept).toEqual([15_000, 15_000]);
  });

  it('leaves an undelayed host on the parallel path', async () => {
    const slept: number[] = [];
    let peak = 0;
    let live = 0;
    await pool(
      Array.from({ length: 6 }, (_, i) => `https://d2l.ai/${i}.html`),
      async () => {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 1));
        live -= 1;
        return { ok: true, status: 200 };
      },
      { perHost: 3, delays: new Map([['arxiv.org', 15]]), sleep: async (ms: number) => { slept.push(ms); } },
    );
    expect(peak).toBe(3);
    expect(slept).toEqual([]);
  });

  it('delays one host without serialising the others alongside it', async () => {
    const slept: number[] = [];
    const seen: string[] = [];
    await pool(
      ['https://arxiv.org/abs/1', 'https://arxiv.org/abs/2', 'https://d2l.ai/x.html'],
      async (url: string) => {
        seen.push(url);
        return { ok: true, status: 200 };
      },
      { delays: new Map([['arxiv.org', 15]]), sleep: async (ms: number) => { slept.push(ms); } },
    );
    expect(slept).toEqual([15_000]);
    expect(seen).toHaveLength(3);
  });
});

describe('--fast partitions by what the host asked for', () => {
  const delays = new Map([['arxiv.org', 15]]);

  it('checks the hosts that stated nothing and holds back the ones that did', () => {
    const { checking, skipped } = partitionByDelay(
      ['https://arxiv.org/abs/1', 'https://d2l.ai/x.html', 'https://arxiv.org/abs/2'],
      delays,
    );
    expect(checking).toEqual(['https://d2l.ai/x.html']);
    expect(skipped.get('arxiv.org')).toHaveLength(2);
  });

  it('skips nothing when no host published a delay', () => {
    const { checking, skipped } = partitionByDelay(['https://d2l.ai/x.html'], new Map());
    expect(checking).toHaveLength(1);
    expect(skipped.size).toBe(0);
  });
});

describe('the skip notice names the host, the delay, and the blast radius', () => {
  it('reports entries and not just urls, because one url can carry sixteen', () => {
    const groups = new Map([
      ['https://arxiv.org/abs/1', [{ node: 'a' }, { node: 'b' }]],
      ['https://arxiv.org/abs/2', [{ node: 'c' }]],
    ]);
    const skipped = new Map([['arxiv.org', [...groups.keys()]]]);
    const notice = skippedNotice(skipped, new Map([['arxiv.org', 15]]), groups, 'citation');

    expect(notice).toContain('arxiv.org');
    expect(notice).toContain('15s between requests');
    expect(notice).toContain('2 url(s) covering 3 citation(s) NOT checked');
    // The word that stops a subset reading as a full pass.
    expect(notice).toContain('NOT checked');
  });
});
