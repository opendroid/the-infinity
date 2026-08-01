# 0002 — Content-as-code and trust tiers

- **Status:** proposed
- **Date:** 2026-08-01

## Context

Two documents describe this product's data, and they disagree.

`/docs/PLAN.md` was written from a **build-time** view: node JSON in git, schema-validated
in CI, synced to Firestore on merge. Git is the only writer. *A merge is the act of
verification.*

`/docs/design/handoff-v1/` was written from a **runtime** view. It introduces a `review`
record, a `provenance` block, a `POST /v1/reviews` endpoint, and states that *"accepted
reviews flip a concept from frontier to verified."* It also reshapes the concept record:
`domain` becomes a string, `viz.config` becomes `params`/`param_controls`/`caption`,
`citations[]` moves inside `provenance.sources[]`, and a new `emphasis` field appears.

Both views are internally coherent. They collide wherever a piece of state could
plausibly live in either place. Left unresolved, the collisions surface one at a time
during implementation, and the first one resolved wrong — a runtime write to `tier` —
breaks the invariant the whole content model rests on.

A second, quieter problem: several fields are stored in two forms that can disagree.
`tier` and `review` encode the same fact. `requires` and `unlocks` are inverses. The
handoff acknowledges this and calls the resulting mismatch *"a data bug"* — which means
the model can represent states that are meaningless.

## Decision

### 1. Git owns authored state. The API owns interaction state. Nothing crosses.

**Authored** — lives in `/content/nodes/*.json`, changes only by PR:
`id`, `title`, `domain`, `bodies`, `emphasis`, `citations`, `edges`, `viz`, `review`.

**Interaction** — written at runtime, never synced back into git:
trails, concept requests, review submissions, stats.

**Derived** — computed by the publish step, never authored:
`tier`, `edges.unlocks`, neighborhood coordinates, the search index, stats aggregates.

Firestore is downstream of git for authored state, and the sole store for interaction
state. The two never mix in one collection.

### 2. `tier` is derived from `review`, not stored

A node is `verified` if and only if it carries a `review` object. Node JSON does not
contain a `tier` field. The publish tool computes it and writes it into the Firestore
document, and the API serves it as a single field exactly as the design requires.

This makes promotion one edit: a reviewer adds `{"reviewed_by": "...", "reviewed_at":
"..."}` in a PR, and merging it *is* the verification. The "verified node with no
reviewer" bug becomes unrepresentable rather than merely detectable.

### 3. `POST /v1/reviews` and `POST /v1/requests` are queues, not mutations

Both return `202` and append to their own collection (`concept_reviews`,
`concept_requests`). Neither touches `concepts`. A submitted review is a signal that a
human should look, not an act of verification.

The path from a review submission to a verified node runs through a person: read the
queue, do the review, edit the JSON, open a PR, merge. This is slower than a button, and
that is the point — the trust tier means a human read it.

### 4. `unlocks` is derived; `adjacent` is symmetrized; `reviewed` is authored per edge

`requires` and `unlocks` are inverses. Authoring both writes the same fact in two files
that can contradict each other, with nothing to catch it. Node JSON declares `requires`
and `adjacent` only; publish inverts `requires` into the target's `unlocks`, and
symmetrizes `adjacent` so it can be declared from whichever side reads naturally.

`edges[].reviewed` **is** authored, per edge, defaulting to `false`. It is tempting to
derive it from the target node's tier — in the handoff's example the two happen to
coincide — but that would erase the case the dashed mini-map line exists for: an
unchecked claim *between two verified nodes*, where both concepts are solid and nobody
confirmed the relationship. That is an independent human judgment, so it is stored.

### 5. `citations[]` stays top-level and tier-independent

The handoff places sources inside `provenance`, which is frontier-only, so promoting a
node would delete its sources. That inverts the intent: review should strengthen
provenance, not remove it. It also contradicts `CLAUDE.md` §4, which requires real
resolvable citations for all content with no tier exemption.

`citations[]` is top-level on every node. `provenance` retains only `{drafted_at}`. The
frontier page renders a *provenance block* because it is soliciting review — that is a
presentation rule, and it was modeled as a storage rule.

### 6. Remaining shape decisions

| Field | Decision |
|---|---|
| `domain` | Ordered path array, exactly 2 levels: `["Architecture","Sparsity"]`. The API emits `"Architecture / Sparsity"` for the eyebrow. It is a path, not multi-membership. |
| `viz` | Take the handoff's `{primitive, params, param_controls, caption}`. CI enforces `param_controls` length ≤ 1 and validates `primitive` against implemented primitives. |
| `emphasis` | Optional per depth. CI asserts `bodies[d]` contains `emphasis[d]` verbatim. Renderer highlights the first occurrence only. |
| `updated_at` | Adopt the handoff's name — consistent with `drafted_at`, `reviewed_at`, `created_at`. |
| Edge storage | Ids only in node JSON. The API's denormalized `{id, title, tier, reviewed}` is a response shape, produced at publish time. |

### 7. Publish rewrites every concept document

Because edges are denormalized into concept documents, flipping one node's tier changes
every document that references it. Rather than compute an incremental diff, publish
rewrites all documents on every merge. At ~300 nodes that is ~300 writes per deploy —
roughly $0.0005 at Firestore's write pricing. Incremental sync would cost more in bugs
than it saves in cents.

## Consequences

**Easier.** The data model cannot represent a contradiction: no tier that disagrees with
its reviewer, no `requires` without its matching `unlocks`. Content PRs stay
single-file — adding a concept never requires editing its neighbours. Verification is one
reviewer, one field, one merge. Rollback is `git revert` plus a re-publish.

**Harder.** Promotion is not self-service; a volunteer reviewer cannot flip a node
themselves, and someone must work the review queue or it silently fills. Publish is now a
real program — it inverts edges, computes tiers and coordinates, denormalizes, and
rewrites everything — so it needs its own tests, and a bug there corrupts the whole
served graph at once.

**Accepted costs.** Firestore never round-trips into git, so anything a user contributes
at runtime is inert until a human acts on it. Full re-publish means deploy time grows
linearly with the graph; fine at 300 nodes, revisit past a few thousand. Deriving `tier`
means you cannot read a JSON file and see its tier at a glance — you infer it from the
presence of `review`, which is less obvious to a human skimming the directory.

**Deliberately not decided here.** Rate limiting and abuse control on the two public
write endpoints is a real launch blocker and is tracked separately. Serving strategy —
what is precomputed versus fetched at runtime — is ADR-0003.
