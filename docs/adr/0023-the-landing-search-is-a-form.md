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
- **This was revisitable on evidence, and the evidence has now been taken.** `make analytics`
  prints a `LANDING` section: landing views, how many submitted the form, and how many made
  no onward request at all.

  **Measured 2026-09-13** — 173 landing views, of which **7.5% submitted the form**, 31.8%
  went to a concept, 4.0% to `/concepts`, 1.7% elsewhere, and **54.9% made no onward
  request**.

  The question was whether readers *stall* on the form and route around it — which would
  show as them reaching for the header's overlay instead. The log cannot separate an
  overlay result from a featured link, but the ranking answers it: the six concepts this
  page features (`attention`, `backpropagation`, `kv-cache`, `mixture-of-experts`,
  `positional-encoding`, `transformer-block`) are **all in the top eleven of TOP CONCEPTS,
  five of them in the top seven**. Overlay searches would scatter across 482 concepts;
  these concentrate on the curated six. Readers who act are clicking a featured link, not
  working around a box that failed them.

  **The decision stands on this rather than on nobody having checked.** A bounce near 55%
  is unremarkable for a landing page. What would change it: the featured-versus-overlay
  split *measured* instead of inferred, form submissions falling while concept arrivals
  hold, or a materially larger sample — 13 submissions is a small number to settle an
  argument with. Reopen [#473](https://github.com/opendroid/the-infinity/issues/473) with
  the number, not without one.

  **Read the figures as requests, not sessions** ([#484](https://github.com/opendroid/the-infinity/issues/484)).
  The log carries no session id and no timestamp per reader, so a reload counts twice and
  two readers landing once look like one landing twice. The window above was also truncated
  — the `-limit` of 10,000 was reached at 30 days — so it describes the most recent 10,000
  requests rather than the month, though it held steady across three runs. And roughly half
  of all traffic is crawlers, which `LANDING` and `TOP CONCEPTS` exclude and the headline
  request count does not. The section is a proxy; a thin window is not a finding.

  When this ADR was written it said this paragraph's measurement came from `make analytics`.
  It did not: the command had no landing section, and nobody noticed because nobody ran it
  ([#484](https://github.com/opendroid/the-infinity/issues/484)). The section then shipped
  counting the page's own stylesheet and favicon as readers going elsewhere, which reported
  the headline figure as 32.6% when it was 54.9%
  ([#486](https://github.com/opendroid/the-infinity/issues/486)). Both were found by running
  the thing rather than reading it, forty minutes apart. This note stays as the record of an
  ADR that demanded a number of #473 and twice failed to check that its own instruction
  produced a true one.
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
