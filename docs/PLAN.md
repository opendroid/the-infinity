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
GET  /healthz
```

Node schema (`/content/schema/node.schema.json`): `id`, `title`, `domain[]`, `tier`, `bodies{intuition,engineer,math}`, `edges{requires[],unlocks[],adjacent[]}`, `viz{primitive,config}`, `citations[]`, `updated`.

## 4. Phases

### Phase 0 — Foundations (~3 hrs · week 1)
- [ ] `gh` CLI auth; create monorepo with directory skeleton + root `CLAUDE.md`
- [ ] GCP project; billing alerts at $10 and $25; enable Cloud Run, Firestore, Artifact Registry, Secret Manager
- [ ] Firebase project on same GCP project; Blaze; `firebase init hosting`
- [ ] Commit mockups to `/docs/design/mockups.html`

### Phase 1 — Web design iteration (~5–6 hrs · weeks 1–2)
- [ ] Astro scaffold in `/web`; Tailwind config generated from design tokens
- [ ] Three templates with 5 hand-written fake nodes: universe (landing), concept page, trail
- [ ] Iterate in browser until layout converges; extract tokens to `/docs/design/tokens.md`

### Phase 2 — API design (~2–3 hrs · weeks 2–3)
- [ ] `node.schema.json` written and CI-validated
- [ ] `/docs/openapi.yaml` for the v1 surface above
- [ ] ADRs: monorepo, content-as-code, static-first, Astro, Firestore

### Phase 3 — Service design (~2–3 hrs · week 3)
- [ ] Go layout: `cmd/server`, `internal/{concepts,trails,requests,store}`
- [ ] Firestore data model doc; least-privilege service account
- [ ] Dockerfile (distroless); Cloud Run config (scale-to-zero)

### Phase 4 — Standards + CI (~2 hrs · weeks 3–4)
- [ ] Go: golangci-lint, table-driven tests, wrapped errors, context propagation
- [ ] TS: strict mode, ESLint (no formatter — see CLAUDE.md §4)
- [ ] GitHub Actions on PR: lint, test, schema-validate, build both surfaces
- [ ] Conventional commits, PR template, branch protection on `main`
- [ ] All summarized in `CLAUDE.md`

### Phase 5 — Backlog (~1–2 hrs · week 4)
- [ ] Generate ~35 issues via `gh` with labels (`web`, `api`, `content`, `infra`) and milestones M1/M2/M3; review once

### Phase 6 — Issue loop (~28–38 hrs · weeks 4–11)
Per issue: `branch → plan → implement → unit tests → review subagent on diff → PR → CI green → merge`.
- Serial by default; for independent issues, git worktrees + two desktop sessions
- Review subagent: fresh context, sees diff + standards only
- Seed content (~300 nodes) runs here as a workflow: 50–75 nodes/run → schema-validate → PR → your review = verification (~4–6 hrs supervised, weeks 8–11)

### Phase 7 — Launch (~3–4 hrs · weeks 11–13)
- [ ] Sitemap, OG cards for trails, analytics (Plausible or GA4), 404/empty states
- [ ] DNS cutover at GoDaddy (TXT verify → A records → cert auto-provisions)
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
