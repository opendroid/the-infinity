# 0012 — A deleted concept leaves a tombstone in the trails that visited it

- **Status:** accepted — shipped, all three parts: publish names deletions before writing
  them, the API emits `missing`, and `SharedTrail` renders a tombstone.
- **Date:** 2026-08-04

## Context

A trail denormalises its stops at creation: `{n, id, title, tier, depth_read_at}` is copied
into the trail document rather than joined at read time. That is deliberate and
[ADR-0004](0004-runtime-collections.md) records why — a shared trail is written once and
read many times, and a join would make every view pay N document reads for data that has
not changed since it was written.

Publish deletes concepts that git no longer has, and **knows nothing about trails**. So
deleting a concept from `/content/nodes` leaves every trail that visited it holding a stop
pointing at a document that is gone.

Nobody has deleted a node yet, which is exactly why this is worth deciding now
([#56](https://github.com/opendroid/the-infinity/issues/56)). The issue's own framing is
the important part: *"the answer might be that a stranded stop renders as a tombstone
rather than that publish refuses — but it should be a decision, not a discovery."*

### What already holds, and what does not

`CreateTrail` refuses a walk whose stop no longer resolves — a missing document comes back
from `GetAll` as a snapshot that does not exist, and the handler returns rather than
decoding a zero `Concept` into a nameless stop on a shared page. **So a trail cannot be
created with a dead stop.** The exposure is narrower than it first looks: only trails
created *before* a deletion are affected.

What those trails do today is not a crash. The stop still carries its stored title and
tier, so the page renders and the ribbon is intact. The link simply goes to a concept page
that 404s. The reader finds out by clicking.

## Decision

**A stranded stop is a tombstone: named, visibly gone, and not a link. Publish says what it
is about to delete before deleting it. Neither one blocks the other.**

Three parts:

1. **Publish names its deletions, before the writes go out.** It reported a count
   afterwards; a count tells you something happened and not what.

2. **`Trail` resolves stop existence at read time**, with one `GetAll` for the whole walk —
   the same batched call `CreateTrail` already uses, for the same reason. Stops whose
   concept is gone are marked, and the API emits `missing: true` on them.

3. **The shared-trail page renders a tombstoned stop as plain text rather than a link**,
   with its position, title and tier preserved. The thread runs through it unbroken: the
   stop *happened*, and a trail is a record of a walk rather than a list of live links.

### Why not refuse

Refusing to publish while a live trail references a concept would make **deleting content
from git hostage to runtime data**, which inverts the rule the whole content pipeline rests
on: *Firestore is downstream of git, always* (CLAUDE.md §3). A reader who walked past a
concept in March would acquire a veto over the corpus in August. It also fails at the worst
moment — the deletion most worth making quickly is one where the content is wrong, and that
is precisely when a stale trail is most likely to reference it.

### Why not warn only

A warning in a CI log is read by whoever is publishing, once. The reader who opens the
shared trail six months later is the person who needs to know, and they would still get a
link to nowhere. Warning is the *reporting* half of this decision, not an alternative to
it.

### What this costs

**One batched read per trail read.** `GET /api/v1/trails/{slug}` is cached
`public, max-age=600, s-maxage=3600`, and a shared trail is the rarest read in the product —
it is reached by someone following a link, not by browsing. A trail carries at most 200
stops and `GetAll` is one round trip regardless.

That is a real cost and it buys a specific thing: the reader learns the concept is gone
*before* clicking rather than after. Paying it on the write path instead — scanning trails
for references whenever a concept is deleted — would mean an unbounded query over a
collection that only grows, on the rarest operation in the system.

### What is deliberately not built

- **No backfill.** Nothing rewrites existing trail documents. The trail is a record of what
  was walked, and rewriting it to say something else would be falsifying it.
- **No cascade.** A trail whose every stop is gone still resolves and still renders. It is
  a record of a walk through a graph that has since changed, which is a true thing to be.
- **No tombstone collection.** The concept document's absence *is* the tombstone. A
  parallel collection of deleted ids would be a second source of truth about what exists.

## Consequences

**Easy.** A deleted concept stops being a trap. Publish becomes legible about the one thing
it does that is not additive. `CreateTrail`'s existing refusal keeps new trails clean, so
this only ever has to handle history.

**Hard.** `Trail` is no longer a single document read, and the fake and Firestore now have
one more behaviour to agree on. The emulator test covering publish-then-read exists for
exactly that.

**Accepted.** A trail page can now show a stop the reader cannot follow. That is the honest
rendering of what happened, and the alternative — hiding it — would renumber the walk and
make the trail claim to be something it was not.

**A tier is preserved that can no longer be checked.** A tombstoned stop still shows the
tier it had when it was walked, because that is what the reader saw. It is a historical
claim, not a current one, and the `missing` marker is what says so.

---

*Written before the code, per CLAUDE.md §8. `proposed` until the first concept is actually
deleted and the behaviour is seen rather than tested.*
