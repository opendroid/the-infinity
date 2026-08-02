<!--
The title becomes the commit message on squash-merge, and CI checks its shape:

  feat(web): add depth toggle island
  fix(api): propagate context deadline to Firestore reads

type   feat | fix | chore | docs | refactor | test | ci | content
scope  web | api | content | infra | docs
-->

Closes #

## What changed

<!-- One paragraph. What a reader of `git log` needs, not a list of the diff. -->

## Why this shape

<!-- The decision worth explaining: the alternative you rejected, the constraint
     that forced this. Skip if there genuinely wasn't one. -->

## What was verified

<!-- What you actually ran, and what it said. Not what CI will run — that is
     visible below. Things a machine cannot check go here: a page opened in a
     browser, a script run twice to prove it resumes, a measurement taken. -->

## Checklist

- [ ] There is an issue, and this references it
- [ ] Smallest change that meets the acceptance criteria — no refactors riding along
- [ ] Anything hard to reverse (a dependency, a data-model change, a serving strategy) has an ADR in `/docs/adr/`
- [ ] `CLAUDE.md` updated if a command, a constraint, or a piece of layout changed
