/**
 * Checks that every citation in /content/nodes is real and resolvable.
 *
 *   node scripts/check-citations.mjs            # structural checks + network
 *   node scripts/check-citations.mjs --offline  # structural checks only
 *   node scripts/check-citations.mjs --fast     # skip hosts that ask a crawl-delay
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
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  byUrl,
  crawlDelays,
  everyFailureWasSilent,
  hostOf,
  partitionByDelay,
  pool,
  skippedNotice,
  unreachableHosts,
  verifiedCount,
} from './fetch-pool.mjs';

const ROOT = resolve(process.cwd(), '..');
const NODES_DIR = join(ROOT, 'content/nodes');

const OFFLINE = process.argv.includes('--offline');
const FAST = process.argv.includes('--fast');

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
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        headers: method === 'GET' ? { Range: 'bytes=0-0' } : {},
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 405 || res.status === 501) continue;
      return { ok: res.ok, status: res.status };
    } catch (err) {
      return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { ok: false, status: 0, error: 'HEAD and GET both refused' };
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

  for (const url of failed) {
    const r = results.get(url);
    const cites = groups.get(url);
    const detail = r.status === 0 ? `could not reach (${r.error})` : `HTTP ${r.status}`;
    console.error(`  ✗ ${cites[0].ref}: ${detail} — ${url}`);
    console.error(
      `      ${cites.length} node(s): ${cites.slice(0, 6).map((c) => c.node).join(', ')}` +
        `${cites.length > 6 ? `, and ${cites.length - 6} more` : ''}`,
    );
  }

  if (problems.length > 0 || failed.length > 0) {
    const affected = failed.reduce((n, url) => n + groups.get(url).length, 0);
    console.error(`\n${problems.length} structural, ${failed.length} unresolvable page(s) affecting ${affected} citation(s).`);
    process.exit(1);
  }

  // Counts the entries actually reached, not the corpus. A --fast run that
  // printed the corpus size would be claiming the papers it skipped.
  const checked = checking.reduce((n, url) => n + groups.get(url).length, 0);
  const unchecked = citations.length - checked;
  console.log(
    `✓ ${checked} citation(s) across ${checking.length} paper(s) resolve` +
      (unchecked > 0 ? ` — ${unchecked} NOT resolved (--fast)` : ''),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
