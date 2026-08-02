/**
 * Checks that every citation in /content/nodes is real and resolvable.
 *
 *   node scripts/check-citations.mjs            # structural checks + network
 *   node scripts/check-citations.mjs --offline  # structural checks only
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
 * WHICH IS WHY THIS NEVER EXITS 0 ON AN UNVERIFIED CORPUS. If the network is
 * unreachable, it says so and exits 2. A checker that reports success because
 * it could not check is worse than no checker: it converts "nobody looked" into
 * "someone looked and it was fine".
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd(), '..');
const NODES_DIR = join(ROOT, 'content/nodes');

const OFFLINE = process.argv.includes('--offline');

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

  const failures = [];
  for (const c of citations) {
    const r = await resolves(c.url);
    if (!r.ok) failures.push({ c, r });
  }

  // An egress proxy that denies a host answers the CONNECT with its own status,
  // so "arxiv.org is blocked here" arrives looking exactly like "this paper was
  // retracted". Told apart by breadth, not by status: a corpus where EVERY
  // citation fails the same way is describing the network, not the content.
  //
  // Getting this backwards is the expensive direction. Reporting a blocked
  // sandbox as nine dead papers invites someone to delete nine real citations.
  const statuses = new Set(failures.map(({ r }) => r.status));
  const environmental = failures.length === citations.length && citations.length > 1 && statuses.size === 1;

  if (environmental) {
    const [status] = [...statuses];
    console.error(
      `\nAll ${citations.length} citations failed identically (${status === 0 ? 'no response' : `HTTP ${status}`}).\n` +
        `That is the network, not the content — an egress policy denying arxiv.org looks the\n` +
        `same as every paper vanishing at once, and only one of those is plausible.\n\n` +
        `Nothing was verified. Re-run where arxiv.org is reachable, or use --offline and say\n` +
        `plainly that the corpus is unresolved.`,
    );
    process.exit(2);
  }

  for (const { c, r } of failures) {
    const detail = r.status === 0 ? `could not reach (${r.error})` : `HTTP ${r.status}`;
    console.error(`  ✗ ${c.node} → ${c.ref}: ${detail} — ${c.url}`);
  }

  if (problems.length > 0 || failures.length > 0) {
    console.error(`\n${problems.length} structural, ${failures.length} unresolvable.`);
    process.exit(1);
  }

  console.log(`✓ ${citations.length} citation(s) resolve`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
