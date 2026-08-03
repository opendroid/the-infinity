# 0009 — Notation in bodies is `_` and `^`, rendered to `<sub>` and `<sup>`

- **Status:** accepted
- **Date:** 2026-08-03

## Context

`bodies.math` is a plain string rendered into a `<p>`, so anything that looks like notation
arrives as the characters that were typed ([#112](https://github.com/opendroid/the-infinity/issues/112)).
`decoder-only-transformer` read, on screen:

> p(x) = Π_t p(x_t | x_{<t})

The complaint that opened the issue was sharper than "math is unstyled". In `adam`:

> m_t = β₁m_{t−1} + (1−β₁)g_t

`β₁` renders correctly and `m_{t−1}` does not, three characters apart — inconsistent in a
way that reads as sloppiness rather than as a deliberate plain-text style.

A survey of all 57 nodes, before choosing anything:

| | |
|---|---|
| `_` subscript notation | 40 nodes |
| `^` superscript notation | 11 nodes |
| braced groups `{…}` | 22 nodes |
| Unicode sub/superscripts | 6 nodes |
| fractions, integrals, matrices, aligned equations | **none** |

The corpus is **inline notation inside prose**, and it already has a convention: Unicode
where a glyph exists (`β₁`, `ᵀ`, `√`, `∈ ℝ`, `Σ`, `∂`, `≈`, `∝`, `−∞`), and `_` / `^` /
`{…}` where it does not (`m_{t−1}`, `x_{<t}`, `ℝ^{n×d_k}`, `2^{−8h/H}`). Nobody wrote that
convention down; 40 nodes converged on it anyway.

Engineer bodies use the same convention — `d_model`, `d_ff`, `W_Q`, `W_K`, `W_O` — 13 uses
across 4 nodes. Intuition bodies contain none.

## Decision

**`_` and `^` mark subscript and superscript in every body, and the build renders them to
`<sub>` and `<sup>`. Existing Unicode stays as it is.**

The grammar is small enough to state completely:

```
_x      _{…}      subscript      x_t → x<sub>t</sub>
^x      ^{…}      superscript    2^{−8h/H}
\_ \^ \{ \\       the literal character
```

After a marker, either a braced group or **a run of letters and digits**. A run, not a
single character as in LaTeX, because the content says so: `d_model` means *d* subscript
*model*, and `S_ij` means one subscript, not `S` sub-*i* followed by a stray *j*.

Braced groups **nest**: `ℝ^{|V|×d_model}` is a superscript containing a subscript, and it
appears in the corpus. A `{` that does not follow a marker is an ordinary character —
`g(x) ∈ {0,1}` is set notation in `conditional-computation` and must survive untouched.

`validate:content` rejects an unbalanced or dangling marker, so a typo fails CI rather
than rendering as literal `_{`.

### Why not KaTeX

The obvious answer, and it fits static-first — it emits HTML and CSS with no runtime
JavaScript. Rejected on what it would cost against what the corpus needs:

- **A migration of all 57 nodes.** Bodies are prose with notation embedded. KaTeX needs
  the boundary marked, and where prose ends and notation begins is a judgment call in
  every sentence — 57 chances to change what a body says while reformatting it.
- **A dependency and a stylesheet on every concept page**, against the budget in #60, to
  typeset material that is entirely inline sub- and superscripts.
- **A parse failure mode** in a content model that currently cannot fail.

The corpus contains no fraction, integral, matrix, or aligned equation. Buying a
typesetting engine to render `x_t` is paying for a capability the content does not use.
If the graph ever grows material that genuinely needs it, this decision is cheap to
revisit: the marker syntax is a subset of LaTeX's, so `_{…}` and `^{…}` already mean
there what they mean here.

### Why not normalise to Unicode

No dependency and no rendering step at all — rewrite `x_t` as `xₜ`. **Disqualified by the
data, not by taste.** Unicode has no subscript `<` for `x_{<t}` and no superscript `×` for
`ℝ^{n×d_k}`, both of which are in the corpus. It would also make the source hard to type
and impossible to grep, and force an author to know which of 57 glyphs exist.

### The cost, stated plainly

**This is a bespoke micro-format.** It is not Markdown and not LaTeX, so it is one more
thing an author has to be told, and the telling has to happen in the schema and in the
generation prompt or batch 3 arrives in the old style. It buys correct rendering of
everything in the corpus for no dependency and no bytes on the wire, and it will never
render a fraction.

**Unicode and markup now coexist by design.** `β₁` stays a glyph; `m_{t−1}` becomes
markup; both display as subscripts. They are not pixel-identical — a Unicode subscript is
a designed glyph, `<sub>` is shifted small text — and the rule that keeps this from
drifting into sloppiness is: **use the Unicode glyph when one exists for the whole
construct, and markup when it does not.** Mixing them inside a single symbol is the thing
to reject.

## Consequences

- Every body is now parsed, not just `math`. That is deliberate: `d_model` in an engineer
  body is a subscript for the same reason it is in a math body.
- `_` is no longer an ordinary character in body copy. An author who wants a literal one —
  a snake_case identifier — writes `\_`. Intuition bodies contain no underscores today, so
  nothing is silently changed by this.
- Emphasis is a substring of the body and is split before parsing, so a phrase that cuts a
  notation group in half would leave both halves literal. `validate:content` rejects that
  rather than letting it render.
- The renderer is a pure function over a string, so it is testable without a DOM and the
  golden fixture is unaffected — this changes presentation, not derivation.
