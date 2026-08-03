# CLAUDE.md — theinfinity.ai

Guidance for Claude Code (and humans) working in this monorepo. Read this first, every
session. Deeper context lives in [`/docs/PLAN.md`](docs/PLAN.md); the design source of
truth is [`/docs/design/handoff-v1/`](docs/design/handoff-v1/).

---

## 1. Product

**theinfinity.ai** is an *infinitely explorable concept graph for AI/ML.*

Every concept is a page with:

- a 30-second **intuition** you can read cold,
- a **depth toggle** — Intuition / Engineer / Math — over the same concept,
- an interactive **viz primitive** (token-stream, vector-space, loss-curve, …),
- **typed edges**: Requires ◂ / Unlocks ▸ / Adjacent ↔,
- a **trail**: the path you took through the graph, recordable and shareable.

Three principles, in priority order:

1. **Static-first.** Concept pages are pre-rendered at build time and served from the
   Firebase CDN — fast first paint, real SEO, near-zero idle cost. After hydration,
   islands call the Go API for navigation, mini-map, search, and trails. *The API is
   canonical; the static pages are a build-time cache.*
2. **Portfolio quality bar.** This is a learning project and a portfolio piece. Craft and
   cost discipline matter more than velocity or revenue. If a change would embarrass us in
   a code review with a stranger, it isn't done.
3. **The graph never dead-ends.** Every page offers a next pull of the thread.

---

## 2. Stack

| Surface | Choice |
|---|---|
| `/web` | Astro + TypeScript, React islands (viz primitives, depth toggle, trail, mini-map), Tailwind |
| `/api` | Go on Cloud Run — `net/http` + [chi](https://github.com/go-chi/chi), distroless container, scale-to-zero |
| Data | Firestore (Native mode): `concepts` (published from git) · `trails`, `concept_requests`, `concept_reviews`, `counters` (runtime — [ADR-0004](docs/adr/0004-runtime-collections.md)) |
| Hosting | Firebase Hosting (Blaze) — CDN + TLS. `/api/**` rewrite → Cloud Run service `api` (no GCLB) |
| Region | `us-west1` for Cloud Run and Firestore |
| Domain | `theinfinity.ai` — registered at GoDaddy, A records pointing at Firebase since the cutover ([#65](https://github.com/opendroid/the-infinity/issues/65)). `the-infinity-ai.web.app` still serves the same site and canonicals to it |

React is for **islands only** — interactive primitives. Everything static stays Astro.
Do not reach for a client-side router, a global store, or SSR; if you think you need one,
open an ADR first.

---

## 3. Content-as-code

Concept nodes are **JSON files in `/content/nodes/`**, one per concept, version-controlled
alongside the code. They are not authored in a CMS and not edited in the Firestore console.

- Every node validates against [`/content/schema/node.schema.json`](content/schema/) — CI
  fails the PR if it doesn't.
- **Trust tiers are semantic and encoded in color everywhere:**
  - `verified` — merged to `main` after human review. **A merge is the act of verification.**
  - `frontier` — generated, cited, and awaiting that review.
- On merge to `main`, CI syncs `/content/nodes/**` → Firestore. Firestore is downstream of
  git, always. To fix content, change the JSON and open a PR.
- **Never call a paid LLM API from application code, CI, or scripts.** Content generation
  runs through Claude Code on the Max subscription as an authoring-time workflow. There is
  no inference in the request path, no API key in the runtime, and no per-request model
  cost. This is a hard constraint, not a preference.

---

## 4. Standards

**Every change ships as a PR against `main` with CI green.** No direct pushes to `main`;
`main` is protected. Squash-merge; the PR title is the commit message.

"CI green" is enforced, not a convention: the `protect-main` ruleset requires `web`,
`api`, `contracts`, and `pr title` to pass before a merge. See
[`/.github/workflows/README.md`](.github/workflows/README.md).

### Commits — [Conventional Commits](https://www.conventionalcommits.org/)

```
feat(web): add depth toggle island
fix(api): propagate context deadline to Firestore reads
chore: bootstrap monorepo
```

Types: `feat` · `fix` · `chore` · `docs` · `refactor` · `test` · `ci` · `content`.
Scopes: `web` · `api` · `content` · `infra` · `docs`.

### Go (`/api`)

- **`golangci-lint` clean** — no `//nolint` without a comment explaining why.
- **Table-driven tests** for every handler and every exported function with branching.
  Name cases; assert on behavior, not on log output.
- **Wrapped errors**: `fmt.Errorf("fetching concept %s: %w", id, err)`. Sentinel errors via
  `errors.Is` / `errors.As`. Never discard an error with `_`; never `panic` in a handler.
- **Context propagation**: `ctx context.Context` is the first parameter of anything that
  does I/O, threaded from the request all the way to the Firestore call. No
  `context.Background()` below `main`.
- Handlers return **structured errors** matching `/docs/openapi.yaml` — never a bare string.
- Storage sits behind an interface so handlers unit-test against a fake, no emulator.

### TypeScript (`/web`)

- **`strict: true`**, plus `noUncheckedIndexedAccess`. No `any`; use `unknown` and narrow.
  `@ts-expect-error` needs a reason on the same line.
- **ESLint is the arbiter** — `npm run lint` runs at `--max-warnings 0`, so a warning is an
  error, and it is a required check. There is deliberately no formatter: match the file
  you are in rather than reformatting it.
- Ship the smallest island that does the job. Prefer CSS over JS, and static over island.
- Accessibility is not optional: semantic landmarks, real focus states
  (`outline: 2px solid var(--thread)`, offset 2 — teal only when the focused element is
  itself violet), `prefers-reduced-motion` respected on every animation, and color never
  the sole carrier of meaning — tier badges carry text too.

### Shell (`/infra`)

- Scripts run under **zsh or bash** — `zsh -n` and `bash -n` both clean. The usual
  offender is `read -rp`, which is bash-only; print the prompt and use a bare `read`.
- `set -euo pipefail` at the top. Check before you create, so a partial run resumes.
- Anything needing a browser stops and says what to click. Do not fake it.

### Content (`/content`)

- Node `id` is a kebab-case slug and is the URL: `speculative-decoding` → `/c/speculative-decoding`.
- Edges may only reference node ids that exist or are planned in the same PR.
- Citations are real, resolvable links (arXiv, papers, primary sources). No invented references.

---

## 5. Design tokens

The source of truth is [`/docs/design/handoff-v1/`](docs/design/handoff-v1/) — all five
routes at implementation fidelity, plus [`tokens.css`](docs/design/handoff-v1/tokens.css)
and [`tokens.json`](docs/design/handoff-v1/tokens.json). When Tailwind lands in `/web`,
its theme is **generated from `tokens.json`** — never re-typed by hand, never drifted.
The table below is the palette in full; the spacing, radius, and type scales live in
`tokens.json` and are not duplicated here.

`mockups.html` is the earlier exploration, superseded. Where the two disagree, the
handoff wins.

### Palette

| Token | Hex | Role |
|---|---|---|
| `void` | `#0B0E1A` | Page background — deep indigo, **never pure black** |
| `nebula` | `#151A2E` | Panel surface |
| `nebula-2` | `#1C2240` | Raised surface |
| `starlight` | `#E9EBF8` | Primary text |
| `dust` | `#8B91B3` | Secondary text |
| `thread` | `#8F7BFF` | Interactive, edges, the thread — signal violet |
| `verified` | `#E5B54A` | Trust tier: verified — gold |
| `frontier` | `#5FD4C4` | Trust tier: frontier / new growth — teal |
| `line` | `#262D4E` | Borders, dividers |

**Three rules govern every surface. Everything else follows from them:**

1. **Node color always encodes trust tier** — gold verified, teal frontier, on graphs,
   edge links, mini-maps, trail stops, badges, OG cards. No exceptions.
2. **`thread` violet is the only interactive color** — links, edges, buttons, focus
   rings, the thread itself. Gold and teal are never buttons, links, or emphasis; they
   carry meaning, not attention.
3. **Glow is rationed** — at most one glowing element per screen, reserved for the
   primary action or the thread. On the landing page that is the search field and
   nothing else.

The handoff's *Anti-patterns — reject on sight* list is what violating these looks like.
Read it before writing CSS.

### Type

| Family | Use |
|---|---|
| **Unbounded** (400/600/800) | Display — wordmark, page H1/H2. Sparingly. |
| **Schibsted Grotesk** (400/500/700) | Body copy, buttons, UI text |
| **JetBrains Mono** (400/600) | Labels, data, edge types, eyebrows, counts, URLs |

Mono is for anything machine-flavored — uppercase, `letter-spacing: .16em–.18em`, 10–12px.

### Signature

**The thread**: one continuous line running through the landing lemniscate, the trail
ribbon on the concept page, and the shared-trail page. It is the product's one visual
idea. Any new surface must answer: *where does the thread run here?*

Widths are per-route, not global — see the handoff. The concept page is a
`1fr 288px` grid collapsing to one column under 760px; body copy is capped at 62ch.

**Motion**: exactly one animation ships — a ~3.2s opacity pulse on frontier nodes and
frontier badge dots, staggered so they don't beat in unison, inside
`prefers-reduced-motion: no-preference`. Nothing else animates.

---

## 6. Layout

```
/web        Astro + TypeScript frontend
  firebase.json  Hosting config: /api/** → Cloud Run
/api        Go service for Cloud Run
  cmd/server     the API
  cmd/publish    git → Firestore, on merge to main
/infra      setup.sh — GCP + Firebase foundations
            cicd.sh  — the workload identity federation CI deploys through
/content
  /nodes    concept node JSON, one file per concept
  /schema   JSON Schema for nodes
  derived.golden.json   derived, not authored — the fixture /api and /web share
/docs
  PLAN.md         the build plan — phases, milestones, budget
  prompt-pack.md  sequenced Claude Code session prompts
  /design
    handoff-v1/     the design source of truth — 5 routes, tokens, components, API
    mockups.html    earlier three-screen exploration, superseded
  /adr      architecture decision records
/.github
  pull_request_template.md
  /workflows  ci.yml — every PR · deploy.yml — merge to main
```

---

## 7. Commands

*Filled in as tooling lands — each phase adds its row. Anything not listed here does not
exist yet.*

| Command | What it does |
|---|---|
| `./infra/setup.sh` | Create the GCP project, Firestore, Artifact Registry, runtime service account, and budget alerts. Re-runnable; stops at the two console steps. |
| `./infra/cicd.sh` | Create the workload identity federation CI deploys through, and print the two repository variables to set. Re-runnable. |
| `cd web && npm install` | Install web dependencies (first run only) |
| `cd web && npm run dev` | Astro dev server on `:4321`. Regenerates design tokens first. |
| `cd web && npm run build` | Static build to `web/dist` |
| `cd web && npm run typecheck` | `astro check` |
| `cd web && npm run lint` | ESLint, zero warnings tolerated |
| `cd web && npm test` | Vitest — graph derivation, node-shape invariants, schema rejection cases |
| `cd web && npm run perf` | Gzipped JavaScript per route against [`perf-budget.json`](web/perf-budget.json). Needs a build first; `-- --update` rewrites the budget |
| `cd web && npm run validate:content` | Nodes against `node.schema.json`, plus the cross-field invariants |
| `cd web && npm run check:citations` | Every citation resolves. `-- --offline` skips the network and says so — it exits 2 rather than passing when nothing could be reached |
| `cd web && npm run validate:openapi` | `redocly lint` on `/docs/openapi.yaml` — zero warnings tolerated |
| `cd api && make run` | Run the API locally on `:8080` (needs `GOOGLE_CLOUD_PROJECT`) |
| `cd api && make test` | Table-driven tests, with the race detector |
| `cd api && make test-emulator` | The same, plus the Firestore round-trip suite (starts an emulator) |
| `cd api && make lint` | `go vet`, `gofmt` check, `golangci-lint` |
| `cd api && make check` | Both — what CI runs |
| `cd api && make docker-build` | Multi-stage distroless nonroot image |
| `cd api && make publish` | Sync `/content/nodes` → Firestore (needs `GOOGLE_CLOUD_PROJECT`) |
| `cd api && make queues` | Print pending flags and concept requests, oldest first. Read-only |
| `cd api && make golden` | Regenerate `content/derived.golden.json` after a content change |
| `cd web && firebase deploy --only hosting` | Deploy the built site |

**The Tailwind theme is generated, not written.** `web/scripts/generate-tokens.mjs` reads
[`tokens.json`](docs/design/handoff-v1/tokens.json) and emits `src/styles/tokens.generated.css`,
which is gitignored so committed source cannot drift from the handoff. It runs from
`prebuild`, `dev`, and `typecheck`. No hex value belongs in hand-written source.

**Content loads from `/content` via `node:fs`, resolved from `process.cwd()`** — not from
`import.meta.url`, which points at the bundled chunk during `astro build` and fails only
there, never in dev.

**Deploying the API** is `gcloud run deploy` with flags that matter — see
[`/infra/README.md`](infra/README.md). Two are load-bearing: `--service-account`, without
which Cloud Run silently falls back to an Editor-privileged default identity, and
`--max-instances`, which is what actually bounds the bill.

**The API serves under `/api/v1`, not `/v1`.** Firebase Hosting rewrites preserve the full
path, so the `/api` prefix reaches the service. See [ADR-0001](docs/adr/0001-infrastructure.md).

**One derivation, two implementations, one fixture.** `api/internal/publish` computes what
the API serves; `web/src/lib/graph.ts` computes what the static pages render. Both must
turn the same nodes into the same graph, and both are checked against
[`content/derived.golden.json`](content/derived.golden.json) — regenerated with
`cd api && make golden`, never hand-edited. Change one side's derivation and the other
side's test fails, which is the entire point: a reader must never see a page whose edge
list and mini-map describe different graphs.

**CI is `.github/workflows/ci.yml`; deploys are `deploy.yml`.** The Firestore round-trip
tests only run in CI — they skip without `FIRESTORE_EMULATOR_HOST`, so `go test ./...`
stays one command locally. **CI authenticates to GCP with workload identity federation. No
JSON service-account keys, ever**, and `deploy.yml` stays inert until `./infra/cicd.sh` has
run and its two repository variables are set.


---

## 8. Working agreement

- **Read `CLAUDE.md` and `/docs/PLAN.md` at the start of every session.**
- **Every commit references an issue.** File the issue first — it is where the problem and
  the acceptance criteria get stated — then reference it from the commit and the PR
  (`Refs #12`, or `Closes #12` when the PR completes it). No issue, no commit; a change
  worth making is worth being able to find the reasoning for later.
- One prompt = one session; one subsystem at a time. `/compact` when a session runs long.
- **Plan before implementing.** Restate the task, list files you'll touch, flag design
  decisions, and wait for a human OK on anything non-obvious.
- **Smallest change that satisfies the acceptance criteria.** No opportunistic refactors
  riding along in a feature PR.
- Subagents are **reviewers and test-runners only** — never parallel builders on one issue.
  For genuinely independent work, use `git worktree` and a second session.
- **Do not merge your own PR.** Open it, summarize what a review flagged and what you fixed,
  and stop.
- Any decision that is hard to reverse — a new dependency, a data-model change, a serving
  strategy — gets an ADR in `/docs/adr/` before the code.
