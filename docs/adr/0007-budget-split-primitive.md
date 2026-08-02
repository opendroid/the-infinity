# 0007 — A fourth shape: one whole divided in two

- **Status:** accepted
- **Date:** 2026-08-02

## Context

[#97](https://github.com/opendroid/the-infinity/issues/97) recorded a node whose idea no
primitive could draw. `feed-forward-network` pointed at `update-spectrum`, whose contract is
*raising the control flattens the right-hand group*. Its concept runs the other way: as
`d_ff` grows, the feed-forward block comes to **own** the parameter budget. #49 shipped a
caption true of the picture as an interim, which stopped the page contradicting itself but
left the viz saying something narrower than the prose.

The engineer body makes a specific, checkable claim:

> d_ff is conventionally 4·d_model, which puts roughly **two thirds** of a transformer's
> parameters in a block that never looks sideways.

That number is not decoration. Attention holds about `4·d_model²` parameters (Q, K, V, O)
and the feed-forward block about `2·d_model·d_ff`, so the block's share is

```
d_ff / (d_ff + 2·d_model)
```

which at `d_ff = 4·d_model` is exactly `4/6`. A viz can *demonstrate* that sentence rather
than gesture near it — the reader drags `d_ff` to `4×` and reads two thirds off the bar.

The standing advice in `content/schema/README.md` is that the enum should not grow ahead of
demand, and one node is thin demand. This ADR records why it grows anyway.

## Decision

**Add `budget-split` to the primitive enum: one whole divided in two, with the control
moving the split.**

The contract, documented beside the primitive:

- The control names the **part**. A `share_rest` param names the fixed remainder, in the
  same units.
- Share is `part / (part + share_rest)` — a saturating proportion, which is the actual shape
  of every part-of-a-whole where the rest is held fixed.
- **Raising the control raises the part's share.** That direction is the contract, the same
  way flattening is `update-spectrum`'s.

For `feed-forward-network`, `share_rest` is `2·d_model` — the attention block's parameter
count in units of `d_model`. At the authored `d_ff` of 2048 against `d_model` 512 the bar
reads 67%, and the engineer body's "roughly two thirds" is on screen.

Two reasons this earns a slot rather than waiting for a second node:

**The alternative was a page that is quietly less true than the prose beside it.** The
interim caption is honest about the picture, but a reader who reads the engineer body and
then looks at the viz finds the viz talking about something else. That is a milder version
of the defect #49 was opened to fix, and "milder" is not the bar.

**Part-of-a-whole is not a one-node shape.** Compute against memory, dense against sparse,
parameters against activations, prefill against decode — the graph is going to keep meeting
quantities that trade against a fixed remainder. `update-spectrum` looked concept-specific
until three nodes pointed at it.

## Alternatives rejected

**Keep the interim caption (option 3 on #97).** Cheapest, and it fails the issue's own
acceptance criterion — that the caption and viz agree *and* both match the engineer body's
claim. The caption and viz agree; neither matches the prose. Accepting that would have meant
weakening a criterion because meeting it was work.

**Re-point the node at `router-dispatch`.** Its grid can be read as "where the parameters
live", but it is built around routing tokens to experts. Borrowing it here would put the
caption-versus-picture problem straight back, one primitive over.

**Teach `update-spectrum` a direction flag.** Rejected on a rule that already exists:
`viz.params` are numbers only precisely so that a mode switch reads as a smell, and a
primitive with two directions is two primitives wearing one name. The closed enum exists to
stop exactly that.

**Compute the share inside the component from `d_model` and `d_ff`.** It would need no new
param and would be exactly right — for this one node. It also puts transformer parameter
counting inside a generic primitive, which is the definition of a shape that only draws one
idea. `share_rest` keeps the arithmetic in the content, where the concept lives.

## Consequences

- `share_rest` is a derived number an author computes by hand — `2·d_model` here. Nothing
  checks that it stays consistent if `d_model` changes, because no validator can know the
  relationship. It is documented with its derivation in `content/schema/README.md`, and it
  is the cost of keeping concept arithmetic out of the component.
- **The bar labels its two sides from the control's name and the word "rest"**, because
  `viz.params` are numbers and a primitive cannot read "feed-forward" out of a float. So the
  bar says `D-FF · 67%` where the caption says "the feed-forward layer, against the attention
  it sits beside". Nothing is wrong on screen, but the reader bridges it themselves. Naming
  the sides properly would need a `viz.labels` object of strings — a fourth schema change in
  one day, for a gap the caption already closes. Worth revisiting if a second node using this
  primitive finds the generic labels genuinely confusing rather than merely plain.
- The enum is now four implemented primitives out of five names; `attention-heatmap` and
  `loss-curve` remain unbuilt and still fall through to the placeholder.
- The advice that the enum should not grow ahead of demand stands. This is growth *behind*
  demand — a node that already exists and could not be drawn.
