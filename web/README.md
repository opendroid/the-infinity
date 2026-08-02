# `/web` — Astro + TypeScript frontend

Static-first (ADR-0003). Every route pre-renders at build time and is served off the
Firebase CDN; islands call the API after hydration. There is no adapter and no SSR.

## Commands

```zsh
npm install
npm run dev         # :4321 — regenerates design tokens first
npm run build       # static output to dist/
npm run typecheck   # astro check
npm run lint        # eslint, zero warnings
npm test            # vitest
```

## Routes

| Route | Screen |
|---|---|
| `/` | Universe — lemniscate, search, entry chips, frontier pulse line |
| `/c/[id]` | Concept — depth toggle, viz island, typed edges, mini-map, trail ribbon |
| `/t/[slug]` | Trail — thread, numbered stops, share row |

## The theme is generated

`scripts/generate-tokens.mjs` reads [`tokens.json`](../docs/design/handoff-v1/tokens.json)
and emits `src/styles/tokens.generated.css` — a Tailwind v4 `@theme` block plus the
frontier-pulse keyframes. The output is **gitignored**, so committed source cannot drift
from the handoff. Never hand-type a hex value.

## Derivation

`src/lib/graph.ts` is a miniature of the Phase 4 publish tool, and exists because
ADR-0002 deliberately does not store what can be computed:

- `tier` is derived — a node is verified iff it carries `review`
- `unlocks` is inverted from `requires`, so one fact lives in one file
- `adjacent` is symmetrized, so it can be declared from either side
- mini-map coordinates are deterministic by edge type (ADR-0003) — no force simulation

`src/lib/nodes.test.ts` enforces those invariants against the real content, so the ADR
is executable rather than remembered.

## Content lives outside this directory

`/content/nodes` is the canonical graph, not a web asset. It is read with `node:fs` at
build time, resolved from `process.cwd()` — **not** from `import.meta.url`, which points
at the bundled chunk during `astro build` and fails only there, never in dev.

The sample trail in `src/fixtures/` is a **fixture, not content**: per ADR-0002 trails are
interaction state, written at runtime and never authored in git.

## Not built yet

Search overlay, 404 / request page, OG cards, the real interactive viz primitives, and any
API call. Each is its own issue.

## Cache headers and clean URLs

`firebase.json` sets `cleanUrls: true`, and Astro's `directory` build format emits
`dist/c/<id>/index.html`. So a concept page is *requested* at `/c/<id>` — a path with no
`.html` in it.

Header `source` globs match **the request path, not the file on disk**. That makes
`**/*.@(html)` useless for these routes: it matches neither the clean URL nor the
directory form, and Firebase's default `max-age=3600` applies instead. The first deploy
shipped exactly that, and a concept page was cached for an hour when it was meant to
revalidate (#72).

**Adding a top-level route means adding a header entry.** The routes are enumerated —
`/`, `/c/**`, `/t/**` — rather than matched by a single clever glob, because none of them
overlaps `/_astro/**` and the result therefore does not depend on how Firebase resolves
two rules matching one request. A search or changelog route needs its own line.

Verify against the deployed site rather than the config:

```zsh
curl -sI https://the-infinity-ai.web.app/c/mixture-of-experts | grep -i cache-control
# public, max-age=0, must-revalidate
```
