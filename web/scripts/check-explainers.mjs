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
 * A `read` entry has no such endpoint and gets the HEAD-then-GET treatment
 * from check-citations.mjs — which exists for non-arXiv hosts and, against a
 * corpus that is 800/800 arXiv, has never once been exercised.
 *
 * Like its neighbour, this NEVER reports success for work it did not do. If
 * every entry failed the same way the network is the explanation, and it says so
 * and exits 2 rather than reporting the corpus as dead.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { URL } from 'node:url';
import { EXPLAINER_HOSTS, hostOf } from './explainer-hosts.mjs';

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

/** Reachability only, for a `read`. Same HEAD-then-GET as check-citations.mjs. */
async function resolves(url) {
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

const verify = (e) => (e.kind === 'video' ? verifyVideo(e) : resolves(e.url));

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

  const failures = [];
  for (const e of explainers) {
    const r = await verify(e);
    if (!r.ok) failures.push({ e, r });
  }

  // The same reasoning as check-citations.mjs: an egress policy denying
  // youtube.com looks exactly like every video being deleted at once, and only
  // one of those is plausible. Told apart by breadth, not by status.
  const statuses = new Set(failures.map(({ r }) => r.status));
  const environmental = failures.length === explainers.length && explainers.length > 1 && statuses.size === 1;

  if (environmental) {
    const [status] = [...statuses];
    console.error(
      `\nAll ${explainers.length} explainers failed identically (${status === 0 ? 'no response' : `HTTP ${status}`}).\n` +
        `That is the network, not the content. Nothing was verified.\n\n` +
        `Re-run where youtube.com is reachable — CI is, and an authoring sandbox may not be —\n` +
        `or use --offline and say plainly that the corpus is unverified.`,
    );
    process.exit(2);
  }

  for (const { e, r } of failures) {
    const detail = r.error ?? `HTTP ${r.status}`;
    console.error(`  ✗ ${e.node} → ${e.title}: ${detail} — ${e.url}`);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} of ${explainers.length} explainer(s) could not be verified.`);
    process.exit(1);
  }

  const videos = explainers.filter((e) => e.kind === 'video').length;
  console.log(`✓ ${explainers.length} explainer(s) verified — ${videos} by title and author against YouTube`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
