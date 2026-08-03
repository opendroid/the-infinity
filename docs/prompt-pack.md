# theinfinity.ai — Claude Code Prompt Pack

Sequenced prompts for the desktop app. One session per prompt unless noted. Paste as-is; edit bracketed bits. Prompts assume the build plan (`theinfinity-build-plan.md`) and mockups are available to reference — Prompt 0 puts both in the repo so later sessions can read them.

---

## Prompt 0 — Bootstrap the repo (Phase 0, session 1)

```
You are bootstrapping a new project. Work step by step and show me each file before committing.

Create a GitHub monorepo called "theinfinity" using the gh CLI (confirm I'm authenticated first; if not, walk me through gh auth login).

Directory skeleton:
  /web        # Astro + TypeScript frontend (scaffold later, just README stub now)
  /api        # Go service for Cloud Run (stub)
  /content/nodes/       # concept node JSON files
  /content/schema/      # JSON schemas
  /docs/design/         # design source of truth
  /docs/adr/            # architecture decision records
  /.github/workflows/   # CI

Copy the three files I've placed in this folder into the repo:
  theinfinity-build-plan.md    -> /docs/PLAN.md
  theinfinity-mockups.html     -> /docs/design/mockups.html
  theinfinity-design-prompt.md -> /docs/design/design-prompt.md

Then write the root CLAUDE.md. It must capture:
- Product: infinitely explorable AI/ML concept graph; static-first; portfolio quality bar
- Stack: Astro+TS+React islands+Tailwind in /web; Go (chi, net/http) in /api for Cloud Run; Firestore; Firebase Hosting with /api/** rewrite to Cloud Run
- Content-as-code: nodes are JSON in /content/nodes, schema-validated; merged-to-main = "verified" tier; never call paid LLM APIs from code
- Standards: golangci-lint + table-driven tests + wrapped errors + context propagation (Go); strict TS + ESLint (web); conventional commits; every change via PR with CI green
- Design tokens from /docs/design/mockups.html (list the hex palette and the three fonts)
- Commands section (fill in as tooling lands)

Finish: git init, first commit ("chore: bootstrap monorepo"), push, enable branch protection on main (PRs required, CI required once CI exists).
```

## Prompt 1 — GCP + Firebase foundations (Phase 0, session 2)

```
Read CLAUDE.md and /docs/PLAN.md first.

Guide me through GCP + Firebase setup for this project. Use gcloud and firebase CLIs where possible; when a step needs the web console (creating billing account links, Blaze upgrade), pause and tell me exactly what to click, then wait for my confirmation.

1. gcloud: create project theinfinity-prod, link billing, set budget alerts at $10 and $25
2. Enable APIs: Cloud Run, Firestore (Native mode, us-west1), Artifact Registry, Secret Manager
3. Create least-privilege service account for the API (Firestore read/write only)
4. Firebase: add Firebase to the project, upgrade to Blaze, firebase init hosting inside /web with the /api/** rewrite to a Cloud Run service named "api" (region us-west1)
5. Do NOT touch DNS — we cut over at launch
6. Record every resource name/region in /docs/adr/0001-infrastructure.md and update CLAUDE.md's commands section

Commit as "chore: gcp and firebase foundations".
```

## Prompt 2 — Design iteration (Phase 1; repeatable session)

```
Read CLAUDE.md and open /docs/design/mockups.html — it is the design source of truth (palette, fonts, the thread motif, trust-tier color semantics).

Scaffold Astro + TypeScript + Tailwind + React islands in /web. Generate the Tailwind theme from the mockup tokens (void/nebula/starlight/dust/thread/verified/frontier; Unbounded, Schibsted Grotesk, JetBrains Mono).

Build three page templates using 5 hand-written fake nodes in /content/nodes/ (write them yourself, any AI concepts, matching the shape you'd expect the schema to take):
1. / (universe): lemniscate hero, search, entry chips, frontier pulse line
2. /c/[id] (concept): domain eyebrow + tier badge, H1, intuition copy, depth toggle island, one viz placeholder, typed edges panel, mini-map SVG, trail ribbon
3. /t/[slug] (trail): thread SVG, numbered stops with tier dots, share row

Run the dev server and give me the URL. We iterate visually — I'll give feedback per screen; make surgical changes only. When I say "converged", extract final tokens to /docs/design/tokens.md, then PR "feat(web): design templates".
```

## Prompt 3 — Contracts: node schema + OpenAPI (Phase 2)

```
Read CLAUDE.md, /docs/PLAN.md, and the fake nodes in /content/nodes/.

1. Write /content/schema/node.schema.json (JSON Schema draft 2020-12):
   id, title, domain[], tier(verified|frontier), bodies{intuition,engineer,math},
   edges{requires[],unlocks[],adjacent[]}, viz{primitive,config}, citations[], updated.
   Make the 5 fake nodes validate; fix them if needed.
2. Write /docs/openapi.yaml for v1:
   GET /v1/concepts/{id}, GET /v1/concepts/{id}/neighborhood, GET /v1/search,
   POST+GET /v1/trails, POST /v1/requests, GET /-/health.
   Structured error object, versioned paths, examples for every operation.
3. Add a schema-validation script (node, no deps beyond ajv) wired into package.json.
4. ADRs 0002 (content-as-code + trust tiers) and 0003 (static-first serving).

PR: "feat: node schema and openapi v1". Walk me through both contracts before opening it.
```

> **Superseded by what it produced.** Kept as the record of what was asked; do not paste it
> again. ADR-0002 moved `tier` and `edges.unlocks` out of the authored file — both are
> derived at publish, and the schema now *rejects* them — and `viz` is
> `{primitive, params, param_controls, caption}`, not `{primitive, config}`.
> [`content/schema/node.schema.json`](../content/schema/node.schema.json) is the authority.

## Prompt 4 — Go service scaffold (Phase 3)

```
Read CLAUDE.md and /docs/openapi.yaml. Plan first, show me the layout, wait for my OK.

Scaffold /api in Go 1.24+:
- cmd/server/main.go; internal/{concepts,trails,requests,store}
- chi router implementing openapi.yaml exactly; handlers return structured errors
- store: Firestore client behind an interface so handlers unit-test against a fake
- Table-driven tests for every handler (no Firestore emulator yet — fake store)
- Dockerfile: multi-stage, distroless, nonroot
- Makefile: run, test, lint (golangci-lint), docker-build
- golangci-lint config matching CLAUDE.md standards

PR "feat(api): service scaffold" once make test and make lint pass.
```

## Prompt 5 — CI/CD + standards enforcement (Phase 4)

```
Read CLAUDE.md. Create GitHub Actions:

1. ci.yml on every PR: web (install, lint, typecheck, build), api (lint, test, build),
   content (schema-validate all nodes). All three must pass.
2. deploy.yml on merge to main: sync /content/nodes -> Firestore (write a small Go tool
   at /api/cmd/publish for this), build Astro -> firebase deploy, build+push api image ->
   gcloud run deploy. Use workload identity federation, not JSON keys — walk me through
   the one-time GCP setup.
3. PR template with a checklist mirroring our standards; commitlint for conventional commits.

Update CLAUDE.md commands. PR "chore: ci-cd pipeline". First deploy is the walking
skeleton — confirm one concept page serves end-to-end on the Firebase URL (M1).
```

## Prompt 6 — Backlog generation (Phase 5)

```
Read /docs/PLAN.md phases 6-7 and the current repo state. Propose ~35 GitHub issues
covering everything remaining to M3: web templates hardening, 5 viz primitives (token-stream,
vector-space, loss-curve, attention-heatmap, distribution-slider), trails end-to-end,
mini-map from /neighborhood, search, publish tool hardening, seed content batches,
SEO/sitemap/OG, analytics, launch checklist.

Format each: title, 2-4 sentence body with acceptance criteria, label (web/api/content/infra),
milestone (M1/M2/M3), estimate (S/M/L). Show me the full list as a table FIRST; after I
approve/edit, create them with gh issue create and set up the milestones.
```

> **Superseded by what it produced** — the backlog exists; do not paste it again. Its
> primitive list (`token-stream`, `vector-space`, `distribution-slider`) was a guess made
> before the design handoff, and the handoff's names won. The v1 set is four, not five:
> `router-dispatch`, `update-spectrum`, `attention-heatmap`, `loss-curve`, documented in
> [`content/schema/README.md`](../content/schema/README.md).

## Prompt 7 — The issue loop (Phase 6; reusable — this is your daily driver)

```
Pick up issue #[N]. Read CLAUDE.md, the issue, and acceptance criteria.

1. PLAN: restate the task, list files you'll touch, flag any design decisions. Wait for my OK.
2. Branch [label]/[short-name]. Implement smallest-change-that-satisfies-criteria.
3. Unit tests for new logic. Run the full local test + lint suite.
4. Spawn a code-review subagent: it sees only the diff and CLAUDE.md standards, and must
   report issues by severity (blocker/should-fix/nit). Fix blockers and should-fixes.
5. Open PR linked to the issue with a summary of what the reviewer flagged and what you fixed.

Stop after opening the PR — I review and merge. Do not merge yourself.
```

## Prompt 8 — Seed content workflow (Phase 6, weeks 8+; repeatable)

```
Read /content/schema/node.schema.json and 3 existing verified nodes as style references.

Write (or reuse) /workflows/generate-nodes: a workflow script that, given a list of concept
ids I provide, generates one JSON node per concept — all three depth bodies, typed edges
that reference existing or planned node ids only, a viz primitive + params (the primitive
MUST be one of the four in the schema's closed enum — read content/schema/README.md for
what each one shows and which params it reads), real
citations (arxiv/source links). Validate every node against the schema; reject and retry
invalid ones inside the loop. Report to me only: count generated, validation failures,
edge references to nodes that don't exist yet.

This batch: [paste 50-75 concept ids].
Branch content/seed-batch-[N], PR "content: seed batch [N]". I review the PR — my merge
is what promotes these nodes to verified.
```

## Prompt 9 — Launch session (Phase 7)

```
Read /docs/PLAN.md phase 7. Execute the launch checklist: sitemap.xml + robots.txt from
the node list; OG card images for concept and trail pages; [Plausible/GA4] analytics;
404 and empty states per the design system; Lighthouse pass on the three templates
(performance and SEO >= 95, fix what's below).

Then walk me through DNS cutover at GoDaddy step by step: add custom domain in Firebase
console, TXT verification record, A records, wait for cert. Verify https://theinfinity.ai
serves with valid TLS and www redirects. Final PR "chore: launch".
```

---

**Session hygiene:** one prompt = one session; start each with "Read CLAUDE.md" (habit even though it's auto-loaded — it anchors attention); `/compact` if a session runs long; `/context` when in doubt. For parallel independent issues: `git worktree add ../theinfinity-api-wt` and a second desktop session — not parallel builder subagents.
