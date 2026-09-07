# 0015 — An empty frontier is a state the figure has to show

- **Status:** accepted
- **Date:** 2026-09-07

## Context

[ADR-0002](0002-content-as-code-and-trust-tiers.md) makes tier derived: a concept is
`verified` iff it carries a `review` block, `frontier` otherwise. The landing page's
lemniscate spends that distinction — a gold left lobe of reviewed core, a teal right lobe
of new growth, one continuous thread through both. It is the product's single visual idea.

Neither document says what the figure shows when nothing is awaiting review, and two
checks quietly decided it could not happen:

- `validate:content` requires the right lobe's three beads to name frontier concepts
- `nodes.test.ts` asserts both tiers are present in the corpus

So verifying the last frontier batch broke the build. That was survivable while there was
an obvious next domain to seed — [#268](https://github.com/opendroid/the-infinity/issues/268)
verified structured prediction and seeded test-time compute in the same PR to stay green.
It stopped being survivable when the seeding lens ran out.

**The constraint began deciding what got written.** Batches were seeded partly because a
verification needed somewhere to put the lobe, which inverts the order those decisions
should happen in. Three vocabulary sweeps yielded eight concepts, then eight, then
**one** ([#312](https://github.com/opendroid/the-infinity/issues/312)) — five of the last
six candidates were dropped as duplicates of nodes that already existed. There was no
longer a supply of honest new concepts to hold the lobe open.

And it became visible. Nineteen days after the last content merge, the landing page read
**"0 grew on the frontier this week"** in the teal reserved for growth — a page whose
argument is reviewed core flowing into new growth, announcing none, held there by a rule
meant to guarantee it.

## Decision

**An empty frontier is a legitimate state, and the lemniscate shows it: a populated left
lobe and a bare right one.** Both checks stop requiring a frontier node to exist.

The figure was built for this without anyone intending it. `Thread.astro` takes
`secondary` with a default of `[]` and maps over whatever it gets, so the empty case
renders the stroke intact, the violet crossing bead at centre, three gold beads on the
left, and nothing on the right. It was measured before it was decided — built at zero
frontier and read out of the markup, not reasoned about.

Two consequences worth naming rather than discovering later:

**The site loses its only motion.** The ~3.2s frontier pulse ([§5](../../CLAUDE.md))
lives on teal beads and their badge dots. At zero frontier nothing animates anywhere.
That is correct — the pulse means *new growth is here* — but it means the empty state is
noticeably stiller, and that is the state, not a bug to fix later.

**The count sentence changes rather than reading zero.** `0 grew on the frontier this
week` is true and says nothing worth saying. At zero it becomes **"every concept
reviewed"**, and the teal goes with the growth: colour that means growth should not be
spent on its absence. Non-zero is unchanged.

## Alternatives

**Show recently-verified concepts on the teal lobe when nothing is frontier.** Keeps three
beads and the motion, and costs the rule CLAUDE.md §5 lists *first* of three — node colour
always encodes trust tier. A teal bead would mean *frontier* everywhere in the product and
*verified, recently* on the one page a stranger meets first. Rejected: the figure's
honesty is the thing it is for.

**Accept the constraint and record it as deliberate**, on the grounds that a graph claiming
to be infinitely explorable should always have something unreviewed in it. Defensible as
an argument and false as a mechanism: the corpus cannot currently produce three honest new
concepts on demand, so the rule would not guarantee growth, it would guarantee three
permanently unverified nodes rotating through the lobe. Rejected for asserting something
the corpus cannot make true.

## Consequences

The coupling is gone: a verification no longer needs a seed beside it, and content
decisions stop being shaped by what the layout requires. `validate:content` still rejects a
bead whose tier belongs to the other lobe, a `t` outside 0–1, a duplicate, and an id that
names nothing — the lobes still mean what they meant, there is just no floor on how many
beads the right one holds.

The empty and one-bead states are tested rather than assumed, which is the acceptance
criterion [#283](https://github.com/opendroid/the-infinity/issues/283) asked for. Three
beads per lobe stays the intent when there is material for it; the layout file is still
where someone decides which concepts earn a place.
