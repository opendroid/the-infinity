# 0021 — A domain-scoped explainer names its domain

- **Status:** accepted
- **Date:** 2026-09-09

## Context

`domain` is an ordered pair: `[primary, refinement]`.

```
attention               ["Attention", "Core"]
mixture-of-experts      ["Architecture", "Sparsity"]
monte-carlo-tree-search ["Planning", "Search"]
principal-component-analysis ["Representation", "Dimensionality"]
```

An `explainers` entry records `scope: 'domain'` but **not which domain**, so the concept
page has nothing to render but the primary:

```astro
{e.scope === 'domain' && <span> · on {node.domain[0]}</span>}
```

That was harmless while every domain-scoped explainer happened to be about a primary. The
video search ([#384](https://github.com/opendroid/the-infinity/issues/384),
[#386](https://github.com/opendroid/the-infinity/issues/386)) made it the binding
constraint. Of 95 domains with a candidate, **57 are refinement domains that are never any
node's primary**, and between them they reach **253 of 482 concepts** — over half the
corpus.

They are not marginal domains, and the stranded material is the best in the run:

| | score | domain |
|---|---|---|
| StatQuest — Principal Component Analysis, step-by-step | 0.97 | `Dimensionality` |
| StatQuest — K-means clustering | 0.96 | `Clustering` |
| StatQuest — K-nearest neighbors | 0.96 | `Instance-Based` |
| Hugging Face — Agent Memory | 0.95 | `State` |
| Stanford CS25 — Transformer Circuits, Induction Heads | 0.94 | `Circuits` |
| StatQuest — Gradient Boost | 0.81 | `Ensembles` |
| StatQuest — Decoder-Only Transformers | 0.80 | `Blocks` |

Attaching them anyway is not an option. The MCTS talk on `monte-carlo-tree-search`
(`["Planning","Search"]`) would render "**· on Planning**" — naming a domain the video is
not about. [ADR-0018](0018-every-concept-gets-an-explainer.md) put that label there for
exactly the reason [ADR-0013](0013-primary-sources-that-predate-arxiv.md) keeps `origin`
unlinked: **a broader source presented as a narrower one is the misrepresentation.** A
*wrong* one is worse than a broad one.

So the label is right and the record is short. `scope: 'domain'` says *how* broad the
resource is without saying *what* it is broad about, and only one of those two facts is
actually written down.

## Decision

**A domain-scoped explainer may name the domain it covers, and the page renders that name.**

```json
{ "kind": "video", "scope": "domain", "domain": "Dimensionality",
  "title": "StatQuest: Principal Component Analysis (PCA), Step-by-Step",
  "author": "StatQuest with Josh Starmer",
  "url": "https://www.youtube.com/watch?v=FgakZw6K1QQ" }
```

**Optional, defaulting to `domain[0]`.** All 563 existing entries stay valid and unedited;
the field is written only where the answer is not the primary. A migration that stamps
`"domain": "<primary>"` onto 563 entries would be 563 lines of diff restating what the node
already says.

**The named domain must be one the node belongs to.** `validate:content` rejects anything
else, offline, with the file and the field named. Without that check this ADR would trade a
label that is wrong in a knowable way for one that is wrong in an arbitrary way — the
schema cannot express "a member of this node's own `domain` array", so the cross-field
validator is the only place it can live.

**`scope` stays.** It is what tells a reader the resource is broader than the concept;
`domain` says how much broader. Collapsing them into one field would mean a concept-scoped
entry needed a null domain, and "absent" would stop meaning "the primary".

## Consequences

**What this makes easy.** 57 domains and 253 concepts become reachable, and the reader is
told the truth about what they are clicking. Adding a refinement domain to the taxonomy no
longer silently creates a class of concepts that cannot have a teaching resource.

**What it costs.** A fourth optional field on an entry that already has five, and one more
cross-field invariant to keep. The page's label is no longer derivable from the node alone,
which is the point but also means a reader of the JSON must look at two places to know what
will render.

**What we accept.** Nothing checks that the *content* matches the named domain — the same
gap [ADR-0019](0019-an-encyclopedia-article-is-a-teaching-resource.md) accepts for "named
author wins over Wikipedia". A video genuinely about clustering can be filed under
`Dimensionality` and every automated check will pass. That is a review question, and saying
so is better than implying the validator covers it.

**What this does not do.** It does not let one entry cover two domains. A resource that
genuinely spans both is two entries, or is concept-scoped on each concept that needs it.
Multi-valued scope is a complication no evidence has yet asked for.
