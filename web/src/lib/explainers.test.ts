import { describe, expect, it } from 'vitest';
import { readExplainers, structuralProblems, videoId } from '../../scripts/check-explainers.mjs';
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
  title: string;
  author: string;
  url: string;
  node: string;
}

const real: Explainer = {
  node: 'attention',
  kind: 'video',
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
