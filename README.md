<div align="center">

# the∞.ai

**Every AI concept, connected. Start anywhere — the map never ends.**

[theinfinity.ai](https://theinfinity.ai)

</div>

---

An infinitely explorable concept graph for AI/ML. Every concept is a page with a
30-second intuition, a depth toggle (Intuition / Engineer / Math), an interactive viz
primitive, and typed edges — Requires ◂ / Unlocks ▸ / Adjacent ↔. **Trails** record the
path you took through the graph and turn it into something you can share.

**This is a learning project and a portfolio piece.** It has no users to answer to and no
revenue to chase, which is the point: it is built the way I would want to build something
at work if the schedule ever allowed it. Where craft and velocity disagree here, craft
wins. Fifty-seven concepts today, fifty-four of them read by a human.

## Try it

Open [theinfinity.ai](https://theinfinity.ai) and search for something. Or start at
[Attention](https://theinfinity.ai/c/attention), switch the depth toggle to **Math**, and
follow an edge. The graph never dead-ends — every page offers a next pull of the thread.

## How it works

**Static-first.** Concept pages are pre-rendered at build time from JSON in
`/content/nodes` and served off the Firebase CDN — fast first paint, real SEO, near-zero
idle cost. After hydration, small React islands call the Go API on Cloud Run for the
mini-map, search, and trails. *The API is canonical; the static pages are a build-time
cache.* The landing page ships **zero** JavaScript, and a budget in CI keeps it that way.

**Content-as-code.** Concepts are version-controlled JSON, schema-validated in CI, and
synced to Firestore on merge. Firestore is downstream of git, always — to fix a concept
you change the JSON and open a PR.

**The merge is the act of verification.** A node reviewed by a human and merged to `main`
is `verified`; a generated one still awaiting that review is `frontier`. Colour encodes
that tier on every surface — gold and teal, never decoration — and the tier is *derived*
from the review block rather than stored, so a node cannot claim to be reviewed without
one.

**No paid LLM API, anywhere.** Content is generated through Claude Code as an
authoring-time workflow. There is no inference in the request path, no model key in the
runtime, and no per-request model cost.

## The decisions worth reading

The reasoning lives in [ADRs](docs/adr) rather than here. The ones that shaped the most:

| | |
|---|---|
| [0002](docs/adr/0002-content-as-code-and-trust-tiers.md) | Tier is derived from `review`, not stored — the bad state is unrepresentable |
| [0003](docs/adr/0003-static-first-serving.md) | Why pages are pre-rendered and what the API is for |
| [0005](docs/adr/0005-depth-coupled-viz.md) | The depth toggle publishes to the DOM; the viz reads it. No shared store |
| [0008](docs/adr/0008-shared-trails-from-a-static-shell.md) | The one route that cannot be pre-rendered, and what to do about it |
| [0009](docs/adr/0009-notation-in-bodies.md) | `_` and `^` in body copy instead of KaTeX, and the migration that avoided |
| [0011](docs/adr/0011-analytics-from-request-logs.md) | Analytics read from request logs — no analytics JavaScript ships at all |

## Repository

| Path | What |
|---|---|
| [`/web`](web) | Astro + TypeScript, React islands, Tailwind. Five viz primitives, seven routes |
| [`/api`](api) | Go on Cloud Run — chi, distroless, scale-to-zero |
| [`/content/nodes`](content/nodes) | The concept graph, one JSON file per concept |
| [`/content/schema`](content/schema) | The schema CI validates every node against |
| [`/infra`](infra) | `setup.sh` and `cicd.sh` — GCP foundations and workload identity federation |
| [`/docs`](docs) | [Plan](docs/PLAN.md) · [ADRs](docs/adr) · [design source of truth](docs/design/handoff-v1) · [launch checklist](docs/LAUNCH.md) |

## Running it

```sh
cd web && npm install && npm run dev     # :4321, regenerates design tokens first
cd api && make run                       # :8080, needs GOOGLE_CLOUD_PROJECT
```

The web dev server works without the API — the pages are static, and the islands that
need it degrade rather than break. `CLAUDE.md` §7 has the full command table: tests,
linting, content validation, citation checking, the perf budget, and the publish path.

**The Tailwind theme is generated, not written.** `web/scripts/generate-tokens.mjs` reads
[`tokens.json`](docs/design/handoff-v1/tokens.json) and emits a gitignored CSS file, so
committed source cannot drift from the design handoff. No hex value belongs in
hand-written source.

## Contributing

Every change ships as a PR against `main` with CI green — `web`, `api`, `contracts` and
`pr title` are all required checks. [Conventional Commits](https://www.conventionalcommits.org/);
the PR title becomes the squashed commit message. `main` is protected.

Anything hard to reverse — a dependency, a data-model change, a serving strategy — gets an
ADR before the code.

[`CLAUDE.md`](CLAUDE.md) is the working agreement: product, stack, standards, design
tokens, and the commands. It is written for whoever is building this, which is a different
document from this one.

## License

[Apache 2.0](LICENSE)
