# theinfinity.ai — Build Plan

**Product:** an infinitely explorable concept graph for AI/ML. Every concept is a page with a 30-second intuition, a depth toggle (Intuition / Engineer / Math), an interactive viz primitive, and typed edges (Requires / Unlocks / Adjacent). Trails record and share your path through the graph.

**Goal:** learning + portfolio piece. Cost discipline and craft matter more than revenue.

---

## 1. Locked decisions

| Area | Decision |
|---|---|
| Repo | Monorepo `theinfinity` on GitHub: `/web`, `/api`, `/content`, `/docs`, `/.github` |
| Frontend | Astro + TypeScript, React islands (viz primitives, depth toggle, trail, mini-map), Tailwind |
| Backend | Go on Cloud Run, scale-to-zero, `net/http` + chi, distroless container |
| Data | Firestore (Native): `concepts`, `trails`, `concept_requests` |
| Hosting | Firebase Hosting (Blaze) — CDN + TLS free; `/api/**` rewrite → Cloud Run (no GCLB) |
| Domain | Stays registered at GoDaddy; DNS A records → Firebase at launch (M3) |
| Content | **Content-as-code:** node JSON files in `/content/nodes/`, generated via Claude Code workflow on the Max subscription (no paid LLM API). PR review = "verified" tier |
| Serving | **Static-first:** concept pages pre-rendered at build → Firebase CDN for first load + SEO. After hydration, islands call the Go API for navigation, mini-map, search, trails. API is canonical; static pages are a build-time cache |
| Publish | CI on merge to `main`: validate schema → sync nodes to Firestore → build Astro → deploy Hosting; build/deploy Go image → Cloud Run |
| Trust tiers | `verified` (merged to main, human-reviewed) · `frontier` (auto-generated, cited, pending review) |

## 2. Design system (from mockups, `/docs/design/`)

- **Palette:** void `#0B0E1A` · nebula `#151A2E` / `#1C2240` · starlight `#E9EBF8` · dust `#8B91B3` · thread (interactive) `#8F7BFF` · verified `#E5B54A` · frontier `#5FD4C4`
- **Type:** Unbounded (display, sparingly) · Schibsted Grotesk (body) · JetBrains Mono (labels, data, edges)
- **Signature:** the thread — one continuous line through landing lemniscate, trail ribbon, shared-trail page
- **Rule:** node color always encodes trust tier; color is semantic, never decorative

## 3. API surface (v1, OpenAPI-first)

```
GET  /v1/concepts/{id}
GET  /v1/concepts/{id}/neighborhood     # 1-hop edges for mini-map
GET  /v1/search?q=
POST /v1/trails        GET /v1/trails/{slug}
POST /v1/requests                        # missing-concept queue
GET  /-/health
```

Node schema (`/content/schema/node.schema.json`): `id`, `title`, `domain[]`, `tier`, `bodies{intuition,engineer,math}`, `edges{requires[],unlocks[],adjacent[]}`, `viz{primitive,config}`, `citations[]`, `updated`.

## 4. Phases

### Phase 0 — Foundations (~3 hrs · week 1)
- [x] `gh` CLI auth; create monorepo with directory skeleton + root `CLAUDE.md`
- [x] GCP project; billing alerts at $10 and $25; enable Cloud Run, Firestore, Artifact Registry, Secret Manager
- [x] Firebase project on same GCP project; Blaze; `firebase init hosting`
- [x] Commit mockups to `/docs/design/mockups.html`

### Phase 1 — Web design iteration (~5–6 hrs · weeks 1–2)
- [x] Astro scaffold in `/web`; Tailwind config generated from design tokens
- [x] Three templates with 5 hand-written fake nodes: universe (landing), concept page, trail
- [x] Iterate in browser until layout converges; extract tokens to `/docs/design/tokens.md`

### Phase 2 — API design (~2–3 hrs · weeks 2–3)
- [x] `node.schema.json` written and CI-validated
- [x] `/docs/openapi.yaml` for the v1 surface above
- [x] ADRs: monorepo, content-as-code, static-first, Astro, Firestore

### Phase 3 — Service design (~2–3 hrs · week 3)
- [x] Go layout: `cmd/server`, `internal/{concepts,trails,requests,store}`
- [x] Firestore data model doc; least-privilege service account
- [x] Dockerfile (distroless); Cloud Run config (scale-to-zero)

### Phase 4 — Standards + CI (~2 hrs · weeks 3–4)
- [x] Go: golangci-lint, table-driven tests, wrapped errors, context propagation
- [x] TS: strict mode, ESLint (no formatter — see CLAUDE.md §4)
- [x] GitHub Actions on PR: lint, test, schema-validate, build both surfaces
- [x] Conventional commits, PR template, branch protection on `main`
- [x] All summarized in `CLAUDE.md`

### Phase 5 — Backlog (~1–2 hrs · week 4)
- [x] Generate ~35 issues via `gh` with labels (`web`, `api`, `content`, `infra`) and milestones M1/M2/M3; review once

### Phase 6 — Issue loop (~28–38 hrs · weeks 4–11)
Per issue: `branch → plan → implement → unit tests → review subagent on diff → PR → CI green → merge`.
- Serial by default; for independent issues, git worktrees + two desktop sessions
- Review subagent: fresh context, sees diff + standards only
- Seed content (~300 nodes) runs here as a workflow: 50–75 nodes/run → schema-validate → PR → your review = verification (~4–6 hrs supervised, weeks 8–11)

### Phase 7 — Launch (~3–4 hrs · weeks 11–13)
- [x] Sitemap, OG cards for trails, analytics (Plausible or GA4), 404/empty states
- [x] DNS cutover at GoDaddy (TXT verify → A records → cert auto-provisions)
- [ ] Ship to HN / X

## 5. Milestones

- **M1 · ~week 5 — walking skeleton live:** one concept page served end-to-end (repo JSON → Firestore → API → pre-rendered page on Firebase URL). CI/CD green.
- **M2 · ~week 10 — core product:** 3 templates, 2+ viz primitives, trails, mini-map, search, ~50 verified nodes.
- **M3 · ~week 12–13 — launch:** ~300 verified nodes, domain live, analytics on, posted publicly.

## 6. Token discipline (Max 20x, no paid API)

- Generation and coding both run on the subscription; the shared bucket covers Claude Code + chat — schedule seed-generation runs in lighter chat weeks
- Seed generation as a **workflow script** (loop lives in code; context sees only summaries)
- Fresh session per subsystem; `/compact` on long sessions; `/context` to inspect
- Subagents only as reviewer/test-runner roles, never parallel builders on one issue

## 7. Budget

- Recurring: ~$0–1/mo idle; ~$5–20/mo at 1K DAU; GoDaddy .ai renewal
- Billing alerts $10/$25 from day one

**Total effort: ~55–65 hrs ≈ 11–13 weeks at 1 hr/day (5–6 weeks at 2 hrs/day).**

---

## 8. What actually happened

Written at 54 of 57 nodes verified, with the site live on the real domain. The plan above
is left as it was predicted; this is the reconciliation, because the gap between the two is
the interesting part.

### The phases held; the estimates did not

Phases 0–5 and 7 are done. Phase 6 is the one still running, and it absorbed far more than
its share — not through the issue loop being slow, but because each issue kept turning up a
second issue underneath it. The backlog grew while being worked.

### Design iteration never happened, and did not need to

Phase 1 budgeted 5–6 hours of in-browser convergence. It cost close to zero: the design
handoff in [`/docs/design/handoff-v1/`](design/handoff-v1) arrived specifying all five
routes at implementation fidelity, so Phase 1 became *build to spec* rather than *discover
the spec* (#3). `mockups.html` is superseded and the plan's §2 above still points at it.

### The data model moved in three ways

| Planned | Shipped | Why |
|---|---|---|
| `concepts`, `trails`, `concept_requests` | plus `concept_reviews`, `counters` | [ADR-0004](adr/0004-runtime-collections.md) — two collections existed in production that no document mentioned |
| `tier` stored on the node | **derived** from the `review` block | [ADR-0002](adr/0002-content-as-code-and-trust-tiers.md) — makes "claims verified without a review" unrepresentable rather than merely detectable |
| `edges{requires,unlocks,adjacent}` all authored | `requires` and `adjacent` authored, `unlocks` inverted at publish | the same fact in two files is free to contradict itself |

`updated` became `updated_at`, and `citations[]` moved to the top level so verifying a node
no longer deletes its sources.

### The API surface moved too

It serves under **`/api/v1`, not `/v1`** — Firebase Hosting preserves the full path through
a rewrite, so `/v1` would have worked against the Cloud Run URL and 404'd through the
domain ([ADR-0001](adr/0001-infrastructure.md)). `GET /v1/search` was **not built**: a
~30 KB static index shipped instead, which is what makes the API-offline state a real
fallback rather than an aspiration. `POST /v1/reviews` and `GET /v1/stats` were added.
`/-/health` is at `/-/health` and not `/healthz` because Google Frontend answers `/healthz`
itself and never forwards it (#75).

### Analytics went the other way entirely

Phase 7 said "Plausible or GA4". [ADR-0011](adr/0011-analytics-from-request-logs.md) chose
**neither**, and reads analytics from request logs the project already has. The
disqualifying number was the landing page's zero-JavaScript budget, and the sharper finding
was that the perf budget could not have caught any of the three options — it counts modules
under `/_astro/`, so a third-party script tag is invisible to it. Verified by putting one
there and watching CI stay green.

### Milestones

- **M1 — met.** Walking skeleton live end to end, CI/CD green.
- **M2 — met.** Three templates, **five** viz primitives against the "2+" asked for,
  trails, mini-map, search, and 54 verified nodes against "~50".
- **M3 — partial.** Domain live and analytics decided; the corpus is 57 nodes against
  "~300", which is the one substantial thing outstanding (#61).

### What the plan did not anticipate at all

**Verification is the expensive half of content, not generation.** The plan treated review
as a step at the end of a batch. Five verification passes over 57 nodes found one recurring
defect ten times — a citation that resolves and sources nothing on its page — plus five
unsourced empirical claims, an arithmetic contradiction between two nodes, and a caveat
that applied to nothing in the graph. The prose and the mathematics were nearly always
right. Nothing but reading caught any of it.

**Tests passing is not the same as the feature working.** Three separate defects shipped
green this way, each caught by looking at the deployed system: a trace field in the wrong
encoding, a correlation feature that emitted nothing on a healthy service, and a perf
budget reporting an empty page with a third-party script in its head. That pattern is why
[`LAUNCH.md`](LAUNCH.md) exists and why it ends with a section on reading the site cold.
