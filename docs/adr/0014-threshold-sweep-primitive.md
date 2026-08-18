# 0014 — A sixth shape: a cut through two overlapping populations

- **Status:** accepted
- **Date:** 2026-08-18

## Context

[#256](https://github.com/opendroid/the-infinity/issues/256) recorded that 200 of the
corpus's 305 figures were the same `budget-split` bar, and argued the cause was the
primitive set rather than the assignments. Three batches since then have added evidence
rather than settling it:

| batch | budget-split | everything else |
|---|---:|---:|
| uncertainty (#244) | 6 | 1 `update-spectrum`, 1 `loss-curve` |
| training reliability (#245) | 7 | 1 `update-spectrum` |
| hardware and numerics (#247) | 8 | — |

None of those assignments is wrong. The standing rule — reaffirmed after #202, #208, #211,
#213 and #222, where a primitive picked for its *shape* rather than its arithmetic produced
a figure that lied — is that the primitive follows the arithmetic, and reassigning for
variety is itself the recorded defect. So the ratio is not going to improve by authoring
more carefully. It improves when the set can draw a shape it currently cannot.

**The shape asked for most often is a threshold over two overlapping populations.** Five
nodes wanted it and took a proportion bar instead:

- `selective-prediction` — abstain below a cutoff; the risk–coverage curve is the deliverable
- `out-of-distribution-detection` — a score threshold, and the near-OOD cases that sit under it
- `conformal-prediction` — coverage bought with set size
- `silent-failure`, `canary-rollout` (#248, pending) — detecting a regression against noise

Three of those had to be **re-framed during authoring** because `budget-split` holds its
remainder fixed while a threshold moves over a *fixed population*, where the remainder must
shrink as the part grows. Those re-framings are honest, and each ended up saying something
true — but each also said something narrower than the concept.

## Decision

**Add `threshold-sweep` to the primitive enum: two overlapping populations and one cut
through them.**

The contract, documented beside the primitive:

- Two populations on one axis: one that should be flagged, one that should not.
  `separation` is the distance between them in spreads — how good the detector is.
  `base_rate` is the share that should be flagged. `threshold` is where the cut falls.
- **Raising the threshold flags fewer of both populations.** True positives and false
  positives fall together; misses rise. A concept where raising the control catches *more*
  is not describing this shape, the same way a concept that concentrates is not describing
  `update-spectrum`.
- Four counts, not one number, and a precision derived from the counts as printed.

Why this rather than the other candidate #256 named. A shrinking confidence interval is the
second-most-wanted shape and has fewer users; a threshold has five waiting and is what the
next two batches keep reaching for. One primitive at a time, and this is the one behind more
demand.

### What it can say that a proportion bar cannot

`budget-split` has one number, so it can show that a share grows. It cannot show that moving
a control makes one kind of error worse *as* it makes the other better, because that needs
two quantities moving in opposite directions against a fixed total. That trade is the whole
content of a threshold, and stating it in a caption while the picture shows a single
growing bar is the caption-versus-picture gap #49 was opened to fix.

It also carries the base rate, which nothing in the corpus currently draws. A detector with
a three-spread separation reaches 90%+ precision on a balanced problem and under 20% when
the thing it is looking for is one in two hundred — same detector, same threshold. That is
the single most load-bearing fact about deployed detection and the corpus had no way to
show it.

## Alternatives rejected

**Keep authoring onto `budget-split` and re-frame each caption.** This is what the last
three batches did, and each re-framing is defensible on its own. The cost is cumulative
rather than local: a reader walking six consecutive pages meets the same two-segment bar
with different labels, which turns the figure back into a decoration to scroll past. The
figure is meant to be the thing that makes a concept page an instrument.

**Reassign existing nodes to spread the load.** Rejected on the rule above, and #211 is on
record as having been moved for variety and being wrong for it.

**Generalise `budget-split` with a mode flag.** The same objection ADR-0007 raised against
teaching `update-spectrum` a direction flag: `viz.params` are numbers only so that a mode
switch reads as a smell, and a primitive with two behaviours is two primitives sharing a
name.

**Reuse `router-dispatch`, which already has a capacity cutoff.** Its component renders MoE
vocabulary directly — "which expert each token woke", a literal `TOKENS` array of word
strings — so any non-MoE node on it shows a reader a grid of words and calls it something
else. That is recorded on #256: the primitive is concept-specific *as rendered*, and the
lesson taken here is that a reusable primitive must stay free of one concept's nouns. This
one labels its four cells `caught` / `false alarms` / `missed` / `precision`, which are the
names of the arithmetic rather than of any concept.

## Consequences

- **The primitive is not seeded from the concept id**, unlike `update-spectrum` and
  `router-dispatch`. Those jitter so that the three or four nodes sharing them do not draw
  identical staircases. Here `separation` already differs per node, for a reason the reader
  can act on, so noise on top would make the density lumpy without making it distinct — and
  a lumpy density invites reading structure that is not there.
- **The axis moves with `separation`**, pinned to `[-3, separation + 3]`. A fixed axis would
  push the positive population off the right edge exactly as a node authored a stronger
  detector, which is the setting where the figure has most to say. The cost is that two
  nodes with different separations are not directly comparable by eye; the counts under the
  figure are what compare.
- **`viz-controls.test.ts` gains a sixth branch.** Its whole argument is that it calls the
  primitives rather than listing their parameter names, so a new primitive that is not wired
  in there is silently unchecked. The `default:` case throws for exactly this reason.
- The `#204` visible-travel assertion covers `budget-split` and `update-spectrum` only,
  because only those have a single scalar meaning "how far along is the picture".
  `threshold-sweep` has four counts and no such scalar, so it joins the three named as
  uncovered rather than being quietly skipped.
- The enum is now six names, all six implemented. The advice in `content/schema/README.md`
  that it should not grow ahead of demand stands — this is growth well behind it.
