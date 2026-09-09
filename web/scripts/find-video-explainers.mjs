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
 * read, and `--redo-empty` is how to re-query them.
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
    n += 0.4;
    trusted = true;
    reasons.push('allowlisted channel');
  } else if (NAMED_AUTHORS.some((a) => `${candidate.author} ${candidate.title}`.toLowerCase().includes(a))) {
    n += 0.25;
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
  n += 0.3 * overlap;
  // Naming the facet is the difference between a number and a reason: it says
  // the video matched "Softmax", not that it matched "Foundations" somehow.
  if (overlap > 0) reasons.push(`matches "${matched}" ${Math.round(overlap * 100)}%`);

  // A teaching video is minutes, not seconds and not a whole conference day.
  const secs = candidate.durationSeconds;
  if (secs !== null && secs >= 240 && secs <= 5400) {
    n += 0.2;
    reasons.push('teachable length');
  } else if (secs !== null && secs < 120) {
    n -= 0.2;
    reasons.push('too short');
  }

  // Weak popularity prior, capped so it cannot outweigh relevance. Left
  // deliberately weak: a well-watched video is not a better teacher.
  const views = Number(candidate.views ?? 0);
  if (views > 0) n += Math.min(0.1, Math.log10(views) / 100);

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
    n -= 0.25;
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
 *
 * Each attempt is charged, because YouTube counts an attempt whether or not it
 * answers — an accounting that flattered itself here would spend real quota the
 * budget could not see.
 */
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
 */
export function pending(all, prior, { redoEmpty = false } = {}) {
  const done = new Set(prior.done ?? []);
  const productive = new Set((prior.candidates ?? []).map((c) => c.target));
  return all.filter((t) => !done.has(t.key) || (redoEmpty && !productive.has(t.key)));
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

async function search(argv, opts = {}) {
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
  const out = flag(argv, '--out') ?? (concepts ? 'video-candidates.concepts.json' : 'video-candidates.domains.json');
  const budget = Number(flag(argv, '--budget') ?? DAILY_UNITS);
  const perTarget = Number(flag(argv, '--per-target') ?? 5);
  const minScore = Number(flag(argv, '--min-score') ?? 0.35);

  const quota = new Quota(budget);
  const all = targets(readNodes(), { concepts });

  const prior = load(out) ?? { scope: concepts ? 'concept' : 'domain', done: [], candidates: [] };
  const done = new Set(prior.done);
  const productive = new Set(prior.candidates.map((c) => c.target));
  const todo = pending(all, prior, { redoEmpty });

  console.log(
    `${all.length} ${concepts ? 'concept' : 'domain'} target(s); ${done.size} already done, ${todo.length} to go` +
      (redoEmpty ? ` (--redo-empty: retrying ${done.size - productive.size} that found nothing)` : '') +
      `.\n` +
      `Budget ${budget} units — a search costs ${COST.search}, so about ${Math.floor(budget / (COST.search + COST.videos))} targets this run.\n`,
  );

  console.log('Resolving the channel allowlist:');
  const allowed = await resolveHandles(CHANNEL_HANDLES, key, quota);
  console.log(`  ${allowed.size} of ${CHANNEL_HANDLES.length} handle(s) resolved\n`);

  for await (const target of paced(todo, { pace })) {
    if (!quota.affords('search')) {
      console.log(`\nBudget reached at ${quota.spent} units. Re-run tomorrow — it resumes from ${out}.`);
      break;
    }

    let found;
    try {
      found = await searchOne(target, key, quota, perTarget, opts);
    } catch (err) {
      if (err.reason === 'quotaExceeded') {
        console.log(`\nYouTube says the daily quota is spent. Progress is saved in ${out}; re-run tomorrow.`);
        break;
      }
      console.error(`  ✗ ${target.key}: ${err.message}`);
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
  console.error(
    'usage:\n' +
      '  YOUTUBE_API_KEY=... node scripts/find-video-explainers.mjs search [--concepts] [--redo-empty]\n' +
      '                                  [--budget 10000] [--per-target 5] [--min-score 0.35] [--out FILE]\n' +
      '  node scripts/find-video-explainers.mjs verify picks.json [--out FILE]',
  );
  process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
