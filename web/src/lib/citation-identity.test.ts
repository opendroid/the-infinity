import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ARXIV_BATCH,
  ARXIV_GAP_SECONDS,
  USER_AGENT,
  WARN_AT,
  arxivId,
  classify,
  identityCheck,
  normalize,
  paperKey,
  parseFeed,
  similarity,
} from '../../scripts/check-citations.mjs';

/**
 * The identity half of the citation check (#558): is the paper at each id the
 * paper the node names?
 *
 * NONE OF THIS TOUCHES THE NETWORK. The check talks to export.arxiv.org, which
 * the sandbox this was written in cannot reach and which a pull request must
 * not depend on (ADR-0020). Every request goes through an injected fetch and
 * every wait through an injected sleep on a fake clock, so the batching, the
 * spacing and the exit codes are proved here, and the first links.yml run is
 * what tests arXiv itself.
 */

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

interface Citation {
  node: string;
  ref: string;
  title: string;
  url: string;
}

const cite = (node: string, ref: string, title: string): Citation => ({
  node,
  ref,
  title,
  url: `https://arxiv.org/abs/${ref.replace(/^arXiv:/, '')}`,
});

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** An answer in the shape arxiv-id-list.xml documents, holding these papers. */
function feed(entries: [id: string, title: string][]): string {
  const body = entries
    .map(([id, title]) => `  <entry>\n    <id>http://arxiv.org/abs/${id}v1</id>\n    <title>${escapeXml(title)}</title>\n  </entry>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n  <title type="html">ArXiv Query: a test</title>\n${body}\n</feed>\n`;
}

interface Call {
  url: string;
  at: number;
  headers: Record<string, string>;
}

/**
 * A fake export API on a fake clock.
 *
 * `held` is what arXiv holds for each id. A title search is answered from
 * `search`, keyed by the phrase it asked for. `statuses` are answered first, in
 * order, each with `Retry-After: 0` — the header that would send a retry
 * straight back. `fail` makes every request throw, as a blocked host does.
 */
function fakeArxiv(opts: {
  held?: Record<string, string>;
  search?: Record<string, [id: string, title: string][]>;
  statuses?: number[];
  fail?: Error;
} = {}) {
  let now = 0;
  const calls: Call[] = [];
  const statuses = [...(opts.statuses ?? [])];
  const fetchImpl = async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, at: now, headers: init.headers });
    if (opts.fail) throw opts.fail;
    const status = statuses.shift();
    if (status !== undefined) {
      return { ok: false, status, headers: { get: () => '0' }, text: async () => '' };
    }
    const query = new URL(url).searchParams;
    const list = query.get('id_list');
    const entries: [string, string][] =
      list !== null
        ? list.split(',').flatMap((id): [string, string][] => {
            const title = opts.held?.[id];
            return title === undefined ? [] : [[id, title]];
          })
        : (opts.search?.[/^ti:"(.*)"$/.exec(query.get('search_query') ?? '')?.[1] ?? ''] ?? []);
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => feed(entries) };
  };
  const sleep = async (ms: number) => {
    now += ms;
  };
  return { fetchImpl, sleep, calls };
}

/** stdout and stderr, as the check writes them. */
function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    all: () => [...out, ...err].join('\n'),
    io: { out: (line: string) => out.push(line), err: (line: string) => err.push(line) },
  };
}

describe('normalize drops what is not the title', () => {
  // Acceptance test 2 of #558, one row per thing a title may differ by and
  // still be the same title.
  const same: [what: string, a: string, b: string][] = [
    ['case', 'Attention Is All You Need', 'attention is all you need'],
    ['punctuation', 'Reinforcement Learning: A Survey', 'Reinforcement Learning, a survey.'],
    ['an apostrophe of either shape', "Don't Stop Pretraining", 'Don’t Stop Pretraining'],
    ['an en dash', 'Self–Attention', 'Self-Attention'],
    ['an em dash', 'Scaling Laws — Revisited', 'Scaling Laws - Revisited'],
    ['a non-breaking hyphen', 'Pre‑training', 'Pre-training'],
    ['a minus sign', 'Leaky−ReLU', 'Leaky-ReLU'],
    ['$…$ around a symbol, which stays', '$k$-Means Clustering', 'k-Means Clustering'],
    // Dropped, not read as a separator: only inside a word do the two differ.
    ['$…$ inside a word', '$k$NN-Prompting', 'kNN-Prompting'],
    ['$…$ around a command', '$\\mathcal{O}(n)$ Connections', 'O(n) Connections'],
    ['\\command{…}, whose argument stays', '\\emph{Attention} Is All You Need', 'Attention Is All You Need'],
    ['nested \\command{…}', '\\textbf{\\emph{Deep}} Learning', 'Deep Learning'],
    ['a \\command{} with nothing in it, which stays a word', '\\LaTeX{} for Everyone', 'LaTeX for Everyone'],
    ['a bare command, read as its name', '$\\alpha$-Divergence', 'alpha-Divergence'],
    ['BibTeX case protection', '{B}ayesian Optimization of {GPT}-3', 'Bayesian Optimization of GPT-3'],
    ['an old font switch', '{\\em Neural} Networks', 'Neural Networks'],
    ['a LaTeX accent, against a Unicode one', 'Schr\\"odinger Bridges', 'Schrödinger Bridges'],
    ['an accent on a dotless i', "Mart\\'{\\i}nez", 'Martínez'],
    ['the line break arXiv wraps a long title with', 'Deep Bidirectional Transformers for Language\n  Understanding', 'Deep Bidirectional Transformers for Language Understanding'],
    ['tabs and doubled spaces', ' Deep  Residual\tLearning ', 'Deep Residual Learning'],
    ['an invisible soft hyphen', 'Pre­training', 'Pretraining'],
  ];

  it.each(same)('ignores %s', (_what, a, b) => {
    expect(normalize(a)).toBe(normalize(b));
  });

  it('leaves the words, lowercased, one space apart', () => {
    // Without this, a normalize that returned "" for everything passes every
    // row above.
    expect(normalize('  BERT: Pre-training — of\n  Deep  $k$-NN \\emph{Models} ')).toBe(
      'bert pre training of deep k nn models',
    );
  });

  it.each([
    ['a different word', 'Attention Is All You Need', 'Attention Is All You Want'],
    ['a negation', 'Attention Is Not All You Need', 'Attention Is All You Need'],
    ['a different number', 'GPT-3', 'GPT-4'],
    ['different math', '$k$-Means', '$n$-Means'],
    ['a letter outside a–z', 'α-Divergence', 'β-Divergence'],
  ])('keeps %s', (_what, a, b) => {
    expect(normalize(a)).not.toBe(normalize(b));
  });
});

describe('similarity is Levenshtein similarity', () => {
  it('kitten to sitting is three edits over seven characters', () => {
    expect(similarity('kitten', 'sitting')).toBeCloseTo(1 - 3 / 7, 12);
  });

  it('is symmetric, 1 for identical strings and 0 for nothing in common', () => {
    expect(similarity('sitting', 'kitten')).toBe(similarity('kitten', 'sitting'));
    expect(similarity('abc', 'abc')).toBe(1);
    expect(similarity('abc', 'xyz')).toBe(0);
  });
});

describe('classify, against the titles in the fixture', () => {
  const held = parseFeed(fixture('arxiv-id-list.xml'));
  // Change any stored title here by one word and its row fails (#558, sabotage 1).
  const rows: { ref: string; stored: string; want: 'pass' | 'warn' | 'fail' }[] = [
    { ref: 'arXiv:1706.03762', stored: 'Attention Is All You Need', want: 'pass' },
    // arXiv wraps this one across two lines.
    {
      ref: 'arXiv:1810.04805',
      stored: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
      want: 'pass',
    },
    { ref: 'arXiv:cs/9605103', stored: 'Reinforcement learning — a survey', want: 'pass' },
    // The prefix dropped: five characters in seventy-nine, similarity 0.94.
    {
      ref: 'arXiv:1810.04805',
      stored: 'Pre-training of Deep Bidirectional Transformers for Language Understanding',
      want: 'warn',
    },
    // A real paper, under the wrong id: the defect this check exists for.
    { ref: 'arXiv:1706.03762', stored: 'Deep Residual Learning for Image Recognition', want: 'fail' },
  ];

  it.each(rows)('$ref stored as "$stored" is $want', ({ ref, stored, want }) => {
    const arxiv = held.get(paperKey(arxivId(ref)!));
    expect(arxiv, `the fixture holds no title for ${ref}`).toBeTypeOf('string');
    expect(classify(stored, arxiv ?? null)).toBe(want);
  });
});

describe('classify draws the warn band at 0.90, inclusive', () => {
  it('passes only an exact match after normalization', () => {
    expect(classify('Attention Is All You Need', 'ATTENTION is all you need.')).toBe('pass');
  });

  it('warns at exactly 0.90 — one edit in ten characters', () => {
    expect(similarity('abcdefghij', 'abcdefghiz')).toBe(0.9);
    expect(classify('abcdefghij', 'abcdefghiz')).toBe('warn');
  });

  it('fails just below it — two edits in ten characters', () => {
    expect(similarity('abcdefghij', 'abcdefghyz')).toBeCloseTo(0.8, 12);
    expect(classify('abcdefghij', 'abcdefghyz')).toBe('fail');
  });

  it('fails a one-word change on a short title: length decides, not word count', () => {
    // need → want is four edits in twenty-five characters, 0.84.
    expect(classify('Attention Is All You Need', 'Attention Is All You Want')).toBe('fail');
  });

  it('fails when arXiv holds no title, or one that normalizes to nothing', () => {
    expect(classify('Attention Is All You Need', null)).toBe('fail');
    expect(classify('Attention Is All You Need', ' — ')).toBe('fail');
    // Two titles that are both nothing are not a match: "" equals "".
    expect(classify(' — ', ' – ')).toBe('fail');
  });

  it('is the threshold #558 settled', () => {
    expect(WARN_AT).toBe(0.9);
  });
});

describe('parseFeed reads the answer the arXiv API documents', () => {
  const held = parseFeed(fixture('arxiv-id-list.xml'));

  it('keys each paper without the version its <id> carries', () => {
    expect([...held.keys()]).toEqual(['1706.03762', '1810.04805', 'cs/9605103']);
  });

  it('reads no title but the papers’ — not the query echo, not "Error", not the pdf link’s', () => {
    expect([...held.values()]).toEqual([
      'Attention Is All You Need',
      'BERT: Pre-training of Deep Bidirectional Transformers for Language\n  Understanding',
      'Reinforcement Learning: A Survey',
    ]);
    expect(held.has('1234.1234')).toBe(false);
  });

  it('decodes entities', () => {
    const t = parseFeed(
      '<feed><entry><id>http://arxiv.org/abs/2401.00001v2</id>' +
        '<title>Q&amp;A, &lt;tags&gt;, &#8220;quotes&#8221; &#x2014; and &amp;lt;</title></entry></feed>',
    );
    expect(t.get('2401.00001')).toBe('Q&A, <tags>, “quotes” — and &lt;');
  });

  it('records an entry with no title as null rather than inventing one', () => {
    const t = parseFeed('<feed><entry><id>https://arxiv.org/abs/2401.00001</id><title/></entry></feed>');
    expect(t.has('2401.00001')).toBe(true);
    expect(t.get('2401.00001')).toBeNull();
  });
});

describe('arxivId and paperKey name one paper however it is spelled', () => {
  it.each([
    ['arXiv:2502.16982', '2502.16982'],
    ['arXiv:2502.16982v3', '2502.16982v3'],
    ['arXiv:cs/9605103', 'cs/9605103'],
    ['arXiv:cs.LG/0701001', 'cs.LG/0701001'],
  ])('arxivId(%s) is %s', (ref, id) => {
    expect(arxivId(ref)).toBe(id);
  });

  it('arxivId is null for a ref that is not an arXiv id', () => {
    expect(arxivId('Vaswani 2017')).toBeNull();
  });

  it.each([
    ['2502.16982v3', '2502.16982'],
    ['cs/9605103v1', 'cs/9605103'],
    ['cs.LG/0701001', 'cs/0701001'],
  ])('paperKey(%s) is %s', (id, paper) => {
    expect(paperKey(id)).toBe(paper);
  });
});

describe('the requests arXiv receives (#558, acceptance test 4)', () => {
  // 250 papers make three lookups, the last one partial. Every fiftieth stored
  // title is wrong, so title searches run too and the spacing covers both.
  const ids = Array.from({ length: 250 }, (_, i) => `2401.${String(i).padStart(5, '0')}`);
  const held = Object.fromEntries(ids.map((id, i) => [id, `Paper number ${i}`]));
  const citations = ids.map((id, i) =>
    cite(`node-${i}`, `arXiv:${id}`, i % 50 === 0 ? `Something else entirely, ${i}` : `Paper number ${i}`),
  );

  async function run(gapSeconds?: number) {
    const arxiv = fakeArxiv({ held });
    const out = capture();
    const code = await identityCheck(citations, {
      fetchImpl: arxiv.fetchImpl,
      sleep: arxiv.sleep,
      gapSeconds,
      ...out.io,
    });
    return { calls: arxiv.calls, code };
  }

  const gaps = (calls: Call[]) => calls.slice(1).map((c, i) => c.at - calls[i]!.at);

  it('asks for at most 100 ids a request, and for as many results as ids', async () => {
    const { calls, code } = await run();
    expect(code).toBe(1);
    const lookups = calls.filter((c) => c.url.includes('id_list='));
    expect(lookups).toHaveLength(3);
    const asked = lookups.map((c) => new URL(c.url).searchParams);
    for (const q of asked) {
      const batch = q.get('id_list')!.split(',');
      expect(batch.length).toBeLessThanOrEqual(100);
      // The API stops at ten results unless told otherwise.
      expect(q.get('max_results')).toBe(String(batch.length));
    }
    expect(asked.flatMap((q) => q.get('id_list')!.split(',')).sort()).toEqual([...ids].sort());
    expect(ARXIV_BATCH).toBe(100);
  });

  it('leaves at least 3 s between requests, title searches included', async () => {
    const { calls } = await run();
    expect(calls.filter((c) => c.url.includes('search_query='))).toHaveLength(5);
    expect(gaps(calls).every((ms) => ms >= 3000)).toBe(true);
    expect(ARXIV_GAP_SECONDS).toBe(3);
  });

  it('names the repository in the User-Agent of every request', async () => {
    const { calls } = await run();
    expect(USER_AGENT).toContain('github.com/opendroid/the-infinity');
    for (const c of calls) expect(c.headers['User-Agent']).toBe(USER_AGENT);
  });

  it('waits longer when the host’s robots.txt asks for longer', async () => {
    const { calls } = await run(15);
    expect(gaps(calls).every((ms) => ms >= 15_000)).toBe(true);
  });

  it('never waits less than 3 s, whatever the host states', async () => {
    const { calls } = await run(1);
    expect(gaps(calls).every((ms) => ms >= 3000)).toBe(true);
  });

  it('spaces a retry too, even when Retry-After says 0', async () => {
    // politeFetch retries a 503; the gap has to wrap each attempt, or this
    // header would send the retry straight back.
    // One paper whose title matches, so the only requests are the refused one
    // and its retry.
    const arxiv = fakeArxiv({ held, statuses: [503] });
    const code = await identityCheck(citations.slice(1, 2), {
      fetchImpl: arxiv.fetchImpl,
      sleep: arxiv.sleep,
      ...capture().io,
    });
    expect(code).toBe(0);
    expect(arxiv.calls).toHaveLength(2);
    expect(gaps(arxiv.calls)).toEqual([3000]);
  });
});

describe('identityCheck exits the way this script always has (#558, acceptance tests 5 and 6)', () => {
  const held = {
    '1706.03762': 'Attention Is All You Need',
    '1810.04805': 'BERT: Pre-training of Deep Bidirectional Transformers for Language\n  Understanding',
    '1512.03385': 'Deep Residual Learning for Image Recognition',
  };

  async function check(citations: Citation[], arxiv = fakeArxiv({ held })) {
    const out = capture();
    const code = await identityCheck(citations, { fetchImpl: arxiv.fetchImpl, sleep: arxiv.sleep, ...out.io });
    return { code, ...out, calls: arxiv.calls };
  }

  it('exits 0 when every title is arXiv’s, printing the near ones as warnings', async () => {
    const r = await check([
      cite('attention', 'arXiv:1706.03762', 'Attention Is All You Need'),
      cite('transformer', 'arXiv:1706.03762', 'Attention Is All You Need'),
      cite('bert', 'arXiv:1810.04805', 'Pre-training of Deep Bidirectional Transformers for Language Understanding'),
    ]);
    expect(r.code).toBe(0);
    expect(r.out.join('\n')).toMatch(/~ arXiv:1810\.04805 — nearly arXiv's title \(similarity 0\.93\), so a warning/);
    expect(r.out.at(-1)).toBe("✓ 3 citation(s) across 2 paper(s) carry arXiv's own title — 1 only nearly, warned above");
    expect(r.err).toEqual([]);
  });

  it('exits 1 on a wrong title, naming the node, the ref, both titles and the candidate', async () => {
    // A real paper under another paper's id. The search finds it exactly, and
    // finds a sibling nearly; only the exact one is a candidate.
    const arxiv = fakeArxiv({
      held,
      search: {
        'deep residual learning for image recognition': [
          ['2401.99999', 'Deep Residual Learning for Image Recognition, Revisited'],
          ['1512.03385', 'Deep Residual Learning for Image Recognition'],
        ],
      },
    });
    const r = await check([cite('residual-connection', 'arXiv:1706.03762', 'Deep Residual Learning for Image Recognition')], arxiv);
    expect(r.code).toBe(1);
    const report = r.err.join('\n');
    expect(report).toContain('✗ arXiv:1706.03762 — the stored title is not arXiv\'s title for this id');
    expect(report).toContain('node(s):   residual-connection');
    expect(report).toContain('stored:    Deep Residual Learning for Image Recognition');
    expect(report).toContain('arXiv:     Attention Is All You Need');
    expect(report).toContain('candidate: arXiv:1512.03385');
    expect(r.all()).not.toContain('✓');
  });

  it('prints candidate: none when the search finds only a near match', async () => {
    const arxiv = fakeArxiv({
      held,
      search: {
        'deep residual learning for image recognition': [
          ['2401.99999', 'Deep Residual Learning for Image Recognition, Revisited'],
        ],
      },
    });
    const r = await check([cite('resnet', 'arXiv:1706.03762', 'Deep Residual Learning for Image Recognition')], arxiv);
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toMatch(/candidate: none$/m);
  });

  it('says the search failed rather than that it found nothing', async () => {
    // The lookup answers; the search cannot reach the host.
    const arxiv = fakeArxiv({ held });
    const r = await check([cite('resnet', 'arXiv:1706.03762', 'Deep Residual Learning for Image Recognition')], {
      ...arxiv,
      fetchImpl: async (url, init) => {
        if (url.includes('search_query=')) throw new TypeError('fetch failed');
        return arxiv.fetchImpl(url, init);
      },
    });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('candidate: none (the title search failed: could not reach export.arxiv.org (fetch failed))');
  });

  it('searches once per stored title, however many nodes carry it', async () => {
    const r = await check([
      cite('resnet', 'arXiv:1706.03762', 'Deep Residual Learning for Image Recognition'),
      cite('skip-connection', 'arXiv:1706.03762', 'Deep Residual Learning for Image Recognition'),
    ]);
    expect(r.code).toBe(1);
    expect(r.calls.filter((c) => c.url.includes('search_query='))).toHaveLength(1);
    expect(r.err.join('\n')).toContain('node(s):   resnet, skip-connection');
  });

  it('exits 2, with no success line, when the fetch throws', async () => {
    // #558, sabotage 4: expecting 0 here instead must fail.
    const r = await check(
      [
        cite('attention', 'arXiv:1706.03762', 'Attention Is All You Need'),
        cite('bert', 'arXiv:1810.04805', 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding'),
      ],
      fakeArxiv({ fail: new TypeError('fetch failed') }),
    );
    expect(r.code).toBe(2);
    expect(r.all()).not.toContain('✓');
    expect(r.err.join('\n')).toContain('2 citation(s) NOT checked for identity');
    expect(r.err.join('\n')).toContain('could not reach export.arxiv.org (fetch failed)');
  });

  it('exits 2 when arXiv answers with none of the papers asked for — the service, not wrong titles', async () => {
    const r = await check([cite('attention', 'arXiv:1706.03762', 'Attention Is All You Need')], fakeArxiv({ held: {} }));
    expect(r.code).toBe(2);
    expect(r.all()).not.toContain('✗');
    expect(r.all()).not.toContain('✓');
  });

  it('exits 2 when arXiv is still asking us to slow down after the retries', async () => {
    const r = await check(
      [cite('attention', 'arXiv:1706.03762', 'Attention Is All You Need')],
      fakeArxiv({ held, statuses: [503, 503, 503] }),
    );
    expect(r.code).toBe(2);
    expect(r.err.join('\n')).toContain('still asked us to slow down after retrying (HTTP 503)');
  });

  it('exits 2 for a citation that is not an arXiv id, and says why', async () => {
    const r = await check([
      cite('attention', 'arXiv:1706.03762', 'Attention Is All You Need'),
      { node: 'transformer', ref: 'Vaswani 2017', title: 'Attention Is All You Need', url: 'https://papers.nips.cc/paper/7181' },
    ]);
    expect(r.code).toBe(2);
    expect(r.err.join('\n')).toContain('1 citation(s): not an arXiv id');
    expect(r.all()).not.toContain('✓');
  });

  it('exits 1, not 2, when a wrong title and an unchecked citation come together', async () => {
    const r = await check([
      cite('resnet', 'arXiv:1706.03762', 'Deep Residual Learning for Image Recognition'),
      { node: 'transformer', ref: 'Vaswani 2017', title: 'Attention Is All You Need', url: 'https://papers.nips.cc/paper/7181' },
    ]);
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('NOT checked for identity');
  });

  it('says out loud that an empty corpus is not a pass', async () => {
    const r = await check([]);
    expect(r.code).toBe(0);
    expect(r.out).toEqual(['· no citations in /content/nodes — nothing to check (this is not a pass)']);
    expect(r.calls).toEqual([]);
  });
});

describe('the command line (#558, acceptance test 1)', () => {
  // Spawned from web/, as `npm run` does: the script resolves /content from the
  // working directory (CLAUDE.md §7).
  const run = (...flags: string[]) =>
    spawnSync(process.execPath, ['scripts/check-citations.mjs', ...flags], { cwd: process.cwd(), encoding: 'utf8' });

  it('--offline still runs only the structural checks', () => {
    const r = run('--offline');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^✓ \d+ citation\(s\) structurally consistent — NOT resolved \(--offline\)$/m);
  });

  it('--offline wins over --identity, so an offline run still reaches nothing', () => {
    const r = run('--offline', '--identity');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/NOT resolved \(--offline\)/);
    expect(r.stdout + r.stderr).not.toMatch(/identity|arXiv's own title/);
  });
});
