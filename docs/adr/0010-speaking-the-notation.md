# 0010 — Notation carries a spoken separator

- **Status:** accepted — listened to 2026-08-05, and corrected; see *What the listen found*
- **Date:** 2026-08-03
- **Amends:** [ADR-0009](0009-notation-in-bodies.md)

## Context

ADR-0009 chose `<sub>` and `<sup>` over KaTeX and Unicode normalisation, and one of its
stated reasons was that they "carry the meaning into the accessibility tree".

They carry. What they carry is the flattened string, and the flattening has no separator
in it ([#144](https://github.com/opendroid/the-infinity/issues/144)):

```
d_model   → "dmodel"
n_target  → "ntarget"
W_Q       → "WQ"
```

`multi-head-attention` at Math depth reaches a screen reader as:

> …Concat(head1,…,headh)WO where headi = Attention(XWQi, XWKi, XWVi) and WO ∈ ℝh·dv×dmodel…

That is not degraded notation. It is a different sentence, and it is what 43 of 57 nodes
hand to anyone reading by ear — 181 groups, 168 of them in `bodies.math`.

The ADR-0009 rationale was half right in a way worth naming: `<sub>` genuinely is the
element that *means* subscript, and it genuinely does reach the accessibility tree. The
error was assuming that reaching the tree implies being *understood* in it. Presence and
intelligibility are different properties, and only the first was checked.

## Decision

**Emit a visually-hidden spoken separator around every subscript and superscript,
derived from the same parse tree that produces the visual form.**

```tsx
<span className="sr-only"> sub </span><sub>model</sub><span className="sr-only"> </span>
```

`d_model` becomes `"d sub model "` in the accessibility tree and is unchanged on screen.

One parse, two renderings — the visual and the spoken — from the same `Token[]`. This is
the same rule the rest of the repo runs on: `api/internal/publish` and `web/src/lib/graph`
derive one graph two ways from one source, and are pinned to one fixture because two
descriptions free to disagree eventually do.

### Why words rather than a space

A bare space is cheaper and reads more naturally — `"d model"` — but it erases the
distinction it exists to carry. `x_2` and `x^2` both flatten to `"x 2"`, and
`2^{−8h/H}` becomes `"2 −8h/H"`, which does not merely lose the exponent, it states a
subtraction. At Math depth, where precision is the entire point of the depth, ambiguity
is the one thing not worth buying with brevity.

`sub` and `super` rather than `subscript` and `superscript`: shorter, and "d sub model"
is how the notation is actually read aloud. `sup` was rejected because a speech engine
says it — rhyming with *cup* — rather than expanding it.

### The cost, stated plainly

**Verbosity.** `_i` appears 21 times, `_t` 19, `_model` 15. A math body with fifteen
subscripts gains fifteen spoken "sub"s, and that is genuinely more tiring to listen to
than the visual form is to read. It buys unambiguity, and this ADR asserts that trade is
right *at Math depth specifically*. Intuition bodies contain zero notation, so the
30-second read — the product's front door — is untouched either way.

**Selection copies the separator.** Selecting `d_model` on screen now yields
`"d sub model"` rather than `"dmodel"`. That is a real change, and it is not a
regression: `"dmodel"` was already not the source text, so copy was lossy before and is
lossy differently now. If copy fidelity ever matters, the fix is a `copy` handler that
reconstructs the source, not the removal of this.

## Alternatives rejected

**`aria-label` on the `<sub>`.** One label per expression, no verbosity, nothing in the
copy buffer. Rejected twice over: `<sub>` has no ARIA role, so a label on it is not
reliably exposed — and more importantly, the label would have to be *authored*, which
makes the spoken form a second description of the notation, free to disagree with the
first. That is the exact shape this repo has been bitten by repeatedly, and the reason
the decision above derives both renderings from one parse.

**MathML.** The right answer for mathematics, and what math-aware screen readers want.
Rejected as a mismatch: this content is English prose with inline identifiers, not
equations. `d_model` inside a sentence about attention head width is a *name*, not an
expression to be evaluated, and MathML would require authors to produce semantic maths for
material that is not maths. It would also be a new rendering path and a schema change,
against ADR-0009's finding that the corpus is "entirely inline sub- and superscripts".

**Accept and document.** Defensible only if a real screen reader handles the run-together
string better than it looks. That is precisely what has not been checked, and it is the
one alternative this ADR cannot rule out from the armchair — see below.

**A space for subscripts, words for superscripts.** Tempting: 158 subscripts are mostly
identifiers where `"d model"` reads fine, and only the 23 superscripts carry the
exponent-versus-index ambiguity. Rejected for inconsistency — a reader would learn that
some raised text is announced and some is not, which is worse than one rule applied
everywhere.

## What would change this

**Nobody has heard it.** This shipped on reasoning and on the accessibility tree, not on a
listen, and that is worth stating rather than leaving to be discovered. The decision rests
on one unverified claim: that a speech engine handed `"dmodel"` produces something a
listener cannot parse.

Shipping first was a judgement that a run-together nonword is very unlikely to be *better*
than a separated one, so the downside of being wrong is verbosity rather than damage — and
verbosity is a one-constant change. That is a weaker footing than this repo usually
insists on, and it is recorded here so the next person knows which parts were measured and
which were reasoned.

The listen is three nodes at Math depth — `multi-head-attention`, `mixture-of-experts`,
`attention` — comparing what ships today against what this produces. Two outcomes change
the decision:

- If readers already announce sub/sup usefully in some modes, "accept and document"
  becomes live and this should not ship.
- If "d sub model" fifteen times a paragraph proves worse to listen to than the ambiguity
  it fixes, the space variant becomes live — a one-constant change, deliberately.

## Consequences

- Notation is now three things: a source convention, a visual rendering, and a spoken
  rendering. A change to the grammar must be reflected in all three, and `notation.test.ts`
  asserts the spoken form on the same fixtures as the visual one.
- The `sr-only` spans are inside body copy, so anything counting DOM nodes in a math body
  gets more of them. Nothing does today.
- `content/schema` and the 57 node files are untouched. This is a rendering decision, and
  the source convention ADR-0009 established is unchanged.

---

## What the listen found — 2026-08-05

*Added after the fact. Nothing above this line has been edited: the record of what was
believed, and on what basis, is the point (CLAUDE.md §8).*

VoiceOver on macOS, `multi-head-attention` at Math depth. It said:

> MultiHead(X) = Concat(headsub1,…,headsubh)WsubO where headsubi = Attention(XWsubQsuperi,
> XWsubKsuperi, XWsubVsuperi) and WsubO ∈

**The words arrived. The spaces did not.** `d_model` went from "dmodel" to "dsubmodel" —
a longer run-together nonword than the one this ADR existed to remove, and the fix was
therefore worse than the defect for three days.

### Why

`sr-only` sets `position: absolute`. That makes each marker span a block container, and
CSS strips leading and trailing **collapsible** whitespace inside one before the
accessibility tree is built. `" sub "` became `"sub"`, and the lone trailing
`<span class="sr-only"> </span>` collapsed to nothing at all.

### The correction

The separator is now **U+00A0**, which is not collapsible whitespace and survives that
processing while still being spoken as a word break. `NBSP` is declared as an escape in
both `Notation.tsx` and `notation.ts` because the entire fix is *which space this is*, and
a literal one is indistinguishable on screen from the ordinary one that failed.

### What this says about the reasoning above

The two outcomes this ADR named as decision-changing were both about *taste* — whether
verbosity is worse than ambiguity. Neither happened. The outcome that did happen was not
in the list: **the mechanism did not work at all**, and no amount of further reasoning
about verbosity would have found that.

Worse, `spoken()` was written specifically to prevent this class — a function whose
docstring says it exists because "the markup was always right". It was a second
description of what a browser does, it disagreed with the browser, and every test agreed
with *it* rather than with the browser. This ADR's own text argues that two descriptions
free to disagree eventually do. It then shipped one and did not notice.

`notation.test.ts` now asserts the property that makes the string survive — that the
separator is a character CSS cannot strip — rather than the string it hoped for. That is
assertable without a browser. What is *not* assertable is whether the result sounds
right, which is still a listen, and is still outstanding for the three verbosity
questions in [`screen-reader-test.md`](../screen-reader-test.md) §1.

**The decision is unchanged.** One parse, two renderings, a visually-hidden separator
derived from the same tokens. Only the character was wrong.
