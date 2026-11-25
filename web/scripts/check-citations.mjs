/**
 * Checks that every citation in /content/nodes is real and resolvable.
 *
 *   node scripts/check-citations.mjs            # structural checks + network
 *   node scripts/check-citations.mjs --offline  # structural checks only
 *   node scripts/check-citations.mjs --fast     # skip hosts that ask a crawl-delay
 *   node scripts/check-citations.mjs --identity # stored titles against arXiv's own
 *
 * CLAUDE.md §4: "Citations are real, resolvable links. No invented references."
 * A generated node's citations are the single most likely thing in it to be
 * fabricated, and the failure is invisible — a plausible arXiv id for a paper
 * that does not exist reads exactly like a real one.
 *
 * TWO KINDS OF CHECK, AND WHY BOTH
 *
 * Structural checks need no network and catch the commonest fabrication shape:
 * a `ref` and a `url` that disagree, or an arXiv id whose date could not exist.
 * They are cheap, deterministic, and run anywhere.
 *
 * The network check is the only one that answers the actual question. It is
 * also the one that cannot run everywhere: a sandbox with a restrictive egress
 * policy cannot reach arxiv.org at all.
 *
 * WHICH IS WHY IT NEVER REPORTS WORK IT DID NOT DO. If the network is
 * unreachable it says so and exits 2; `--offline` and `--fast` say in the
 * success line itself what they left unresolved. A checker that reports success
 * because it could not check is worse than no checker: it converts "nobody
 * looked" into "someone looked and it was fine".
 *
 * THIS IS THE SLOW HALF OF ADR-0020, AND TODAY IT IS ALL OF IT. Every citation
 * in the corpus is an arxiv.org url, and arxiv.org asks fifteen seconds between
 * requests — so a full sweep of 485 papers is a two-hour job, which is why this
 * runs weekly from links.yml rather than on a pull request. `--fast` is what a
 * pull request would use, and today it checks nothing at all and says so.
 *
 * AND A THIRD QUESTION, ASKED ON ITS OWN (#558). Resolving answers "does this
 * URL load", which a real-but-wrong paper passes — and that is the defect every
 * verification batch has found most. `--identity` asks whether the paper at the
 * id is the one the node names, by comparing each stored title with the title
 * arXiv's export API gives that id. It is a third check in the same weekly job,
 * never a pull-request gate; ADR-0020's addendum says why.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as sleepFor } from 'node:timers/promises';
import {
  byUrl,
  crawlDelays,
  everyFailureWasSilent,
  hostOf,
  partitionByDelay,
  politeFetch,
  pool,
  THROTTLED,
  skippedNotice,
  unreachableHosts,
  verifiedCount,
} from './fetch-pool.mjs';

const ROOT = resolve(process.cwd(), '..');
const NODES_DIR = join(ROOT, 'content/nodes');

const OFFLINE = process.argv.includes('--offline');
const FAST = process.argv.includes('--fast');
const IDENTITY = process.argv.includes('--identity');

/** arXiv ids are YYMM.NNNNN (or the pre-2007 `archive/YYMMNNN` form). */
const ARXIV_REF = /^arXiv:(\d{4})\.(\d{4,5})(v\d+)?$/;
const ARXIV_OLD = /^arXiv:([a-z-]+(\.[A-Z]{2})?\/\d{7})$/;

export function readCitations() {
  return readdirSync(NODES_DIR)
    .filter((f) => f.endsWith('.json'))
    .flatMap((file) => {
      const node = JSON.parse(readFileSync(join(NODES_DIR, file), 'utf8'));
      return node.citations.map((c) => ({ ...c, node: node.id }));
    });
}

/**
 * Checks that do not need the network.
 *
 * @returns {string[]} one message per problem
 */
export function structuralProblems(citations, today = new Date()) {
  const problems = [];
  const seen = new Map();

  for (const c of citations) {
    const where = `${c.node} → ${c.ref}`;

    if (!c.url.startsWith('https://')) {
      problems.push(`${where}: url is not https`);
    }

    const m = ARXIV_REF.exec(c.ref);
    if (m) {
      const [, yymm, num] = m;
      const year = 2000 + Number(yymm.slice(0, 2));
      const month = Number(yymm.slice(2));

      // A fabricated id usually looks right and dates wrong. Month 00 or 13
      // cannot exist, and a paper cannot be published after today.
      if (month < 1 || month > 12) {
        problems.push(`${where}: arXiv month ${month} does not exist`);
      } else if (new Date(year, month - 1, 1) > today) {
        problems.push(`${where}: arXiv id is dated in the future (${year}-${String(month).padStart(2, '0')})`);
      }

      // The ref and the url have to name the same paper. When a model invents a
      // citation it frequently invents them independently.
      const expected = `${yymm}.${num}`;
      if (!c.url.includes(expected)) {
        problems.push(`${where}: url does not contain the arXiv id ${expected} — ${c.url}`);
      }
    } else if (!ARXIV_OLD.test(c.ref) && c.url.includes('arxiv.org')) {
      problems.push(`${where}: arxiv.org url with a ref that is not an arXiv id`);
    }

    // The same paper cited under two different urls is a sign one was invented.
    const prior = seen.get(c.ref);
    if (prior && prior !== c.url) {
      problems.push(`${where}: cited elsewhere as ${prior}, here as ${c.url}`);
    }
    seen.set(c.ref, c.url);
  }

  return problems;
}

async function resolves(url) {
  // HEAD first: arXiv answers it and it costs nothing. Some hosts refuse HEAD,
  // so a 405 falls through to a ranged GET rather than being read as dead.
  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await politeFetch(url, {
        method,
        redirect: 'follow',
        headers: method === 'GET' ? { Range: 'bytes=0-0' } : {},
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 405 || res.status === 501) continue;
      // Still throttled after the retries (#408). arxiv.org holds every url in
      // this corpus and the sweep is a two-hour job, so it is the run most
      // exposed to a host saying "not now" — and reporting that as a retracted
      // paper is the mistake this file's own note calls the expensive one.
      if (THROTTLED.has(res.status)) return { ok: false, status: res.status, throttled: true };
      return { ok: res.ok, status: res.status };
    } catch (err) {
      return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { ok: false, status: 0, error: 'HEAD and GET both refused' };
}

/*
 * ── IDENTITY (#558) ──────────────────────────────────────────────────────────
 *
 * Is the paper at this id the paper this node names? The export API answers
 * with the title arXiv holds for each id, a batch of ids to a request, so the
 * whole corpus is a handful of requests where the sweep above is 485.
 *
 * NETWORK ONLY, AND NEVER ON A PULL REQUEST (ADR-0020's addendum). Like the
 * sweep it reaches a third party, which is the reason a gate fails for causes
 * the pull request cannot fix — and arXiv is exactly the host an authoring
 * sandbox cannot reach. Everything below takes an injected fetch and sleep, so
 * the tests prove the batching, the spacing and the exit codes offline.
 */

/** The export API, which answers in Atom: one `<entry>` per paper. */
export const ARXIV_API = 'https://export.arxiv.org/api/query';

/** Ids per request — #558's figure, which makes 485 papers five requests. */
export const ARXIV_BATCH = 100;

/**
 * Seconds between requests, as a FLOOR. arXiv's API terms ask for no more than
 * one request every three seconds, on one connection at a time. A longer
 * `Crawl-delay` in the host's robots.txt wins, read at runtime as ADR-0020
 * requires; nothing lowers this.
 */
export const ARXIV_GAP_SECONDS = 3;

/** Named, so arXiv can see whose script this is and where to say so. */
export const USER_AGENT =
  'the-infinity check:citations --identity (+https://github.com/opendroid/the-infinity)';

/** A title that is not exact, but at least this similar, warns rather than fails. */
export const WARN_AT = 0.9;

/** How many results a title search reads for an exact match. */
const SEARCH_RESULTS = 25;

/** Per attempt. A hundred-paper answer is a few hundred kilobytes. */
const TIMEOUT_MS = 30_000;

/**
 * @typedef {object} Citation
 * @property {string} node
 * @property {string} ref
 * @property {string} title
 * @property {string} url
 */

/**
 * The part of a `fetch` Response this reads, which is all a test's fake must be.
 *
 * @typedef {object} FetchAnswer
 * @property {boolean} ok
 * @property {number} status
 * @property {{ get(name: string): string | null }} [headers]
 * @property {() => Promise<string>} text
 */

/**
 * @typedef {object} IdentityOptions
 * @property {(url: string, init: { headers: Record<string, string>, signal: AbortSignal }) => Promise<FetchAnswer>} [fetchImpl]
 * @property {(ms: number) => Promise<unknown>} [sleep] injected so a test proves
 *   the gap without spending it
 * @property {number} [gapSeconds] the host's own Crawl-delay; never lowers the floor
 * @property {(line: string) => void} [out] stdout, for what does not fail the run
 * @property {(line: string) => void} [err] stderr, for what does
 */

/**
 * The id a ref names, spelled the way the API takes it — `2502.16982`,
 * `2502.16982v3`, `cs/9605103` — or null for a ref that is not an arXiv id.
 *
 * @param {string} ref
 * @returns {string | null}
 */
export function arxivId(ref) {
  const m = ARXIV_REF.exec(ref);
  if (m) return `${m[1]}.${m[2]}${m[3] ?? ''}`;
  return ARXIV_OLD.exec(ref)?.[1] ?? null;
}

/**
 * One paper however it is spelled: without a version, and without the subject
 * class a pre-2007 id may carry — `math.GT/0309136` is `math/0309136`, because
 * the subject class was never part of the identifier. An answer's `<id>` is an
 * abs url ending in a version, so a request and its answer meet only here.
 *
 * @param {string} id
 * @returns {string}
 */
export function paperKey(id) {
  return id.replace(/v\d+$/, '').replace(/^([a-z-]+)\.[A-Za-z]{2}\//, '$1/');
}

/**
 * A title reduced to what two honest copies of it share (#558): case,
 * punctuation, Unicode dashes, LaTeX and whitespace are not the title.
 *
 * LATEX FIRST, while a backslash or a dollar still means something. arXiv keeps
 * a title the way its authors typed it — `$k$-means`, `\emph{Attention}`,
 * `Schr\"odinger` — where the corpus stores what a reader sees. Math delimiters
 * go and what they held stays, so `$k$NN` is `kNN`; `\cmd{x}` becomes `x`; an
 * old font switch like `{\em …}` goes; an accent command keeps its letter, and
 * NFKD makes a Unicode accent do the same, so `Schr\"odinger` and `Schrödinger`
 * agree. A backslash left after that is a separator like any other, which is
 * how `$\alpha$` comes to read as "alpha".
 *
 * THEN ANYTHING THAT IS NOT A LETTER OR A DIGIT IS ONE SEPARATOR. That is where
 * every dash goes — hyphen, en, em, minus — and every space, tab, and the line
 * breaks arXiv wraps a long title with. Letters are Unicode letters, not a–z:
 * dropping one this did not recognise could make two different titles equal,
 * which is the permissive direction of the mistake.
 *
 * @param {string} title
 * @returns {string}
 */
export function normalize(title) {
  let s = String(title)
    .replace(/\\([ij])(?![A-Za-z])/g, '$1') // dotless i and j, as in \'{\i}
    .replace(/\\[`'^"~=.]\s*\{?\s*([A-Za-z])\s*\}?/g, '$1') // \"o, \'{e}
    .replace(/\\(?:em|it|bf|sc|rm|tt|sl|sf)(?![A-Za-z])\s*/g, '') // {\em …}
    .replace(/\$/g, ''); // $…$ and $$…$$
  // \cmd{x} → x, innermost first, so \textbf{\emph{x}} unwraps in two passes.
  // Never \cmd{}: `\LaTeX{}` would vanish, and a vanished word is the
  // permissive direction again.
  for (let before = ''; before !== s; ) {
    before = s;
    s = s.replace(/\\[A-Za-z]+\s*\{([^{}]+)\}/g, '$1');
  }
  return s
    .replace(/[{}]/g, '') // BibTeX case protection: {B}ayesian
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // the accent NFKD split off: é → e
    .replace(/\p{Cf}/gu, '') // soft hyphen, zero-width space: invisible, so no break
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * How alike two titles are, from 0 to 1 — meant for `normalize`d ones.
 *
 * THE MEASURE IS LEVENSHTEIN SIMILARITY: one minus the edit distance (the
 * fewest single-character insertions, deletions and substitutions that turn one
 * string into the other) divided by the length of the longer string. Over
 * characters rather than words, so "pretraining" against "pre training" costs
 * one edit, and a dropped "BERT:" prefix costs the five characters it was.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function similarity(a, b) {
  const x = [...a];
  const y = [...b];
  const longer = Math.max(x.length, y.length);
  if (longer === 0) return 1;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= y.length; j += 1) {
      const swap = prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1);
      row.push(Math.min(prev[j] + 1, row[j - 1] + 1, swap));
    }
    prev = row;
  }
  return 1 - prev[y.length] / longer;
}

/**
 * A stored title against arXiv's, decided the way #558 settled it: exact after
 * `normalize` passes; a similarity of WARN_AT or more warns, printed but never
 * red, because a dropped prefix or a hyphen is a person's call to make; anything
 * else fails. So does no title at all — arXiv holding nothing for an id is not
 * a near match to anything.
 *
 * @param {string} stored
 * @param {string | null} arxiv
 * @returns {'pass' | 'warn' | 'fail'}
 */
export function classify(stored, arxiv) {
  const a = normalize(stored);
  const b = arxiv === null ? '' : normalize(arxiv);
  if (a === '' || b === '') return 'fail';
  if (a === b) return 'pass';
  return similarity(a, b) >= WARN_AT ? 'warn' : 'fail';
}

/** A code point from a numeric reference, or U+FFFD for one that cannot be. */
const codePoint = (n) => (Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '�');

/** XML's five entities and numeric references; `&amp;` last, so `&amp;lt;` stays `&lt;`. */
const decodeXml = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => codePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/**
 * Paper titles from an arXiv Atom answer, keyed by `paperKey`, in the order the
 * answer gives them — relevance, for a search.
 *
 * ENTRIES ONLY. The feed carries a `<title>` of its own, the query echoed back,
 * and reading that as a paper's would compare every citation with a sentence
 * about the request. An entry whose `<id>` is not an abs url is arXiv reporting
 * an error, titled "Error", and is skipped rather than read as a paper by that
 * name. A regex, not an XML parser, because this is all that is read, and an
 * XML dependency would cost more than it is worth — the call ci-workflow.test.ts
 * makes about YAML.
 *
 * @param {string} xml
 * @returns {Map<string, string | null>} paper → its title, null if it has none
 */
export function parseFeed(xml) {
  const titles = new Map();
  for (const [, entry] of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)) {
    const id = /<id\b[^>]*>([\s\S]*?)<\/id>/.exec(entry)?.[1]?.trim() ?? '';
    const abs = /^https?:\/\/arxiv\.org\/abs\/(\S+)$/.exec(id);
    if (!abs) continue;
    const paper = paperKey(abs[1]);
    if (titles.has(paper)) continue;
    const title = /<title\b[^>]*>([\s\S]*?)<\/title>/.exec(entry)?.[1];
    titles.set(paper, title === undefined ? null : decodeXml(title).trim() || null);
  }
  return titles;
}

/**
 * One serial client for the export API. Every request it sends — the lookups
 * and the title searches alike — waits the gap after the one before, and says
 * whose it is.
 *
 * THE GAP WRAPS EACH ATTEMPT, NOT EACH CALL. `politeFetch` retries a 429 or a
 * 503, and a `Retry-After: 0` would otherwise send the retry straight back:
 * spacing the fetch it retries through keeps "one request every three seconds"
 * true of the requests arXiv actually receives.
 *
 * @param {IdentityOptions} opts
 * @returns {(url: string) => Promise<{ titles: Map<string, string | null>, error?: undefined } | { error: string, titles?: undefined }>}
 */
function arxivClient({ fetchImpl = fetch, sleep = sleepFor, gapSeconds = 0 }) {
  const gapMs = Math.max(ARXIV_GAP_SECONDS, gapSeconds) * 1000;
  let sent = 0;
  const spaced = async (url) => {
    if (sent > 0) await sleep(gapMs);
    sent += 1;
    return fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  };
  return async (url) => {
    try {
      const res = await politeFetch(url, {}, { fetchImpl: spaced, sleep });
      if (!res.ok) {
        return {
          error: THROTTLED.has(res.status)
            ? `${hostOf(url)} still asked us to slow down after retrying (HTTP ${res.status})`
            : `${hostOf(url)} answered HTTP ${res.status}`,
        };
      }
      return { titles: parseFeed(await res.text()) };
    } catch (err) {
      return { error: `could not reach ${hostOf(url)} (${err instanceof Error ? err.message : String(err)})` };
    }
  };
}

/**
 * The search a failure's candidate comes from: arXiv's title search for the
 * stored title as a phrase, read for an EXACT normalized match. A near match is
 * not a candidate — it is how a sibling paper would get proposed in this one's
 * place, which is the defect this check exists to find.
 *
 * @returns {Promise<string>} what follows `candidate:` on the failure
 */
async function candidateFor(want, ask) {
  if (want === '') return 'none';
  const phrase = want.split(' ').map(encodeURIComponent).join('+');
  const answer = await ask(
    `${ARXIV_API}?search_query=ti:%22${phrase}%22&start=0&max_results=${SEARCH_RESULTS}`,
  );
  // "none" alone would say a search ran and found nothing. It did not run.
  if (answer.error !== undefined) return `none (the title search failed: ${answer.error})`;
  for (const [paper, title] of answer.titles) {
    if (title !== null && normalize(title) === want) return `arXiv:${paper}`;
  }
  return 'none';
}

const oneLine = (s) => s.replace(/\s+/g, ' ').trim();
const byRef = (a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);
const cited = (groups) => groups.reduce((n, g) => n + g.nodes.length, 0);

/**
 * Every citation's stored title against arXiv's own, printed as it goes; the
 * promise resolves to the exit code (#558).
 *
 *   0  every title is arXiv's — some only nearly, and those were printed
 *   1  at least one is not, printed with its nodes, the ref, both titles and a
 *      candidate id, which only an exact title search can supply
 *   2  something could not be checked and nothing failed. No success line:
 *      "nobody looked" must never read as "someone looked and it was fine".
 *
 * @param {Citation[]} citations
 * @param {IdentityOptions} [opts]
 * @returns {Promise<0 | 1 | 2>}
 */
export async function identityCheck(citations, opts = {}) {
  const { out = console.log, err = console.error } = opts;

  // An empty corpus is said out loud, not reported as a pass (#357).
  if (citations.length === 0) {
    out('· no citations in /content/nodes — nothing to check (this is not a pass)');
    return 0;
  }

  // ONE LOOKUP PER PAPER, the way the sweep fetches once per url (#373), and
  // one verdict per ref-and-title, so a paper cited on twelve nodes reports
  // once — unless two nodes disagree about what it is called.
  const groups = new Map();
  const ids = new Map();
  const notArxiv = [];
  for (const c of citations) {
    const id = arxivId(c.ref);
    if (id === null) {
      notArxiv.push(c);
      continue;
    }
    const paper = paperKey(id);
    if (!ids.has(paper)) ids.set(paper, id);
    const key = `${c.ref}\n${c.title}`;
    const group = groups.get(key) ?? { ref: c.ref, title: c.title, paper, nodes: [] };
    group.nodes.push(c.node);
    groups.set(key, group);
  }

  const ask = arxivClient(opts);
  const titles = new Map();
  const unchecked = new Map();
  const asking = [...ids.values()];
  for (let i = 0; i < asking.length; i += ARXIV_BATCH) {
    const batch = asking.slice(i, i + ARXIV_BATCH);
    // max_results AS WELL AS id_list: the API stops at ten results unless told
    // otherwise, which would leave ninety papers in every batch looking absent.
    const answer = await ask(`${ARXIV_API}?id_list=${batch.join(',')}&start=0&max_results=${batch.length}`);
    const papers = batch.map(paperKey);
    // NONE OF A BATCH IS THE SERVICE, NOT A HUNDRED WRONG TITLES — told apart by
    // breadth, the rule the sweep applies to a host that answers nothing at all.
    const why =
      answer.error ??
      (papers.some((p) => answer.titles.has(p))
        ? null
        : `${hostOf(ARXIV_API)} answered with none of the ${batch.length} paper(s) asked for`);
    for (const p of papers) {
      if (why === null) titles.set(p, answer.titles.get(p) ?? null);
      else unchecked.set(p, why);
    }
  }

  const passed = [];
  const warned = [];
  const failed = [];
  const skipped = [];
  for (const g of groups.values()) {
    if (unchecked.has(g.paper)) {
      skipped.push(g);
      continue;
    }
    const arxiv = titles.get(g.paper) ?? null;
    const verdict = classify(g.title, arxiv);
    (verdict === 'pass' ? passed : verdict === 'warn' ? warned : failed).push({ ...g, arxiv });
  }

  for (const g of warned.sort(byRef)) {
    // Floored, not rounded: 0.996 printed as "1.00" would read as an exact match.
    const score = Math.floor(similarity(normalize(g.title), normalize(g.arxiv)) * 100) / 100;
    out(
      `  ~ ${g.ref} — nearly arXiv's title (similarity ${score.toFixed(2)}), so a warning\n` +
        `      node(s): ${g.nodes.join(', ')}\n` +
        `      stored:  ${g.title}\n` +
        `      arXiv:   ${oneLine(g.arxiv)}`,
    );
  }

  // One search per distinct stored title, however many papers share it.
  const candidates = new Map();
  for (const g of failed.sort(byRef)) {
    const want = normalize(g.title);
    if (!candidates.has(want)) candidates.set(want, await candidateFor(want, ask));
    err(
      `  ✗ ${g.ref} — the stored title is not arXiv's title for this id\n` +
        `      node(s):   ${g.nodes.join(', ')}\n` +
        `      stored:    ${g.title}\n` +
        `      arXiv:     ${g.arxiv === null ? '(none — arXiv returned no title for this id)' : oneLine(g.arxiv)}\n` +
        `      candidate: ${candidates.get(want)}`,
    );
  }

  if (skipped.length > 0 || notArxiv.length > 0) {
    const reasons = new Map();
    for (const g of skipped) {
      const why = unchecked.get(g.paper);
      reasons.set(why, (reasons.get(why) ?? 0) + g.nodes.length);
    }
    if (notArxiv.length > 0) reasons.set('not an arXiv id, so arXiv holds no title to compare', notArxiv.length);
    err(
      `\n${cited(skipped) + notArxiv.length} citation(s) NOT checked for identity:\n` +
        [...reasons].map(([why, n]) => `  ${n} citation(s): ${why}`).join('\n') +
        `\n\nThat says nothing about whether those titles are right. Re-run where ` +
        `${hostOf(ARXIV_API)} is reachable — links.yml is.`,
    );
  }

  // A WRONG TITLE OUTRANKS AN INCOMPLETE RUN, as a dead page does in the sweep.
  if (failed.length > 0) {
    const papers = new Set(failed.map((g) => g.paper)).size;
    err(`\n${cited(failed)} citation(s) on ${papers} paper(s) carry a title arXiv does not give that id.`);
    return 1;
  }
  if (skipped.length > 0 || notArxiv.length > 0) return 2;

  const near = cited(warned);
  out(
    `✓ ${cited(passed) + near} citation(s) across ${titles.size} paper(s) carry arXiv's own title` +
      (near > 0 ? ` — ${near} only nearly, warned above` : ''),
  );
  return 0;
}

async function main() {
  const citations = readCitations();
  const problems = structuralProblems(citations);

  for (const p of problems) console.error(`  ✗ ${p}`);

  if (OFFLINE) {
    if (problems.length > 0) {
      console.error(`\n${problems.length} structural problem(s).`);
      process.exit(1);
    }
    // Deliberately not "all citations valid": nothing here proved any paper
    // exists. Saying otherwise is the failure this script is built to avoid.
    console.log(`✓ ${citations.length} citation(s) structurally consistent — NOT resolved (--offline)`);
    process.exit(0);
  }

  // AFTER --offline, so a run asked to reach nothing still reaches nothing, and
  // instead of the sweep below, which identity does not need. A structural
  // problem stops it first: `npm test` fails on one already, so this should not
  // fire on main, and a ref that is not well formed is not one to look up.
  if (IDENTITY) {
    if (problems.length > 0) {
      console.error(`\n${problems.length} structural problem(s).`);
      process.exit(1);
    }
    const host = hostOf(ARXIV_API);
    const delays = await crawlDelays([host]);
    process.exit(await identityCheck(citations, { gapSeconds: delays.get(host) }));
  }

  // ONE FETCH PER PAPER, NOT PER CITATION (#373). 800 citations are 485
  // distinct arXiv URLs — a well-cited paper appears on up to twelve concepts —
  // and the fetch only ever asked whether the URL answers, which does not depend
  // on which node is asking.
  const groups = byUrl(citations);

  // WHAT EACH HOST ASKS FOR, READ FROM THE HOST (ADR-0020). arxiv.org's
  // robots.txt states 15 seconds between requests and, at the top, that
  // "indiscriminate automated downloads from this site are not permitted".
  // A host in this map runs serially with that gap; the rest keep the pool.
  const delays = await crawlDelays([...groups.keys()].map(hostOf));
  const { checking, skipped } = FAST
    ? partitionByDelay([...groups.keys()], delays)
    : { checking: [...groups.keys()], skipped: new Map() };

  if (skipped.size > 0) {
    console.log(skippedNotice(skipped, delays, groups, 'citation'));
  }

  // Nothing left to ask about is not a pass, and on this corpus it is the
  // NORMAL --fast outcome: all 485 papers are on arxiv.org, so skipping the
  // delayed hosts skips everything. Said plainly rather than dressed as a tick.
  if (checking.length === 0) {
    const structural = `${citations.length} citation(s) structurally consistent`;
    console.log(`· ${structural} — NOT resolved, every url is on a host --fast skips`);
    process.exit(0);
  }

  const results = await pool(checking, resolves, { perHost: 4, delays });
  const failed = checking.filter((url) => !results.get(url).ok);

  // An egress proxy that denies a host answers the CONNECT with its own status,
  // so "arxiv.org is blocked here" arrives looking exactly like "this paper was
  // retracted". Told apart by breadth, not by status: a host where EVERY url
  // fails the same way is describing the network, not the content.
  //
  // Getting this backwards is the expensive direction. Reporting a blocked
  // sandbox as nine dead papers invites someone to delete nine real citations.
  //
  // Per host rather than per corpus since #373. This corpus is single-host —
  // all 800 citations are arxiv.org — so the two are the same answer here; the
  // shared helper is what keeps this checker and check:explainers agreeing.
  const dead = unreachableHosts(results);

  if (everyFailureWasSilent(results)) {
    const [{ host, urls }] = dead;
    // DERIVED, NOT ASSERTED (#390). This used to print "Nothing was verified"
    // unconditionally, which is true only while every citation is on one host.
    // Add a citation elsewhere and the sentence becomes false with nothing to
    // catch it — the same shape as the helper above claiming to read successes
    // it never looked at.
    const ok = verifiedCount(results);
    console.error(
      `\nAll ${urls} url(s) on ${host} got no response at all.\n` +
        `That is the network, not the content — an egress policy denying arxiv.org looks the\n` +
        `same as every paper vanishing at once, and only one of those is plausible.\n\n` +
        `${ok === 0 ? 'Nothing was verified' : `Only ${ok} of ${results.size} url(s) were verified`}. ` +
        `Re-run where ${host} is reachable, or use --offline and say\n` +
        `plainly that the corpus is unresolved.`,
    );
    process.exit(2);
  }

  // A host that declined to answer has said nothing about the paper (#408).
  const throttled = failed.filter((url) => results.get(url).throttled === true);
  const gone = failed.filter((url) => results.get(url).throttled !== true);

  for (const url of gone) {
    const r = results.get(url);
    const cites = groups.get(url);
    const detail = r.status === 0 ? `could not reach (${r.error})` : `HTTP ${r.status}`;
    console.error(`  ✗ ${cites[0].ref}: ${detail} — ${url}`);
    console.error(
      `      ${cites.length} node(s): ${cites.slice(0, 6).map((c) => c.node).join(', ')}` +
        `${cites.length > 6 ? `, and ${cites.length - 6} more` : ''}`,
    );
  }

  if (throttled.length > 0) {
    const affected = throttled.reduce((n, url) => n + groups.get(url).length, 0);
    console.error(
      `\n${throttled.length} paper(s) asked us to slow down and were NOT resolved:\n` +
        throttled.map((url) => `  ${url} — HTTP ${results.get(url).status}, after retrying`).join('\n') +
        `\n\nThat is rate limiting, NOT a missing paper. ${affected} citation(s) went unresolved.`,
    );
  }

  if (problems.length > 0 || gone.length > 0) {
    const affected = gone.reduce((n, url) => n + groups.get(url).length, 0);
    console.error(`\n${problems.length} structural, ${gone.length} unresolvable page(s) affecting ${affected} citation(s).`);
    process.exit(1);
  }

  // Nobody asked to skip these, so the sweep is incomplete rather than clean.
  if (throttled.length > 0) process.exit(2);

  // Counts the entries actually reached, not the corpus. A --fast run that
  // printed the corpus size would be claiming the papers it skipped.
  const checked = checking
    .filter((url) => results.get(url).ok)
    .reduce((n, url) => n + groups.get(url).length, 0);
  const unchecked = citations.length - checked;
  console.log(
    `✓ ${checked} citation(s) across ${checking.length} paper(s) resolve` +
      (unchecked > 0 ? ` — ${unchecked} NOT resolved (--fast)` : ''),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
