<div align="center">

# the<span>∞</span>.ai

**Every AI concept, connected. Start anywhere — the map never ends.**

</div>

---

An infinitely explorable concept graph for AI/ML. Every concept is a page with a
30-second intuition, a depth toggle (Intuition / Engineer / Math), an interactive viz
primitive, and typed edges — Requires ◂ / Unlocks ▸ / Adjacent ↔. **Trails** record the
path you took through the graph, and turn it into something you can share.

## Repository

| Path | What |
|---|---|
| [`/web`](web) | Astro + TypeScript frontend, React islands, Tailwind — *stub* |
| [`/api`](api) | Go service for Cloud Run — *stub, serves `/healthz`* |
| [`/content/nodes`](content/nodes) | Concept nodes as JSON — the canonical graph |
| [`/content/schema`](content/schema) | JSON Schema the nodes are validated against |
| [`/docs`](docs) | [Build plan](docs/PLAN.md), [prompt pack](docs/prompt-pack.md), [design](docs/design), [ADRs](docs/adr) |
| [`/.github/workflows`](.github/workflows) | CI/CD |

## How it works

**Static-first.** Concept pages are pre-rendered at build time from the JSON in
`/content/nodes` and served off the Firebase CDN — fast first paint, real SEO, near-zero
idle cost. After hydration, islands call the Go API on Cloud Run for navigation,
mini-map, search, and trails. The API is canonical; the static pages are a build-time cache.

**Content-as-code.** Nodes are version-controlled JSON, schema-validated in CI. A node
merged to `main` is `verified`; a generated one awaiting review is `frontier`. **The merge
is the act of verification.** Color encodes that tier on every surface, always.

## Start here

Read [`CLAUDE.md`](CLAUDE.md) — product, stack, standards, and design tokens — then
[`/docs/PLAN.md`](docs/PLAN.md) for the phases and milestones. The design source of truth
is [`/docs/design/mockups.html`](docs/design/mockups.html); open it in a browser.

## Contributing

Every change ships as a PR against `main` with CI green.
[Conventional Commits](https://www.conventionalcommits.org/). `main` is protected.

## License

[Apache 2.0](LICENSE)
