# 0024 — A domain is a route, and the index is a directory of them

- **Status:** proposed
- **Date:** 2026-09-17
- **Refines:** [ADR-0003](0003-static-first-serving.md)

## Context

`/concepts` was built in [#107](https://github.com/opendroid/the-infinity/issues/107) for a
graph of 57 concepts in 6 domains, and it was right for that graph. Its source comment still
describes it:

> A jump list rather than a table of contents nobody reads: **with six domains it fits on
> one line**, and **at 300 nodes** it is the only thing that keeps this page navigable.

It now renders 47 domain chips and 482 rows. Measured from the build at `3b0ac74`:

```
/                                6,475 B raw    2,299 B gzipped
/c/attention  (heaviest concept)  40,114 B raw    8,297 B gzipped
/concepts                       438,968 B raw   37,979 B gzipped
```

**16× the landing page and 4.6× the heaviest concept page.** 42 KB of the raw total is
blurb prose — 481 derived first-sentences, of which a reader reads perhaps ten. Every
visitor downloads the whole corpus to find one concept.

`perf-budget.json` already identified this and deliberately declined to police it:

> **/concepts IS THE ONE THAT MOVES**: 37,446 B gzipped at 482 concepts, against 8,363 B
> for the heaviest concept page and 2,144 B for the landing page. It lists every node, so it
> grows with the graph.

> HTML IS RECORDED, NOT ENFORCED. It grows with the graph — /concepts lists every node — and
> **failing a build for publishing content would be the budget fighting the product.**

That reasoning is correct and this ADR does not overturn it. A limit on this route would turn
publishing content into a CI failure. The conclusion it points to is that the page's *shape*
is what needs to change, not its ceiling.

**The taxonomy is already two levels, and the page flattens it.** `directory()` groups by
`domain[0]` then `domain[1]`, and every concept page renders that path as its eyebrow. The
distribution, from `content/nodes/**`:

| | |
|---|---|
| primary domains (`domain[0]`) | **47** |
| largest | `Foundations`, 37 |
| **median** | **8** — 35 of the 47 hold exactly 8 |

A graph grown to a deliberate, consistent width is being served as one flat list.

**What prompted this** was a proposal to add a second index at `/contents` carrying three
links per concept, one per depth. That would have put 1,446 anchors on the heaviest page in
the site, and it contradicts a decision already written into `DepthToggle` — which uses
`replaceState` rather than `pushState` because *"changing depth is a reading control, not a
navigation."* The proposal is declined; the question it exposed is this one. The separate,
real gap it found — that depth is never offered before a reader is inside a concept — is
[#508](https://github.com/opendroid/the-infinity/issues/508) and is independent of this.

## Decision

**`/concepts` becomes a directory of the 47 domains. `/concepts/<domain>` is that domain's
concepts.**

- The directory lists each domain with its count, its `domain[1]` section labels, and its
  link. No concept rows, no blurbs.
- A domain page renders the `Group → Section → Entry` structure `directory()` already
  produces: the existing sub-headings, rows, blurbs, tier badges. That is a re-hosting of
  code that exists, not a new derivation.
- Routes are **derived from `domain[0]`**, never a hand-kept list that can disagree with the
  nodes — the same rule `directory()` already follows.
- **Neither route gets an island.** #107 was right that a list of links is the one thing the
  platform has always been good at.
- **`/concepts` keeps its URL.** It is in the sitemap, linked from the Topbar, and
  `make analytics` records readers arriving there. It changes what it shows; it does not 404.

## Consequences

**What this makes easy.** A reader who does not know a name — #107's stated case — picks a
territory out of 47 instead of a name out of 482. Each domain becomes a page about one
subject rather than one page about everything, which is what a search engine can rank and
what a person can send to someone else. Growth stops concentrating: a 483rd concept adds a
row to one small page instead of weight to the only page everybody loads.

**What this makes hard, and what we accept.**

- **A find-in-page across the whole corpus stops working.** Anyone using `/concepts` as a
  `Ctrl-F` surface over all 482 titles loses that, and it is a genuine loss to a power
  reader. `/search` is one keystroke away from every page and answers the same need better,
  but it is not the same gesture and this ADR does not pretend it is.
- **Two clicks instead of one** for a reader who already knows the name. Mitigated by
  `/search`, and by the fact that such a reader was already scrolling 482 rows.
- **Most domain pages will be thin — 8 links.** This is the strongest argument against, and
  it is not fully answered. A page of eight links and nothing else is a weak page, and thin
  pages are not automatically an SEO gain; 47 of them can be a loss. What makes them worth a
  route is the `domain[1]` sections, the blurbs, the tier badges and the thread already
  carrying real content into them. **If they turn out thin in practice, that is the signal
  to reverse this**, not a detail to paper over.
- **47 more routes** to build, ~531 sitemap entries instead of 484. Negligible against 482
  concept pages already pre-rendered.

**The claimed saving is a target, not a measurement.** No number here says what the new
`/concepts` will weigh, because nothing has been built. `npm run perf -- --update` writes
the real figures to `html_gzip_measured` when it has been, and `--update` does not move any
`js_gzip` on its own ([#327](https://github.com/opendroid/the-infinity/issues/327)). An order
of magnitude is the expectation; the recorded number is what settles it.

**What would reverse this.** Domain pages that readers land on and leave — `make analytics`
can see arrivals per route. Or a corpus that stops growing, which would make the flat page
fine again.

## Alternatives considered

**Leave it.** The page works today. Rejected on trajectory rather than on its current state:
it grows with the graph by construction, it is already 16× the landing page, and the project
intends the graph to keep growing.

**Cap `html_gzip` on `/concepts`.** Rejected by `perf-budget.json`'s own words — it would be
the budget fighting the product, and it turns publishing a concept into a red build.

**Drop the blurbs.** Saves 42 KB raw, though prose gzips well so the shipped saving is much
smaller. Treats the symptom: 482 rows and 47 chips remain, and the blurb is the part of the
row that makes it scannable. It would make the page lighter and worse.

**Paginate or virtualize.** Rejected. Both need an island on a page that has none, and
ADR-0023 measured that floor at 57 KB of React — far more than the HTML it would save.

**An A–Z index instead of by-domain.** Rejected for the reason `directory()` already gives:
a second organising scheme for the same graph, free to disagree with the eyebrow readers see
on every concept page.

**Per-depth links on the index.** The proposal that prompted this ADR. Rejected above: 1,446
anchors on the heaviest page, and it contradicts the reading-control decision the depth
toggle already encodes.
