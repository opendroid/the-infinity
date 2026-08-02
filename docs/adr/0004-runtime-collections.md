# 0004 — Runtime collections: `concept_requests`, `concept_reviews`, `counters`

- **Status:** accepted — written after the code, see the note at the end
- **Date:** 2026-08-02

## Context

[ADR-0002](0002-content-as-code-and-trust-tiers.md) establishes that **git owns authored
state and Firestore is downstream, always**. `concepts` is written only by `cmd/publish` on
merge to `main`; to change a concept you change its JSON and open a pull request, because
the merge is the act of verification.

That covers the graph. It says nothing about the state that has nowhere else to live.

Three things arrived with the API in #26 and were never recorded:

- **`concept_requests`** — what a reader typed into the "no concept here" form on a 404.
- **`concept_reviews`** — a flag on a concept, or an offer to review one.
- **`counters`** — the daily write budget, and the published `stats` document.

`CLAUDE.md` §2 still listed only `concepts`, `trails`, `concept_requests`. Two collections
existed in production that the governing document did not mention, which is precisely the
drift ADRs exist to prevent.

The pressure to skip this record is real: none of these decisions felt hard while making
them. That is the usual reason a data model ends up undocumented, and the reason the
argument for `counters` — the one below that is genuinely arguable — is worth writing down
while it can still be recalled rather than reconstructed.

## Decision

### These collections are runtime state and never sync back to git

Authored state flows git → Firestore. These flow the other way or nowhere at all, and
**nothing in this repository ever writes them into `/content`.**

A reader's submission is not a fact about the graph. It is a fact about a reader, and
promoting it into the graph is a decision a human makes by opening a pull request.
`POST /reviews` returning `202` rather than mutating a tier is the same rule seen from the
API side: accepting a submission and accepting its content are different acts.

The practical consequence is what a Firestore restore has to recover, and
[`infra/backups.sh`](../../infra/backups.sh) draws the line in a place worth stating
precisely, because two different arguments produce it:

```
trails, concept_requests, concept_reviews    exported
concepts, counters                           not exported
```

`concepts` is excluded because it is **rebuildable**: re-running `cmd/publish` reconstructs
it from git exactly. An export is billed at document read rates, so backing it up is paying
twice for one copy.

`counters` is excluded for a different reason — it is **cheap to lose**, not rebuildable.
`counters/stats` is rewritten by the next publish. `counters/writes-<day>` is the day's
write budget, and losing it resets that day's count to zero, which costs at most one day of
the cap starting over. Neither is worth an export line, but neither is recoverable in the
way `concepts` is, and conflating the two arguments would make the next person assume
`counters` can be regenerated on demand. It cannot; it simply does not matter.

### Queue documents are append-only and carry no identity

Both queues are written with `Add`, taking Firestore's generated id, and are never updated
or deleted by the service. Neither stores anything identifying: no address, no session, no
fingerprint. `concept_requests` holds the requested name and the referring path;
`concept_reviews` holds a concept id, a kind, and a note.

This is a public, unauthenticated endpoint on a portfolio project. The abuse bound is the
rate limiter and the daily cap, not identity — and the less that is stored, the less there
is to leak, to export, or to have to explain.

`status: "queued"` is written on every request document and nothing reads it. It is a hook
for a triage workflow that does not exist. Recorded here as deliberate rather than lost.

### `counters` holds two unrelated things, and that is the arguable part

```
counters/stats          { concepts, grew_this_week }      written by cmd/publish
counters/writes-<day>   { count, day }                     written by every accepted write
```

These have nothing in common except being single documents that are not a graph. They differ
in writer, in lifetime, in read path, and in what breaking them costs: a wrong `stats`
shows a wrong number on the landing page; a wrong `writes-<day>` disables the layer that
bounds the bill.

They share a collection because **neither justified its own**, and a Firestore collection is
free but not weightless — it is another name in `backups.sh`, another rule when security
rules land, another thing to explain.

The honest counter-argument: `stats` is published from git and is therefore closer in spirit
to `concepts` than to a runtime counter, and putting it beside the write budget invites
someone to assume `counters` is uniformly runtime state and back it up, or uniformly
derived and not. This is the decision most likely to be superseded, and superseding it means
a new ADR rather than an edit to this one.

**`writes-<day>` is a transaction, not an increment.** `ReserveWrite` reads and writes
inside `RunTransaction` so two instances racing cannot both slip past the cap — which they
would under a plain read-then-write, and exactly when it matters, since a burst is when
instances scale out. The day key is UTC so the window does not shift under a deploy in
another zone.

### These documents are never read back into a Go struct with a schema

Unlike `concepts`, nothing here has a typed round trip. They are written as
`map[string]any` and read by a human in the console or by a future triage tool.

That is a real difference in guarantee and worth naming: the field-name protections in
`internal/publish` — the tests asserting stored keys match `openapi.yaml` — do not cover
these. A typo in `"referrer"` would be invisible until someone looked. The mitigation is
that the write sites are three lines each and change roughly never; if a triage tool ever
reads them, it should bring typed structs and the same round-trip test with it.

## Consequences

**Easy.** A restore is small and cheap: three collections, none of them the graph.
Contribution stays anonymous with no consent surface to design. The API cannot corrupt the
graph, because the only collection that describes it is written by one tool on one trigger.

**Hard.** Triage has no home yet — a request sits in Firestore until a human reads the
console. `status` exists but means nothing. Growing this into a workflow is unbuilt work,
not a configuration change.

**Accepted cost.** `counters` mixes a published artefact with a runtime counter for want of
a better home, and is the one collection with no backup — deliberately, since both its
documents are cheap to lose, but that is a judgement rather than a property of the data. The
write counter accumulates one document per day forever, roughly 365 tiny documents a year,
which is not worth a lifecycle rule until it is.

**Unresolved.** There are no Firestore security rules. Access is entirely mediated by the
runtime service account, which holds `roles/datastore.user` and reaches the database only
through the API. That is sufficient while nothing else can talk to Firestore, and it stops
being sufficient the moment anything client-side does. It needs its own ADR before that
happens, not after.

## Note on writing this after the code

This record was owed from #26 and written on 2026-08-02, after the collections were already
in production. That is backwards — `CLAUDE.md` §8 says a decision hard to reverse gets an
ADR **before** the code — and the cost was visible: `CLAUDE.md` §2 was stale for a week, and
the `counters` reasoning had to be recalled rather than read.

Status is `accepted` rather than `proposed` because the code shipped. Marking it proposed
would suggest a choice still open, which would be a second inaccuracy on top of the first.
