# Handoff: theinfinity.ai — v1 surface scaffolding

## Overview
theinfinity.ai is an infinitely explorable concept graph for AI/ML. This package
specifies **all five v1 routes plus their states** at implementation fidelity:
the Universe landing, the concept page (verified and frontier variants), the
shared trail, the search overlay, and the state set (404 + request, empty edge
group, API-unreachable fallback, OG cards).

The product thesis, in one line: knowledge as one continuous thread you pull.
Concepts are beads ON that thread. The thread appears as the lemniscate on the
landing page, the trail ribbon on concept pages, and the pulled-thread path on
shared trails. Any new surface must answer: where does the thread run here?

## About the Design Files
The files in `designs/` are **design references written in HTML** — prototypes
that show intended look, structure, and copy. They are not production code to
copy verbatim.

The task is to **recreate these designs in the target codebase's own
environment**, using its established patterns, router, and component
conventions. If no codebase exists yet: the concept page is ~95% of traffic and
arrives via SEO, so choose a framework that pre-renders HTML at build or request
time (Next.js/Astro/SvelteKit-style SSG with client hydration is the natural
fit). The first paint of `/c/[id]` must be complete, readable HTML with no
client JS required.

`designs/Surface Board.dc.html` needs `designs/support.js` beside it to open;
both are included. `designs/original-bootstrap-mockups.html` is the earlier
three-screen exploration, kept for provenance.

## Fidelity
**High-fidelity.** Colors, type sizes, spacing, radii, borders, and copy are
final and should be reproduced exactly. What is *not* specified: real motion
beyond the frontier pulse (there is intentionally none), and the interactive
behavior of the viz primitives beyond the described parameter.

---

## Design system in one screen

Semantic color, never decorative. Three hard rules that govern every surface:

1. **Node color always encodes trust tier** — gold `#E5B54A` = verified
   (human-reviewed), teal `#5FD4C4` = frontier (auto-generated, new growth).
   This holds on graphs, edge links, mini-maps, trail stops, badges, OG cards.
   No exceptions.
2. **Violet `#8F7BFF` is the only interactive color** — links, edges, buttons,
   focus rings, the thread itself. Gold and teal are never buttons, links, or
   emphasis. They carry meaning, not attention.
3. **Glow is rationed** — at most one glowing element per screen
   (`box-shadow` in violet), reserved for the primary action or the thread. On
   the landing page that is the search field, and nothing else.

Typography, three faces, non-overlapping jobs:

| Face | Job | Never |
| --- | --- | --- |
| Unbounded | wordmark, H1/H2, node titles | body copy |
| Schibsted Grotesk | all body and UI copy | data labels |
| JetBrains Mono | data, eyebrows, edge types, counts — always uppercase, .14–.18em tracking, 10–12px | headings, paragraphs |

Every major heading gets a mono uppercase eyebrow in `--dust` above it.

---

## Routes

### 1. `/` — Universe (landing)
**Job:** orient and invite; get the visitor onto a node in under ten seconds.
**Reference:** board section 1a, frame A.

Layout: single centered column, max content width ~620px for the graph,
540px for the search field. Desktop padding `56px 40px 52px`; mobile
`36px 22px 40px`. Background is a subtle radial lift behind the hero —
`radial-gradient(120% 90% at 50% 0%, #141A31 0%, #0B0E1A 62%)` — the only
gradient anywhere in the product, and it reads as depth, not decoration.

In order:
1. **Lemniscate** — one inline `<svg>` (viewBox `0 0 620 230`). Two paths: the
   figure-eight outline at `stroke-width 1.4, opacity .8`, plus a thicker
   `stroke-width 4, opacity .2` pass over the left lobe only, which reads as
   depth. Nodes are `<circle>` r=4–7.5 filled by tier: left lobe gold, right
   lobe teal, center junction violet r=7.5. Right-lobe (frontier) nodes carry
   the pulse animation, staggered 0s / .9s / 1.7s. Four labels in JetBrains
   Mono 10–11px; the center label is `--starlight`, the rest `--dust`.
   Node coordinates come from a **static layout file committed to the repo** —
   do not run a force simulation at load.
2. **Wordmark** — Unbounded 800, 38px desktop / 26px mobile, letter-spacing
   `-.015em`. "the" + "infinity" in violet + ".ai".
3. **Tagline** — 15px `--dust`, max-width 44ch: "Every AI concept, connected.
   Start anywhere — the map never ends."
4. **Search field** — 1px violet border, radius 12, `background: var(--void)`,
   `box-shadow: 0 0 44px rgba(143,123,255,.16)` (the one glow). Input padding
   `16px 18px`, 15px. Attached button: solid violet fill, void text, weight
   700, padding `0 24px`. Placeholder: "Start anywhere — try “attention” or
   “flow matching”". Focus opens the search overlay (route 4) rather than
   submitting.
5. **Entry chips** — 6 pills, `--nebula-2` fill, 1px `--line` border, radius
   999, padding `7px 15px`, 13px. Border becomes violet on hover. Each is a
   plain `<a href="/c/[id]">`. Content: Attention · RLHF · Diffusion ·
   KV Cache · Mixture-of-Experts · Agents.
6. **Frontier pulse line** — JetBrains Mono 12px: "1,847 concepts · " then the
   frontier clause in teal: "12 grew on the frontier this week". Reads
   `GET /v1/stats`; ships with build-time values so it never renders empty.

No other CTAs on this page. No nav bar.

Mobile (390): same order, lemniscate viewBox `0 0 340 200`, wordmark 26px,
button label shortens to "Go", 4 chips instead of 6, pulse line wraps to two
lines.

### 2. `/c/[id]` — Concept page
**Job:** 60 seconds to understanding, plus seeing where the concept sits.
**Reference:** 1a frame B (verified, shown as first-paint and hydrated) and
section 2a (frontier).

Grid: `1fr 288px`. Main padding `34px 30px 30px`; sidebar padding
`30px 24px` with `border-left: 1px solid var(--line)` and background
`rgba(11,14,26,.35)`. Under 760px it collapses to one column, sidebar below the
viz, edge rows grow to 44px+ touch targets.

Order, top to bottom:

**Topbar** — `padding: 14px 26px`, bottom hairline. Left: mini wordmark,
Unbounded 600 14px, "the∞.ai" with ∞ in violet. Center: search field, max-width
340px, radius 8, `--void` fill, 13px, with a mono `/` hint right-aligned.
Right: trail count, mono 11px — `trail · 0 nodes` in `--dust` when empty,
count in violet once the trail has entries.

**Eyebrow + tier badge** — mono 11px uppercase `.16em`: `Architecture /
Sparsity`. Badge beside it: pill, radius 999, padding `4px 11px`, mono 10px
`.14em`, 1px border and text in the tier color at 45% border opacity, plus a
7px tier dot. Frontier badges' dots pulse; verified badges' dots do not.

**H1** — Unbounded 600, 32px/1.16 desktop, 23px/1.2 mobile, margin `16px 0`.

**Body** — Schibsted 15.5px/1.65, max-width 62ch, `text-wrap: pretty`. One
phrase per depth is lifted to violet weight 500 as the takeaway. All three depth
variants ship in the pre-rendered HTML.

**Depth toggle** — three segments, inline-flex, 1px `--line` border, radius 10,
overflow hidden. Inactive: transparent, `--dust`, 13px weight 500, padding
`9px 18px`. Active: solid violet fill, `--void` text, weight 700. Swaps the
body copy in place; **never navigates**. Mobile: full-width, three equal
segments. The depth the reader lands on is recorded on the trail entry.

**Viz island** — 1px `--line`, radius 12, `--void` fill, padding 22.
Header row: mono 10px `.16em` label left (`Viz primitive · router-dispatch`),
parameters right (`top-k = 2 · experts = 8`). Caption below in `--dust` 12.5px,
max-width 58ch, naming the one draggable parameter. Bars and cells are violet —
inside the island violet is the data channel; tier colors never appear here.

Two primitives are specified; the set is meant to grow, one per concept, chosen
by the concept record:
- `router-dispatch` (Mixture-of-Experts) — a `78px repeat(8,1fr)` grid of 20px
  cells: solid violet = top-1 expert, `rgba(143,123,255,.45)` = top-2, 1px
  `--line` outline = asleep. Per-expert load row underneath in mono 10px. The
  engineer depth re-parameterizes the same primitive as horizontal utilisation
  bars (9px tall, radius 999, `--nebula` track).
- `update-spectrum` (Muon) — two side-by-side bar groups, 104px tall, 8 bars
  each: raw gradient σ decaying steeply vs. the flattened post-orthogonalization
  spectrum. Parameter: Newton–Schulz step count 0–8.

**Edges panel** — three typed groups, in order Requires / Unlocks / Adjacent,
each with a mono 10px `.18em` heading whose arrow glyph is violet (`◂` /
`▸` / `↔`). Rows: `display:flex; justify-content:space-between`, padding
`9px 11px`, 1px `--line`, radius 8, `--nebula` fill, 13.5px, with a 7px tier
dot on the right. Border turns violet on hover. An empty group renders a
1px **dashed** `--line` box: "Nothing builds on this yet — it's the current end
of the thread." plus a mono violet "Suggest an edge".

**Mini-map** — `You are here`. Only element that waits on the network:
`GET /v1/concepts/{id}/neighborhood` after hydration. Skeleton is a 132px
`--void` box, 1px `--line`, radius 10, centered mono 10px "loading
neighborhood…". Loaded: viewBox `0 0 240 132`, violet lines at opacity .5,
current node r=8 in violet (or teal when the node itself is frontier), 1-hop
neighbours r=5 by tier, node id label in mono 8px. Unreviewed edges draw
`stroke-dasharray="3 4"` at opacity .35, with a mono caption "Dashed =
unreviewed edge".

**Trail ribbon** — footer bar, `--nebula-2` fill, top hairline, padding
`16px 26px`. Mono `.16em` "Your thread" label, then beads: title 13px with a
26×1px violet wire at opacity .5 between them; current node violet weight 700.
Share button right-aligned: 1px violet border, violet text, radius 8. Mobile
collapses beads to tier dots joined by wires and the button becomes solid violet
"Share".

**Frontier-only: provenance block** (section 2a) — after the viz, 1px `--line`,
radius 12, padding `18px 20px`, `rgba(28,34,64,.45)` fill. Mono eyebrow
`Provenance · frontier node`, one sentence of framing, then the citation list in
mono 11.5px `--dust`, then two actions: "Flag an error" (1px violet border) and
"Volunteer to review" (1px `--line`). Verified pages omit this block entirely
and instead carry a reviewer attribution.

### 3. `/t/[slug]` — Shared trail
**Job:** a wander turned into a shareable artifact; the growth loop.
**Reference:** 1a frame C.

Padding `40px 34px 36px`. In order: mono eyebrow `Shared thread · 6 concepts ·
31 min of wandering` · H2 in Unbounded 600 28px/1.2, max-width 34ch, with one
word ("thread") in violet · a `--dust` 14px line with date and where it ended ·
the thread SVG · the numbered stop list · the share row.

Thread SVG (desktop): viewBox `0 0 1000 90`, one cubic path,
`stroke-width 1.6, opacity .75`, beads r=5–7 placed along it in tier color,
frontier beads pulsing, the final bead one radius larger.

Stop list: `<ol>`, `list-style:none`. Each row `display:flex; gap:16px;
padding:12px 0`, bottom hairline except the last. Columns: mono 11px 2-digit
index (22px fixed) · 8px tier dot · title 15px flex:1 · depth read at, mono 10px
uppercase `.12em` `--dust`. **Numbering is legitimate here** — order is the
content. Nowhere else in the product is numbered.

Share row: 1px `--line`, radius 10, padding `14px 16px`, `--void` fill. Mono
12px URL in `--dust` (flex:1, `overflow-wrap:anywhere`), then "Copy link"
(1px `--line`) and "Walk this trail" (solid violet, weight 700) which opens
stop 1 with the trail preloaded.

Mobile rotates the same primitive: the thread becomes a vertical spine — a 9px
tier dot per stop with a 1px violet 45%-opacity connector between, title 15px,
and `NN · depth` in mono beneath. Buttons stack full-width, violet first.

### 4. Search — overlay, not a page
**Reference:** 1a frame D, first panel.

Scrim `rgba(11,14,26,.6)` over the current page; panel padding 24. Input: 1px
violet, radius 12, `--void`, 15px, with a 1px violet caret bar and a mono `ESC`
hint right-aligned. Results: rows `padding:12px 14px`, radius 9, 12px gap.
Each row = 8px tier dot · title 14.5px + mono 10px `.14em` domain eyebrow
beneath · mono `↵` on the selected row only. Selected row: `--nebula-2` fill
with a 1px violet border; others 1px transparent border (so nothing shifts).
Footer: mono 10px "4 of 23 matches · ↑↓ to move". Types ahead against
`GET /v1/search`; Enter navigates to the concept page.

### 5. States
**Reference:** 1a frame D.

**Concept 404** — `/c/[unknown]`. A broken-thread SVG at the top: solid path to
a gold node, then a dashed violet gap circle (`stroke-dasharray="3 4"`), then a
ghosted continuation at opacity .2 ending on a 35%-opacity teal node. Mono
eyebrow `Gap in the graph` · H2 Unbounded 600 26px "This node doesn't exist
yet" · body naming the missing slug in mono · request form: text field
(1px `--line`, radius 9, `--void`) + solid violet "Request this concept"
(`POST /v1/requests`) · then a hairline and `Nearest nodes` — two edge rows,
tier-dotted, so the page is never a dead end.

**Empty edge group** — see the concept-page spec. Dashed container, honest copy,
one mono violet suggest action.

**API unreachable** — the static page still works. A status strip above the
topbar: `--nebula-2` fill, 7px `--dust` dot (deliberately not teal — this is
not tier information), mono 10.5px "Live graph offline · reading the cached page
· retry" with "retry" in violet. Body, all depths, viz, and edges render
normally. Two dashed 1px `--line` cards explain the degradation: mini-map
"Hidden, not broken. Returns on reconnect." and search "Falls back to a plain
form post to /search." Trail keeps writing to localStorage; share queues until
reconnect.

**OG cards — 1200×630** (frame E). One template, two fills. Padding `78px 88px`,
three rows justified apart. Concept card: mono 22px `.2em` domain eyebrow +
tier badge (1.5px border, 20px mono, 13px dot) · H2 Unbounded 600 82px/1.05 ·
one line of intuition copy at 32px/1.45 `--dust`, max-width 26ch · footer with
the wordmark at 28px and mono 20px node stats. Behind it, a thread path at
`stroke-width 2.5, opacity .28` with two beads. Trail card: mono eyebrow ·
H2 64px, max-width 24ch · the thread at `stroke-width 3` with r=11–14 tier
beads · footer wordmark + "Walk this trail". **No glow on either** — most
renderers flatten it.

---

## Interactions & Behavior

| Interaction | Behavior |
| --- | --- |
| Depth toggle | Swaps between three copy blocks already in the DOM. No navigation, no fetch. Updates the trail entry's `depth_read_at`. |
| Edge click | Before hydration, a normal link. After, client-side navigation via the API with no full reload. |
| Every concept view | Appends `{id, title, tier, depth_read_at, ts}` to the localStorage trail. Re-visiting an existing node moves it to the end rather than duplicating. |
| Share trail | `POST /v1/trails` with the localStorage trail → redirect to `/t/{slug}`. |
| Walk this trail | Loads the trail into localStorage, opens stop 1. |
| Search | `/` or topbar click opens the overlay. Type-ahead debounced ~120ms against `GET /v1/search`. ↑↓ moves, ↵ navigates, ESC closes. |
| Chip / lemniscate node | Plain link to `/c/[id]`. |
| Hover | Edge rows and chips: border → `--thread`. Nothing else moves; no lift, no scale. |
| Focus | 2px `--thread` outline, `outline-offset: 2px`. Teal focus ring only when the focused element is itself violet. |
| Motion | Exactly one animation ships: a ~3.2s opacity pulse (`.5 → 1 → .5`) on frontier nodes and frontier badge dots, staggered by delay so they don't beat in unison. Everything is inside `@media (prefers-reduced-motion: no-preference)`. Nothing else animates. |

## State Management

Server / build-time: concept record (all three depth bodies, tier, provenance,
typed edges, viz primitive + params), trail record, search index, stats.

Client:
- `trail` — localStorage array, the only persistent client state. Written on
  every concept view; read by the ribbon, the share action, and `/t`.
- `depth` — per-page, defaults to `intuition`; last choice may be remembered in
  localStorage so a returning engineer isn't re-taught.
- `neighborhood` — `idle | loading | ready | unavailable`, drives the mini-map
  skeleton / SVG / hidden states.
- `search` — `{ open, query, results, selectedIndex }`.
- `api` — `online | offline`, drives the status strip and the degraded
  affordances.

Everything except `neighborhood` and `search` must be correct on first paint
without JS.

## Design Tokens

```css
--void:      #0B0E1A;  /* page background — deep indigo, NEVER pure black */
--nebula:    #151A2E;  /* panel surface */
--nebula-2:  #1C2240;  /* raised surface: topbars, ribbons, chips */
--starlight: #E9EBF8;  /* primary text */
--dust:      #8B91B3;  /* secondary text */
--line:      #262D4E;  /* borders, hairlines */
--thread:    #8F7BFF;  /* ALL interactive: links, edges, buttons, focus, thread */
--verified:  #E5B54A;  /* trust tier: human-reviewed nodes ONLY */
--frontier:  #5FD4C4;  /* trust tier: auto-generated / new-growth nodes ONLY */
```

Derived values used in the designs: `rgba(229,181,74,.45)` and
`rgba(95,212,196,.45)` for tier badge borders, `rgba(143,123,255,.45)` for the
top-2 dispatch cell, `rgba(11,14,26,.35)` for the edges panel wash,
`rgba(28,34,64,.45)` for the provenance block, `#39406B` for the inert browser
dots in the mock chrome.

**Spacing** (px): 6 · 7 · 9 · 10 · 12 · 14 · 16 · 18 · 22 · 26 · 30 · 34 · 40 ·
56 · 80. Column gap between screens on the board: 28.

**Radius** (px): 8 edge rows, buttons, topbar search · 9 overlay rows, request
input · 10 depth toggle, mini-map, share row · 12 viz island, hero search,
provenance · 14 panel/screen card · 999 pills and dots.

**Type scale**

| Role | Face | Size / line-height | Weight | Tracking |
| --- | --- | --- | --- | --- |
| Landing wordmark | Unbounded | 38px | 800 | -.015em |
| Concept H1 | Unbounded | 32 / 1.16 | 600 | — |
| Concept H1 (mobile) | Unbounded | 23 / 1.2 | 600 | — |
| Trail title | Unbounded | 28 / 1.2 | 600 | — |
| Mini wordmark | Unbounded | 14px | 600 | — |
| Body | Schibsted Grotesk | 15.5 / 1.65 | 400 | — |
| Body emphasis | Schibsted Grotesk | 15.5 | 500, `--thread` | — |
| Edge row / stop | Schibsted Grotesk | 13.5–15px | 400 | — |
| Secondary / caption | Schibsted Grotesk | 12.5–14.5px, `--dust` | 400 | — |
| Eyebrow | JetBrains Mono | 11px uppercase | 400 | .16–.18em |
| Badge / group label | JetBrains Mono | 10px uppercase | 600 | .14–.18em |
| Data / counts | JetBrains Mono | 10–12px | 400–500 | .04–.14em |

Borders are 1px `--line` everywhere except the two 1.5px OG tier badges.
The only shadow in the product is the landing search glow,
`0 0 44px rgba(143,123,255,.16)`.

**Fonts** — Google Fonts: Unbounded 400/600/800, Schibsted Grotesk 400/500/700
+ italic 400, JetBrains Mono 400/500/600. Self-host for production; the mocks
load them from the CDN.

## Assets
None. Every graphic is an inline `<svg>` of lines and circles, or a CSS box.
There are no images, no icon set, and no illustration — deliberately: the cosmos
here is implied by depth-graded indigo, never illustrated. Do not add a
starfield, planets, or space clip-art. No emoji anywhere in the UI.

## Accessibility
- Text contrast ≥ 4.5:1 against its surface; `--starlight` and `--dust` both
  pass on `--void` and `--nebula`. Tier colors are used for text only at their
  full value on dark surfaces (badges), never as small text on a tinted fill.
- Tier is never the sole signal: badges pair the dot with a text label, and
  every tier dot sits next to a title.
- Semantic HTML first: `<main>`, `<aside>`, `<nav>` for the ribbon, `<ol>` for
  trail stops, `role="search"` on the search field, `role="tablist"` on the
  depth toggle with `aria-selected`.
- Focus visible in `--thread`, 2px, offset 2.
- The search overlay traps focus and closes on ESC.
- All motion behind `prefers-reduced-motion: no-preference`.

## Anti-patterns — reject on sight
Pure black backgrounds · a single acid-green accent · starfields or planets ·
decorative gradients or decorative color · more than one glow per screen ·
emoji · icon soup · center-aligned body copy · gold or teal used as a button,
link, or emphasis · numbering anything but trail stops · any color that
communicates nothing.

## Files
- `designs/Surface Board.dc.html` — all routes and states. Section `2a` is the
  frontier concept page; section `1a` holds frames A (landing), B (concept page,
  first-paint and hydrated side by side), C (trail), D (search + states),
  E (OG cards). Each frame carries a mono `SCAFFOLD ·` note naming its
  endpoints and hydration boundary. Requires `designs/support.js` beside it.
- `designs/support.js` — runtime for the above. Not part of the design.
- `designs/original-bootstrap-mockups.html` — earlier three-screen exploration.
- `API.md` — endpoint contracts and response shapes.
- `DATA-MODEL.md` — the concept, edge, trail, request, and review records.
- `COMPONENTS.md` — the component inventory to build, with props.
- `tokens.css` / `tokens.json` — the token set, ready to drop in.

---

## Repo notes

Everything above is the handoff as exported, unedited. Two changes were made to
the *bundle* when it landed in this repo; this section is the only addition.

1. **`designs/Surface Board.dc.html` → `designs/surface-board.dc.html`.** The
   space in the original filename needs escaping on the command line and
   percent-encoding in every markdown link. Contents are unchanged, and it still
   loads `./support.js` from beside itself.
2. **`designs/original-bootstrap-mockups.html` was not committed here.** It is
   byte-identical (md5 `5fe20dd0d43ef5520879cd164369ab51`) to
   [`../mockups.html`](../mockups.html), which has been in the repo since the
   bootstrap commit. Keeping both would be two copies free to drift apart.
   The earlier three-screen exploration is preserved — one path up.
