# Architecture Decision Records

One file per decision, numbered and immutable: `NNNN-short-title.md`. A decision that is
hard to reverse — a new dependency, a data-model change, a serving strategy, a hosting
choice — gets an ADR **before** the code that implements it.

## Format

```markdown
# NNNN — Title

- **Status:** proposed | accepted | superseded by ADR-NNNN
- **Date:** YYYY-MM-DD

## Context
What forces are at play? What did we know at the time?

## Decision
What we are doing, stated in the active voice.

## Consequences
What this makes easy, what it makes hard, and what we accept as the cost.
```

Superseding a decision means writing a **new** ADR and marking the old one superseded.
Never rewrite history in an accepted ADR — the record of what we believed and when is the
point.

## Records

| ADR | Subject | Status |
|---|---|---|
| [0001](0001-infrastructure.md) | Infrastructure — project, regions, identities, URL prefix | **accepted** — built 2026-08-01 |
| [0002](0002-content-as-code-and-trust-tiers.md) | Content-as-code and trust tiers | proposed |
| [0003](0003-static-first-serving.md) | Static-first serving | proposed |
| [0004](0004-runtime-collections.md) | Runtime collections — the state git does not own | **accepted** — written after the code |

## Planned

| ADR | Subject | Phase |
|---|---|---|
| — | Monorepo, Astro, Firestore | 2 |
