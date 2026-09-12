/**
 * Finds candidate `kind: video` explainers, on a machine that can reach YouTube.
 *
 *   YOUTUBE_API_KEY=... node scripts/find-video-explainers.mjs search
 *   YOUTUBE_API_KEY=... node scripts/find-video-explainers.mjs search --concepts
 *   node scripts/find-video-explainers.mjs verify picks.json
 *
 * WHY THIS EXISTS AT ALL (#384). The corpus has 482 explainers and zero videos,
 * and that is not a judgement that no good talk exists. `youtube.com` is denied
 * in the sandbox where content is authored, so no session has ever been able to
 * SEARCH for one — only to verify one it was handed. `check:explainers` has a
 * whole oEmbed path for `kind: video` that has never run against a single entry.
 * This script is the half that has to happen on a laptop.
 *
 * IT FINDS. IT DOES NOT DECIDE. Nothing here writes `content/nodes/**`, and that
 * is deliberate: ADR-0018 says attaching an explainer where none genuinely fits
 * is the invented-reference rule wearing a different field name. A ranked list
 * is a starting point for a person, not a verdict.
 *
 * NO MODEL IS CALLED, ANYWHERE. CLAUDE.md §3 is a hard constraint and it does
 * not soften for an authoring script. Ranking is arithmetic over things YouTube
 * reports: channel allowlist, title overlap, duration, view count.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { URL } from 'node:url';
import { EXPLAINER_HOSTS } from './explainer-hosts.mjs';
import { videoId } from './check-explainers.mjs';

const ROOT = resolve(process.cwd(), '..');
const NODES_DIR = join(ROOT, 'content/nodes');
/**
 * Where dismissals live, and NOT in the checkpoint (#439).
 *
 * `done` and `candidates` are caches of an API — lose them and a re-search
 * rebuilds them, at the price of quota. A dismissal is human judgment and no
 * command regenerates it: "homonym — returns the SVM kernel trick" took reading
 * every candidate for that target to write. #399 ignores the checkpoint for
 * good reasons that all apply to a cache and none of which apply to this, so
 * this is committed, reviewable in a pull request, and survives the checkpoint
 * being deleted.
 */
const DISMISSED = join(ROOT, 'content/explainers-dismissed.json');
const API = 'https://www.googleapis.com/youtube/v3';

/**
 * Free tier is 10,000 units a day and `search.list` costs 100 of them, so this
 * is a hundred searches — 117 domains is a day and a bit, 482 concepts is five.
 * Tracked and enforced here so the run STOPS with a checkpoint rather than
 * discovering the limit as a 403 halfway through.
 */
const COST = { search: 100, videos: 1, channels: 1 };
const DAILY_UNITS = 10_000;

/**
 * Below this, a video is treated as unwatched rather than merely unpopular.
 *
 * 500 because it separates cleanly on the measured corpus: it demotes exactly
 * the 60 candidates under it and leaves the lowest survivor at 518. The
 * legitimate low-view content sits above — USENIX at 1,292, Hung-yi Lee at
 * 1,599, Olewave at 909.
 */
const UNWATCHED = 500;

/**
 * Milliseconds between searches (#400).
 *
 * AVOIDING THE LIMIT BEATS REACTING TO IT. The first --concepts run fired ~100
 * `search.list` calls back to back, tripped YouTube's short-window rate limit
 * partway through, and then spent most of its budget being refused. The domain
 * passes never showed it because 117 and 73 targets slip under the window.
 *
 * A day is about 99 searches, so this costs two and a half minutes of wall clock
 * and nothing at all in quota.
 */
const PACE_MS = 1500;

/**
 * Channels worth trusting, AS HANDLES — never as channel ids.
 *
 * A `UC...` id is 24 characters this repository cannot check by reading. A
 * handle is a public name that either resolves or does not, and `resolveHandles`
 * prints what each one became so a wrong entry is visible in the first ten lines
 * of output rather than as a silently empty result set. That is the same lesson
 * ADR-0020 records about hard-coding arxiv.org's crawl-delay: read the source,
 * do not recall it.
 *
 * Edit this freely — it is a starting point, not a canon.
 */
const CHANNEL_HANDLES = [
  '@AndrejKarpathy',
  '@DeepLearningAI',
  '@3blue1brown',
  '@statquest',
  '@YannicKilcher',
  '@TwoMinutePapers',
  '@GoogleDeepMind',
  '@stanfordonline',
  '@MITCSAIL',
  '@huggingface',
];

/** Names that earn a video a look even on a channel not listed above. */
const NAMED_AUTHORS = [
  'karpathy', 'andrew ng', 'yann lecun', 'lecun', 'chollet', 'hinton',
  'fei-fei', 'hassabis', 'sutskever', 'jim fan', 'raschka',
];

// ---------------------------------------------------------------- the corpus

/** Every node, with the fields targeting needs. */
export function readNodes() {
  return readdirSync(NODES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(NODES_DIR, f), 'utf8')));
}

/**
 * How many other nodes point at each node — a cheap centrality proxy.
 *
 * Used to pick which concepts stand for a domain in its search query. Corpus
 * order would be alphabetical by filename, which would make every domain look
 * like whatever its "A" concepts are.
 */
export function inDegree(nodes) {
  const n = new Map();
  for (const node of nodes) {
    const e = node.edges ?? {};
    for (const list of [e.requires, e.unlocks, e.adjacent]) {
      for (const edge of list ?? []) n.set(edge.id, (n.get(edge.id) ?? 0) + 1);
    }
  }
  return n;
}

/**
 * What to search for, and at what scope.
 *
 * DOMAINS FIRST, AND THAT IS THE WHOLE COST ARGUMENT. 335 of the 482 existing
 * explainers are domain-scoped, because one good resource legitimately covers a
 * cluster. 117 domains fit inside a day of quota; 482 concepts do not fit inside
 * five. Concept scope is the opt-in second pass for the ones that deserve their
 * own.
 *
 * A DOMAIN CARRIES SAMPLE CONCEPTS BECAUSE HALF THE DOMAIN NAMES ARE NOT
 * SEARCHABLE. "Alignment" is a topic YouTube knows about; "Methods",
 * "Foundations", "Systems" and "Core" are this repository's filing labels, and
 * searching for them returns noise — while scoring title overlap against the
 * word "methods" would actively reward the wrong videos. So a domain target
 * also carries its most-referenced concepts, and both the query and the
 * relevance score are built from those instead.
 */
export function targets(nodes, { concepts = false } = {}) {
  if (concepts) {
    return nodes.map((n) => ({ scope: 'concept', key: n.id, title: n.title ?? n.id }));
  }

  const degree = inDegree(nodes);
  const members = new Map();
  for (const n of nodes) {
    for (const d of n.domain ?? []) {
      if (!members.has(d)) members.set(d, []);
      members.get(d).push({ title: n.title ?? n.id, degree: degree.get(n.id) ?? 0 });
    }
  }

  // Biggest domains first: if the quota runs out mid-run, it ran out having
  // covered the most concepts rather than the alphabetically luckiest.
  return [...members]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([d, list]) => ({
      scope: 'domain',
      key: d,
      title: d,
      covers: list.length,
      sample: [...list].sort((a, b) => b.degree - a.degree).slice(0, 3).map((c) => c.title),
    }));
}

/**
 * The field every concept query is asked within (#401).
 *
 * A CONCEPT NAME ALONE IS AMBIGUOUS, and the wrong video arrives as the TOP
 * candidate — the first thing a reviewer reads. `ablation explained` returned a
 * cardiac ablation patient guide; `adam explained` returned Genesis; `alibi`
 * returned a dictionary entry; `active-learning` returned classroom pedagogy.
 * Seven of the first 41 concepts, 17%, and they scored 0.40–0.56 BECAUSE the
 * scorer is working: "ablation" really does appear in "AFib Ablation", and the
 * video really is a teachable length. No mechanical signal available here can
 * tell that the subject is a heart procedure.
 *
 * The domain pass never hit this. A domain query carries its sample concepts and
 * that context disambiguates; a bare concept name carries nothing.
 *
 * NOT THE NODE'S OWN `domain[0]`, which would be the obvious source: half the
 * domain names are filing labels — `Methods`, `Foundations`, `Core` — and
 * `Core explained` was the finding that drove #386 in the first place.
 *
 * UNVALIDATED, AND THAT IS NOT A FORMALITY. Nothing in this repository can check
 * that a query returns better videos; that takes a real run against real
 * YouTube. This is an argument, not a measurement, until the next day's output
 * judges it — `adam`, `ablation`, `alibi` and `active-learning` are the four to
 * read, and `--redo` is how to re-query them. NOT `--redo-empty`, which was
 * what #401 said and was wrong (#403): all seven homonyms produced candidates,
 * so they count as productive and that flag skips every one of them.
 */
const FIELD = 'machine learning';

/**
 * The query a target becomes. Plain words — YouTube's search is not a DSL.
 *
 * The domain's own name is included but does the lighter half of the work; the
 * sample concepts are what make "Core" mean attention rather than the English
 * adjective. A concept has no samples, so it borrows `FIELD` instead.
 *
 * THE QUERY CHANGES; THE SCORING DOES NOT. `facets` still returns `[title]` for
 * a concept, so `FIELD` never contributes overlap and cannot inflate a score.
 * It changes which videos YouTube offers, and nothing about how they are ranked
 * once offered — which is what keeps `attention` at 0.97 and `backpropagation`
 * at 0.97 rather than quietly re-tuning the names that already work.
 */
export const queryFor = (t) =>
  t.scope === 'domain'
    ? `${t.title} ${(t.sample ?? []).join(' ')} explained`.replace(/\s+/g, ' ').trim()
    : `${t.title} ${FIELD} explained`;

// ---------------------------------------------------------------- scoring

const WORD = /[a-z0-9]+/g;
const words = (s) => new Set(String(s).toLowerCase().match(WORD) ?? []);

/**
 * The separate things a target is about.
 *
 * A domain is its label AND each sample concept, scored independently — see the
 * note in `score`. A concept is only itself.
 */
export const facets = (t) =>
  t.scope === 'domain' ? [t.title, ...(t.sample ?? [])] : [t.title];

/** ISO 8601 duration → seconds. Only the shapes YouTube emits. */
export function durationSeconds(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso ?? ''));
  if (!m) return null;
  const [, h, min, s] = m;
  return Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0);
}

/**
 * How promising a candidate looks, 0..1, from things YouTube reported.
 *
 * DELIBERATELY CRUDE, AND SAYING SO IS THE POINT. This cannot tell whether a
 * video teaches the concept well; nothing mechanical can. It exists to put the
 * plausible ones near the top of a list a person then reads. Every component is
 * reported alongside the score so a reviewer can see WHY something ranked, and
 * disagree with it.
 */
/**
 * What each signal is worth (#432).
 *
 * RELEVANCE MUST OUTWEIGH REPUTATION, and until this issue it did not: the
 * allowlist paid 0.40 and a perfect topic match paid 0.30, so an allowlisted
 * video about something else scored 0.67 while the best any other channel could
 * reach on an exact match was 0.60. Measured, not argued — `early-exit` was
 * offered 3Blue1Brown's "But what is a neural network?" at 0.67 on ZERO overlap,
 * which is 0.40 + 0.20 + log10(24,210,799)/100 to three decimals. Across one
 * sweep, 8 of 181 targets had a top pick matching nothing at all, and 14 had a
 * better match ranked lower.
 *
 * The allowlist is still doing a real job — it is the only proxy here for "this
 * will actually teach you" — but quality only matters once subject is settled. A
 * superb explanation of a different concept is worth nothing to a reader on this
 * page, and ADR-0017 is explicit that `explainers` is where to be taught IT.
 *
 * allowlist < overlap / 2 is the invariant that keeps it that way, and a test
 * asserts it: a perfect match from an unknown channel must beat a half-match
 * from a trusted one. Raise the allowlist above 0.30 again and that test fails.
 */
export const WEIGHTS = {
  allowlist: 0.2,
  namedAuthor: 0.12,
  /** Multiplied by the best facet's overlap, so a perfect match pays 0.6. */
  overlap: 0.6,
  teachableLength: 0.15,
  /** Cap on the popularity prior. A well-watched video is not a better teacher. */
  views: 0.1,
  /**
   * The floor #395 added, RESCALED WITH THE OVERLAP TERM. At 0.25 against an
   * overlap worth 0.30 it very nearly cancelled a perfect title; against an
   * overlap worth 0.60 it no longer did, and a content farm with an exact title
   * and one view scored 0.50 — comfortably past the 0.35 threshold it exists to
   * keep them under. #395's own test caught that, which is why it is a test.
   */
  unwatched: 0.45,
};

export function score(candidate, target, allowedChannelIds = new Set()) {
  const reasons = [];
  let n = 0;

  // Whether the floor below applies. A brand-new StatQuest video legitimately
  // has no views yet, and should not be demoted for it.
  //
  // UNTESTED AGAINST REAL DATA, AND SAYING SO IS THE POINT: none of the 60
  // sub-threshold candidates in the second search were on a trusted channel, so
  // this exemption has never actually fired. It is here on the argument above,
  // not on evidence.
  let trusted = false;

  if (allowedChannelIds.has(candidate.channelId)) {
    n += WEIGHTS.allowlist;
    trusted = true;
    reasons.push('allowlisted channel');
  } else if (NAMED_AUTHORS.some((a) => `${candidate.author} ${candidate.title}`.toLowerCase().includes(a))) {
    n += WEIGHTS.namedAuthor;
    trusted = true;
    reasons.push('named author');
  }

  // BEST-MATCHING FACET, NOT THE UNION OF THEM (#386). Scoring against one word
  // set built from the label AND all three samples divided hits by everything a
  // domain contains, and a video is only ever about one of those things. A
  // perfect softmax video scored 20% against Foundations' five words — 0.307,
  // under the 0.35 threshold, so it was dropped. 53 of 97 domains reported zero
  // that way, INCLUDING ALL TEN LARGEST: the more concepts a domain covered, the
  // more its own samples diluted it. Exactly backwards.
  //
  // Each facet is scored separately and the best one wins, so a video about one
  // sampled concept counts as being about that concept.
  const got = words(candidate.title);
  let overlap = 0;
  let matched = null;
  for (const facet of facets(target)) {
    const want = words(facet);
    if (!want.size) continue;
    const hit = [...want].filter((w) => got.has(w)).length;
    const share = hit / want.size;
    if (share > overlap) {
      overlap = share;
      matched = facet;
    }
  }
  // RELEVANCE IS A GATE BEFORE IT IS A TERM (#432). A video whose title shares
  // no word with the concept is not a teaching resource for it, however good it
  // is and whoever made it — so it scores zero rather than being out-argued by
  // the other terms. This is what removes the eight zero-overlap winners; the
  // weights above decide the order of everything that survives.
  if (overlap === 0) {
    return { score: 0, reasons: ['no topic overlap'] };
  }
  n += WEIGHTS.overlap * overlap;
  // Naming the facet is the difference between a number and a reason: it says
  // the video matched "Softmax", not that it matched "Foundations" somehow.
  reasons.push(`matches "${matched}" ${Math.round(overlap * 100)}%`);

  // A teaching video is minutes, not seconds and not a whole conference day.
  const secs = candidate.durationSeconds;
  if (secs !== null && secs >= 240 && secs <= 5400) {
    n += WEIGHTS.teachableLength;
    reasons.push('teachable length');
  } else if (secs !== null && secs < 120) {
    n -= WEIGHTS.teachableLength;
    reasons.push('too short');
  }

  // Weak popularity prior, capped so it cannot outweigh relevance. Left
  // deliberately weak: a well-watched video is not a better teacher.
  const views = Number(candidate.views ?? 0);
  if (views > 0) n += Math.min(WEIGHTS.views, Math.log10(views) / 100);

  // A FLOOR, WHICH THE PRIOR ABOVE IS NOT (#395). That term spans 0.000 to
  // 0.070 across the entire plausible range — less than the 0.2 for merely
  // being a teachable length — and never goes negative. So a video nobody has
  // watched paid no price at all: 60 of 230 candidates in the second search had
  // under 500 views, and several scored above 0.50 on a good title match. They
  // are AI-generated content farms, publishing in 2026 with double-digit view
  // counts and names like "AI Paper Slop", and hand-rejecting them was the
  // largest single cost of curating that run.
  //
  // 0.25 rather than a wider curve, and only below the floor, because the first
  // attempt at this re-weighted the whole term and demoted a video that had
  // already shipped — the IEEE S&P Membership Inference talk at 16,801 views.
  // Any curve steep enough to punish 22 views is weaker than this one around
  // 20,000, which is exactly where conference talks and university lectures
  // live. The threshold does the work: -0.35 demotes the same 60.
  if (views > 0 && views < UNWATCHED && !trusted) {
    n -= WEIGHTS.unwatched;
    reasons.push(`almost unwatched (${views} views)`);
  }

  return { score: Math.max(0, Math.min(1, n)), reasons };
}

// ---------------------------------------------------------------- the api

class Quota {
  constructor(budget) {
    this.budget = budget;
    this.spent = 0;
  }
  /** True if `kind` can still be afforded. */
  affords(kind) {
    return this.spent + COST[kind] <= this.budget;
  }
  charge(kind) {
    this.spent += COST[kind];
  }
}

async function api(path, params, key) {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', key);

  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const reason = body?.error?.errors?.[0]?.reason ?? `HTTP ${res.status}`;
    // quotaExceeded is not a bug and should not read like one. The checkpoint
    // is already on disk; tomorrow's run continues from it.
    throw Object.assign(new Error(`youtube ${path}: ${reason}`), { reason });
  }
  return body;
}

/**
 * Handles → channel ids, printed so a wrong handle is visible immediately.
 *
 * An unresolved handle is reported and dropped rather than silently producing a
 * channel filter that matches nothing — which would look exactly like "YouTube
 * has no good videos about this", the wrong conclusion drawn quietly.
 */
async function resolveHandles(handles, key, quota) {
  const ids = new Set();
  for (const handle of handles) {
    if (!quota.affords('channels')) break;
    quota.charge('channels');
    let body;
    try {
      body = await api('channels', { part: 'id,snippet', forHandle: handle }, key);
    } catch (err) {
      console.error(`  ? ${handle} — ${err.message}`);
      continue;
    }
    const item = body.items?.[0];
    if (!item) {
      console.error(`  ? ${handle} — did not resolve; dropped from the allowlist`);
      continue;
    }
    ids.add(item.id);
    console.log(`  · ${handle.padEnd(22)} → ${item.snippet.title}`);
  }
  return ids;
}

/** Top candidates for one target, enriched with duration and views. */
/** Reasons that mean "slow down", as opposed to "you are done for today". */
const TRANSIENT = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'backendError', 'internalError']);

/**
 * Retries a burst limit; never retries the daily cap.
 *
 * THE TWO LOOK ALIKE AND ARE OPPOSITES (#386). A real run hit
 * `rateLimitExceeded` on one target and lost it, because only `quotaExceeded`
 * was special-cased and everything else fell through to "skip this target".
 * quotaExceeded means come back tomorrow; rateLimitExceeded means wait a moment.
 */
/**
 * Consecutive targets refused for rate limiting. A success — or a failure of
 * any other kind — clears it.
 *
 * THE RETRY LADDER IS SIZED FOR A BURST AND THE THING IT MEETS MAY NOT BE ONE
 * (#429). Each target retries over about 20 seconds and then gives up, and the
 * loop starts the next one immediately, so a condition lasting ten minutes cost
 * thirty targets: on 2026-09-11 the run charged 99 searches and 30 of them —
 * roughly 3,000 units, a third of the day — bought nothing. Nothing carried
 * between targets, so the tool could not tell "this one was unlucky" from
 * "everything is being refused right now".
 */
export function refusals(previous, err) {
  return err && TRANSIENT.has(err.reason) ? previous + 1 : 0;
}

/**
 * How many in a row before the run stops and checkpoints.
 *
 * Three, because two in a row is plausibly coincidence and thirty is a wasted
 * day. Stopping is cheap — the failed targets were never marked done, so the
 * next run picks them up — and continuing is what costs.
 */
export const STOP_AFTER_REFUSALS = 3;

export async function withRetry(kind, quota, call, { sleep = (ms) => new Promise((r) => setTimeout(r, ms)), attempts = 3 } = {}) {
  // ONCE PER OPERATION, NOT ONCE PER ATTEMPT (#400). Charging every attempt was
  // my guess, and the first --concepts run priced it: 41 targets of real work
  // cost 4,151 units and the run spent 9,951, so 58% of the day went to
  // retries it had refused to pay for twice over.
  //
  // The asymmetry settles it. If YouTube does not bill a rejected request,
  // billing it locally throws away real quota, which is what happened. If it
  // does, under-counting is harmless: the run meets a genuine quotaExceeded,
  // which stops it with the checkpoint intact. One direction costs a day, the
  // other costs nothing.
  //
  // WHICH OF THE TWO IS TRUE IS STILL NOT ESTABLISHED (#429). Google documents
  // the daily cap and not what a refusal costs, and this repository has never
  // measured it: doing so means spending a known number of units, forcing
  // refusals, and reading the quota page in the console — a deliberate
  // experiment on a day nobody needs the budget. Until then the asymmetry
  // above is the whole argument, and it is an argument rather than a
  // measurement.
  quota.charge(kind);
  for (let i = 0; ; i += 1) {
    try {
      return await call();
    } catch (err) {
      if (!TRANSIENT.has(err.reason) || i >= attempts - 1) throw err;
      // 5s, 15s, 45s. The old 2s/4s never cleared the window — all three
      // attempts failed together and 14 targets were lost outright.
      const wait = 5000 * 3 ** i;
      console.error(`      ${err.reason}; waiting ${wait / 1000}s (attempt ${i + 2} of ${attempts})`);
      await sleep(wait);
    }
  }
}

async function searchOne(target, key, quota, perTarget, opts = {}) {
  const found = await withRetry('search', quota, () => api(
    'search',
    { part: 'snippet', q: queryFor(target), type: 'video', maxResults: String(perTarget), relevanceLanguage: 'en' },
    key,
  ), opts);
  const items = found.items ?? [];
  if (items.length === 0) return [];

  const ids = items.map((i) => i.id.videoId).filter(Boolean);
  let details = new Map();
  if (ids.length && quota.affords('videos')) {
    quota.charge('videos');
    const meta = await api('videos', { part: 'contentDetails,statistics', id: ids.join(',') }, key);
    details = new Map((meta.items ?? []).map((v) => [v.id, v]));
  }

  return items
    .filter((i) => i.id.videoId)
    .map((i) => {
      const d = details.get(i.id.videoId);
      return {
        videoId: i.id.videoId,
        url: `https://www.youtube.com/watch?v=${i.id.videoId}`,
        title: i.snippet.title,
        author: i.snippet.channelTitle,
        channelId: i.snippet.channelId,
        published: i.snippet.publishedAt,
        durationSeconds: durationSeconds(d?.contentDetails?.duration),
        views: d?.statistics?.viewCount ?? null,
      };
    });
}

/**
 * What still needs searching, given a checkpoint.
 *
 * "DONE" AND "FOUND SOMETHING" ARE DIFFERENT FACTS, and the checkpoint only ever
 * recorded the first (#386). After a scoring fix a plain re-run would skip
 * precisely the barren targets the fix was for — 53 domains, in the run that
 * prompted this. `--redo-empty` re-attempts a target that completed with no
 * candidates, and leaves the productive ones alone so their quota is not spent
 * twice.
 *
 * `--redo` is the third fact neither of those expresses: "done, produced
 * something, and I no longer trust it" (#403). A query or scorer change creates
 * exactly that state, and `--redo-empty` cannot see it — every homonym #401 was
 * written for returned a candidate, so all seven counted as productive.
 */
export function pending(all, prior, { redoEmpty = false, redo = /** @type {string[]} */ ([]), dismissed: dismissedList = /** @type {{ target: string, reason: string }[]} */ ([]) } = {}) {
  const done = new Set(prior.done ?? []);
  const productive = new Set((prior.candidates ?? []).map((c) => c.target));
  // THE FOURTH STATE (#437). A target can be searched, produce candidates, be
  // read by a human, and have every one rejected — 32 of them after the
  // 2026-09-11 sweep. Nothing recorded that, so each pass re-read the same 32
  // and reached the same conclusions. `--redo-empty` must not resurrect them:
  // they are not barren, they are finished. `--redo` still can, by name, which
  // is what makes a dismissal a judgment rather than a tombstone.
  const dismissed = new Set(dismissedList.map((d) => d.target));
  // NAMED WINS OVER EVERY OTHER STATE (#403). `--redo-empty` retries a target
  // that found nothing, which is a different question from "found something I
  // no longer trust" — and the second is the one a query or scorer change
  // creates. All seven homonyms #401 was written for produced candidates, so
  // --redo-empty skipped every one of them.
  const named = new Set(redo);
  return all.filter(
    (t) =>
      named.has(t.key) ||
      (!dismissed.has(t.key) && (!done.has(t.key) || (redoEmpty && !productive.has(t.key)))),
  );
}

/**
 * The `--redo` ids that name no target at all.
 *
 * A TYPO THAT DOES NOTHING IS THE EXPENSIVE FAILURE. `--redo ablaton` would
 * skip silently, the run would spend its day on something else, and the thing
 * it was paid to re-test would come back untested — discovered tomorrow, if at
 * all. Same argument as `resolveHandles` printing what each handle became: an
 * input this script cannot verify by reading gets checked against reality
 * before anything is spent.
 *
 * @param {{key: string}[]} all every target, from `targets`
 * @param {string[]} redo the ids `--redo` named
 * @returns {string[]} the ones that match nothing
 */
export function unknownTargets(all, redo) {
  const keys = new Set(all.map((t) => t.key));
  return redo.filter((id) => !keys.has(id));
}

/**
 * The targets, yielded with `ms` of quiet BETWEEN them (#400).
 *
 * Between rather than before, the same shape as the crawl-delay branch of
 * `pool` in fetch-pool.mjs and for the same reason: a delay after the last item
 * is time spent for nothing.
 *
 * A generator so the loop reads as a loop and the interval is still injectable —
 * a test asserts the gaps without waiting them out, which is the only way this
 * gets checked at all, since spending them for real is the thing being avoided.
 */
export async function* paced(items, { pace, ms = PACE_MS } = {}) {
  for (const [i, item] of items.entries()) {
    if (i > 0) await pace(ms);
    yield item;
  }
}

// ---------------------------------------------------------------- checkpoint

const load = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);
const save = (path, data) => writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);

// ---------------------------------------------------------------- commands

/**
 * Exported for the integration test that drives the whole loop.
 *
 * The unit tests cover `refusals` — the RULE — and cannot cover the `break`
 * that acts on it: removing the break outright left all 57 of them passing
 * (#429). A missing `break` is only observable by running the loop, so the
 * loop has to be reachable from a test.
 */
export async function search(argv, opts = {}) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    console.error(
      'YOUTUBE_API_KEY is not set.\n\n' +
        'Create one at https://console.cloud.google.com/apis/credentials with the\n' +
        '"YouTube Data API v3" enabled. It is free and unrelated to any model API —\n' +
        'CLAUDE.md §3 forbids paid LLM calls, not Google service keys.\n\n' +
        '  YOUTUBE_API_KEY=... node scripts/find-video-explainers.mjs search',
    );
    process.exit(2);
  }

  const concepts = argv.includes('--concepts');
  const pace = opts.pace ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const redoEmpty = argv.includes('--redo-empty');
  const redo = (flag(argv, '--redo') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const out = flag(argv, '--out') ?? (concepts ? 'video-candidates.concepts.json' : 'video-candidates.domains.json');
  const budget = Number(flag(argv, '--budget') ?? DAILY_UNITS);
  const perTarget = Number(flag(argv, '--per-target') ?? 5);
  const minScore = Number(flag(argv, '--min-score') ?? 0.35);

  const quota = new Quota(budget);
  const all = targets(readNodes(), { concepts });

  const prior = load(out) ?? { scope: concepts ? 'concept' : 'domain', done: [], candidates: [] };
  const done = new Set(prior.done);
  const productive = new Set(prior.candidates.map((c) => c.target));

  // BEFORE A SINGLE UNIT IS SPENT. Ten channel lookups and the first search go
  // out before the loop would ever notice a name that matches nothing.
  const unknown = unknownTargets(all, redo);
  if (unknown.length > 0) {
    console.error(
      `--redo names ${unknown.length} target(s) that do not exist: ${unknown.join(', ')}\n` +
        `Nothing was searched. Concept ids are the node filenames in content/nodes.`,
    );
    process.exit(2);
  }

  const dismissedList = readDismissed();
  const todo = pending(all, prior, { redoEmpty, redo, dismissed: dismissedList });

  // A dismissal says "looked, nothing worth attaching". If the concept has
  // since gained a video the judgment has been overtaken, and saying so is
  // cheaper than anybody noticing a year later (#437).
  const covered = new Set(
    readNodes()
      .filter((n) => (n.explainers ?? []).some((e) => e.kind === 'video'))
      .map((n) => n.id),
  );
  const stale = staleDismissals(dismissedList, covered);
  if (stale.length > 0) {
    console.log(
      `${stale.length} dismissal(s) are stale — these now have a video: ${stale.join(', ')}\n`,
    );
  }

  console.log(
    `${all.length} ${concepts ? 'concept' : 'domain'} target(s); ${done.size} already done, ${todo.length} to go` +
      (redoEmpty ? ` (--redo-empty: retrying ${done.size - productive.size} that found nothing)` : '') +
      (redo.length > 0 ? ` (--redo: ${redo.filter((id) => done.has(id)).length} named target(s) re-queried)` : '') +
      (dismissedList.length > 0
        ? `; ${dismissedList.length} dismissed as having nothing worth attaching`
        : '') +
      `.\n` +
      `Budget ${budget} units — a search costs ${COST.search}, so about ${Math.floor(budget / (COST.search + COST.videos))} targets this run.\n`,
  );

  console.log('Resolving the channel allowlist:');
  const allowed = await resolveHandles(CHANNEL_HANDLES, key, quota);
  console.log(`  ${allowed.size} of ${CHANNEL_HANDLES.length} handle(s) resolved\n`);

  let refused = 0;
  for await (const target of paced(todo, { pace })) {
    if (!quota.affords('search')) {
      console.log(`\nBudget reached at ${quota.spent} units. Re-run tomorrow — it resumes from ${out}.`);
      break;
    }

    let found;
    try {
      found = await searchOne(target, key, quota, perTarget, opts);
      refused = refusals(refused, null);
    } catch (err) {
      if (err.reason === 'quotaExceeded') {
        console.log(`\nYouTube says the daily quota is spent. Progress is saved in ${out}; re-run tomorrow.`);
        break;
      }
      refused = refusals(refused, err);
      console.error(`  ✗ ${target.key}: ${err.message}`);
      if (refused >= STOP_AFTER_REFUSALS) {
        console.log(
          `\n${refused} target(s) in a row were refused for rate limiting, so this run is stopping\n` +
            `rather than spending the rest of the budget one refusal at a time (#429).\n` +
            `${quota.spent} units spent. Those targets were never marked done — re-run and it\n` +
            `resumes from ${out}. If a quota day just rolled over, waiting a few minutes is enough.`,
        );
        break;
      }
      continue;
    }

    const ranked = found
      .map((c) => ({ ...c, ...score(c, target, allowed) }))
      .filter((c) => c.score >= minScore)
      .sort((a, b) => b.score - a.score);

    done.add(target.key);
    // Replace rather than append: a re-scored target must not leave its old
    // candidates behind alongside the new ones.
    prior.candidates = prior.candidates.filter((c) => c.target !== target.key);
    for (const c of ranked) {
      prior.candidates.push({ target: target.key, scope: target.scope, ...c });
    }

    const best = ranked[0];
    console.log(
      `  ${ranked.length ? '·' : ' '} ${target.key.padEnd(28)} ${String(ranked.length).padStart(2)} candidate(s)` +
        (best ? `  best: ${best.score.toFixed(2)} ${best.author} — ${best.title.slice(0, 54)}` : ''),
    );

    prior.done = [...done];
    save(out, prior);
  }

  save(out, { ...prior, done: [...done] });
  console.log(
    `\n${quota.spent} units spent. ${prior.candidates.length} candidate(s) across ${done.size} target(s) → ${out}\n` +
      `\nNothing here is an explainer yet. Read it, pick the ones that genuinely teach the\n` +
      `thing, and put the picks in a file:\n\n` +
      `  [{ "target": "attention", "scope": "domain", "url": "https://www.youtube.com/watch?v=..." }]\n\n` +
      `then: node scripts/find-video-explainers.mjs verify picks.json`,
  );
}

/**
 * Picked URLs → entries that pass `check:explainers` by construction.
 *
 * THE TITLE AND AUTHOR COME FROM oEmbed, NOT FROM THE PICKER. That is the whole
 * value of this mode: `check:explainers` compares the recorded title and author
 * against what YouTube reports, so anything typed by hand is a coin flip on
 * punctuation. Taking the canonical strings here means the entry is right the
 * first time — and if oEmbed 404s, the video is gone or private and the pick is
 * rejected now rather than in CI.
 */
/**
 * Records that a target was searched, read, and had nothing worth attaching.
 *
 * A REASON IS REQUIRED, and that is the whole value of the file. "custom-kernel
 * was skipped" tells a curator a year from now nothing at all; "homonym —
 * returns the kernel trick and OS kernels" tells them whether a different query
 * might help, and "no teaching video exists for this" tells them not to look
 * again. The two kinds need opposite follow-ups and the checkpoint has to carry
 * which is which.
 */
/** The committed dismissal list, or an empty one before the first dismissal. */
export function readDismissed() {
  if (!existsSync(DISMISSED)) return [];
  return JSON.parse(readFileSync(DISMISSED, 'utf8'));
}

export function dismissals(picks, knownIds) {
  const entries = [];
  const problems = [];
  for (const pick of picks) {
    const target = typeof pick?.target === 'string' ? pick.target.trim() : '';
    const reason = typeof pick?.reason === 'string' ? pick.reason.trim() : '';
    if (!target) {
      problems.push('an entry has no target');
    } else if (!knownIds.has(target)) {
      problems.push(`${target} is not a concept id`);
    } else if (!reason) {
      problems.push(`${target} has no reason — say why, or a year from now this is indistinguishable from a mistake`);
    } else {
      entries.push({ target, reason });
    }
  }
  return { entries, problems };
}

/** Dismissals naming a concept that has since gained a video are stale. */
export function staleDismissals(dismissed, coveredIds) {
  return (dismissed ?? []).filter((d) => coveredIds.has(d.target)).map((d) => d.target);
}

async function dismiss(argv) {
  const path = argv.find((a) => !a.startsWith('-'));
  if (!path || !existsSync(path)) {
    console.error(
      'usage: node scripts/find-video-explainers.mjs dismiss dismissed.json [--out FILE]\n\n' +
        '  [{ "target": "custom-kernel", "reason": "homonym — returns the kernel trick" }]',
    );
    process.exit(2);
  }

  const nodes = readNodes();
  const { entries, problems } = dismissals(JSON.parse(readFileSync(path, 'utf8')), new Set(nodes.map((n) => n.id)));

  // NOTHING IS WRITTEN IF ANYTHING IS WRONG, the same argument as --redo's
  // check (#403): a half-applied dismissal file is worse than none, because the
  // half that landed looks deliberate.
  if (problems.length > 0) {
    console.error(`${problems.length} problem(s); nothing was written:`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(2);
  }

  const existing = readDismissed();
  const kept = existing.filter((d) => !entries.some((e) => e.target === d.target));
  const all = [...kept, ...entries].sort((a, b) => a.target.localeCompare(b.target));
  writeFileSync(DISMISSED, `${JSON.stringify(all, null, 2)}\n`);

  for (const e of entries) console.log(`  · ${e.target.padEnd(30)} ${e.reason}`);
  console.log(`\n${entries.length} dismissed; ${all.length} in content/explainers-dismissed.json in total.`);
  console.log('It is committed, so this belongs in a pull request like any other judgment about the corpus.');
  console.log('A dismissal is a judgment, not a tombstone — `--redo <id>` re-queries one by name.');
}

async function verify(argv) {
  const path = argv.find((a) => !a.startsWith('-'));
  if (!path || !existsSync(path)) {
    console.error('usage: node scripts/find-video-explainers.mjs verify picks.json');
    process.exit(2);
  }

  const picks = JSON.parse(readFileSync(path, 'utf8'));
  const entries = [];
  let bad = 0;

  for (const pick of picks) {
    const id = videoId(pick.url);
    if (!id) {
      console.error(`  ✗ ${pick.url}: not a YouTube url shape oEmbed can check`);
      bad += 1;
      continue;
    }
    if (!EXPLAINER_HOSTS.video.some((h) => pick.url.includes(h))) {
      console.error(`  ✗ ${pick.url}: host is not on the video allowlist`);
      bad += 1;
      continue;
    }

    const target = `https://www.youtube.com/watch?v=${id}`;
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(target)}&format=json`,
      { signal: AbortSignal.timeout(20_000) },
    );
    if (res.status === 404) {
      console.error(`  ✗ ${pick.url}: no such video — deleted, private, or mistyped`);
      bad += 1;
      continue;
    }
    if (!res.ok) {
      console.error(`  ✗ ${pick.url}: oEmbed answered HTTP ${res.status}`);
      bad += 1;
      continue;
    }
    const meta = await res.json();

    entries.push({
      for: pick.target,
      entry: {
        kind: 'video',
        scope: pick.scope ?? 'domain',
        title: meta.title,
        author: meta.author_name,
        url: target,
      },
    });
    console.log(`  ✓ ${meta.author_name} — ${meta.title}`);
  }

  const out = flag(argv, '--out') ?? 'video-explainers.json';
  save(out, entries);
  console.log(
    `\n${entries.length} verified, ${bad} rejected → ${out}\n` +
      `Titles and authors are YouTube's own strings, so check:explainers will agree with them.`,
  );
  if (bad > 0) process.exit(1);
}

const flag = (argv, name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
};

async function main() {
  const [cmd, ...argv] = process.argv.slice(2);
  if (cmd === 'search') return search(argv);
  if (cmd === 'verify') return verify(argv);
  if (cmd === 'dismiss') return dismiss(argv);
  console.error(
    'usage:\n' +
      '  YOUTUBE_API_KEY=... node scripts/find-video-explainers.mjs search [--concepts] [--redo-empty]\n' +
      '                                  [--redo id,id,...]\n' +
      '                                  [--budget 10000] [--per-target 5] [--min-score 0.35] [--out FILE]\n' +
      '  node scripts/find-video-explainers.mjs verify picks.json [--out FILE]\n' +
      '  node scripts/find-video-explainers.mjs dismiss dismissed.json [--out FILE]',
  );
  process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
