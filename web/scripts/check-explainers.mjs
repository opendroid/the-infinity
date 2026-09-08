/**
 * Checks that every `explainers` entry is real, reachable, and attributed to
 * the person who actually made it (ADR-0017).
 *
 *   node scripts/check-explainers.mjs            # structural checks + network
 *   node scripts/check-explainers.mjs --offline  # structural checks only
 *
 * THIS IS A STRONGER CHECK THAN check:citations, AND THAT IS THE POINT.
 *
 * `check:citations` can only ask whether a URL answers. A retracted paper still
 * answers 200, which is why PLAN.md §8 calls a source that resolves and supports
 * nothing "the most common defect by a wide margin".
 *
 * A video can do better. YouTube's oEmbed endpoint answers 404 for a video that
 * is gone or private, and returns the real title and channel for one that is
 * live — so this compares what the node CLAIMS against what YouTube SAYS. A
 * fabricated video id fails because nothing is there; a real id under someone
 * else's name fails because the names disagree. Neither is catchable by asking
 * whether a URL loads.
 *
 * A `read` entry has no oEmbed, so it is fetched and its page title is compared
 * against the recorded one. That is the same question asked a weaker way: is the
 * thing at this URL the thing this node says is there.
 *
 * Like its neighbour, this NEVER reports success for work it did not do. If
 * every entry failed the same way the network is the explanation, and it says so
 * and exits 2 rather than reporting the corpus as dead.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { URL } from 'node:url';
import { EXPLAINER_HOSTS, hostOf } from './explainer-hosts.mjs';
import { byUrl, nothingWasVerified, pool, unreachableHosts } from './fetch-pool.mjs';

const ROOT = resolve(process.cwd(), '..');
const NODES_DIR = join(ROOT, 'content/nodes');

const OFFLINE = process.argv.includes('--offline');

export function readExplainers() {
  return readdirSync(NODES_DIR)
    .filter((f) => f.endsWith('.json'))
    .flatMap((file) => {
      const node = JSON.parse(readFileSync(join(NODES_DIR, file), 'utf8'));
      return (node.explainers ?? []).map((e) => ({ ...e, node: node.id }));
    });
}

/**
 * The video id, or null if the URL is not a shape YouTube serves.
 *
 * Three forms, because all three get pasted: the watch URL, the youtu.be short
 * link, and the embed path. Anything else is rejected rather than guessed at —
 * a URL this cannot parse is one oEmbed cannot check either.
 */
export function videoId(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = hostOf(url);
  if (host === 'youtu.be') return u.pathname.slice(1) || null;
  if (host !== 'youtube.com') return null;
  if (u.pathname === '/watch') return u.searchParams.get('v');
  if (u.pathname.startsWith('/embed/')) return u.pathname.slice('/embed/'.length) || null;
  return null;
}

/** Loose enough to survive punctuation, strict enough that a different video fails. */
const normalise = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9']+/g, ' ')
    .trim();

/**
 * Checks that do not need the network.
 *
 * @returns {string[]} one message per problem
 */
export function structuralProblems(explainers) {
  const problems = [];
  const seen = new Map();

  for (const e of explainers) {
    const where = `${e.node} → ${e.title}`;

    if (!e.url?.startsWith('https://')) {
      problems.push(`${where}: url is not https — ${e.url}`);
      continue;
    }

    let host;
    try {
      host = hostOf(e.url);
    } catch {
      problems.push(`${where}: url does not parse — ${e.url}`);
      continue;
    }

    // Duplicated from validate:content deliberately, off the SAME table, so this
    // script is correct when run on its own. A host it cannot verify is worse
    // than a missing entry: it looks checked and is not.
    const allowed = EXPLAINER_HOSTS[e.kind] ?? [];
    if (!allowed.includes(host)) {
      problems.push(`${where}: kind "${e.kind}" at ${host}, which this cannot verify`);
      continue;
    }

    // Duplicated from the schema for the same reason as the host table: this
    // script has to be right when run on its own, and an entry with no scope is
    // one whose page cannot say what it covers.
    if (e.scope !== 'concept' && e.scope !== 'domain') {
      problems.push(`${where}: scope is "${e.scope}" — must be "concept" or "domain"`);
      continue;
    }

    if (e.kind === 'video' && !videoId(e.url)) {
      problems.push(`${where}: no video id in ${e.url} — oEmbed has nothing to ask about`);
    }

    // The same resource under two different titles or authors means at least one
    // of them was written from memory rather than from the page.
    const prior = seen.get(e.url);
    if (prior && (prior.title !== e.title || prior.author !== e.author)) {
      problems.push(
        `${where}: ${e.url} is also on ${prior.node} as "${prior.title}" by ${prior.author} — ` +
          `the same resource described two ways`,
      );
    } else if (!prior) {
      seen.set(e.url, e);
    }
  }

  return problems;
}

/** The handful of entities that turn up in a page title. */
const unescape = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&(amp|quot|apos|nbsp|ndash|mdash|lsquo|rsquo|ldquo|rdquo);/g, ' ');

/** The page's own <title>, or null if it has none. */
export function titleOf(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? unescape(m[1]) : null;
}

/**
 * Existence AND identity, for a `read`.
 *
 * A GET alone proves only that SOMETHING answers at that URL, which is exactly
 * the weakness of check:citations that ADR-0017 set out not to inherit — a
 * moved post, a domain that changed hands, a 200-serving error page all pass it.
 * So the page's own <title> has to contain the recorded title.
 *
 * Substring rather than equality, because a title carries the site with it:
 * "The Illustrated Transformer – Jay Alammar – Visualizing machine learning one
 * concept at a time." and "11.5. Multi-Head Attention — Dive into Deep Learning
 * 1.0.3 documentation" both have to match what a reader would sensibly write
 * down (ADR-0018).
 */
async function verifyRead(e) {
  let res;
  try {
    res = await fetch(e.url, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
  if (!res.ok) return { ok: false, status: res.status };

  let body;
  try {
    body = await res.text();
  } catch (err) {
    return { ok: false, status: res.status, error: err instanceof Error ? err.message : String(err) };
  }

  const page = titleOf(body);
  if (page === null) {
    return { ok: false, status: res.status, error: 'the page has no <title> to check against' };
  }
  if (!normalise(page).includes(normalise(e.title))) {
    return { ok: false, status: res.status, error: `the page is titled "${page.trim()}"` };
  }
  return { ok: true, status: res.status };
}

/**
 * Existence AND attribution, for a `video`.
 *
 * oEmbed 404s for a video that is gone, deleted or private — the states a plain
 * GET of the watch page cannot distinguish, because YouTube serves 200 and an
 * apology for all of them.
 */
async function verifyVideo(e) {
  const target = `https://www.youtube.com/watch?v=${videoId(e.url)}`;
  const api = `https://www.youtube.com/oembed?url=${encodeURIComponent(target)}&format=json`;

  let res;
  try {
    res = await fetch(api, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
  if (res.status === 404) return { ok: false, status: 404, error: 'no such video — deleted, private, or invented' };
  if (!res.ok) return { ok: false, status: res.status };

  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, status: res.status, error: 'oEmbed did not return JSON' };
  }

  const mismatches = [];
  if (normalise(body.title) !== normalise(e.title)) {
    mismatches.push(`title is "${body.title}"`);
  }
  if (normalise(body.author_name) !== normalise(e.author)) {
    mismatches.push(`author is "${body.author_name}"`);
  }
  if (mismatches.length) {
    return { ok: false, status: res.status, error: `YouTube says ${mismatches.join(' and ')}` };
  }
  return { ok: true, status: res.status };
}

const verify = (e) => (e.kind === 'video' ? verifyVideo(e) : verifyRead(e));

async function main() {
  const explainers = readExplainers();
  const problems = structuralProblems(explainers);

  for (const p of problems) console.error(`  ✗ ${p}`);
  if (problems.length > 0) {
    console.error(`\n${problems.length} structural problem(s).`);
    process.exit(1);
  }

  // AN EMPTY CORPUS IS SAID OUT LOUD RATHER THAN REPORTED AS A PASS. This gate
  // shipped before any content used it, so "✓ 0 verified" would have been its
  // normal output — a green line for a check that had nothing to do, which is
  // the exact shape #357 caught this repository writing twice.
  if (explainers.length === 0) {
    console.log('· no explainers in /content/nodes — nothing to verify (this is not a pass)');
    process.exit(0);
  }

  if (OFFLINE) {
    // Not "valid": nothing here proved a single video exists.
    console.log(`✓ ${explainers.length} explainer(s) structurally consistent — NOT verified (--offline)`);
    process.exit(0);
  }

  // ONE FETCH PER PAGE, NOT PER ENTRY (#373). A domain fallback is one URL
  // shared across a whole domain, so 482 entries are 126 pages. Every entry
  // sharing a URL carries the same title and author — structuralProblems
  // rejects any that do not — so one of them stands for all of them.
  const groups = byUrl(explainers);
  const results = await pool([...groups.keys()], (url) => verify(groups.get(url)[0]), { perHost: 4 });

  const failed = [...groups.keys()].filter((url) => !results.get(url).ok);

  // Which hosts answered nothing, as opposed to which pages are gone. The old
  // version of this asked whether the WHOLE corpus failed identically, which
  // stopped meaning anything once the corpus spanned seven hosts.
  const dead = unreachableHosts(results);
  const blocked = failed.filter((url) => results.get(url).status === 0);
  const real = failed.filter((url) => results.get(url).status !== 0);

  for (const url of real) {
    const r = results.get(url);
    const entries = groups.get(url);
    const detail = r.error ?? `HTTP ${r.status}`;
    console.error(`  ✗ ${url}\n      ${detail}`);
    // Blast radius, because a dead domain fallback is one page and many
    // concepts, and the count is the thing a reader needs first.
    console.error(
      `      ${entries.length} concept(s): ${entries.slice(0, 6).map((e) => e.node).join(', ')}` +
        `${entries.length > 6 ? `, and ${entries.length - 6} more` : ''}`,
    );
  }

  if (dead.length > 0) {
    const affected = blocked.reduce((n, url) => n + groups.get(url).length, 0);
    console.error(
      `\n${dead.length} host(s) answered nothing, which is the network rather than the content:\n` +
        dead.map((d) => `  ${d.host} — ${d.urls} url(s), no response at all`).join('\n') +
        `\n\n${affected} explainer(s) went unverified. Re-run where those hosts are reachable — CI is,\n` +
        `and an authoring sandbox may not be — or use --offline and say plainly that they are unverified.`,
    );
    // Exit 2 only when nothing here is evidence a page is gone. One real HTTP
    // status anywhere makes this a run that found something, and exit 1 says so.
    if (nothingWasVerified(results)) process.exit(2);
  }

  if (real.length > 0) {
    const affected = real.reduce((n, url) => n + groups.get(url).length, 0);
    console.error(`\n${real.length} of ${groups.size} page(s) could not be verified, affecting ${affected} explainer(s).`);
    process.exit(1);
  }

  const videos = explainers.filter((e) => e.kind === 'video').length;
  const domain = explainers.filter((e) => e.scope === 'domain').length;
  console.log(
    `✓ ${explainers.length} explainer(s) across ${groups.size} page(s) verified by title — ` +
      `${videos} also by author against YouTube; ${domain} scoped to a domain rather than a concept`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
