# 0011 — Analytics is read from request logs, not from a script in the page

- **Status:** accepted — the hard part holds: no analytics JavaScript ships on any route.
  Linking Cloud Logging and adding `make analytics` is outstanding and needs a console
  step (#64).
- **Date:** 2026-08-04

## Context

M3 says "analytics on" and [#64](https://github.com/opendroid/the-infinity/issues/64) already
picked the answer in its title: Plausible. The question put to this ADR was narrower and
better — *should we use Firebase's Google Analytics integration?* Firebase offers it on the
same console page as Hosting, it is free, and it is one line of config. If it fits, taking
it is obviously right.

It does not fit, and the reason is not taste. It is a number this repo already committed to
in writing.

### Four facts, measured rather than recalled

**1. Firebase Analytics costs 14 KB gzipped, and the budget has 3 KB.**

`firebase/app` + `firebase/analytics`, tree-shaken through esbuild with `--minify`, gzipped
at level 9 — the same compression `npm run perf` uses:

```
firebase@12.17.0, entry calling initializeApp / getAnalytics / logEvent
  raw:   53,971 bytes
  gzip:  14,076 bytes
```

Against the headroom in [`perf-budget.json`](../../web/perf-budget.json), measured on the
build of `757b87c`:

| Route | measured | budget | headroom | Firebase Analytics as a multiple of headroom |
|---|---|---|---|---|
| `/` | 0 | **0** | **0** | ∞ |
| `/concepts` | 63,979 | 67,000 | 3,021 | 4.7× |
| `/search` | 63,979 | 67,000 | 3,021 | 4.7× |
| `/request` | 66,538 | 69,000 | 2,462 | 5.7× |
| `/404` | 66,977 | 69,500 | 2,523 | 5.6× |
| `/c/*` | 73,267 | 76,000 | 2,733 | 5.2× |
| `/t/*` | 68,040 | 70,500 | 2,460 | 5.7× |

It does not overrun one route. It overruns every route, by between four and six times the
entire allowance. Raising six budgets by 14 KB is permitted — `--update` exists — but the
budget file states the terms: *"RAISING A BUDGET IS A DECISION. The commit message has to
say what the extra weight bought."* The honest sentence would be "a page-view counter", and
it does not survive being written down.

**2. `/` is budgeted at zero, and that is not an accident of measurement.**

> `/` IS BUDGETED AT ZERO, AND THAT IS THE POINT. The landing page ships no JavaScript at
> all. It is the page a stranger meets first and the clearest evidence for static-first, so
> any island there should have to argue for itself in a pull request rather than arrive.

Every client-side option — Firebase Analytics, raw GA4, Plausible, a hand-rolled beacon —
puts JavaScript on that page. Not much, in Plausible's case. But zero is a stated invariant,
and the page it protects is the one an analytics script most wants to be on.

**3. `gtag.js` is loaded at runtime, and our own budget cannot see it.**

The 14 KB above is the SDK alone. `getAnalytics()` then injects a `<script>` pointing at
`googletagmanager.com` — a second payload, from a third-party origin, on the critical path.

That payload is invisible to `npm run perf`. The seed regex in
[`perf-budget.mjs`](../../web/scripts/perf-budget.mjs) is:

```js
/(?:src|component-url|renderer-url)="(\/_astro\/[^"]+\.js)"/g
```

It matches paths under `/_astro/` and nothing else. A `<script src="https://…">` does not
match. A script element created at runtime is not in the HTML to match against.

Verified by doing it rather than by reading the regex — a `gtag.js` tag injected into the
`<head>` of the built landing page, which is the one route budgeted at zero:

```
$ npm run perf
/                  0        0         0        2175        0
…
within budget
```

Zero JavaScript, budget met, Google Tag Manager in the `<head>`. The guardrail reports the
page it is guarding as empty.

**This is the part worth stopping on.** #64's acceptance criteria include *"inside the
performance budget"* — a check that, for every option on the table, would have passed
without measuring anything at all. It is precisely the defect class this project has spent
the week hunting: a check that passes for the wrong reason. Load Firebase Analytics through
Vite and it lands in `/_astro/` and CI goes red at 14 KB. Load it by script tag, as the
Firebase docs show, and CI stays green while the page gets *heavier*. The greener path is
the worse one.

**4. Both sources of truth already exist, and neither ships a byte.**

Firebase Hosting can export a `webrequests` log to Cloud Logging for every request its CDN
serves — path, status, `httpRequest.referer`, `httpRequest.userAgent`, `httpRequest.remoteIp`,
and `cacheHit`. It is opt-in from the console, retains 30 days by default, and is captured at
the CDN, so **cache hits are logged too** — which is #64's "a cached page still reports",
satisfied by construction rather than by a workaround.

And the API is already in the path for the interesting half. Every concept page fires exactly
one call after hydration — `GET /concepts/{id}/neighborhood`, the mini-map — so a concept
read is already a Cloud Run log line today, without anything being added.

## Decision

**Use the Firebase integration. The Cloud Logging one, not the Google Analytics one. No
analytics JavaScript ships on any route.**

Two sources, both already paid for:

| Source | Covers | Enabled by |
|---|---|---|
| Firebase Hosting → Cloud Logging (`webrequests`) | Every route including `/`, referrers, bots, CDN cache behaviour | Console: Project settings → Integrations → Cloud Logging → Link |
| Cloud Run request logs (existing) | Concept reads via the mini-map fetch, trail create/read, review and request submissions | Already on |

Hosting logs are load-bearing rather than redundant: the landing page ships no JavaScript
*and* makes no API call, so it is invisible to Cloud Run and would be invisible to any
option we did not put a script on. The one page we most want to measure is the one page we
have refused to instrument. Only the CDN sees it.

### Why not Firebase Analytics / GA4

Cost is not the objection — it is free. The objections, in the order they disqualify it:

1. **14 KB against 2.4–3 KB of headroom on six routes, and a seventh budgeted at zero.**
2. **Cookies.** GA4 sets `_ga`; a consent banner follows, on a site whose landing page is a
   single search field and one glowing element.
3. **A second uncounted payload** from `googletagmanager.com`, on the critical path.
4. **The readership leaves.** A portfolio piece about a graph does not need Google to own
   who read it, and the data it would hand back is shaped like an attention business, which
   this is not.

### Why not Plausible, which #64 chose

Plausible is a better product than GA4 on every axis that matters here — no cookies, no
banner, ~1 KB, a company whose incentives point the same way as ours. It still loses:

- **$9/month**, the project's first recurring cost, against $10/$25 budget alerts. That is
  not fatal on its own, but it is a real line item to buy something two free log sinks
  already hold.
- **Still JavaScript on a page budgeted at zero.**
- **Still uncounted by our own budget**, so the guardrail would not guard it either.
- It cannot see referrer chains between concept pages any better than logs can, and logs can.

### What decided it

The landing page budgeted at zero. Everything else on this page is a trade with a defensible
answer on both sides; that one is an invariant we wrote down before there was anything to
gain by breaking it. An analytics script is exactly the "hundred reasonable decisions" the
perf budget was built to catch.

### What this can measure that a script cannot

`httpRequest.referer` on a `/c/*` → `/c/*` request **is an edge traversal**. Which edges
readers actually pull, which concepts are dead ends in practice rather than in the schema,
where the thread gets dropped — that is the product's central question, and a page-view
counter never answers it. We get it for free because the graph is made of links and links
send referrers.

`cacheHit` tells us what fraction never reached an origin, which is the static-first claim
measured rather than asserted. `userAgent` separates crawlers from readers, which matters a
great deal in the first weeks after a sitemap submission and which most dashboards quietly
hide.

### What this cannot measure — stated now, not discovered in three months

- **Depth toggle usage.** ADR-0005 publishes depth as a DOM attribute and CSS switches the
  variants. No network, no log line. Which depth people actually read is a question we are
  choosing not to answer.
- **Search queries.** The index is fetched once and filtered locally, so the query never
  leaves the browser.
- **Scroll depth and time on page.** Not available, not sought.
- **Unique visitors.** No cookie means no identity. IP + user-agent is an *estimate* and
  anything built on it must be labelled an estimate rather than reported as a count.

The first two are recoverable with a beacon. We are choosing not to, and this paragraph
exists so that choice is visible to whoever wants them later.

## Consequences

**Easy.** Zero bytes on every route. No consent banner, no vendor, no new dependency, no
recurring cost, nothing to keep out of the critical path. CDN caching is a non-issue because
the logging happens at the CDN. The perf budget stays honest, because there is nothing for
it to fail to see.

**Hard.** There is no dashboard on day one. Reading Cloud Logging is a query, not a page —
`make analytics` printing the week's top concepts, referrer edges, and bot share is the
obvious follow-up, and it is a separate issue, not this ADR. Until it exists, "analytics on"
means the data is being retained and can be queried, which is less satisfying than a chart.

**Hard.** Retention is 30 days by default. Anything longer means a sink into BigQuery, which
is a second decision with its own cost, and it should be made when there is a reason rather
than pre-emptively. Thirty days of history from a standing start is not a real constraint.

**Accepted.** No unique-visitor number, ever, unless this is superseded. Requests and
approximate sessions, both labelled as what they are.

**Cost.** Within Cloud Logging's free allowance (50 GiB per project per month); this site
will not approach it, and the storage charge only applies to retention beyond the default 30
days, which we are not requesting. To be recorded alongside the existing cost notes in
[`/infra/README.md`](../../infra/README.md) as *zero recurring, with the free-tier ceiling
named* — the ceiling matters more than the price, because the failure mode is a bot storm
raising ingestion rather than a monthly bill creeping up. That is the same shape as the
`--max-instances` argument already in that file: what bounds the bill is a limit, not a
price.

**A console step.** Linking Cloud Logging is click-through, like the two steps `setup.sh`
already stops at. It follows the same rule from CLAUDE.md §4: *anything needing a browser
stops and says what to click. Do not fake it.*

### #64's acceptance criteria, re-read

| Criterion | Under this decision |
|---|---|
| ADR recording the choice, the cost, and what was rejected | This document |
| States what is measured and what deliberately is not | Both sections above |
| Script loaded without blocking render, inside the perf budget | **Void — there is no script.** And the budget could not have checked it |
| No cookies, no personal data, no consent banner — verified not assumed | Nothing is set client-side. `remoteIp` is logged server-side and stays inside the project's retention |
| Recurring cost added to the budget note | Still required, now recording zero and the free-tier ceiling |
| Works with the CDN cache; a cached page still reports | Satisfied by construction — the log is written at the CDN |

Five of six survive. The one that dies is the one that assumed the answer.

---

*Written before the code, per CLAUDE.md §8. `proposed` until the console link is made and
the first query runs; nothing in `/web` changes under this decision, which is the point.*
