# 0005 — The depth toggle publishes depth; the viz reads it

- **Status:** accepted
- **Date:** 2026-08-02

## Context

The design handoff specifies that a viz primitive renders differently **per depth**, not
only per concept. For `router-dispatch`:

> a `78px repeat(8,1fr)` grid of 20px cells … **The engineer depth re-parameterizes the
> same primitive as horizontal utilisation bars** (9px tall, radius 999, `--nebula` track).

Both renderings are drawn at implementation fidelity in `surface-board.dc.html`. Only the
grid shipped in [#48](https://github.com/opendroid/the-infinity/issues/48).

The obstacle is not drawing the second rendering — it is that the two components do not
know about each other. `DepthToggle` holds `depth` in its own island's `useState`;
`VizIsland` is a separate component further down the page. Nothing connects them, and
CLAUDE.md §2 forbids the reflex fix:

> Do not reach for a client-side router, a global store, or SSR; if you think you need
> one, open an ADR first.

This is that ADR. It is worth deciding once rather than four times: the same coupling is
needed by `update-spectrum`, `attention-heatmap`, and `loss-curve`, so whatever is chosen
here is a mechanism all four primitives inherit.

## Decision

**The depth toggle writes its state to the DOM as a `data-depth` attribute on a scope
element. The viz renders every depth variant and CSS decides which one is visible.**

Concretely:

- The concept page wraps its content in `<div data-depth-scope>`.
- `DepthToggle` walks up to `closest('[data-depth-scope]')` and sets `data-depth` on it
  whenever the reader changes depth. It keeps owning its own state; it merely publishes it.
- A primitive marks its per-depth renderings `depth-default` and `depth-engineer`.
- Three rules in `global.css` swap them. No component reads the attribute in JavaScript.

```css
[data-depth-scope] .depth-engineer { display: none; }
[data-depth-scope][data-depth='engineer'] .depth-engineer { display: block; }
[data-depth-scope][data-depth='engineer'] .depth-default { display: none; }
```

Three properties fall out of this shape, and they are the reasons for it:

**It degrades correctly with no JavaScript.** The attribute is absent, the default rules
apply, and the reader sees the intuition body next to the intuition rendering. There is no
state to be wrong about, because the fallback *is* the unstyled case.

**The viz keeps its own control across a depth change.** Both renderings come from one
mounted component, so the `top_k` a reader dragged is still dragged when they switch to
Engineer. Any message-passing design would have had to preserve that deliberately; here it
is structural.

**Depth becomes readable by anything, without a subscription.** The trail records the
depth a reader landed on, and a future OG-image or analytics hook needs the same fact.
A DOM attribute is already the shared surface; a JS store would have been a second one.

### The cost, stated plainly

Every depth variant is in the DOM whether or not it is visible. For `router-dispatch`
that is 48 cells plus 8 bar rows — nothing. It is not free forever: a primitive with three
genuinely heavy renderings would be paying for all three on every page. The rule that
keeps this honest is that a variant must be cheap to render, and a primitive that cannot
meet it should render one depth and say so, rather than reaching for lazy mounting.

`display: none` also removes the hidden variant from the accessibility tree, which is
what we want — but it means each variant carries its own screen-reader summary, and a
primitive that puts the summary outside its variants would leak the wrong one.

## Alternatives rejected

**Merge the two islands.** One island owning the depth toggle, the body copy, and the viz.
Simplest possible state story, and rejected the hardest: the body copy is pre-rendered
prose that currently costs nothing to hydrate, and folding it into a React island to solve
a problem in a sibling component would put the most-read text on the page behind
JavaScript. Static-first (ADR-0003) is the product's first principle, not a default to
trade away for convenience.

**A shared store — nanostores or similar.** The mechanism Astro's own docs recommend for
exactly this, and a genuinely good library. Rejected because it is a new dependency for a
problem the platform already solves, and because CLAUDE.md names "a global store" as the
thing to open an ADR *before* adopting. The honest version of that sentence is: prove the
DOM cannot do it first. The DOM can.

**A `CustomEvent` on a shared ancestor.** No dependency, no store — but the coupling
becomes invisible. Nothing in the type system or the markup says the two components are
related, and the failure mode is silence: rename the event and the viz simply stops
following, with no error anywhere. The attribute is at least inspectable in devtools and
greppable in source.

**Do nothing — the viz shows one depth.** Defensible, and the reading of "ship the
smallest island that does the job" that would have saved this whole ADR. Rejected because
the depth toggle's promise is *the same concept at three depths*, and a viz that ignores
the toggle quietly narrows that promise to "the same prose at three depths." The handoff
drew the second rendering; not shipping it is a decision to ship less than was designed.

## Consequences

- `data-depth` on the scope element is now a small public contract inside `/web`. Changing
  its name is a find-and-replace across `global.css`, `DepthToggle`, and every primitive.
- Primitives opt in by class name. A primitive that renders one thing at every depth writes
  no classes at all and keeps working — the mechanism costs nothing to ignore.
- `math` depth shows the default rendering. The handoff specifies a distinct rendering only
  for `engineer`; if a primitive ever needs a third, it adds `depth-math` and two more CSS
  rules, with no change to the mechanism.
