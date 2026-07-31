# Component inventory

Small, unambitious set. Each takes tier or type as data and never decides color
on its own.

| Component | Props | Notes |
| --- | --- | --- |
| `Thread` | `variant: lemniscate \| ribbon \| trail \| broken`, `nodes[]` | the signature. One path + tier-filled beads. Every surface that shows the thread uses this. |
| `TierBadge` | `tier` | pill, 1px tier border at 45%, 7px dot, mono uppercase label. Frontier dot pulses. |
| `TierDot` | `tier`, `size = 7` | the atom. Used in edge rows, trail stops, search results, mini-map. |
| `Eyebrow` | `children` | mono 11px uppercase .16–.18em `--dust`. Above every major heading. |
| `EdgeGroup` | `type`, `edges[]` | heading with violet arrow glyph + rows; renders the dashed empty state when `edges` is empty. |
| `EdgeRow` | `id`, `title`, `tier` | bordered row, tier dot right, border → violet on hover. |
| `Chip` | `href`, `children` | pill, `--nebula-2`, border → violet on hover. |
| `DepthToggle` | `value`, `onChange` | three segments; active = solid violet, void text. Never navigates. |
| `VizIsland` | `primitive`, `params`, `caption` | frame + mono header/params row + caption. Dispatches to a primitive by name. |
| `VizRouterDispatch` | `experts`, `topK`, `tokens[]`, `loads[]` | grid or bar form depending on depth. |
| `VizUpdateSpectrum` | `nsSteps`, `sigma[]` | two bar groups, raw vs orthogonalized. |
| `MiniMap` | `state`, `data` | skeleton / SVG / hidden. Server-supplied coordinates. |
| `TrailRibbon` | `stops[]`, `currentId` | beads + wires; collapses to dots on mobile. Owns the Share action. |
| `TrailStops` | `stops[]` | the `<ol>`. The only numbered list in the product. |
| `SearchOverlay` | `open`, `query`, `results`, `selectedIndex` | scrim + input + rows + match count. Focus trap, ESC to close. |
| `Topbar` | `trailCount` | mini wordmark, search field, trail count. |
| `ProvenanceBlock` | `drafted_at`, `sources[]` | frontier only. Two violet-owned actions. |
| `StatusStrip` | `state` | API-offline banner. Grey dot, not teal. |
| `OgCard` | `variant: concept \| trail`, data | 1200×630, no glow. |

Two components must not exist, on purpose: a nav bar (the landing page has no
CTAs beyond search, and concept pages have only the topbar), and an icon set
(there are no icons — arrows are text glyphs `◂ ▸ ↔`, and everything else is a
line, a circle, or a box).
