# 0019 — An encyclopedia article is a teaching resource, with a different kind of author

- **Status:** accepted
- **Date:** 2026-09-08
- **Revises a premise of:** [ADR-0017](0017-teaching-resources-are-not-citations.md)

## Context

[ADR-0018](0018-every-concept-gets-an-explainer.md) committed to every concept having
somewhere to go: a resource of its own where one exists, its domain's otherwise. Thirty-six
domains and 383 concepts in, that held.

Eleven domains did not, and the reason is structural rather than effort. **Every source on
the allowlist is a deep-learning teaching resource.** d2l, Lilian Weng, colah, jalammar,
distill, cs231n and the Hugging Face courses are excellent and they do not cover
differential privacy, disparate impact, causal inference, model merging or MLOps. Measured:

| | domains | concepts |
|---|---|---|
| coverable from the existing allowlist | Alignment, Multilingual | 22 |
| **nothing within reach covers them** | Causality, Code, Deployment, Evaluation, Fairness, Platform, Privacy, Provenance, Weights | **77** |

Pointing `disparate-impact` at a deep-learning textbook would be a domain fallback that is
not about the domain — the one thing ADR-0018's `scope` field exists to prevent. Leaving
seventy-seven concepts with no onward move contradicts principle 3, that the graph never
dead-ends.

ADR-0017 states the premise that makes the third option hard:

> **`author` is a field, not prose.** The point of these is that a named person a reader
> already trusts explains the thing. Attribution is the content.

Wikipedia has no such person.

## Decision

**Add `en.wikipedia.org` to the `read` allowlist, with `author` recorded as
"Wikipedia contributors" — and only as a last resort.**

**What this changes.** `author` widens from *whose judgement you are trusting* to *who
wrote it*. That is a real loss and it is the price of the field being complete rather than
mostly complete.

**What it does not change.** The check is exactly as strong. A `read` entry is verified by
fetching the page and requiring the recorded title to appear in its `<title>`, and
Wikipedia's titles are specific — `"Differential privacy"`, `"Instrumental variables"`,
`"Exploratory causal analysis"`. Two of those are the titles of *redirect targets* rather
than of the URL requested, which the check catches and the author has to resolve.

**Last resort, and what that means precisely.** Wikipedia is used only where nothing with a
named author covers the concept **or its domain**. Where both exist the named author wins:
`perplexity` has a Wikipedia article and takes d2l's *Language Models* instead;
`machine-translation` takes d2l's chapter over `Machine translation`.

**No check can enforce that**, so it is stated here for the reviewer to ask, in the same
shape as ADR-0018's warning about over-claimed scope: **a Wikipedia entry sitting next to
an unused Lilian Weng post is the failure mode.** The question to ask of any new Wikipedia
entry is not "is this article good" but "did anyone look for a signed one first".

**The subject-match rule still binds, and it excludes more than it admits.** An article has
to be about the concept, not merely adjacent to its name. Rejected under it while writing
this batch: `Canary_release` redirects to *Feature toggle*, which is a different subject;
`Software_versioning` is not model versioning; `Test_automation` is not test generation;
`Multilingualism` is a linguistics article and not about multilingual models; `Sycophancy`
is about flattery between people and not about model behaviour. All five are domain-scoped
instead.

## Consequences

**What this makes easy.** The field becomes complete: 482 of 482, which is what ADR-0018
promised and could not deliver on its own. Nine domains that would otherwise dead-end have
a real onward move.

**What it costs.** A second class of `author`, which a reader will notice and which the
data does not distinguish — "Wikipedia contributors" simply reads differently from "Lilian
Weng". A future `check` could flag a Wikipedia entry on a concept whose domain has signed
resources; it does not exist yet and this ADR does not require it.

**What we accept.** Wikipedia articles change under the entry rather than beside it. A
signed post is a fixed thing that can rot; a wiki article is a moving thing that can drift
without the URL or the title ever changing. The title check will not see that. This is a
weaker guarantee than the rest of the field carries, and it is confined to the concepts
that had no alternative.
