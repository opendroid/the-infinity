# 0022 — An edge-review pass that never ran

- **Status:** accepted
- **Date:** 2026-09-10
- **Supersedes:** the third clause of [ADR-0002](0002-content-model.md) §4

## Context

`edges[].reviewed` is authored per edge, defaulting to `false`. Measured across the whole
corpus:

```
edge reviewed   {False: 1154, True: 3}
by type         adjacent 607 false / 1 true
                requires 547 false / 2 true
tiers           {verified: 482}
```

All three `true` edges are one cluster:

```
feed-forward-network -adjacent-> conditional-computation
mixture-of-experts   -requires-> feed-forward-network
mixture-of-experts   -requires-> conditional-computation
```

`MiniMap.tsx` draws an unreviewed link dashed at opacity `.35`, a reviewed one solid at
`.5`, and renders a legend when any link is unreviewed. At 1,154 of 1,157 that legend
ships on effectively every concept page, and every line under it is dashed.

**Since [#346](https://github.com/opendroid/the-infinity/issues/346) it reads worse than
noise.** Every node in the corpus is verified, so a concept page says *"Reviewed by
opendroid · 2026-09-07"* directly above a mini-map asserting that none of that node's
relationships have been checked. A reader who trusts both is told the author read the
concept and declined to confirm a single thing it connects to.

### The design was deliberate, which is the whole difficulty

ADR-0002 §4 chose this on purpose, and its reasoning was sound:

> `edges[].reviewed` **is** authored, per edge, defaulting to `false`. It is tempting to
> derive it from the target node's tier … but that would erase the case the dashed
> mini-map line exists for: an unchecked claim *between two verified nodes*, where both
> concepts are solid and nobody confirmed the relationship. That is an independent human
> judgment, so it is stored.

The field does not encode the wrong thing. **The independent judgment it stores has never
been part of any workflow.** Seeding writes `false`; verification adds a `review` block to
the node and never touches its edges. So the field faithfully records one fact about the
project — *no separate edge-review pass has ever run* — published 1,157 times as if it
were a fact about each edge.

A channel that resolves to one value everywhere encodes nothing. This one also costs a
legend's worth of a reader's attention, teaching a distinction the corpus makes three
times.

## Decision

**Drop `edges[].reviewed`, and drop the dash and its legend with it.**

Removed from `node.schema.json`, `api/internal/publish`, `web/src/lib/graph.ts`,
`MiniMap.tsx`, `docs/openapi.yaml`, and the three `true` values in content. Mini-map links
render one way.

The rest of ADR-0002 §4 stands: `unlocks` stays derived from `requires`, and `adjacent`
stays symmetrized. Only the third clause is superseded.

## Alternatives rejected

**Derive it from the target node's tier.** Self-maintaining, and consistent with
ADR-0002's own derived-not-stored principle. Rejected for two reasons, and the first is
fatal: with all 482 nodes verified every line becomes *solid*, which asserts that every
relationship in the graph has been confirmed — a stronger claim than the project can
make, and manufactured by arithmetic rather than by anybody looking. Swapping a channel
that says "nothing was checked" for one that says "everything was" is not an improvement
when neither is true. Second, it makes the dash a second encoding of the tier that node
colour already carries, which CLAUDE.md §5 rule 1 assigns to colour alone.

**Keep the field and actually run edge review.** The honest version of the original
design, and it stays available. 1,157 edges cannot be batch-approved without becoming the
rubber stamp the tier system exists to avoid, so it would have to ride along with node
verification — and there is none left to ride: all 482 nodes are already verified. That
makes this a fresh 1,157-item pass with no carrier, which is a project, not a fix.

**Keep everything and hide the legend below a threshold.** Rejected on sight, and recorded
so nobody proposes it later: it makes the display honest by making it quieter, which is
worse than either fixing the data or dropping the channel.

## Consequences

The distinction ADR-0002 §4 wanted — an unchecked claim between two verified nodes — is no
longer representable. That is a real loss and it is accepted knowingly: it was never
representable *in practice*, only in the schema, and a schema field nothing fills is a
claim about intent rather than about the graph.

**The field can come back, and this ADR is not an argument against it.** What it is an
argument against is shipping the storage before the workflow. If an edge-review pass is
ever built — a step in verification that reads a node's outgoing edges and records the
judgment — then re-adding `reviewed` is a small change, and it will arrive with something
that fills it.

This mirrors [ADR-0015](0015-an-empty-frontier-is-a-state.md) in subject and departs from
it in conclusion, which is worth being explicit about. There, the frontier pulse was kept
with nothing to render on, because *an empty frontier is a state* and the code is waiting
on the next seeded node. The difference is what each renders while empty: the pulse
renders **nothing**, silently and correctly, and costs a reader nothing. The dash renders
on **every edge of every page**, under a legend explaining it. A channel that is silent
when it has nothing to say can wait; one that shouts a single value cannot.
