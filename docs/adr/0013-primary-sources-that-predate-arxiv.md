# 0013 — Primary sources that predate arXiv get a field of their own

- **Status:** accepted
- **Date:** 2026-08-17
- **Refs:** [#191](https://github.com/opendroid/the-infinity/issues/191), [ADR-0002](0002-content-as-code-and-trust-tiers.md)

## Context

Every citation in this corpus must carry a resolvable `https://` URL — the schema requires
it and `check:citations` fetches every one, exiting non-zero if any fails. Both rules are
right and neither is negotiable: a checker that reports success because it could not check
is worse than no checker.

Together they make a pre-arXiv paper **unrepresentable**. There is no way to write down
*"this comes from Cortes & Vapnik 1995"* without inventing a URL that resolves.

Measured from the authoring environment, every non-arXiv scholarly host is unreachable:

```
link.springer.com   000        projecteuclid.org      000
www.jmlr.org        000        dl.acm.org             403
scikit-learn.org    000        www.stat.berkeley.edu  000
```

All 223 citations in the corpus are arXiv. That is not a preference anybody expressed; it
is the only thing the schema permits.

### What that costs, concretely

The corpus systematically credits the wrong decade. Every one of these nodes rests on a
result whose primary source it cannot name:

| node | the claim | who actually proved it |
|---|---|---|
| `connectionist-temporal-classification` | the collapse rule and the forward–backward sum | Graves et al. 2006 |
| `temporal-difference-learning` | TD(λ) and the bias–variance dial | Sutton 1988 |
| `q-learning` | the off-policy update and its convergence | Watkins 1989 |
| `k-nearest-neighbors` | farthest/nearest distance ratio → 1 as d grows | Beyer et al. 1999 |
| `decision-tree` | finding the optimal tree is NP-hard | Hyafil & Rivest 1976 |
| `spectrogram` | recovering audio from magnitudes alone | Griffin & Lim 1984 |

Each currently cites a modern arXiv paper that genuinely supports the claim — which works,
and is honest as far as it goes. What it cannot do is say where the idea came from.

The judgement recorded in #181 and #183 — that a definitional formula named as a common
noun is not an uncited result — covers BM25 and the roofline model. It does not cover
these. "The ratio tends to 1" and "optimal is NP-hard" are things somebody proved, and the
somebody has a name.

## Decision

**Add an optional `origin` array, separate from `citations`, for primary sources that
cannot be fetched. It is never fetched, and it never carries a URL.**

```json
"origin": [
  {
    "ref": "Graves et al. 2006",
    "title": "Connectionist Temporal Classification: Labelling Unsegmented Sequence Data with Recurrent Neural Networks",
    "venue": "ICML 2006",
    "doi": "10.1145/1143844.1143891"
  }
]
```

- `ref` and `title` are required; `venue` and `doi` are optional.
- **No `url` property exists on it at all.** Not optional — absent. A field that could hold
  a URL would eventually hold one, and then the question of whether it gets fetched is
  reopened by every future author instead of being settled here.
- `doi` is validated by pattern (`^10\.\d{4,9}/`) and never dereferenced. A DOI is a stable
  identifier a reader can paste anywhere; treating it as an identifier rather than a link
  is the whole distinction this ADR turns on.
- `citations` is unchanged: still required, still `minItems: 1`, still every URL fetched.

**A node may not use `origin` to avoid citing something reachable.** `origin` names where
an idea came from; `citations` is what a reader can go and read today. A node still needs
at least one of the latter.

### It renders differently, because it means something different

The concept page prints the two under separate labels — `SOURCES` for citations and
`ORIGIN` for these — with `origin` entries as plain text, not links. A reader can see at a
glance which references were verified by a machine and which were asserted by an author.
Presenting an unfetchable attribution as though it were a checked link is the one outcome
this ADR exists to prevent.

## Alternatives rejected

**Allow a citation with no URL.** Simplest, and it collapses the distinction that matters.
`check:citations` would have to skip entries it cannot fetch, which weakens the check to
"some of these resolve" — and its own header argues against exactly that.

**Allow a DOI URL (`https://doi.org/10.1007/BF00994018`) and accept that it 000s here.**
This converts a real check into one that passes only where egress happens to allow it. That
is the "green for the wrong reason" shape this repo has now shipped three times: a test
that passes because it did not run is indistinguishable from one that passes.

**Accept and document — name primary sources in prose only.** Cheapest, and roughly what
has been happening undocumented. Rejected because prose is not queryable: `origin` can be
listed, counted, and checked for duplicates, and a sentence cannot. It also leaves
`CLAUDE.md` §4 saying "citations are real, resolvable links (arXiv, papers, primary
sources)" while the schema forbids two of those three.

## Consequences

- The Go loader uses `DisallowUnknownFields`, so `origin` had to land in `store.Concept`,
  `publish.AuthoredNode`, and `docs/openapi.yaml` at the same time as the JSON Schema.
  One derivation, two implementations — adding a field to one alone fails CI, which is the
  design working.
- `derived.golden.json` is unaffected: it carries tier, domain and edges, not sources.
- The corpus gains a place to be honest about its own lineage, and the honesty is visible
  on the page rather than buried in a file.
- **This does not make `check:citations` weaker in any way.** It is the reason the ADR took
  this shape rather than the simpler one.
