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

## Calling the API

`src/lib/api.ts` is the only place a request URL is built. No island concatenates one.

```ts
import { apiUrl } from '../lib/api';
const res = await fetch(apiUrl(`/concepts/${id}/neighborhood`));
```

Note the argument is the path **after** the prefix. Routes mount at `/api/v1`, not `/v1`,
because Firebase Hosting rewrites `/api/**` to Cloud Run *preserving the full path* — a
client calling `/v1/...` works perfectly against the Cloud Run URL and 404s through the
domain, which is a failure that appears only in production. Keeping the prefix in one
module means it can be wrong once rather than at every call site. See ADR-0001.

### `PUBLIC_API_ORIGIN`

| Environment | Value | Why |
|---|---|---|
| Production | unset | Hosting rewrites `/api/**`, so every call is same-origin: no CORS, no preflight, no second DNS lookup |
| `astro dev` | `http://localhost:8080` | There is no rewrite in dev, so the API has to be addressed directly |

```zsh
PUBLIC_API_ORIGIN=http://localhost:8080 npm run dev   # against a local `cd api && make run`
```

**A malformed value fails the build, not the browser.** `astro.config.ts` runs the same
`normaliseOrigin` the client uses, at the moment the build starts:

```
PUBLIC_API_ORIGIN must be a bare origin with no path, query, or fragment, got "http://localhost:8080/api"
```

That last case is why the check is stricter than "is this a URL": a path there is silently
concatenated with the prefix to give `/api/api/v1/stats`, which 404s in a way that reads
like a routing bug in the API rather than a typo in a config.

The config is `astro.config.ts` rather than `.mjs` precisely so it can import that function
instead of restating the rule in JavaScript. Two copies of a validation rule are two copies
free to disagree — the failure mode this repo has hit more than once.

## The site is deliberately unindexable right now

`public/robots.txt` disallows everything and `firebase.json` sets
`X-Robots-Tag: noindex, nofollow` on every route. Both are pre-launch measures (#84).

The site is live at `the-infinity-ai.web.app` while the real domain is still parked, and
indexing that URL would put the same content on two domains, index the graph at its
thinnest, and attach the history to an address we are about to abandon.

**Both come off at the DNS cutover (#65), together.** `robots.txt` asks a crawler not to
*crawl*; the header tells it not to *index*, and a page linked from somewhere else can be
indexed without ever being crawled. Removing only one leaves the site half-blocked in a way
nothing reports.

The removal is a verified step in #65 and #66 rather than a note here, because forgetting it
is silent: the site works perfectly and is simply never found.
