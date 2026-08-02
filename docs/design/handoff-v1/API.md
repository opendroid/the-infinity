# API contract — v1

Base: `/v1`. JSON, UTF-8. All ids are stable kebab-case slugs
(`mixture-of-experts`), which are also the URL segments.

**Rule that shapes the whole design:** the concept page's first paint must be
complete without any of these calls. Concept records are read at build/request
time on the server. Only the mini-map and the search overlay call the API from
the client, and both degrade to nothing visible breaking.

---

## GET /v1/concepts/{id}
Full concept record. Used server-side for pre-render, and client-side when
navigating between concept pages after hydration.

```json
{
  "id": "mixture-of-experts",
  "title": "Mixture-of-Experts",
  "domain": "Architecture / Sparsity",
  "tier": "verified",
  "bodies": {
    "intuition": "Instead of pushing every token through every parameter…",
    "engineer": "A learned router scores every token against N expert FFNs…",
    "math": "…"
  },
  "emphasis": {
    "intuition": "you pay for the experts you wake up, not the ones you own",
    "engineer": "The cost moves from compute to memory and to balance"
  },
  "viz": {
    "primitive": "router-dispatch",
    "params": { "experts": 8, "top_k": 2, "capacity_factor": 1.25 },
    "param_controls": [
      { "name": "top_k", "min": 1, "max": 4, "step": 1 }
    ],
    "caption": "Solid = first choice, faint = second…",
    "caption_engineer": "Same primitive, engineer depth: per-expert utilisation over a batch…"
  },
  "edges": {
    "requires":  [{ "id": "feed-forward-network", "title": "Feed-Forward Network", "tier": "verified", "reviewed": true }],
    "unlocks":   [{ "id": "expert-parallelism", "title": "Expert Parallelism", "tier": "frontier", "reviewed": false }],
    "adjacent":  [{ "id": "conditional-computation", "title": "Conditional Computation", "tier": "verified", "reviewed": true }]
  },
  "provenance": null,
  "review": { "reviewed_by": "…", "reviewed_at": "2026-05-02" },
  "updated_at": "2026-07-12"
}
```

For a frontier node, `review` is `null` and `provenance` is populated:

```json
"provenance": {
  "drafted_at": "2026-07-24",
  "sources": [
    { "ref": "arXiv:2502.16982", "title": "Muon is scalable for LLM training" },
    { "ref": "Jordan et al., 2024", "title": "Original Muon writeup" }
  ]
}
```

`tier` drives the badge, every dot fill, the pulse, and whether the provenance
block renders. It is one field; nothing else in the UI decides tier.

**404** returns `{ "error": "not_found", "id": "liquid-neural-nets",
"nearest": [{ "id": "neural-odes", "title": "Neural ODEs", "tier": "verified" }] }`
— the `nearest` array is what the 404 page's "Nearest nodes" list renders.

## GET /v1/concepts/{id}/neighborhood
The only call the concept page makes after hydration. One hop.

```json
{
  "center": { "id": "mixture-of-experts", "tier": "verified" },
  "nodes": [
    { "id": "feed-forward-network", "title": "Feed-Forward Network", "tier": "verified", "x": 44, "y": 32 },
    { "id": "expert-parallelism", "title": "Expert Parallelism", "tier": "frontier", "x": 204, "y": 68 }
  ],
  "links": [
    { "from": "feed-forward-network", "to": "mixture-of-experts", "type": "requires", "reviewed": true },
    { "from": "mixture-of-experts", "to": "expert-parallelism", "type": "unlocks", "reviewed": false }
  ]
}
```

Coordinates are **server-computed** in a `240 × 132` viewBox — no client-side
layout, so the map never jitters. `reviewed: false` links draw dashed.
On failure the mini-map hides; the page is otherwise untouched.

## GET /v1/search?q=exp&limit=8
```json
{
  "total": 23,
  "results": [
    { "id": "expert-parallelism", "title": "Expert Parallelism", "domain": "Systems / Distributed", "tier": "frontier" }
  ]
}
```
Prefix + fuzzy on title, then domain. `total` feeds "4 of 23 matches".
Debounce ~120ms. On failure the overlay falls back to a plain form post to
`/search`.

## GET /v1/stats
`{ "concepts": 1847, "grew_this_week": 12 }` — the landing pulse line. Ships
with build-time values as a fallback so the line never renders empty.

## POST /v1/trails
Body: `{ "stops": [{ "id": "…", "depth_read_at": "engineer" }], "duration_s": 1860 }`
→ `201 { "slug": "dense-to-sparse-9k2f", "url": "/t/dense-to-sparse-9k2f" }`.
Idempotent on an identical stop sequence from the same client.
Offline: queue and retry; the button shows queued state rather than failing.

## GET /v1/trails/{slug}
```json
{
  "slug": "dense-to-sparse-9k2f",
  "title": "From dense layers to sparse experts",
  "created_at": "2026-07-29",
  "duration_min": 31,
  "stops": [
    { "n": 1, "id": "feed-forward-network", "title": "Feed-Forward Network", "tier": "verified", "depth_read_at": "intuition" }
  ]
}
```
`title` is generated from the first and last stop; the display H2 appends "—
one pull of the thread". Bead coordinates along the trail path are computed
client-side from `stops.length`.

## POST /v1/requests
Body `{ "name": "Liquid Neural Nets", "referrer": "/c/liquid-neural-nets" }`
→ `202`. The 404 request form. Rate-limit per client.

## POST /v1/reviews
Body `{ "concept_id": "muon-optimizer", "kind": "flag" | "volunteer",
"note": "…" }` → `202`. The two frontier provenance actions.
