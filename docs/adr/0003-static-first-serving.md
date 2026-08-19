# 0003 — Static-first serving

- **Status:** proposed
- **Date:** 2026-08-01

## Context

`CLAUDE.md` states the serving principle: concept pages are pre-rendered at build time and
served from the Firebase CDN; after hydration, islands call the Go API. *The API is
canonical; the static pages are a build-time cache.*

`/docs/design/handoff-v1/API.md` sharpens it into a hard rule: *"the concept page's first
paint must be complete without any of these calls."* The design then names exactly one
element that waits on the network — the mini-map — and gives it a designed loading
skeleton.

What neither document settles is **where the work happens** for everything in between.
The handoff quietly adds requirements that have to land somewhere:

- `GET /v1/concepts/{id}/neighborhood` returns `x`/`y` coordinates, *"server-computed in a
  `240 × 132` viewBox — no client-side layout, so the map never jitters."* The plan
  described this endpoint as "1-hop edges for mini-map." Graph layout is now in scope.
- The landing lemniscate's node coordinates come from *"a static layout file committed to
  the repo — do not run a force simulation at load."* No such file exists.
- The search overlay types ahead against `GET /v1/search`, but the API-unreachable state
  requires it to fall back to *"a plain form post to `/search`"* — a page that is not one
  of the five specified routes, and which cannot render results from a static host if the
  API is the only index.
- `GET /v1/stats` feeds the landing pulse line and *"ships with build-time values as a
  fallback so the line never renders empty."*

Underneath all four is one question: for a graph of ~300 nodes, which reads justify a
Cloud Run invocation at all? The service scales to zero, so every endpoint that a page
actually needs on load is a cold start in the critical path and a recurring cost.

## Decision

### 1. Everything derivable is computed at publish, not per request

The publish step (ADR-0002) already rewrites every concept document. It also computes and
stores, per concept: denormalized edge rows, mini-map coordinates, and the concept's entry
in the search index. `GET /v1/concepts/{id}/neighborhood` becomes a single document read
with no computation behind it.

Mini-map layout does not need a force simulation. With at most a handful of one-hop
neighbours in a `240 × 132` box, placement is deterministic by edge type — requires to the
left, unlocks to the right, adjacent vertical — which is how the mockup already draws it,
and is roughly thirty lines. Deterministic layout also means the map is byte-identical
across deploys unless the graph actually changed.

### 2. The mini-map stays a network call — deliberately

It is the only element that waits, and keeping it that way is what makes "the API is
canonical, the static page is a cache" true rather than decorative. A concept page built
last week and cached at the CDN shows last week's tier colors. Its mini-map, fetched live,
shows today's. That one call is the freshness escape hatch for the entire static surface,
and it is why the design gives it a loading skeleton instead of inlining the data.

### 3. Search ships as a static index for v1; `GET /v1/search` is deferred

At ~300 nodes the search index — id, title, domain, tier — is roughly 30 KB gzipped.
Shipping it as a versioned static asset and matching client-side is faster than a network
round-trip, costs nothing per query, and **works while the API is down**, which is exactly
the state the handoff writes a fallback for. The overlay's design, keyboard model, and
match-count footer are unchanged; only the data source moves.

This also resolves the `/search` page: it is a no-JS form target that renders against the
same static index, so the fallback is real rather than aspirational.

Revisit when the graph passes roughly 5–10k nodes, where index size stops being free.
Until then `GET /v1/search` is not built.

Staleness is bounded by deploy frequency: the index rebuilds on every content merge, so it
is never more stale than the pages it sits behind.

### 4. Static layout and stats are committed content

The lemniscate layout lives at `/content/layout/lemniscate.json` — featured node ids plus
hand-tuned coordinates — and CI validates that every id resolves to a real node. This lets
the featured set change without touching component code.

`GET /v1/stats` is built, but the landing page ships with build-time values inlined. The
endpoint refreshes the number after hydration; it never gates the render.

### 5. What the API is actually for

After the above, the v1 surface that a page depends on at runtime is small:

| Endpoint | Used by | On failure |
|---|---|---|
| `GET /v1/concepts/{id}/neighborhood` | Mini-map, after hydration | Mini-map hides; page unaffected |
| `GET /v1/concepts/{id}` | Client-side navigation between concept pages | Fall back to a full page load |
| `GET /v1/stats` | Landing pulse line refresh | Build-time values stand |
| `POST /v1/trails`, `GET /v1/trails/{slug}` | Share and view trails | Share queues in localStorage |
| `POST /v1/requests`, `POST /v1/reviews` | 404 form, provenance actions | Queue and retry |
| `GET /-/health` | Cloud Run | — |

Every read path degrades to something that still works. No page has a hard dependency on
a warm instance.

## Consequences

**Easier.** First paint never waits on Cloud Run, so a cold start is invisible to a
first-time visitor arriving from search — which the handoff estimates is ~95% of traffic.
Search costs nothing per query and survives the API being down entirely. The neighborhood
endpoint is a document read, so it cannot be slow for graph-shaped reasons.

**Harder.** The publish step accumulates responsibility: it now owns layout, index
generation, and denormalization, and a bug in any of them ships to every page at once. It
needs real tests. Static search also means the index is a build artifact that can silently
go stale if a deploy half-fails — worth a post-deploy assertion that the index node count
matches the published node count.

**Accepted costs.** Deferring `GET /v1/search` means the search overlay behaves
differently from the handoff's description, even though it looks identical; anyone reading
`API.md` will expect an endpoint that is not there, so the deferral is recorded in the
design README as well as here. Shipping a 30 KB index to every visitor is a real cost paid
by people who never search — acceptable against a page that already loads three font
families, and revisited if the index grows.

**Deliberately not decided here.** `/changelog` is referenced twice in the handoff's data
model and specified nowhere; it is **out of scope for v1** until it has a route spec. Node
authoring, tier derivation, and the review queue are ADR-0002.

---

## Measured since — 2026-08-18, at 482 nodes

This decision rests on a size estimate made before any content existed. The corpus is now
60% past the "~300 nodes" the estimate was written for, so the number was re-measured
rather than assumed (#321).

| | predicted | measured |
|---|---|---|
| corpus | ~300 nodes | **482** |
| search index, gzipped | ~30 KB | **9.4 KB** (51 KB raw) |
| per node, gzipped | ~100 B implied | **19.5 B** |

**The estimate was pessimistic by roughly 5x per node.** Projecting forward at the measured
rate: ~20 KB at 1,000 nodes, ~98 KB at 5,000. The revisit trigger above — "roughly 5–10k
nodes, where index size stops being free" — is therefore well placed and nothing about the
decision needs revisiting yet. **The trigger is a rate, not a count**: re-measure if bytes
per node moves, since that is what would invalidate the projection.

One recorded cost turned out never to be paid. *"Shipping a 30 KB index to every visitor is
a real cost paid by people who never search"* describes an eager load, and `SearchPanel.tsx`
fetches the index **when search opens, never on page load** — its own comment says so, and
`fallbacks.test.ts` asserts the fetch exists. A visitor who never opens search never pays
anything. The accepted cost was real when written and the implementation improved on it.

One thing this section asked for did not exist and now does: *"worth a post-deploy
assertion that the index node count matches the published node count."* Built in #322 —
`deploy.yml` fetches the deployed index and compares its length against the published node
count, cache-busting so it cannot pass against a stale edge copy. The failure it catches is
silent: a stale index is valid JSON, renders a populated panel, and answers "no results"
for a new concept — the same answer as one that does not exist.

The decision stands. Only the numbers under it have moved, and they moved in its favour.
