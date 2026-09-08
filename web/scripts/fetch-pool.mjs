import { URL } from 'node:url';

/**
 * The fetch policy `check:explainers` and `check:citations` share (#373).
 *
 * SHARED FOR THE REASON explainer-hosts.mjs IS. Two copies of a politeness
 * policy drift, and then one checker hammers a host the other is careful with,
 * for no reason anybody wrote down.
 *
 * Both checkers used to walk their corpus one entry at a time. At 13 explainers
 * that was invisible; at 482 it was 99 seconds on every pull request, which is
 * how `check:citations` ended up outside CI altogether (#361) and how this one
 * was heading the same way. The fix is two things, and the first matters more:
 *
 * DEDUPLICATE, THEN PARALLELISE. 482 explainer entries are 126 distinct pages,
 * because a domain fallback is one URL shared across a whole domain. Fetching
 * the page once instead of once per concept is a 3.8x cut before any
 * concurrency, and it is also why a dead page now reports once with its blast
 * radius rather than sixteen times.
 */

/** The host, lowercased and without `www.` — a grouping key and an allowlist key. */
export function hostOf(url) {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
}

/**
 * Entries grouped by the URL they point at.
 *
 * SOUND ONLY BECAUSE ANOTHER CHECK MAKES IT SO, which is worth knowing before
 * anyone relaxes that check: `structuralProblems` already rejects one URL
 * recorded with two different titles or authors — "the same resource described
 * two ways". It was written to catch an entry copied from memory. It is what
 * lets a single fetch stand for every entry sharing the URL.
 */
export function byUrl(entries) {
  const groups = new Map();
  for (const e of entries) {
    const group = groups.get(e.url);
    if (group) group.push(e);
    else groups.set(e.url, [e]);
  }
  return groups;
}

/**
 * Runs `verify` over every URL, capped PER HOST rather than globally.
 *
 * Per host because the cap is about politeness first and speed second: 46
 * simultaneous requests to d2l.ai is worse behaviour than 46 spread out, and a
 * global cap would let one slow host starve the others. Hosts run in parallel;
 * within a host, at most `perHost` are in flight.
 *
 * @returns {Promise<Map<string, unknown>>} url → whatever `verify` resolved to
 */
export async function pool(urls, verify, { perHost = 4 } = {}) {
  const queues = new Map();
  for (const url of urls) {
    const host = hostOf(url);
    const queue = queues.get(host);
    if (queue) queue.push(url);
    else queues.set(host, [url]);
  }

  const results = new Map();
  await Promise.all(
    [...queues.values()].map(async (queue) => {
      let next = 0;
      // Safe without a lock: `next++` never yields, so two workers cannot read
      // the same index. Node is single-threaded and this is the one place it
      // matters.
      const worker = async () => {
        while (next < queue.length) {
          const url = queue[next];
          next += 1;
          results.set(url, await verify(url));
        }
      };
      await Promise.all(Array.from({ length: Math.min(perHost, queue.length) }, worker));
    }),
  );
  return results;
}

/**
 * Hosts that answered NOTHING, grouped for the message.
 *
 * Replaces a single `environmental` flag that asked whether EVERY entry in the
 * corpus failed with the SAME status. That worked while the corpus was one host
 * (all 800 citations are arxiv.org). Explainers now span seven, so a genuinely
 * blocked sandbox no longer fails uniformly — and the direction it then fails in
 * is the expensive one ADR-0013 names: a network problem reported as dead
 * content invites someone to delete real entries.
 *
 * THE SIGNAL IS "NO RESPONSE", NOT "ALL THE SAME". An earlier version of this
 * asked whether every URL on a host failed identically, which is true of a
 * blocked host and equally true of a host with three deleted pages — and 404 is
 * the server answering clearly. Status 0 means the request never completed:
 * DNS, TLS, a refused CONNECT, a timeout. That is the only failure a checker
 * cannot tell from a network problem, so it is the only one excused.
 *
 * A host appears here when it had failures and every one of them got no
 * response. Whether that means "nothing was verified" is the caller's call —
 * see `nothingWasVerified`.
 */
export function unreachableHosts(results) {
  const byHost = new Map();
  for (const [url, r] of results) {
    if (r.ok) continue;
    const host = hostOf(url);
    const seen = byHost.get(host) ?? { failed: 0, silent: 0 };
    seen.failed += 1;
    if (r.status === 0) seen.silent += 1;
    byHost.set(host, seen);
  }

  const out = [];
  for (const [host, seen] of byHost) {
    if (seen.failed === seen.silent) out.push({ host, urls: seen.silent });
  }
  return out;
}

/**
 * True when there were failures and NONE of them was the server answering.
 *
 * The exit-2 condition: nothing here proved anything, and nothing here is
 * evidence a page is gone. One real HTTP status anywhere makes it false, because
 * a run that reached some hosts is a run that can report the ones it reached.
 */
export function nothingWasVerified(results) {
  const failures = [...results.values()].filter((r) => !r.ok);
  return failures.length > 0 && failures.every((r) => r.status === 0);
}
