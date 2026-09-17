import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  dismissals,
  DEFAULT_MIN_SCORE,
  durationSeconds,
  facets,
  floored,
  inDegree,
  outcome,
  paced,
  pending,
  queryFor,
  readDismissed,
  readNodes,
  refusals,
  reportLine,
  score,
  search,
  staleDismissals,
  targets,
  STOP_AFTER_REFUSALS,
  UNWATCHED,
  unknownTargets,
  WEIGHTS,
  withRetry,
} from '../../scripts/find-video-explainers.mjs';

/**
 * The pure half of the video-explainer finder (#384).
 *
 * The API half is not tested here and deliberately so: a test that mocks
 * YouTube proves this file agrees with its own mock. What IS worth pinning is
 * the targeting order, the duration parser, and the shape of the ranking —
 * because those decide what a reviewer sees first, and a reviewer reads the top
 * of the list.
 */

/** The shape targets() returns — the .mjs carries no types of its own. */
type Target = {
  scope: 'concept' | 'domain';
  key: string;
  title: string;
  covers?: number;
  sample?: string[];
};

/** A candidate with `score()`'s result spread onto it — what `floored` returns. */
type Scored = { title: string; author: string; views: number; score: number; reasons: string[] };

const node = (id: string, domain: string[], adjacent: string[] = []) => ({
  id,
  title: id,
  domain,
  edges: { requires: [], adjacent: adjacent.map((a) => ({ id: a })) },
});

describe('targets picks domains first, biggest first', () => {
  it('orders domains by how many concepts they cover', () => {
    // Not cosmetic. Quota runs out mid-run by design, so when it does it should
    // have covered the most concepts rather than the alphabetically luckiest.
    const t = targets([
      node('a', ['Foundations']),
      node('b', ['Foundations']),
      node('c', ['Foundations']),
      node('d', ['Alignment']),
      node('e', ['Methods']),
      node('f', ['Methods']),
    ]);
    expect(t.map((x: Target) => x.key)).toEqual(['Foundations', 'Methods', 'Alignment']);
    expect(t[0]).toMatchObject({ scope: 'domain', covers: 3 });
  });

  it('counts a concept once per domain it belongs to', () => {
    const t = targets([node('a', ['Foundations', 'Methods']), node('b', ['Methods'])]);
    expect(t.find((x: Target) => x.key === 'Methods')?.covers).toBe(2);
    expect(t.find((x: Target) => x.key === 'Foundations')?.covers).toBe(1);
  });

  it('picks the most-referenced concepts to stand for a domain', () => {
    // Half the domain names are filing labels — "Methods", "Core" — so the
    // query is built from what the domain CONTAINS. Alphabetical order would
    // make every domain look like whatever its "A" concepts are, hence
    // in-degree.
    // DELIBERATELY IN THE WRONG ORDER. Listed most-obscure-first, so corpus
    // order and centrality order disagree — otherwise dropping the sort would
    // still pass and this test would prove nothing.
    const nodes = [
      node('zzz-obscure', ['Core']),
      node('gpt', ['Core'], ['transformer']),
      node('transformer', ['Core'], ['softmax', 'attention']),
      node('attention', ['Core'], ['softmax']),
      node('softmax', ['Core']),
    ];
    // Five members, three sampled: softmax(2), attention(1), transformer(1).
    // gpt and zzz-obscure are referenced by nothing and fall out.
    const core = targets(nodes).find((t: Target) => t.key === 'Core');
    expect(core?.sample).toContain('softmax');
    expect(core?.sample).not.toContain('zzz-obscure');
  });

  it('builds a domain query from the samples, not the label alone', () => {
    const nodes = [node('softmax', ['Core']), node('attention', ['Core'], ['softmax'])];
    const core = targets(nodes).find((t: Target) => t.key === 'Core');
    expect(queryFor(core)).toContain('softmax');
  });

  it('switches to concept scope on request', () => {
    // A concept carries a sample too, as of #504 — its declared neighbours. It
    // is empty here because this fixture declares no edges, and the assertion
    // that it must never exist was the belief that "a concept target is already
    // as specific as it gets". Thirty concepts were dismissed on that belief.
    const t = targets([node('speculative-decoding', ['Inference'])], { concepts: true });
    expect(t).toEqual([
      { scope: 'concept', key: 'speculative-decoding', title: 'speculative-decoding', sample: [] },
    ]);
  });
});

describe('facets are the separate things a target is about', () => {
  it('splits a domain into its label and each sample', () => {
    expect(facets({ scope: 'domain', title: 'Core', sample: ['Attention', 'Softmax'] }))
      .toEqual(['Core', 'Attention', 'Softmax']);
  });
  it('leaves a concept as itself alone', () => {
    expect(facets({ scope: 'concept', title: 'speculative-decoding' })).toEqual(['speculative-decoding']);
  });
});

describe('inDegree counts who points at whom', () => {
  it('counts references across every edge kind, and zero for the unreferenced', () => {
    const d = inDegree([node('a', ['X'], ['b', 'c']), node('b', ['X'], ['c'])]);
    expect(d.get('c')).toBe(2);
    expect(d.get('b')).toBe(1);
    expect(d.get('a')).toBeUndefined();
  });
});

describe('queryFor asks a different question at each scope', () => {
  it('collapses whitespace when a domain has no samples', () => {
    expect(queryFor({ scope: 'domain', title: 'Alignment' })).toBe('Alignment explained');
  });

  it('names the field a concept belongs to, so a homonym has something to lose to (#401)', () => {
    // `ablation explained` returned a cardiac ablation patient guide, at 0.55,
    // as the top candidate. Seven of the first 41 concepts went that way.
    expect(queryFor({ scope: 'concept', title: 'Ablation' })).toBe('Ablation machine learning explained');
  });

  it('leaves a domain query alone — its samples already disambiguate it', () => {
    // The domain pass never hit the homonym problem, so this must not "fix" it
    // there and disturb the queries that produced the ten shipped picks.
    expect(queryFor({ scope: 'domain', title: 'Core', sample: ['Attention', 'Softmax'] }))
      .toBe('Core Attention Softmax explained');
  });

  it('does not let the field leak into scoring', () => {
    // The whole safety argument for #401 is that `facets` is untouched: the
    // field steers what YouTube offers and contributes nothing to overlap, so
    // `attention` at 0.97 stays at 0.97.
    expect(facets({ scope: 'concept', title: 'Ablation' })).toEqual(['Ablation']);
  });
});

describe('durationSeconds reads the shapes YouTube emits', () => {
  it.each([
    ['PT12M30S', 750],
    ['PT1H2M3S', 3723],
    ['PT45S', 45],
    ['PT2H', 7200],
  ])('%s → %i', (iso, secs) => {
    expect(durationSeconds(iso)).toBe(secs);
  });

  it('returns null rather than 0 for something it cannot read', () => {
    // 0 would score as "too short" and quietly bury the candidate. Null means
    // "unknown", which the scorer leaves alone.
    expect(durationSeconds('P1D')).toBeNull();
    expect(durationSeconds(undefined)).toBeNull();
  });
});

describe('score ranks plausibly and says why', () => {
  const target = { scope: 'domain' as const, title: 'Attention', key: 'Attention' };
  const base = {
    channelId: 'UC-unknown',
    title: 'Attention explained',
    author: 'Some Channel',
    durationSeconds: 900,
    views: '10000',
  };

  it('puts an allowlisted channel above an unknown one, all else equal', () => {
    const allowed = new Set(['UC-good']);
    const good = score({ ...base, channelId: 'UC-good' }, target, allowed);
    const unknown = score(base, target, allowed);
    expect(good.score).toBeGreaterThan(unknown.score);
    expect(good.reasons).toContain('allowlisted channel');
  });

  it('credits a named author even off the allowlist', () => {
    const r = score({ ...base, author: 'Andrej Karpathy' }, target, new Set());
    expect(r.reasons).toContain('named author');
  });

  it('penalises a short, and rewards a teachable length', () => {
    const short = score({ ...base, durationSeconds: 45 }, target, new Set());
    const teachable = score(base, target, new Set());
    expect(short.reasons).toContain('too short');
    expect(teachable.reasons).toContain('teachable length');
    expect(teachable.score).toBeGreaterThan(short.score);
  });

  it('does not let views outweigh relevance', () => {
    // A wildly popular video about nothing related must not outrank a modest
    // one that is actually on topic. This is the guard on that.
    const popularIrrelevant = score(
      { ...base, title: 'my holiday vlog', views: '900000000' },
      target,
      new Set(),
    );
    const modestRelevant = score({ ...base, views: '500' }, target, new Set());
    expect(modestRelevant.score).toBeGreaterThan(popularIrrelevant.score);
  });

  /**
   * #432: relevance must outweigh reputation, and it did not.
   *
   * The allowlist paid 0.40 and a perfect topic match paid 0.30, so an
   * allowlisted video about something else reached 0.67 while the ceiling for
   * an exact match from any other channel was 0.60. Measured on the live
   * sweep: 8 of 181 targets had a top pick that matched NOTHING, all of them
   * 3Blue1Brown or StatQuest, and 14 had a better match ranked lower.
   */
  describe('relevance outweighs reputation (#432)', () => {
    const concept = { scope: 'concept' as const, title: 'Early Exit', key: 'early-exit' };

    it('keeps the weights in an order that cannot invert again', () => {
      // The invariant, stated as arithmetic rather than as a comment: a PERFECT
      // match from an unknown channel must beat a HALF match from a trusted
      // one. Raise the allowlist back above half the overlap term and this
      // fails — which is the whole point of asserting it here.
      expect(WEIGHTS.allowlist).toBeLessThan(WEIGHTS.overlap / 2);
      expect(WEIGHTS.namedAuthor).toBeLessThan(WEIGHTS.allowlist);
    });

    it('disqualifies a video that shares no word with the concept, whoever made it', () => {
      // The real case: early-exit was offered 3Blue1Brown's neural network
      // primer at 0.67 on zero overlap — 0.40 + 0.20 + log10(24,210,799)/100.
      const allowed = new Set(['UC-3b1b']);
      const r = score(
        {
          channelId: 'UC-3b1b',
          title: 'But what is a neural network? | Deep learning chapter 1',
          author: '3Blue1Brown',
          durationSeconds: 1140,
          views: '24210799',
        },
        concept,
        allowed,
      );
      expect(r.score).toBe(0);
      expect(r.reasons).toEqual(['no topic overlap']);
    });

    it('ranks a perfect match from an unknown channel above a half match from a trusted one', () => {
      const allowed = new Set(['UC-statquest']);
      const trustedHalf = score(
        {
          channelId: 'UC-statquest',
          title: 'StatQuest: Hierarchical Clustering',
          author: 'StatQuest with Josh Starmer',
          durationSeconds: 700,
          views: '566380',
        },
        { scope: 'concept' as const, title: 'Hierarchical RL', key: 'hierarchical-rl' },
        allowed,
      );
      const unknownExact = score(
        {
          channelId: 'UC-chandar',
          title: 'Hierarchical RL | Reinforcement Learning | Lecture 11',
          author: 'chandar-lab',
          durationSeconds: 2000,
          views: '1011',
        },
        { scope: 'concept' as const, title: 'Hierarchical RL', key: 'hierarchical-rl' },
        allowed,
      );
      expect(unknownExact.score).toBeGreaterThan(trustedHalf.score);
    });

    it('still lets a trusted channel win when it IS on topic', () => {
      // The fix must not throw away what the allowlist is for. StatQuest's
      // logistic regression video is the right answer for logistic-regression
      // and has to stay the right answer.
      const allowed = new Set(['UC-statquest']);
      const t = { scope: 'concept' as const, title: 'Logistic Regression', key: 'logistic-regression' };
      const statquest = score(
        {
          channelId: 'UC-statquest',
          title: 'StatQuest: Logistic Regression',
          author: 'StatQuest with Josh Starmer',
          durationSeconds: 500,
          views: '2802552',
        },
        t,
        allowed,
      );
      const lesser = score(
        {
          channelId: 'UC-other',
          title: 'Logistic Regression in five minutes',
          author: 'Someone',
          durationSeconds: 300,
          views: '900',
        },
        t,
        allowed,
      );
      expect(statquest.score).toBeGreaterThan(lesser.score);
    });
  });

  it('lets a video about ONE sampled concept clear the bar on a broad domain', () => {
    // THE #386 REGRESSION, WITH ITS REAL NUMBERS. Scoring against the union of
    // {foundations, softmax, convolutional, network, tokenization} gave a
    // perfect softmax video 20% overlap and a score of 0.307 — under the 0.35
    // default threshold. 53 of 97 domains reported zero candidates that way,
    // every one of the ten largest among them. Best-facet scoring makes it 100%
    // against "Softmax".
    const foundations = {
      scope: 'domain' as const,
      key: 'Foundations',
      title: 'Foundations',
      sample: ['Softmax', 'Convolutional Network', 'Tokenization'],
    };
    const perfect = { ...base, title: 'Softmax explained', views: '50000' };
    const r = score(perfect, foundations, new Set());
    expect(r.score).toBeGreaterThanOrEqual(0.35);
    expect(r.reasons).toContain('matches "Softmax" 100%');
  });

  it('still filters an unrelated video on that same broad domain', () => {
    // The other half of the fix: widening what counts as a match must not turn
    // the threshold off. A holiday vlog stays out.
    const foundations = {
      scope: 'domain' as const,
      key: 'Foundations',
      title: 'Foundations',
      sample: ['Softmax', 'Convolutional Network', 'Tokenization'],
    };
    const vlog = { ...base, title: 'my holiday vlog', views: '900000000' };
    expect(score(vlog, foundations, new Set()).score).toBeLessThan(0.35);
  });

  it('scores relevance against a domain’s samples, not just its label', () => {
    // The bug this guards: with only the label, a video titled "Research
    // Methods" scores full overlap on the domain "Methods" while teaching
    // nothing in it.
    const labelOnly = { scope: 'domain' as const, title: 'Core', key: 'Core' };
    const withSamples = { ...labelOnly, sample: ['Attention', 'Softmax'] };
    const onTopic = { ...base, title: 'Attention and Softmax, explained' };
    expect(score(onTopic, withSamples, new Set()).score).toBeGreaterThan(
      score(onTopic, labelOnly, new Set()).score,
    );
  });

  it('sinks a video nobody has watched, however well its title matches', () => {
    // #395. The positive views term spans 0.000 to 0.070 across the whole
    // plausible range — less than the 0.2 for being a teachable length — and
    // never goes negative, so a 1-view content farm with a perfect title match
    // scored 0.50 and landed near the top of a reviewer's list. 60 of 230
    // candidates in the second search were under 500 views.
    const perfectMatch = { ...base, title: 'Attention explained', views: '1' };
    const r = score(perfectMatch, target, new Set());
    expect(r.score).toBeLessThan(0.35);
    expect(r.reasons).toContain('almost unwatched (1 views)');
  });

  it('does NOT demote a trusted channel with no views yet', () => {
    // A new StatQuest video legitimately has an empty counter.
    const fresh = { ...base, channelId: 'UC-good', views: '3' };
    const r = score(fresh, target, new Set(['UC-good']));
    expect(r.reasons).not.toContain('almost unwatched (3 views)');
    expect(r.score).toBeGreaterThanOrEqual(0.35);
  });

  it('leaves a niche-but-real video alone at 16,801 views', () => {
    // THE CASE THAT KILLED THE FIRST ATTEMPT. Widening the curve to punish 22
    // views made it weaker than the original around 20,000, and demoted the
    // IEEE S&P Membership Inference talk — already shipped — from 0.3547 to
    // 0.3495. Conference talks and university lectures live in that band, so
    // the fix adds a floor and leaves the positive term untouched.
    const niche = { ...base, views: '16801' };
    const withFloor = score(niche, target, new Set());
    const wellWatched = score({ ...base, views: '9511886' }, target, new Set());
    expect(withFloor.reasons).not.toContain('almost unwatched (16801 views)');
    // The prior stays weak on purpose: 9.5M views is worth under 0.03 more.
    expect(wellWatched.score - withFloor.score).toBeLessThan(0.03);
  });

  it('stays within 0..1', () => {
    const best = score(
      { ...base, channelId: 'UC-good', author: 'Andrej Karpathy', views: '99999999' },
      target,
      new Set(['UC-good']),
    );
    expect(best.score).toBeLessThanOrEqual(1);
    expect(best.score).toBeGreaterThanOrEqual(0);
  });
});

describe('withRetry tells a burst limit from the daily cap', () => {
  const quota = () => {
    const q = { spent: 0, charge() { this.spent += 100; } };
    return q;
  };

  it('retries rateLimitExceeded with 5s/15s backoff, long enough to clear the window', async () => {
    // Injected clock, so the interval is asserted rather than waited out.
    const slept: number[] = [];
    const q = quota();
    let calls = 0;
    const out = await withRetry('search', q, async () => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error('rate'), { reason: 'rateLimitExceeded' });
      return 'ok';
    }, { sleep: async (ms: number) => { slept.push(ms); } });

    expect(out).toBe('ok');
    expect(calls).toBe(3);
    // The old 2s/4s never cleared it: all three attempts failed together and
    // fourteen targets were lost outright in one run.
    expect(slept).toEqual([5000, 15000]);
  });

  it('charges once per operation, however many attempts it takes', async () => {
    const q = quota();
    await withRetry('search', q, async () => 'ok', { sleep: async () => {} });
    expect(q.spent).toBe(100);
  });

  it('charges once even when every attempt is refused', async () => {
    // PLANTED AGAINST THE REAL DEFECT (#400). Charging per attempt spent 9,951
    // units on 4,151 units of work — 58% of a day's quota went to requests
    // YouTube had already refused. Move `charge` back inside the loop and this
    // reads 300.
    const q = quota();
    await expect(withRetry('search', q, async () => {
      throw Object.assign(new Error('still busy'), { reason: 'rateLimitExceeded' });
    }, { sleep: async () => {}, attempts: 3 })).rejects.toThrow('still busy');
    expect(q.spent).toBe(100);
  });

  it('never retries quotaExceeded — that one means come back tomorrow', async () => {
    const q = quota();
    let calls = 0;
    await expect(withRetry('search', q, async () => {
      calls += 1;
      throw Object.assign(new Error('done for today'), { reason: 'quotaExceeded' });
    }, { sleep: async () => {} })).rejects.toThrow('done for today');
    expect(calls).toBe(1);
    expect(q.spent).toBe(100);
  });

  it('gives up after the attempt limit rather than looping forever', async () => {
    const q = quota();
    let calls = 0;
    await expect(withRetry('search', q, async () => {
      calls += 1;
      throw Object.assign(new Error('still busy'), { reason: 'rateLimitExceeded' });
    }, { sleep: async () => {}, attempts: 3 })).rejects.toThrow('still busy');
    expect(calls).toBe(3);
  });
});

describe('paced leaves a gap between searches, not around them', () => {
  const drain = async (items: string[], ms?: number) => {
    const slept: number[] = [];
    const seen: string[] = [];
    const opts = { pace: async (n: number) => { slept.push(n); }, ...(ms === undefined ? {} : { ms }) };
    for await (const item of paced(items, opts)) seen.push(item);
    return { slept, seen };
  };

  it('waits between consecutive targets and yields them in order', async () => {
    const { slept, seen } = await drain(['a', 'b', 'c'], 1500);
    expect(seen).toEqual(['a', 'b', 'c']);
    // Two gaps for three targets. A third would be a wait after the last one,
    // which buys nothing.
    expect(slept).toEqual([1500, 1500]);
  });

  it('does not wait before the first target', async () => {
    expect((await drain(['only'], 1500)).slept).toEqual([]);
  });

  it('does nothing at all on an empty list', async () => {
    expect(await drain([], 1500)).toEqual({ slept: [], seen: [] });
  });

  it('paces by default, so a caller cannot forget to', async () => {
    // The whole point of #400 is that avoiding the limit beats reacting to it.
    // A default of zero would make the fix opt-in and the next --concepts run
    // would burn the same 58%.
    const { slept } = await drain(['a', 'b']);
    expect(slept).toHaveLength(1);
    expect(slept[0]).toBeGreaterThan(0);
  });
});

/**
 * #499. A target reaches "done with no candidates" honestly — an early
 * domain-scoped pass found nothing — and a later concept-scoped pass then
 * attaches a video from a different query. The checkpoint records the first
 * fact and nothing reconciles it with the second, so --redo-empty re-asked
 * YouTube about 24 of its 68 targets: 2,400 units against a 10,000/day tier.
 */
describe('a concept that already has a video is not barren (#499)', () => {
  const all = [
    { scope: 'concept' as const, key: 'throughput', title: 'Throughput' },
    { scope: 'concept' as const, key: 'grounding', title: 'Grounding' },
  ];
  // BOTH ARE done-AND-EMPTY, which is the only state --redo-empty acts on.
  // Differing only in coverage is what makes the assertion about coverage and
  // nothing else: a fixture where the covered one also had candidates would
  // pass whether or not `covered` is consulted at all, which is how the
  // dismissal fixture above went wrong the first time.
  const prior = { done: ['throughput', 'grounding'], candidates: [] };
  const covered = new Set(['grounding']);

  it('--redo-empty skips it, and still retries the one with no video', () => {
    expect(pending(all, prior, { redoEmpty: true, covered }).map((t: Target) => t.key))
      .toEqual(['throughput']);
  });

  it('REVERTING THE EXCLUSION IS VISIBLE HERE — without `covered`, both come back', () => {
    expect(pending(all, prior, { redoEmpty: true }).map((t: Target) => t.key))
      .toEqual(['throughput', 'grounding']);
  });

  it('--redo names it anyway, because a video you no longer trust is a reason', () => {
    expect(pending(all, prior, { redo: ['grounding'], covered }).map((t: Target) => t.key))
      .toEqual(['grounding']);
  });

  it('a covered target that was never searched is still searched', () => {
    expect(pending(all, { done: [], candidates: [] }, { covered }).map((t: Target) => t.key))
      .toEqual(['throughput', 'grounding']);
  });

  /**
   * THE UNIT TESTS ABOVE CANNOT SEE A CALL-SITE MISTAKE, and I proved it by
   * planting one: dropping `covered` from main()'s pending() call leaves all 77
   * of them passing, because they call pending() directly. The exclusion is
   * only worth anything if main() actually passes the set, so the wiring is
   * asserted the way ci-workflow.test.ts asserts a workflow's `run:` lines —
   * by reading the source, which is blunt and is the only reader there is.
   */
  it('main() passes covered to pending, or the exclusion is decorative', () => {
    const src = readFileSync(
      new URL('../../scripts/find-video-explainers.mjs', import.meta.url),
      'utf8',
    );
    const call = /const todo = pending\(([^;]*)\);/.exec(src);
    expect(call, 'main() no longer calls pending() in the expected shape').not.toBeNull();
    expect(call![1]).toContain('covered');
  });
});

describe('pending knows that "done" is not "found something"', () => {
  const all = [
    { key: 'Foundations', scope: 'domain' as const, title: 'Foundations' },
    { key: 'Attention', scope: 'domain' as const, title: 'Attention' },
    { key: 'Numerics', scope: 'domain' as const, title: 'Numerics' },
  ];
  // Foundations completed and found nothing; Attention found one; Numerics errored.
  const prior = {
    done: ['Foundations', 'Attention'],
    candidates: [{ target: 'Attention', url: 'https://www.youtube.com/watch?v=x' }],
  };

  it('skips everything already done by default', () => {
    expect(pending(all, prior).map((t: Target) => t.key)).toEqual(['Numerics']);
  });

  it('re-attempts the barren ones under --redo-empty, and only those', () => {
    // Without this the 53 domains a scoring fix was written for are exactly the
    // ones a re-run would skip.
    expect(pending(all, prior, { redoEmpty: true }).map((t: Target) => t.key)).toEqual(['Foundations', 'Numerics']);
  });

  it('treats an absent checkpoint as everything to do', () => {
    expect(pending(all, { done: [], candidates: [] }).length).toBe(3);
  });

  it('re-queries a named target even though it was productive (#403)', () => {
    // THE DEFECT THIS REPLACES. Attention is done AND found something, so
    // --redo-empty skips it — which is exactly what happened to all seven
    // homonyms #401 was written for. Naming it must win over both facts.
    expect(pending(all, prior, { redo: ['Attention'] }).map((t: Target) => t.key))
      .toEqual(['Attention', 'Numerics']);
  });

  it('takes the union with --redo-empty rather than replacing it', () => {
    expect(pending(all, prior, { redoEmpty: true, redo: ['Attention'] }).map((t: Target) => t.key))
      .toEqual(['Foundations', 'Attention', 'Numerics']);
  });

  it('does not widen beyond what was named', () => {
    // A flag that quietly re-queried the corpus would spend a day finding what
    // it already had.
    expect(pending(all, prior, { redo: [] }).map((t: Target) => t.key)).toEqual(['Numerics']);
  });
});

describe('unknownTargets refuses a --redo id that names nothing', () => {
  const all = [
    { key: 'ablation', scope: 'concept' as const, title: 'Ablation' },
    { key: 'adam', scope: 'concept' as const, title: 'Adam' },
  ];

  it('names every id that matches no target', () => {
    // A typo that skips silently is the expensive failure: the run spends its
    // day elsewhere and the thing it was paid to re-test comes back untested.
    expect(unknownTargets(all, ['ablation', 'ablaton', 'alibi'])).toEqual(['ablaton', 'alibi']);
  });

  it('is empty when every id resolves', () => {
    expect(unknownTargets(all, ['adam', 'ablation'])).toEqual([]);
  });
});

/**
 * #429: the run kept paying for a refusal it could not recognise.
 *
 * Each target retries over about 20 seconds and then gives up, and the loop
 * starts the next one immediately — so a condition lasting ten minutes cost
 * thirty targets. On 2026-09-11 the sweep charged 99 searches and 30 of them,
 * roughly 3,000 units and a third of the day, bought nothing. Nothing carried
 * between targets, so "this one was unlucky" and "everything is being refused"
 * looked identical.
 */
describe('a sustained refusal stops the run (#429)', () => {
  const limited = { reason: 'rateLimitExceeded', message: 'youtube search: rateLimitExceeded' };

  it('counts refusals in a row', () => {
    expect(refusals(0, limited)).toBe(1);
    expect(refusals(2, limited)).toBe(3);
  });

  const clearing: Array<[string, unknown]> = [
    ['a success', null],
    ['no error at all', undefined],
    ['a failure of another kind', { reason: 'badRequest' }],
    ['the daily cap, which is handled separately', { reason: 'quotaExceeded' }],
  ];
  it.each(clearing)('%s clears the streak', (_name, err) => {
    expect(refusals(9, err as Error)).toBe(0);
  });

  it('stops well before a day can be spent', () => {
    // Three, because two in a row is plausibly coincidence and thirty is a
    // wasted day. If this is ever raised, the cost is quota — so it is asserted
    // rather than left to a comment.
    expect(STOP_AFTER_REFUSALS).toBeGreaterThanOrEqual(2);
    expect(STOP_AFTER_REFUSALS).toBeLessThanOrEqual(5);
  });

  it('reaches the limit after exactly STOP_AFTER_REFUSALS targets, not before', () => {
    let n = 0;
    const seen: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      n = refusals(n, limited);
      seen.push(n);
      if (n >= STOP_AFTER_REFUSALS) break;
    }
    expect(seen).toHaveLength(STOP_AFTER_REFUSALS);
    expect(seen[seen.length - 1]).toBe(STOP_AFTER_REFUSALS);
  });

  it('does not trip on refusals that are spread out', () => {
    // The case the stop must NOT fire on: an occasional burst limit between
    // successful targets is exactly what withRetry is for.
    let n = 0;
    for (const err of [limited, null, limited, null, limited, null]) {
      n = refusals(n, err as Error | null);
      expect(n).toBeLessThan(STOP_AFTER_REFUSALS);
    }
  });
});

/**
 * The `break` itself, which no unit test can see.
 *
 * Removing it outright left every other test in this file passing, which is
 * how this one came to exist: the rule and the wiring are different claims.
 * Drives the real loop against a YouTube that refuses every search.
 */
describe('the loop actually stops (#429)', () => {
  it('gives up after a run of refusals instead of spending the budget', async () => {
    const previous = process.env.YOUTUBE_API_KEY;
    process.env.YOUTUBE_API_KEY = 'test-key';
    const out = join(mkdtempSync(join(tmpdir(), 'fve-')), 'candidates.json');
    let searches = 0;

    const fake = (url: string | URL) => {
      const href = String(url);
      if (href.includes('/channels')) {
        return Promise.resolve(
          new Response(JSON.stringify({ items: [{ id: 'UC-x', snippet: { title: 'Chan' } }] }), { status: 200 }),
        );
      }
      searches += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }), { status: 403 }),
      );
    };

    try {
      vi.stubGlobal('fetch', fake);
      await search(['--concepts', '--out', out, '--budget', '10000'], {
        pace: () => Promise.resolve(),
        sleep: () => Promise.resolve(),
      });
    } finally {
      vi.unstubAllGlobals();
      if (previous === undefined) delete process.env.YOUTUBE_API_KEY;
      else process.env.YOUTUBE_API_KEY = previous;
    }

    // Three targets, three attempts each. Without the break the budget allows
    // ~99 targets and the run would make roughly 300 search calls before
    // stopping — which is the day that was lost on 2026-09-11.
    expect(searches).toBeLessThanOrEqual(STOP_AFTER_REFUSALS * 3);
    expect(searches).toBeGreaterThan(0);
  });
});

/**
 * #437: the state the checkpoint could not express.
 *
 * 32 targets after the 2026-09-11 sweep had been searched, produced candidates,
 * been read, and had every candidate rejected — and none of that was recorded,
 * so each pass re-read the same 32. #386 separated "done" from "found
 * something" and #403 added "found something I no longer trust"; this is the
 * fourth: "looked, and there is nothing worth attaching".
 */
describe('a dismissal is a state the checkpoint keeps (#437)', () => {
  const known = new Set(['custom-kernel', 'cold-start', 'attention']);

  describe('dismissals', () => {
    it('accepts a target with a reason', () => {
      const { entries, problems } = dismissals(
        [{ target: 'custom-kernel', reason: 'homonym — returns the kernel trick' }],
        known,
      );
      expect(problems).toEqual([]);
      expect(entries).toEqual([{ target: 'custom-kernel', reason: 'homonym — returns the kernel trick' }]);
    });

    const rejected: Array<[string, unknown, string]> = [
      ['no reason at all', { target: 'custom-kernel' }, 'no reason'],
      ['a blank reason', { target: 'custom-kernel', reason: '   ' }, 'no reason'],
      ['an unknown id', { target: 'nope', reason: 'because' }, 'not a concept id'],
      ['no target', { reason: 'because' }, 'no target'],
      ['nonsense', null, 'no target'],
    ];
    it.each(rejected)('rejects %s', (_name, pick, fragment) => {
      const { entries, problems } = dismissals([pick], known);
      expect(entries).toEqual([]);
      expect(problems.join(' ')).toContain(fragment);
    });

    it('reports every problem rather than stopping at the first', () => {
      // Nothing is written when anything is wrong, so the operator should see
      // the whole list in one pass instead of fixing them one run at a time.
      const { problems } = dismissals([{ target: 'nope', reason: 'x' }, { target: 'cold-start' }], known);
      expect(problems).toHaveLength(2);
    });
  });

  describe('pending honours it', () => {
    const all = [
      { scope: 'concept' as const, key: 'custom-kernel', title: 'Custom Kernel' },
      { scope: 'concept' as const, key: 'beam-search-tradeoffs', title: 'Beam Search Tradeoffs' },
      { scope: 'concept' as const, key: 'cold-start', title: 'Cold Start' },
      { scope: 'concept' as const, key: 'attention', title: 'Attention' },
    ];
    // custom-kernel:         searched, HAS candidates, dismissed as a homonym.
    // beam-search-tradeoffs: searched, found NOTHING, dismissed as hopeless.
    // cold-start:            searched, found nothing, NOT dismissed.
    // attention:             never searched.
    //
    // The barren-and-dismissed row is the one that matters and the one I first
    // left out. A dismissed target that still has candidates is skipped by
    // --redo-empty anyway, for being productive — so a fixture with only that
    // shape passes whether or not the dismissed list is consulted at all.
    // Planting proved exactly that.
    const prior = {
      done: ['custom-kernel', 'beam-search-tradeoffs', 'cold-start'],
      candidates: [{ target: 'custom-kernel' }],
    };
    // #439: the list is no longer part of the checkpoint. It is a committed
    // file, because `done` and `candidates` are caches an API can rebuild and
    // this is human judgment that nothing regenerates.
    const dismissed = [
      { target: 'custom-kernel', reason: 'homonym' },
      { target: 'beam-search-tradeoffs', reason: 'no teaching video exists' },
    ];

    it('leaves a dismissed target alone on an ordinary run', () => {
      expect(pending(all, prior, { dismissed }).map((t: Target) => t.key)).toEqual(['attention']);
    });

    it('--redo-empty does not resurrect a barren target that was dismissed', () => {
      // The case this exists for. cold-start is barren and NOT dismissed, so it
      // comes back; beam-search-tradeoffs is barren AND dismissed, so it does
      // not. Without the dismissed check the two are indistinguishable.
      const keys = pending(all, prior, { redoEmpty: true, dismissed }).map((t: Target) => t.key);
      expect(keys).toContain('cold-start');
      expect(keys).not.toContain('beam-search-tradeoffs');
      expect(keys).not.toContain('custom-kernel');
    });

    it('--redo names it and gets it back', () => {
      // A dismissal is a judgment, not a tombstone.
      const keys = pending(all, prior, { redo: ['custom-kernel'], dismissed }).map((t: Target) => t.key);
      expect(keys).toContain('custom-kernel');
    });
  });

  describe('the list is committed, not in the checkpoint (#439)', () => {
    it('reads content/explainers-dismissed.json', () => {
      // The file is in git, so this asserts the real corpus rather than a
      // fixture: a dismissal now survives the checkpoint being deleted, which
      // is the whole point of #439.
      const live = readDismissed();
      expect(live.length).toBeGreaterThan(0);
      for (const d of live) {
        expect(d.target, 'every dismissal names a target').toBeTruthy();
        expect(d.reason, `${d.target} has no reason`).toBeTruthy();
      }
    });

    it('names only concepts that exist', () => {
      // A committed file can be hand-edited, which is the point — and a typo'd
      // id would silently dismiss nothing at all.
      const ids = new Set(readNodes().map((n: { id: string }) => n.id));
      for (const d of readDismissed()) {
        expect(ids.has(d.target), `${d.target} is not a concept id`).toBe(true);
      }
    });

    it('does not carry a dismissal the corpus has overtaken', () => {
      const covered = new Set(
        readNodes()
          .filter((n: { explainers?: Array<{ kind: string }> }) =>
            (n.explainers ?? []).some((e) => e.kind === 'video'))
          .map((n: { id: string }) => n.id),
      );
      expect(staleDismissals(readDismissed(), covered)).toEqual([]);
    });
  });

  describe('staleDismissals', () => {
    it('names a dismissal the corpus has overtaken', () => {
      const dismissed = [{ target: 'custom-kernel', reason: 'x' }, { target: 'cold-start', reason: 'y' }];
      expect(staleDismissals(dismissed, new Set(['cold-start']))).toEqual(['cold-start']);
    });

    it('is quiet when none are stale', () => {
      expect(staleDismissals([{ target: 'custom-kernel', reason: 'x' }], new Set())).toEqual([]);
      expect(staleDismissals(undefined, new Set(['a']))).toEqual([]);
    });
  });
});

describe("a concept's neighbours are its query context (#504)", () => {
  /** A node whose edges span all three kinds, which the fixture above does not. */
  const linked = (id: string, title: string, edges: Record<string, string[]>) => ({
    id,
    title,
    domain: ['Systems'],
    edges: Object.fromEntries(
      Object.entries(edges).map(([kind, ids]) => [kind, ids.map((i) => ({ id: i }))]),
    ),
  });

  const corpus = [
    linked('throughput', 'Throughput', {
      requires: ['continuous-batching'],
      adjacent: ['tail-latency', 'accelerator-utilization', 'arithmetic-intensity'],
    }),
    linked('continuous-batching', 'Continuous Batching', {}),
    linked('tail-latency', 'Tail Latency', {}),
    linked('accelerator-utilization', 'Accelerator Utilization', {}),
    linked('arithmetic-intensity', 'Arithmetic Intensity', {}),
  ];

  it('borrows up to three neighbour titles, requires first', () => {
    const t = targets(corpus, { concepts: true }).find((x: Target) => x.key === 'throughput');
    expect(t?.sample).toEqual(['Continuous Batching', 'Tail Latency', 'Accelerator Utilization']);
  });

  it('builds the query a person would have typed', () => {
    // THE PLANT. Revert queryFor to `${title} ${FIELD} explained` and this is
    // "Throughput machine learning explained" — the query that was answered
    // with Fireship's "Machine Learning Explained in 100 Seconds", as were
    // code-generation, verifier-model and zero-redundancy-optimizer. One video,
    // four questions.
    const t = targets(corpus, { concepts: true }).find((x: Target) => x.key === 'throughput');
    expect(queryFor(t)).toBe('Throughput Continuous Batching Tail Latency Accelerator Utilization explained');
    expect(queryFor(t)).not.toContain('machine learning');
  });

  it('falls back to the field when a node declares no edges', () => {
    // Five concepts are in this state — softmax, tokenization, loss-function,
    // layer-normalization, markov-decision-process. Everything points at them
    // and they point at nothing, and their names are unambiguous enough that
    // #401's field is genuinely the best context available.
    const t = targets([linked('softmax', 'Softmax', {})], { concepts: true })[0];
    expect(t?.sample).toEqual([]);
    expect(queryFor(t)).toBe('Softmax machine learning explained');
  });

  it('drops an edge to a node that does not exist yet', () => {
    // The schema permits an edge to a concept planned in the same PR. A kebab
    // slug is noise in a query, so it is left out rather than searched for.
    const t = targets([linked('a', 'Alpha', { requires: ['not-written-yet'] })], { concepts: true })[0];
    expect(t?.sample).toEqual([]);
  });

  it('keeps neighbours out of scoring, whatever the query does with them', () => {
    // THE DECISION, NOT AN OMISSION. A domain contains its samples; a concept's
    // neighbour is a different concept with its own page, and ADR-0017 says
    // `explainers` is where a reader goes to be taught IT. Let neighbours into
    // facets and a Tail Latency video is attached to `throughput` at 100%.
    const t = targets(corpus, { concepts: true }).find((x: Target) => x.key === 'throughput');
    expect(facets(t)).toEqual(['Throughput']);

    const latencyVideo = {
      title: 'Tail Latency, clearly explained',
      author: 'Some Channel',
      channelId: 'UCx',
      views: 40_000,
      durationSeconds: 900,
    };
    expect(score(latencyVideo, t, new Set()).reasons).toEqual(['no topic overlap']);
  });
});

describe('"0 candidates" no longer means two different things (#503)', () => {
  const cand = (title: string, sc: number, reasons: string[]) => ({
    title,
    author: 'A Channel',
    score: sc,
    reasons,
  });

  const nothing: ReturnType<typeof cand>[] = [];
  const noOverlap = [cand('Machine Learning Explained in 100 Seconds', 0, ['no topic overlap'])];
  const floored = [
    cand("NSDI '13 - Effective Straggler Mitigation", 0.327, [
      'matches "Straggler" 100%',
      'teachable length',
      'almost unwatched (499 views)',
    ]),
  ];

  it('prints a different line for nothing returned than for nothing kept', () => {
    // THE PLANT, AND THE WHOLE ISSUE. Thirty concepts were dismissed in #502
    // with "YouTube returns nothing for this concept, not merely nothing good",
    // written off a number that could not tell those apart. All thirty had
    // returned five candidates each.
    const a = reportLine('straggler', nothing, 0.35);
    const b = reportLine('straggler', noOverlap, 0.35);
    expect(a).not.toBe(b);
    expect(a).toContain('nothing returned');
    expect(b).toContain('1 returned, none kept');
  });

  it('names the term that rejected the candidate, not the one in its favour', () => {
    // reasons[0] here is `matches "Straggler" 100%` — the reason it nearly
    // passed. Printing that as the reason it failed is worse than printing
    // nothing, because it reads as an explanation.
    expect(reportLine('straggler', floored, 0.35)).toContain('almost unwatched (499 views)');
    expect(reportLine('straggler', floored, 0.35)).not.toContain('best 0.33 (matches');
  });

  it('records the three states in the checkpoint, so a dismissal can cite one', () => {
    expect(outcome(nothing, 0.35)).toEqual({ returned: 0, kept: 0 });
    expect(outcome(noOverlap, 0.35)).toMatchObject({ returned: 1, kept: 0, reason: 'no topic overlap' });
    expect(outcome(floored, 0.35)).toMatchObject({
      returned: 1,
      kept: 0,
      best: 0.327,
      reason: 'almost unwatched (499 views)',
    });
  });

  it('says so plainly when nothing disqualifying fired', () => {
    const low = [cand('Something partly related', 0.3, ['matches "Offline-Online Gap" 50%'])];
    expect(outcome(low, 0.35).reason).toBe('nothing disqualifying, just a low score');
  });

  it('reports a kept candidate exactly as it always did', () => {
    const kept = [cand('Vectorization Low Rank Matrix Factorization', 0.777, ['matches "X" 100%'])];
    expect(reportLine('low-rank-factorization', kept, 0.35)).toContain(
      'best: 0.78 A Channel — Vectorization Low Rank Matrix Factorization',
    );
  });
});

describe('the view floor is a gate, and what it removes is written down (#505)', () => {
  const straggler = { scope: 'concept' as const, key: 'straggler', title: 'Straggler' };
  const video = (title: string, views: number, durationSeconds = 900) => ({
    title,
    author: 'USENIX',
    channelId: 'UCunknown',
    views,
    durationSeconds,
  });
  const rank = (raw: ReturnType<typeof video>[]) =>
    raw
      .map((c) => ({ ...c, ...score(c, straggler, new Set()) }))
      .sort((a, b) => b.score - a.score);

  describe('the invariant', () => {
    it('nothing under the view floor can pass, however perfectly it matches', () => {
      // THE RELATIONSHIP THIS FILE EXISTS TO PIN. `WEIGHTS.unwatched` is 0.45
      // against a 0.35 threshold, so the best an untrusted candidate can reach
      // while the floor applies is 0.327 — a perfect title match at a teachable
      // length with the views prior at its own maximum. That is a gate, not the
      // demotion #395's comment described, and it crossed the line by 0.023
      // when #432 rescaled it.
      //
      // IF THIS TEST FAILS, SOMEONE MOVED A WEIGHT OR THE THRESHOLD. That may
      // be deliberate — #505 lists retuning as a real option — but it changes
      // whether `floored` below can ever be empty, so it is a decision to make
      // on purpose rather than discover later.
      const best = score(video('Straggler, clearly explained', UNWATCHED - 1), straggler, new Set());
      expect(best.reasons).toContain(`almost unwatched (${UNWATCHED - 1} views)`);
      expect(best.score).toBeLessThan(DEFAULT_MIN_SCORE);

      // One view the other side of the boundary, and the same video is the best
      // thing in the run. That cliff is the point.
      const watched = score(video('Straggler, clearly explained', UNWATCHED), straggler, new Set());
      expect(watched.score).toBeGreaterThan(DEFAULT_MIN_SCORE);
      expect(watched.score - best.score).toBeGreaterThan(0.4);
    });

    it('lets the floor be switched off, which is how "would otherwise" is measured', () => {
      const c = video('Straggler, clearly explained', 412);
      expect(score(c, straggler, new Set(), { floor: false }).reasons).not.toContain(
        'almost unwatched (412 views)',
      );
      expect(score(c, straggler, new Set(), { floor: false }).score).toBeGreaterThan(
        DEFAULT_MIN_SCORE,
      );
    });
  });

  describe('floored', () => {
    it('holds what the floor alone kept out', () => {
      // THE PLANT. Remove the floor's effect from `floored` and this is empty,
      // which is the state that hid 17 of 30 concepts in the #503 diagnostic —
      // 11 of them on a 100% title match, this one among them.
      const scored = rank([
        video("NSDI '13 - Effective Straggler Mitigation", 412),
        video('Straggler talk', 40_000),
      ]);
      const held = floored(scored, straggler, new Set(), DEFAULT_MIN_SCORE);
      expect(held.map((c: Scored) => c.title)).toEqual(["NSDI '13 - Effective Straggler Mitigation"]);
    });

    it('leaves out anything the floor was not what stopped', () => {
      // A video sharing no word with the concept is stopped by the #432 gate and
      // would be stopped by it at any view count. Listing it as a near-miss
      // would be a lie about why it is not a candidate.
      const scored = rank([video('Unrelated cooking video', 50), video('Straggler talk', 40_000)]);
      expect(floored(scored, straggler, new Set(), DEFAULT_MIN_SCORE)).toEqual([]);
    });

    it('does not reconstruct a score by adding the weight back', () => {
      // A candidate that scored badly for other reasons is CLAMPED AT ZERO, so
      // score + 0.45 reads as 0.45 and passes. Re-scoring with the floor off is
      // the difference between a near-miss and an arithmetic artefact: one word
      // of three, too short, 50 views — 0.067 unfloored, nowhere near the bar.
      const lowRank = { scope: 'concept' as const, key: 'x', title: 'Low-Rank Factorization' };
      const c = video('Factorization in 20 seconds', 50, 20);
      const scored = [{ ...c, ...score(c, lowRank, new Set()) }];
      expect(scored[0]?.score).toBe(0);
      expect(score(c, lowRank, new Set(), { floor: false }).score).toBeLessThan(DEFAULT_MIN_SCORE);
      expect(floored(scored, lowRank, new Set(), DEFAULT_MIN_SCORE)).toEqual([]);
    });

    it('keeps a short video the floor genuinely removed, judgement included', () => {
      // 60s and a perfect title is the AI-slop shape, and it would have passed
      // without the floor — 0.60 − 0.15 + prior. It belongs in the list with
      // `too short` attached, because filtering it here would be this file
      // making the call that the list exists to hand to a person.
      const scored = rank([video('Straggler shorts', 300, 60)]);
      const held = floored(scored, straggler, new Set(), DEFAULT_MIN_SCORE);
      expect(held).toHaveLength(1);
      expect(held[0]?.reasons).toContain('too short');
    });

    it('is empty when nothing is being filtered at all', () => {
      // `--min-score 0` keeps everything, so the floor removes nothing and there
      // is no near-miss to report. THIS FAILED WHEN FIRST WRITTEN: the predicate
      // asked only whether the floor had fired and whether the candidate would
      // pass without it, never whether it had actually been excluded, so the
      // diagnostic mode reported every low-view candidate as a near-miss of a
      // bar it had cleared.
      const scored = rank([video("NSDI '13 - Effective Straggler Mitigation", 412)]);
      expect(floored(scored, straggler, new Set(), 0)).toEqual([]);
    });
  });

  describe('a floored near-miss is not a candidate', () => {
    it('does not make a target productive, so --redo-empty still retries it', () => {
      // THE PROMISE OF KEEPING THESE IN A SEPARATE LIST. A target whose only
      // result is a near-miss has not been answered, and the next query change
      // must still pay to ask it again. Put these in `candidates` instead and
      // `productive` counts them, and `--redo-empty` skips the targets the
      // change was for — which is the #403 mistake with a new cause.
      const prior = {
        done: ['straggler'],
        candidates: [],
        floored: [{ target: 'straggler', scope: 'concept', title: "NSDI '13", score: 0.327 }],
      };
      const all = [{ scope: 'concept' as const, key: 'straggler', title: 'Straggler' }];
      expect(pending(all, prior, { redoEmpty: true }).map((t: Target) => t.key)).toEqual([
        'straggler',
      ]);
    });
  });

  describe('the run says so', () => {
    it('names the count whether or not anything was kept', () => {
      const withPick = rank([video("NSDI '13", 412), video('Straggler talk', 40_000)]);
      expect(reportLine('straggler', withPick, DEFAULT_MIN_SCORE, 1)).toContain('1 floored');
      const withoutPick = rank([video("NSDI '13", 412)]);
      expect(reportLine('straggler', withoutPick, DEFAULT_MIN_SCORE, 1)).toContain('1 floored');
    });

    it('says nothing when nothing was floored', () => {
      const scored = rank([video('Straggler talk', 40_000)]);
      expect(reportLine('straggler', scored, DEFAULT_MIN_SCORE, 0)).not.toContain('floored');
    });
  });
});
