# 0006 — Per-depth divergence in content is an optional override, not a required set

- **Status:** accepted
- **Date:** 2026-08-02

## Context

[ADR-0005](0005-depth-coupled-viz.md) let a viz primitive render differently per depth.
`router-dispatch` now draws a token × expert grid at Intuition and per-expert utilisation
bars at Engineer.

That immediately broke the caption. `mixture-of-experts` authored one:

> **Solid cells** are each token's first-choice expert, **faint cells** its second.
> **Outlined experts** stay asleep for this batch. Drag top-k to watch compute rise as more
> experts wake.

At Engineer depth there are no cells. Two of those three sentences name marks that are not
on screen — the same defect as the `devices` param in #48 and the dashed-cell legend in
#92, and the worst version of it, because a reader cannot tell a stale sentence from a
broken picture.

The design handoff already assumed this would be solved: `surface-board.dc.html` draws the
*same primitive* with two different captions, the Engineer one reading *"Same primitive,
engineer depth: per-expert utilisation over a batch."* So writing one depth-neutral caption
per node was never the intended design, only the cheapest way out.

The question this ADR settles is not "should captions vary by depth" — the handoff answers
that — but **how per-depth divergence is modelled in authored content**, because the same
answer will apply to whatever diverges next.

## Decision

**A per-depth variant is an optional override on the default, not a required entry per
depth.**

Concretely, `viz.caption` stays a required string and `viz.caption_engineer` is added as an
optional sibling that replaces it at Engineer depth. Absent means the one caption serves
every depth. Three of the five committed nodes author nothing new.

Two properties of that shape are the reasons for it:

**It taxes only the nodes with the problem.** Two nodes render differently per depth; the
other three draw one picture. A required set would have made every author write three
captions to solve a problem two nodes have — and authoring burden is the tax that decides
whether the graph grows.

**It models the mechanism that exists, not one that sounds symmetric.** ADR-0005
distinguishes exactly two rendering variants, `default` and `engineer`. `math` shares the
default. A three-key caption object would have implied three renderings and invited authors
to write a `math` caption that nothing would ever show differently.

The rule the field encodes, which outlives the field: **no caption may describe a mark
absent from the rendering it appears under.** Marks the *component* owns — a dashed cell, a
bar — are explained by the primitive's own depth-scoped legend. The caption carries the
concept.

## Alternatives rejected

**`caption: { intuition, engineer, math }`, mirroring `bodies`.** The most symmetric option
and the first one considered, since `bodies` already works exactly this way. Rejected on
cost and on honesty: it charges every future node three captions for a divergence most
primitives do not have, and it claims three renderings when there are two. `bodies` earns
its three keys because all three genuinely differ — that is the entire depth toggle. A
caption does not.

**Keep one caption and write it to be true at every depth.** Genuinely tempting, and it
needs no schema change, no Go change, no OpenAPI change. Rejected because the handoff draws
two different captions for this primitive, so a single caption is not a neutral simplification
— it ships less than was designed. It also cannot be enforced: no validator can tell whether
a sentence describes a mark that is on screen, so the rule would rest entirely on a reviewer
noticing, forever.

**Per-depth captions rendered by the component from a template.** Rejected quickly: it moves
authored voice into code. The caption is the one place a concept gets a sentence written for
it, and generating it would make every island sound the same.

## Consequences

- `caption_engineer` is stored in Firestore for every concept, including the ones that leave
  it empty — its `firestore` tag carries no `omitempty`. The stored document shape stays
  uniform, and the "absent means use the default" distinction is made at the JSON edge where
  clients read it. The field-name round-trip test asserts this rather than assuming it.
- The schema rejects an **empty** `caption_engineer`, because a blank override would render
  an empty caption at Engineer depth — the failure this field exists to prevent, arriving
  through a different door.
- `content/derived.golden.json` is unaffected: the fixture carries ids, tiers, and edges,
  not `viz`. The Go and TypeScript derivations never see a caption.
- If a second thing ever needs to diverge by depth — a param, a control range — this is the
  shape to copy: required default, optional `_engineer` override, nothing required of a node
  that does not diverge.
