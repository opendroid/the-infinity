# 0017 — A teaching resource is not a citation

- **Status:** accepted
- **Date:** 2026-09-08

## Context

A concept page carries an intuition, an engineer's view, the maths, an interactive figure,
typed edges, and citations. A reader who finishes all of that and still wants to be *taught*
the concept — by someone talking through it for forty minutes — has nowhere to go.

The obvious move is to put a link to a talk in `citations`. That is the wrong field, for a
reason [ADR-0013](0013-primary-sources-that-predate-arxiv.md) already worked out about
`origin`: **the fields are distinguished by job, not by whether they hold a URL.**

- `citations` is **evidence for a claim**. Every one is fetched.
- `origin` is **where an idea came from**. Unfetchable by construction, so it carries no URL.
- What is missing is **where to go and be taught it**, which is neither.

There is also a measured cost to folding them together. `check-citations.mjs` tells "the
network is blocked" apart from "these papers are dead" by whether **every** citation failed
with an **identical** status:

```js
const environmental = failures.length === citations.length && citations.length > 1 && statuses.size === 1;
```

That works because the corpus is single-host: all **800** citations are `arxiv.org`, zero
exceptions. Mixing YouTube and university hosts into `citations` degrades the heuristic
exactly when it matters — a genuinely blocked sandbox would report as N dead papers, which
ADR-0013 names as the outcome to avoid, because "reporting a blocked sandbox as nine dead
papers invites someone to delete nine real citations."

## Decision

**Add an optional `explainers` array, separate from `citations` and `origin`, and give it
its own checker.**

```json
"explainers": [
  {
    "kind": "video",
    "title": "Let's build GPT: from scratch, in code, spelled out.",
    "author": "Andrej Karpathy",
    "url": "https://www.youtube.com/watch?v=..."
  }
]
```

**`author` is a field, not prose.** The point of these is that a named person a reader
already trusts explains the thing. Attribution is the content — and for a video it is the
half that can be checked.

**`kind` is `video` or `read`,** because the two verify differently, and a field that
selects the check has to be authored rather than guessed from the host.

**The checker asserts attribution, not just resolution.** YouTube's oEmbed endpoint answers
404 for a dead or private video and returns the real `title` and `author_name` for a live
one, so `check:explainers` compares what is recorded against what YouTube says. This is
strictly stronger than `check:citations`, which can only ask whether a URL answers — and a
retracted paper still answers 200. PLAN.md §8 calls a source that resolves and supports
nothing "the most common defect by a wide margin"; for this field that class is closed by
construction.

**A `read` entry is fetched with the HEAD→GET-on-405/501 pattern** already in
`check-citations.mjs`. That fallback was written for non-arXiv hosts and, against a corpus
that is 800/800 arXiv, has never once been exercised.

**The gate runs in CI.** `check:citations` does not and never has ([#361](https://github.com/opendroid/the-infinity/issues/361)),
which is why `LAUNCH.md` ticks "every citation resolves" with nothing enforcing it. The new
field does not inherit that.

**The machinery ships before the content.** The first change adds the field, the renderer
and the gate with **zero entries**. This is not caution for its own sake: `www.youtube.com`,
`youtu.be`, `cs231n.stanford.edu`, `distill.pub` and `deeplearning.ai` are all
`connect_rejected` by the egress policy where this work is authored, while `arxiv.org`
answers 200. No video URL can be verified from an authoring session, so CI is the only place
verification can happen, and it should exist before content depends on it.

## Consequences

**What this makes easy.** A concept page can send a reader onward to a talk without
pretending the talk is evidence. The three source fields stay individually meaningful, so
"how many concepts cite a paper" and "how many can be watched" are separate, answerable
questions. `check:citations` keeps its single-host corpus and the heuristic that depends on
it.

**What it costs.** A fourth thing to author per concept, and a fourth place a node can rot —
videos are deleted and made private far more often than arXiv papers are withdrawn. A CI
step that reaches a third-party API on every pull request, which will occasionally be red
for reasons that are nobody's fault; the environmental heuristic is what keeps that from
looking like dead content.

**What we accept.** Coverage will be partial and lopsided, probably permanently. A canonical
talk exists for `attention` and `backpropagation`; none exists for
`fisher-weighted-merging` or `energy-cost-of-inference`, and 37 of the corpus's 47 domains
are made of concepts like the latter. **An absent `explainers` is the normal case, not a
gap to be filled** — the same stance ADR-0015 took toward an empty frontier. Attaching a
loosely-related video to a concept it does not explain would be the invented reference that
CLAUDE.md's content rules exist to prevent, wearing a different field name.

**What this is not.** Not a place for social-media posts. An x.com link cannot be verified
from CI or anywhere else this project runs, posts are deleted by their authors, and the
result would be a field full of links nothing can check — which is the state `origin` exists
to avoid rather than to normalise.
