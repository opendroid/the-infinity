# CLAUDE.md — theinfinity.ai

Guidance for Claude Code (and humans) working in this monorepo. Read this first, every
session. Deeper context lives in [`/docs/PLAN.md`](docs/PLAN.md); the design source of
truth is [`/docs/design/mockups.html`](docs/design/mockups.html).

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
| Data | Firestore (Native mode): `concepts`, `trails`, `concept_requests` |
| Hosting | Firebase Hosting (Blaze) — CDN + TLS. `/api/**` rewrite → Cloud Run service `api` (no GCLB) |
| Region | `us-west1` for Cloud Run and Firestore |
| Domain | Registered at GoDaddy; DNS A records point at Firebase at launch (M3), not before |

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
- **ESLint + Prettier** are the arbiters of style — don't hand-format, don't argue with them.
- Ship the smallest island that does the job. Prefer CSS over JS, and static over island.
- Accessibility is not optional: semantic landmarks, real focus states
  (`outline: 2px solid var(--frontier)`), `prefers-reduced-motion` respected on every
  animation, and color never the sole carrier of meaning — tier badges carry text too.

### Content (`/content`)

- Node `id` is a kebab-case slug and is the URL: `speculative-decoding` → `/c/speculative-decoding`.
- Edges may only reference node ids that exist or are planned in the same PR.
- Citations are real, resolvable links (arXiv, papers, primary sources). No invented references.

---

## 5. Design tokens

Extracted from [`/docs/design/mockups.html`](docs/design/mockups.html), which is the source
of truth. When Tailwind lands in `/web`, its theme is **generated from these values** —
never re-typed by hand, never drifted.

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

**Rule: color is semantic, never decorative.** A node's color encodes its trust tier on
every surface — landing lemniscate, edge list, mini-map, trail. `thread` violet means
"this is interactive or this is your path" and nothing else.

### Type

| Family | Use |
|---|---|
| **Unbounded** (400/600/800) | Display — wordmark, page H1/H2. Sparingly. |
| **Schibsted Grotesk** (400/500/700) | Body copy, buttons, UI text |
| **JetBrains Mono** (400/600) | Labels, data, edge types, eyebrows, counts, URLs |

Mono is for anything machine-flavored — uppercase, `letter-spacing: .16em–.18em`, 10–12px.

### Signature

**The thread**: one continuous line running through the landing lemniscate, the trail
ribbon on the concept page, and the shared-trail page. It is the product's one visual idea.
Content max-width `960px`.

---

## 6. Layout

```
/web        Astro + TypeScript frontend            (README stub — scaffolded in Phase 1)
/api        Go service for Cloud Run               (stub — built out in Phase 3)
/content
  /nodes    concept node JSON, one file per concept
  /schema   JSON Schema for nodes                  (Phase 2)
/docs
  PLAN.md         the build plan — phases, milestones, budget
  prompt-pack.md  sequenced Claude Code session prompts
  /design   mockups.html (source of truth), tokens.md (Phase 1)
  /adr      architecture decision records
/.github/workflows   CI                            (Phase 4)
```

---

## 7. Commands

*Filled in as tooling lands — each phase adds its row. Anything not listed here does not
exist yet.*

| Command | What it does | Status |
|---|---|---|
| — | — | web tooling arrives in Phase 1 |
| — | — | schema validation arrives in Phase 2 |
| — | — | `make test` / `make lint` in `/api` arrive in Phase 3 |
| — | — | CI workflows arrive in Phase 4 |

<!--
As tooling lands, replace the placeholder rows above, e.g.:

### Web (`/web`)
| `npm run dev` | Astro dev server |
| `npm run build` | Static build |
| `npm run lint` / `npm run typecheck` | ESLint / tsc --noEmit |

### API (`/api`)
| `make run` | Run the service locally |
| `make test` | Table-driven tests |
| `make lint` | golangci-lint |
| `make docker-build` | Multi-stage distroless image |

### Content
| `npm run validate:content` | Validate every node against the schema |
-->

---

## 8. Working agreement

- **Read `CLAUDE.md` and `/docs/PLAN.md` at the start of every session.**
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
