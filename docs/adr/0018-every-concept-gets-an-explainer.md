# 0018 — Every concept gets an explainer, and says which kind it is

- **Status:** accepted
- **Date:** 2026-09-08
- **Revises a consequence of:** [ADR-0017](0017-teaching-resources-are-not-citations.md)

## Context

[ADR-0017](0017-teaching-resources-are-not-citations.md) added `explainers` and, under
Consequences, took a position on how much of the corpus would ever carry one:

> **An absent `explainers` is the normal case, not a gap to be filled** — the same stance
> ADR-0015 took toward an empty frontier.

That was written against a measurement: `www.youtube.com`, `cs231n.stanford.edu`,
`distill.pub` and every other candidate host were denied by the egress policy of the
environment this corpus is authored in. Nothing could be found, let alone checked, so
partial coverage was the only honest outcome.

**The policy was widened, and the answer changed.** Fourteen hosts are now reachable from an
authoring session — `d2l.ai`, `distill.pub`, `jalammar.github.io`, `colah.github.io`,
`lilianweng.github.io`, `sebastianraschka.com`, `cs231n.github.io`, `course.fast.ai`,
`karpathy.ai`, `huggingface.co`, `pytorch.org`, `simonwillison.net`, `thegradient.pub`,
`export.arxiv.org`. Only YouTube is still denied.

`d2l.ai` alone changes the arithmetic: a textbook of roughly two hundred sections that maps
onto the head of this corpus almost one for one — LSTM, GRU, beam search, multi-head
attention, positional encoding, Adam, convexity, momentum, RMSProp, encoder–decoder, vision
transformers. All of it fetchable, and therefore checkable, where the content is written.

What has *not* changed is the long tail. Thirty-seven of forty-seven domains hold eight
concepts each, and they are `fisher-weighted-merging`, `evaluation-disaggregation`,
`graph-capture`, `energy-cost-of-inference`. No canonical explainer exists for those
specifically and none will.

## Decision

**Every concept carries an explainer. Where none covers the concept, it points at the best
resource for the concept's domain, and the page says so.**

A required `scope` on each entry:

```json
{ "kind": "read", "scope": "domain", "title": "Compilers and Interpreters", … }
```

**`scope` is required, not defaulted.** A default would let a domain overview be recorded as
though it explained the concept, by omission — and the whole distinction is one the reader
needs before they click, not after. An author who has to type `"scope": "concept"` has
asserted something; an author who typed nothing has not.

**The reader is told, in the row itself.** A domain-scoped entry renders with the subject it
actually covers appended, so "about Compilers" is visible on the page rather than discovered
by following the link. This is the same rule ADR-0013 applies to `origin`: presenting a
broader resource as though it were a narrower one is the misrepresentation, not the resource.

**`read` entries are verified by title, not only by reachability.** Fetching a page and
checking that the recorded title appears in its `<title>` is the `read` equivalent of the
oEmbed check ADR-0017 built for videos. Without it, a `read` entry proves only that *some*
page answers at that URL — the exact weakness of `check:citations` that ADR-0017 was
written to avoid inheriting.

## Consequences

**What this makes easy.** Principle 3 — the graph never dead-ends — now holds on this axis
too: no concept page is a place where the reader is out of onward moves. And because
`scope` is data rather than prose, "how many concepts have a resource of their own" is a
question that can be answered by counting rather than by reading.

**What it costs.** Coverage is now a completeness obligation, so a new concept without an
explainer is a gap rather than a normal state. Domain fallbacks are duplicated across the
eight concepts of a domain, so a domain's resource dying breaks eight rows at once — which
the checker will report as eight failures for one cause.

**What we accept, and it is the sharp one.** A domain-scoped entry is, deliberately, not
about the concept the reader is on. That is worth shipping only while the label is honest
and visible. **The failure mode to watch for is a domain fallback quietly being written as
`scope: "concept"`** because it seemed close enough — which is the shoehorning ADR-0017
named, arriving through the one door left open. No check can catch it; it is a review
question, and this paragraph is where the next reviewer is told to ask it.

**What this revises.** ADR-0017's "an absent `explainers` is the normal case" no longer
holds. The rest of ADR-0017 stands unchanged: the field is still separate from `citations`,
still checked by its own gate, and a video is still verified by attribution.
