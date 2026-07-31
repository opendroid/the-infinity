# `/web` — Astro + TypeScript frontend

**Status: stub.** Scaffolded in Phase 1 — nothing here yet but this file.

## What lands here

Astro + TypeScript + Tailwind, with React islands for the interactive pieces (viz
primitives, depth toggle, trail ribbon, mini-map). Three page templates:

| Route | Screen | Contents |
|---|---|---|
| `/` | Universe | Lemniscate hero, search, entry chips, frontier pulse line |
| `/c/[id]` | Concept | Domain eyebrow + tier badge, H1, intuition, depth toggle island, viz primitive, typed edges panel, mini-map SVG, trail ribbon |
| `/t/[slug]` | Trail | Thread SVG, numbered stops with tier dots, share row |

Concept pages are **pre-rendered at build time** from `/content/nodes/*.json` and served
off the Firebase CDN. Islands hydrate and call the Go API for navigation, mini-map,
search, and trails. See "static-first" in [`/CLAUDE.md`](../CLAUDE.md).

## Tailwind theme

Generated from the design tokens in [`/docs/design/mockups.html`](../docs/design/mockups.html)
— `void` / `nebula` / `starlight` / `dust` / `thread` / `verified` / `frontier`, and the
three families (Unbounded, Schibsted Grotesk, JetBrains Mono). The token table lives in
[`/CLAUDE.md`](../CLAUDE.md). Never re-type a hex value by hand.

## Non-negotiables

- `strict: true` TypeScript. No `any`.
- ESLint + Prettier decide style.
- Smallest island that does the job; prefer CSS over JS, static over island.
- `prefers-reduced-motion` respected, visible focus states, color never the sole carrier
  of meaning.
