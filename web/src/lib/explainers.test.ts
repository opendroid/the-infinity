import { describe, expect, it } from 'vitest';
import {
  readExplainers,
  sortFailures,
  structuralProblems,
  verifyRead,
  verifyVideo,
  videoId,
} from '../../scripts/check-explainers.mjs';
import { EXPLAINER_HOSTS, hostOf } from '../../scripts/explainer-hosts.mjs';

/**
 * The offline half of the explainer check (ADR-0017).
 *
 * The half that needs YouTube — comparing a recorded title and author against
 * what oEmbed reports — cannot run here, and cannot run in an authoring sandbox
 * either: `www.youtube.com` is denied by the egress policy where this corpus is
 * written. CI is where that half runs. Everything reachable without a network
 * is asserted here instead, so a bad entry fails `npm test` rather than waiting
 * for a step that talks to a third party.
 */

interface Explainer {
  kind: string;
  scope: string;
  title: string;
  author: string;
  url: string;
  node: string;
}

const real: Explainer = {
  node: 'attention',
  kind: 'video',
  scope: 'concept',
  title: 'Attention in transformers, step-by-step',
  author: '3Blue1Brown',
  url: 'https://www.youtube.com/watch?v=eMlx5fFNoYc',
};

describe('videoId reads the three shapes people paste', () => {
  it.each([
    ['https://www.youtube.com/watch?v=eMlx5fFNoYc', 'eMlx5fFNoYc'],
    ['https://youtu.be/eMlx5fFNoYc', 'eMlx5fFNoYc'],
    ['https://www.youtube.com/embed/eMlx5fFNoYc', 'eMlx5fFNoYc'],
  ])('%s', (url, id) => {
    expect(videoId(url)).toBe(id);
  });

  it.each([
    ['a playlist, which is not a video', 'https://www.youtube.com/playlist?list=PLabc'],
    ['a channel', 'https://www.youtube.com/@karpathy'],
    ['somewhere else entirely', 'https://vimeo.com/12345'],
    ['not a url at all', 'nonsense'],
  ])('rejects %s rather than guessing', (_name, url) => {
    // A URL this cannot parse is one oEmbed cannot be asked about, so guessing
    // an id would produce a check that silently verifies the wrong video.
    expect(videoId(url)).toBeNull();
  });
});

describe('structuralProblems accepts what is well-formed', () => {
  it('a video with a parseable id on an allowed host', () => {
    expect(structuralProblems([real])).toEqual([]);
  });

  it('a read on an allowed host', () => {
    const page = { ...real, kind: 'read', url: 'https://jalammar.github.io/illustrated-transformer/' };
    expect(structuralProblems([page])).toEqual([]);
  });

  it('the same resource on two concepts, described identically', () => {
    // Two concepts pointing at one talk is ordinary. Only a DISAGREEMENT about
    // what that talk is called means somebody wrote it from memory.
    expect(structuralProblems([real, { ...real, node: 'self-attention' }])).toEqual([]);
  });
});

describe('structuralProblems catches', () => {
  const cases: { name: string; explainer: Explainer; match: RegExp }[] = [
    {
      name: 'an http url',
      explainer: { ...real, url: 'http://www.youtube.com/watch?v=eMlx5fFNoYc' },
      match: /not https/,
    },
    {
      name: 'a video on a host oEmbed cannot answer for',
      explainer: { ...real, url: 'https://vimeo.com/12345' },
      match: /cannot verify/,
    },
    {
      name: 'a read on a host nobody allowed',
      explainer: { ...real, kind: 'read', url: 'https://some-blog.example/post' },
      match: /cannot verify/,
    },
    {
      name: 'a youtube url carrying no video id',
      explainer: { ...real, url: 'https://www.youtube.com/playlist?list=PLabc' },
      match: /no video id/,
    },
    {
      name: 'a kind nothing knows how to check',
      explainer: { ...real, kind: 'podcast' },
      match: /cannot verify/,
    },
    {
      name: 'a missing scope — the page could not say what it covers',
      explainer: { ...real, scope: undefined as unknown as string },
      match: /must be "concept" or "domain"/,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const problems = structuralProblems([c.explainer]);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(c.match);
    });
  }

  it('one resource described two different ways', () => {
    const problems = structuralProblems([real, { ...real, node: 'self-attention', author: 'Someone Else' }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/described two ways/);
  });
});

describe('the committed corpus', () => {
  const explainers = readExplainers();

  it('is structurally clean', () => {
    expect(structuralProblems(explainers)).toEqual([]);
  });

  it('points only at hosts the checker can verify', () => {
    // Belt-and-braces with validate:content, which enforces the same table. The
    // point of asserting it twice is that the table is shared: if it were
    // copied, one of these two would eventually accept what the other refuses.
    const hosts = EXPLAINER_HOSTS as Record<string, string[] | undefined>;
    for (const e of explainers) {
      expect(hosts[e.kind] ?? [], `${e.node} → ${e.title}`).toContain(hostOf(e.url));
    }
  });
});

/**
 * A rate limit is not a dead link (#408).
 *
 * CI failed on #407 — a PR touching no content — with
 * `✗ https://en.wikipedia.org/wiki/AI_alignment / HTTP 429 / 11 concept(s)` and
 * the line "1 of 164 page(s) could not be verified". The page answered 200 from
 * another network minutes later. The message named eleven concepts and read as
 * a broken reference, so the obvious response to it was to delete eleven
 * working entries.
 *
 * These use an injected fetch, so nothing here touches the network — which is
 * the point, since what is being tested is how a misbehaving host is read.
 */
const response = (status: number, body = '', retryAfter?: string) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (n: string) => (n.toLowerCase() === 'retry-after' ? (retryAfter ?? null) : null) },
  text: async () => body,
  json: async () => JSON.parse(body || '{}'),
});

const entry = {
  node: 'deceptive-alignment',
  url: 'https://en.wikipedia.org/wiki/AI_alignment',
  title: 'AI alignment',
  author: 'Wikipedia contributors',
  kind: 'read' as const,
};

describe('a host saying "slow down" is not a page saying "I am gone"', () => {
  const stub = (queue: ReturnType<typeof response>[]) => {
    let i = 0;
    return {
      fetchImpl: async () => queue[Math.min(i++, queue.length - 1)],
      sleep: async () => {},
    };
  };

  it('marks a surviving 429 as throttled rather than failed', async () => {
    const r = await verifyRead(entry, stub([response(429)]));
    expect(r.ok).toBe(false);
    expect(r.throttled).toBe(true);
    expect(r.status).toBe(429);
  });

  it('treats 503 the same way — the host cannot answer yet', async () => {
    const r = await verifyRead(entry, stub([response(503)]));
    expect(r.throttled).toBe(true);
  });

  it('verifies normally once the host relents', async () => {
    const r = await verifyRead(entry, stub([
      response(429),
      response(200, '<title>AI alignment - Wikipedia</title>'),
    ]));
    expect(r.ok).toBe(true);
  });

  it('still fails a 404, which IS a claim about the page', async () => {
    const r = await verifyRead(entry, stub([response(404)]));
    expect(r.ok).toBe(false);
    expect(r.throttled).toBeUndefined();
  });

  it('still fails a page whose title does not match what we recorded', async () => {
    const r = await verifyRead(entry, stub([response(200, '<title>Something else entirely</title>')]));
    expect(r.ok).toBe(false);
    expect(r.throttled).toBeUndefined();
    expect(r.error).toContain('Something else entirely');
  });

  it('marks a throttled oEmbed the same way, and still calls a 404 a missing video', async () => {
    const video = { ...entry, kind: 'video' as const, url: 'https://www.youtube.com/watch?v=eMlx5fFNoYc' };
    expect((await verifyVideo(video, stub([response(429)]))).throttled).toBe(true);

    const missing = await verifyVideo(video, stub([response(404)]));
    expect(missing.throttled).toBeUndefined();
    expect(missing.error).toContain('no such video');
  });
});

describe('sortFailures separates the network, the host, and the page', () => {
  const urls = ['a', 'b', 'c', 'd', 'e'];
  const results = new Map<string, { ok: boolean; status: number; throttled?: boolean }>([
    ['a', { ok: true, status: 200 }],
    ['b', { ok: false, status: 0 }],
    ['c', { ok: false, status: 429, throttled: true }],
    ['d', { ok: false, status: 404 }],
    ['e', { ok: false, status: 503, throttled: true }],
  ]);

  it('puts a rate limit with neither the unreachable nor the dead', () => {
    const { blocked, throttled, real } = sortFailures(urls, results);
    expect(blocked).toEqual(['b']);
    expect(throttled).toEqual(['c', 'e']);
    // The one that must keep failing the build. Fold `throttled` back into this
    // and CI reports a rate-limited page as an unresolvable one again.
    expect(real).toEqual(['d']);
  });

  it('does not report a success as any kind of failure', () => {
    const { blocked, throttled, real } = sortFailures(['a'], results);
    expect([...blocked, ...throttled, ...real]).toEqual([]);
  });
});
