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

## Planned

| ADR | Subject | Phase |
|---|---|---|
| 0001 | Infrastructure — GCP project, regions, service accounts | 0 |
| 0002 | Content-as-code and trust tiers | 2 |
| 0003 | Static-first serving | 2 |
| — | Monorepo, Astro, Firestore | 2 |
