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
 * The `Crawl-delay` a robots.txt states for `User-agent: *`, in seconds.
 *
 * PARSED, NOT TABULATED, AND ADR-0020 EXISTS BECAUSE OF ONE FILE. Wikipedia's
 * robots.txt contains `Crawl-delay: 5`, and a grep finds it. It belongs to
 * `User-agent: SemrushBot`; the `*` group is sixty lines further down and states
 * no delay. A table of numbers in this repository would have recorded that five
 * and been wrong in the direction nobody notices — slower than asked, for a host
 * that asked nothing. Reading the file is also the only thing that stays right
 * the day arXiv changes its mind.
 *
 * @param {string[]} hosts bare hostnames, as `hostOf` returns them
 * @returns {Promise<Map<string, number>>} host → seconds, absent when none stated
 */
export async function crawlDelays(hosts) {
  const delays = new Map();
  await Promise.all(
    [...new Set(hosts)].map(async (host) => {
      let body;
      try {
        const res = await fetch(`https://${host}/robots.txt`, {
          redirect: 'follow',
          signal: AbortSignal.timeout(15_000),
        });
        // No robots.txt is not an error and not a delay — it is a host that
        // stated nothing, which is the same position as a 200 with no directive.
        if (!res.ok) return;
        body = await res.text();
      } catch {
        return;
      }
      const seconds = starGroupDelay(body);
      if (seconds !== null) delays.set(host, seconds);
    }),
  );
  return delays;
}

/**
 * The `Crawl-delay` of the `User-agent: *` group, or null.
 *
 * Exported for the tests, which run it against the two real files rather than
 * against a hand-written imitation of them.
 *
 * GROUPS, NOT LINES. Consecutive `User-agent` lines share one group — that is
 * the format, and arXiv uses it — so a directive belongs to every agent named
 * since the last non-agent line. A group is left the moment a directive appears
 * and a new `User-agent` follows it.
 */
export function starGroupDelay(robots) {
  let agents = [];
  let inGroup = false;

  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const at = line.indexOf(':');
    if (at === -1) continue;
    const field = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();

    if (field === 'user-agent') {
      // A `User-agent` after directives starts a fresh group rather than
      // widening the one just closed.
      if (inGroup) {
        agents = [];
        inGroup = false;
      }
      agents.push(value.toLowerCase());
      continue;
    }

    inGroup = true;
    if (field !== 'crawl-delay' || !agents.includes('*')) continue;
    const seconds = Number(value);
    // A delay this cannot read is not a delay of zero. Ignoring it would be the
    // permissive direction of a mistake, so it is skipped and the next
    // `Crawl-delay` in the group, if any, gets its turn.
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
  }
  return null;
}

/** Resolves after `ms`. */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs `verify` over every URL, capped PER HOST rather than globally.
 *
 * Per host because the cap is about politeness first and speed second: 46
 * simultaneous requests to d2l.ai is worse behaviour than 46 spread out, and a
 * global cap would let one slow host starve the others. Hosts run in parallel;
 * within a host, at most `perHost` are in flight.
 *
 * A HOST IN `delays` OVERRIDES `perHost` ENTIRELY (ADR-0020). It runs one
 * request at a time, waiting the stated interval between them — because
 * "15 seconds between requests" and "4 in flight, 15 seconds apart each" are not
 * the same promise, and only the first is what arxiv.org's robots.txt asks for.
 *
 * @param {Map<string, number>} [opts.delays] host → seconds between requests
 * @param {(ms: number) => Promise<void>} [opts.sleep] injected so a test can
 *   prove the interval without spending it
 * @returns {Promise<Map<string, unknown>>} url → whatever `verify` resolved to
 */
export async function pool(urls, verify, { perHost = 4, delays = new Map(), sleep = wait } = {}) {
  const queues = new Map();
  for (const url of urls) {
    const host = hostOf(url);
    const queue = queues.get(host);
    if (queue) queue.push(url);
    else queues.set(host, [url]);
  }

  const results = new Map();
  await Promise.all(
    [...queues].map(async ([host, queue]) => {
      const delay = delays.get(host);
      if (delay) {
        // Serial, with the gap BETWEEN requests rather than after the last one.
        for (const [i, url] of queue.entries()) {
          if (i > 0) await sleep(delay * 1000);
          results.set(url, await verify(url));
        }
        return;
      }

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
 * The urls to check and the ones a `--fast` run is leaving alone.
 *
 * Split here rather than in each checker so both describe the skip the same way,
 * and so the thing the success line must not claim is a value rather than a
 * convention.
 *
 * @returns {{ checking: string[], skipped: Map<string, string[]> }} host → urls
 */
export function partitionByDelay(urls, delays) {
  const checking = [];
  const skipped = new Map();
  for (const url of urls) {
    const host = hostOf(url);
    if (!delays.has(host)) {
      checking.push(url);
      continue;
    }
    const seen = skipped.get(host);
    if (seen) seen.push(url);
    else skipped.set(host, [url]);
  }
  return { checking, skipped };
}

/**
 * What a `--fast` run did NOT check, named host by host.
 *
 * THE WHOLE POINT OF THE FLAG IS THAT IT CANNOT BE SILENT. A gate covering a
 * subset while printing the success line of a full run is precisely the failure
 * PLAN.md §8 names, and it is the failure `--fast` would be if this were left to
 * each caller's discretion. Shared so both checkers say it identically.
 *
 * @param {Map<string, string[]>} skipped host → urls, from `partitionByDelay`
 * @param {Map<string, number>} delays host → seconds
 * @param {Map<string, unknown[]>} groups url → the entries pointing at it
 * @param {string} noun what an entry is called, e.g. "citation"
 */
export function skippedNotice(skipped, delays, groups, noun) {
  const lines = [...skipped].map(([host, urls]) => {
    const entries = urls.reduce((n, url) => n + (groups.get(url)?.length ?? 1), 0);
    return `    ${host} — asks ${delays.get(host)}s between requests; ` +
      `${urls.length} url(s) covering ${entries} ${noun}(s) NOT checked`;
  });
  return (
    `· --fast skipped ${skipped.size} host(s) that publish a crawl-delay:\n` +
    `${lines.join('\n')}\n` +
    `  Those are checked by the weekly sweep, not here (ADR-0020).`
  );
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
 * see `everyFailureWasSilent`.
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
 * NAMED FOR WHAT IT DECIDES, AFTER THE OLD NAME LIED (#390). This used to be
 * called `nothingWasVerified`, and its note claimed "one real HTTP status
 * anywhere makes it false, because a run that reached some hosts is a run that
 * can report the ones it reached". It never looked at successes — only at
 * failures — so on a run that verified 126 of 134 pages and was blocked on 8, it
 * returned true and the caller exited 2 under a name meaning the opposite.
 *
 * The question it actually answers is the useful one: was every failure the
 * NETWORK rather than the CONTENT. A 404 is a server answering clearly; status 0
 * is DNS, TLS, a refused CONNECT, a timeout — the only failure a checker cannot
 * tell from a network problem, and so the only one that excuses an incomplete
 * run rather than condemning a page.
 *
 * The caller decides what to do about it, and both callers exit 2: an
 * unreachable host nobody asked to skip leaves work undone, and a check that
 * goes green because it could not look is the failure PLAN.md §8 names.
 * `--offline` and `--fast` exit 0 instead, because there the skip was requested.
 */
export function everyFailureWasSilent(results) {
  const failures = [...results.values()].filter((r) => !r.ok);
  return failures.length > 0 && failures.every((r) => r.status === 0);
}

/** How many urls actually answered ok — the half the name above does not read. */
export function verifiedCount(results) {
  return [...results.values()].filter((r) => r.ok).length;
}
