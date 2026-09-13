# 0023 — The landing search is a form, and the header search is an island

- **Status:** accepted
- **Date:** 2026-09-13
- **Refines:** [ADR-0003](0003-static-first-serving.md) §3

## Context

Two QA passes have now filed the same observation: the search box on `/` and the search
box in the header behave differently.

| | landing `/` | header overlay and `/search` |
|---|---|---|
| typing | nothing happens | filters live, on every keystroke |
| results | static suggestion chips below | a `role="listbox"` of matches |
| Enter | submits `<form action="/search">` | navigates to the highlighted option |
| arrow keys | nothing | move the selection |

Both passes recommended unifying them. Neither costed it, and the cost is the whole
decision.

**Measured, 2026-09-13:**

```
/         0 bytes of JavaScript, gzipped
/search   64,511 bytes
```

Unifying means putting the search island on `/`. That is not a 4 KB component: `/search`'s
64 KB is mostly the React runtime — `perf-budget.json` records the floor as *"client.js is
57 KB gzipped on its own and every route with an island pays it"*. So the landing page
would go from **zero to roughly 64 KB** to make a box behave the way the box one press of
`/` away already behaves.

`perf-budget.json` budgets `/` at `js_gzip: 0` with the note *"No islands. Zero is the
budget; adding one is a decision."* CLAUDE.md calls the landing page the clearest evidence
for static-first, and the page it is easiest to lose that argument on.

## Decision

**The landing search stays a plain GET form. The difference is accepted, not a defect.**

The form is not a fallback that happens to work. It is the mechanism: with no JavaScript
at all it navigates to `/search`, which answers the query there — and `/search` is a real
page with a real URL, so the result is bookmarkable and shareable in a way a client-side
overlay is not. ADR-0003 §3 already relies on exactly this: *"it is a no-JS form target
that renders against the static index."*

The overlay is the better experience and it is one keystroke away on every page, including
the landing page. What a reader loses on `/` is type-ahead in the first box they see; what
they keep is a page that paints with nothing to download and works with scripting off.

## Consequences

- `/` keeps its 0-byte budget, and `--set-budgets` still refuses to move it without a
  commit message saying what the weight bought.
- The two surfaces will keep looking inconsistent to a QA pass reading only the rendered
  product. That is the cost of this decision, and this file is where it is written down —
  the previous record was a comment inside `index.astro`, which no one auditing the site
  from outside will ever see.
- **This is revisitable on evidence, and the evidence is cheap.** `make analytics` reads
  the Hosting request log: landing sessions that submit the form versus landing sessions
  that leave without a search would say whether anyone actually stalls waiting for
  suggestions. Nobody has looked. If that number is bad, reopen this with it.
- If it is ever reversed, `/`'s perf budget moves in the same pull request, because
  `perf-budget.json` requires the commit message to justify it.

## Alternatives considered

**Ship the island on `/`.** Rejected on the measurement above: 64 KB, on the one page whose
emptiness is the argument.

**Make the header overlay open automatically on `/`.** Rejected — it would put a dialog
between a first-time reader and the page they just arrived at, and it still needs the
island.

**Progressive enhancement: form first, island hydrated after.** This is the one worth
revisiting if the analytics say readers stall. It still pays the 57 KB React floor, so it
is the same decision with a delay, not a way around it.
