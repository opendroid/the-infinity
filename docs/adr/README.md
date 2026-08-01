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
| [0002](0002-content-as-code-and-trust-tiers.md) | Content-as-code and trust tiers | proposed |
| [0003](0003-static-first-serving.md) | Static-first serving | proposed |

## Planned

| ADR | Subject | Phase |
|---|---|---|
| 0001 | Infrastructure — GCP project, regions, service accounts | 0 |
| — | Monorepo, Astro, Firestore | 2 |

0001 is numbered ahead of 0002/0003 but written later — the infrastructure session
(Phase 0, prompt 1) claims that number. Numbers are allocation order, not writing order.
