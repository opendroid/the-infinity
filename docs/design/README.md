# Design

## What is authoritative

[**`handoff-v1/`**](handoff-v1) — the v1 surface scaffolding. This is the design
source of truth. It specifies all five routes and their states at implementation
fidelity: colors, type sizes, spacing, radii, borders, and copy are final and are
meant to be reproduced exactly.

[`mockups.html`](mockups.html) is the earlier three-screen exploration, kept for
provenance. It is **superseded** — where the two disagree, the handoff wins. Read it
to understand how the thread motif arrived, not to build from.

## The handoff

| File | What |
|---|---|
| [`handoff-v1/README.md`](handoff-v1/README.md) | The spec. Design system, all five routes, interactions, state management, tokens, accessibility, anti-patterns. Start here. |
| [`handoff-v1/API.md`](handoff-v1/API.md) | Endpoint contracts and response shapes |
| [`handoff-v1/DATA-MODEL.md`](handoff-v1/DATA-MODEL.md) | Concept, edge, trail, request, and review records |
| [`handoff-v1/COMPONENTS.md`](handoff-v1/COMPONENTS.md) | Component inventory with props — and the two components that must not exist |
| [`handoff-v1/tokens.css`](handoff-v1/tokens.css) | Custom properties, ready to drop in |
| [`handoff-v1/tokens.json`](handoff-v1/tokens.json) | The same tokens as data — Tailwind's theme is generated from this, never hand-typed |
| [`handoff-v1/designs/surface-board.dc.html`](handoff-v1/designs/surface-board.dc.html) | Every route and state, rendered. Open in a browser; needs `support.js` beside it |

## Reading the board

Open `handoff-v1/designs/surface-board.dc.html` directly — no server needed. Section
`1a` holds frames A (landing), B (concept page, first-paint and hydrated side by side),
C (trail), D (search + states), E (OG cards). Section `2a` is the frontier concept page.
Each frame carries a mono `SCAFFOLD ·` note naming its endpoints and its hydration
boundary.

The HTML in `designs/` is a **design reference, not production code.** Rebuild it in
Astro using the project's own patterns; do not copy the markup across.

## The three rules

Everything else follows from these. They are why the product looks like one thing:

1. **Node color always encodes trust tier.** Gold `#E5B54A` = verified, teal
   `#5FD4C4` = frontier. On graphs, edge links, mini-maps, trail stops, badges, OG
   cards. No exceptions.
2. **Violet `#8F7BFF` is the only interactive color.** Links, edges, buttons, focus
   rings, the thread. Gold and teal are never buttons, links, or emphasis — they carry
   meaning, not attention.
3. **Glow is rationed** — at most one glowing element per screen, reserved for the
   primary action or the thread. On the landing page that is the search field, and
   nothing else.

The handoff's *Anti-patterns — reject on sight* list is the short version of what
violating these looks like. It is worth reading before writing any CSS.

## Where this disagrees with the implementation

The handoff specifies the product in more detail than `/docs/PLAN.md` did, and in a few
places it says something different. Those conflicts are **resolved** in
[ADR-0002](../adr/0002-content-as-code-and-trust-tiers.md) and
[ADR-0003](../adr/0003-static-first-serving.md). Read them before implementing against
`API.md` or `DATA-MODEL.md` — in these specific places, the ADRs win:

| Handoff says | We do | Why |
|---|---|---|
| `POST /v1/reviews` flips a node to verified | It returns `202` to a queue; a merged PR is the only thing that promotes a node | Runtime writes to `tier` break "Firestore is downstream of git" |
| `provenance.sources[]` holds citations, frontier-only | `citations[]` is top-level on every node, tier-independent | Otherwise verifying a node deletes its sources |
| `tier` is a stored field | Derived: a node is verified iff it carries `review` | Makes "verified with no reviewer" unrepresentable, not just detectable |
| Nodes declare `requires` and `unlocks` | Declare `requires`; `unlocks` is inverted at publish | They are inverses; authoring both lets two files contradict |
| `domain` is a string | Stored as a 2-level path array; the API emits the joined string | Keeps it queryable; the eyebrow renders identically |
| Search types ahead against `GET /v1/search` | A static index, matched client-side. The endpoint is deferred | ~30 KB at this scale, no cold start, works while the API is down |
| Edges carry `title` and `tier` | True of API responses; node JSON stores ids only | Otherwise renaming a concept edits every file that references it |

Everything else in the handoff — every route, state, token, and component — stands as
written.

`/changelog`, referenced twice in `DATA-MODEL.md` and specified nowhere, is **out of
scope for v1** until it has a route spec.
