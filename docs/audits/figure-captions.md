# Figure captions against what the template draws

A screen for [`LAUNCH.md`](../LAUNCH.md) §6, *every figure read against its caption* (#559).
Each node's `viz.caption`, and its `caption_engineer` where it has one, is read against what
its template actually draws, taken from the template's source. A `flag` is for Ajay to confirm
or dismiss; a follow-up issue rewrites the captions he confirms. Nothing here changes a
caption, a param or a template.

This file covers all six templates, 482 nodes: five templates and 131 nodes from #559, and
`budget-split`'s 351 from #560. Each half has its own entries under **Templates** and its own
verdict section.

## How a caption was judged

Ajay's rules, 22 Nov 2026:

- A figure used as a metaphor is fine if the caption says literally what moves and what it
  stands for.
- Flag a caption only when it claims something the figure can't show: a quantity, a
  direction, a shape, a relationship, or a control that isn't there.
- Judge against what the template actually draws, read from its source, not against how the
  concept usually looks.

Applied as:

- **What is graded is what the caption says the figure shows**: the marks it names (groups,
  rows, curves, humps, the cut) and what it tells the reader to watch as the control moves.
  Background about the concept that points at nothing on screen is prose, and out of scope.
- **A synonym for the control's name is not a flag.** The test is denotation, as
  [`content/schema/README.md`](../../content/schema/README.md) sets it out. A caption that
  names the control's cause but also says what visibly moves passes under the metaphor rule.
- **Every flag was run, not only read.** Each node went through its template's own
  arithmetic (`spectrum.ts`, `losscurve.ts`, `attention.ts`, `threshold.ts`, `routing.ts`,
  `share.ts`, the modules the components draw from) at the control's minimum, at the node's
  value and at the maximum. Every number quoted in a reason comes from those runs.
- **A pass's reason is empty unless the call was close.** A pass marked *Borderline* says what
  nearly made it a flag, so the line drawn here can be checked.

Coverage is checked rather than asserted. This exits 0 only when the rows below are exactly
the nodes using these five templates, each once, each `pass` or `flag`:

```zsh
node web/scripts/audit-coverage.mjs docs/audits/figure-captions.md \
  update-spectrum loss-curve attention-heatmap threshold-sweep router-dispatch
```

## Templates

What each template draws and what each param does. References are `file:line` in
[`web/src/components/viz/`](../../web/src/components/viz/) as of commit `92901db`. Every
component receives the node's `params`, the first of its `param_controls` and its captions
([`VizIsland.astro`](../../web/src/components/VizIsland.astro)), and the control replaces its
param's value as it is dragged.

### `update-spectrum` — `UpdateSpectrum.tsx`, `spectrum.ts`

Two groups of bars side by side, labelled `before` and `after` (UpdateSpectrum.tsx:73-76),
every bar the same violet (UpdateSpectrum.tsx:136). The left group is a seeded, steeply
decaying sequence, sorted largest first and scaled so its tallest bar is 1
(spectrum.ts:83-87). The right group is the same values, each pulled toward the group's mean
by a fraction *t* (spectrum.ts:92-93): the total is preserved, so tall bars fall as short ones
rise, and the order never changes. At *t* = 1 every bar sits at the mean, between about 0.4
and 0.8 of the tallest depending on the seed, and lower with more bars. The header lists
every param (UpdateSpectrum.tsx:66-70).

| param | what it does | where |
|---|---|---|
| `bars` | Bars per group, 2–24, default 8 | spectrum.ts:76, UpdateSpectrum.tsx:59 |
| the control, whatever its name | Sets *t* from its position between `min` and `max`, eased as 1 − (1 − x)², so the first part of a drag moves it most. *t* = 0 at `min`, where the right group equals the left, and 1 at `max`, where it is flat | spectrum.ts:56-62, UpdateSpectrum.tsx:58 |
| anything else | Shown in the header and drawn nowhere | UpdateSpectrum.tsx:55-59 |

The contract is that raising the control flattens the right group (spectrum.ts:8-14). With no
control, *t* is 0 and the groups are identical. What it cannot draw, which is what most flags
below come down to:

- **A bar removed, zeroed, merged, added or highlighted.** The count is fixed by `bars`
  (spectrum.ts:76), every bar keeps a 2% floor (UpdateSpectrum.tsx:132-135), and all are one
  violet.
- **Anything sharper than the left group.** *t* is clamped at 0 (spectrum.ts:77), so the
  control's minimum is the steepest the right group gets.
- **A change on the left.** The left group reads only the seed and `bars` (spectrum.ts:83-87).
- **A total that shrinks or grows, or a level other than the mean.** Flattening preserves the
  total (spectrum.ts:89-93); nothing rises to the tallest bar's height or falls toward zero.

### `loss-curve` — `LossCurve.tsx`, `losscurve.ts`

Loss against training step (LossCurve.tsx:6): a solid line of 120 samples (losscurve.ts:46)
and, when a param calls for one, a dashed counterfactual on the same vertical scale
(LossCurve.tsx:63, 100-117). Under the plot: `step 0`, `dashed = <label>` and the value of
`steps` (LossCurve.tsx:121-125). The header lists every param but `holdout` and `decay`
(LossCurve.tsx:44, 79-84). The solid line starts at 6 and falls fast, then slowly, toward a
floor (losscurve.ts:97, 108-109), with seeded jitter (losscurve.ts:133).

| param | what it does | where |
|---|---|---|
| `steps` | The x-axis's end label, default 1000, and the denominator of the warmup fraction. The line is always 120 samples from start to end, so `steps` relabels the run rather than lengthening it | losscurve.ts:75, 100; LossCurve.tsx:124 |
| `lr` | Descent speed, 1 + 900·`lr`. Above 0.006 the run oscillates and climbs. With no warmup and `lr` above 0.0015 the run opens with a spike of 2.4·`lr`/0.004, gone by 12% of the run | losscurve.ts:49, 108, 116-126 |
| `batch` | Jitter amplitude, 0.35/√`batch`, default 64 | losscurve.ts:99, 133 |
| `params` | The floor, 1.4·`params`^−0.076: a pure power law with no data term. Step 0 stays at 6, so a bigger model lowers the tail and leaves the start where it was | losscurve.ts:96-97 |
| `decay` | Lowers the last stretch, by `decay`·0.28·(6 − floor)·u^2.2, and summons a dashed `flat rate` run without it | losscurve.ts:112, 153-155 |
| `warmup` | Steps of ramp, inside which the loss sits up to 0.5 higher instead of spiking; summons a dashed `no warmup` run | losscurve.ts:100, 127-131, 156-158 |
| `holdout` | Summons a dashed `held-out` line: the solid line plus `holdout`·2.6·(u − 0.32)^1.7 once 32% of the run has passed. It is never below the solid line, and its gap depends on nothing but `holdout` and the step | losscurve.ts:145-152 |

Any other key is dropped (losscurve.ts:73-83). There is one dashed line at most: `holdout`
wins over `decay`, which wins over `warmup` (losscurve.ts:145-158). What it cannot draw: a
held-out line that crosses the solid one, or whose gap closes or answers to anything but
`holdout` and the step; a floor that stops falling as `params` grows; any x-axis but the
run's own steps. The `no warmup` line can cross the solid one and meet it again, since the
ramp opens higher than an unwarmed run once its spike is gone.

### `attention-heatmap` — `AttentionHeatmap.tsx`, `attention.ts`

A grid of query rows against key columns, `query ↓` and `key →`
(AttentionHeatmap.tsx:114-117). Each row is a softmax and sums to one (attention.ts:124-129).
A cell's opacity is its weight divided by the brightest cell in the frame, floored at 0.06
(AttentionHeatmap.tsx:106), so the brightest cell is full violet whatever its weight. A masked
cell is an outline rather than a dark fill, "cannot see" rather than "looked and found
nothing" (AttentionHeatmap.tsx:102-108). The header hides `lookahead`, `keys`, `decay` and
`sink` (AttentionHeatmap.tsx:42).

Before the softmax every cell's score is seeded noise in [0, 2) (attention.ts:118). There is no
content in it, no diagonal, no alignment and no match, beyond the two terms below.

| param | what it does | where |
|---|---|---|
| `tokens` | Rows, 2–24, default 8 | attention.ts:76 |
| `keys` | Columns, 2–24, default `tokens` | attention.ts:79 |
| `lookahead` | How far ahead of itself a row may read: cell (i, j) is masked when j > i + `lookahead`. 0 draws the causal triangle; absent means 64, unmasked. Keys behind a row are never masked, at any value | attention.ts:81, 112 |
| `heads` | Which head is drawn, always the last, and how sharply: scores are scaled by 1 + log₂ `heads`. Also sets that head's slope under `decay` | attention.ts:82, 98-103 |
| `decay` | A penalty of slope·(i − j) on keys **behind** the row only; the diagonal and keys ahead are never penalised. With one head the slope is `decay` | attention.ts:83, 99, 119 |
| `sink` | Adds 6·`sink` to column 0 in every row. Column 0 is the first key, not an extra one | attention.ts:84, 120 |

What it cannot draw: a bright diagonal in an unmasked grid, since `decay` leaves the diagonal
and every key ahead of it unpenalised, which is why nodes wanting one set `lookahead: 0` and
mask the upper triangle; locality centred on a cell, since the penalty is one-sided; a
particular match in a row, since scores are noise; an absolute weight, since brightness is
rescaled to each frame's brightest cell, so dragging in more keys does not dim the grid.
Within one frame a row sharing its weight among more keys does look dimmer, which is why a
causal grid's first row is always the brightest.

### `threshold-sweep` — `ThresholdSweep.tsx`, `threshold.ts`

Two overlapping humps on one unlabelled axis: the population that should be flagged in violet
at 85%, the one that should not at 40% (ThresholdSweep.tsx:90-94), and a vertical cut
(ThresholdSweep.tsx:95-103). Everything right of the cut is flagged; under the axis,
`let through · cut · flagged` (threshold.ts:121-128, ThresholdSweep.tsx:106-110). Under the
figure, three counts out of 1,000 (threshold.ts:26), caught, false alarms and missed, and
precision as a percentage (ThresholdSweep.tsx:116-119). Recall and the total are only in
the screen-reader line (threshold.ts:157-163).

| param | what it does | where |
|---|---|---|
| `separation` | Where the should-be-flagged hump sits, in spreads; the other sits at 0. 0–6, default 2. In axis units it moves only that hump, so false alarms do not change with it. On screen the axis stretches with it, so the other hump narrows and slides left, and the cut slides with it | threshold.ts:74, 103-110 |
| `threshold` | Where the cut falls on the same axis, −3 to 9, default 1 | threshold.ts:75, 125-128 |
| `base_rate` | Share that should be flagged, 0.001–1, default 0.5. Both humps are scaled together by it, so a rare population draws small | threshold.ts:76, 111-118 |

The axis runs from −3 to `separation` + 3 (threshold.ts:103-105). The contract is that raising
the threshold flags fewer of both populations (threshold.ts:10-13). What it cannot draw: the
population to be flagged anywhere but the right-hand hump, on the flagged side; a change in
how many should be flagged except through `base_rate`.

### `router-dispatch` — `RouterDispatch.tsx`, `routing.ts`

Six fixed tokens, "the protein folds into a helix" (routing.ts:12), routed across experts. At
Intuition and Math depth, a token × expert grid: first choice solid, later choices fading
(routing.ts:170-173), unchosen cells outlined and dropped ones dashed
(RouterDispatch.tsx:263-281), with a `load` row underneath (RouterDispatch.tsx:149-154) and
device bands `D1…` when `devices` is above 1 (RouterDispatch.tsx:123-136). At Engineer depth,
one bar per expert, accepted load over capacity (RouterDispatch.tsx:168-191). Router scores
are seeded per concept and independent of `top_k` (routing.ts:72-75), so raising it only
adds chosen cells. A chosen cell can still switch between kept and dropped, because capacity
grows with `top_k` and tokens are served in order (routing.ts:97, 110-123).

| param | what it does | where |
|---|---|---|
| `experts` | Columns, default 8 | RouterDispatch.tsx:55, routing.ts:88 |
| `top_k` | Experts per token, default 2, clamped to 1…`experts` | RouterDispatch.tsx:56, routing.ts:89 |
| `capacity_factor` | Each expert accepts ⌈factor · tokens · `top_k` / `experts`⌉ assignments; tokens arriving at a full expert are dropped, in token order | RouterDispatch.tsx:57, routing.ts:97, 110-123 |
| `devices` | Groups the expert columns into device bands and changes no routing | RouterDispatch.tsx:90-91, 123-136 |

### `budget-split` — `BudgetSplit.tsx`, `share.ts`

One stacked bar, a whole divided in two (BudgetSplit.tsx:6-12). The left segment, solid
violet, is the part; the right, the same violet at 45%, is the rest (BudgetSplit.tsx:70-75).
The part's width is part / (part + `share_rest`) as a whole percent (share.ts:29-39,
BudgetSplit.tsx:52-57), so the bar reads 100% only once the part is 199 times the rest. Under
the bar, `<control> · N%` on the left and `rest · (100 − N)%` on the right
(BudgetSplit.tsx:55-56, 78-83). The left label is the control's name with underscores as
hyphens (BudgetSplit.tsx:33) and the right one is always `rest`, so only the caption can say
what the rest stands for ([ADR-0007](../adr/0007-budget-split-primitive.md)). The header
lists every param but `share_rest` (BudgetSplit.tsx:60, 66). The bar is the same at every
depth; `caption_engineer`, which one node has, only swaps the caption
(BudgetSplit.tsx:89-100).

| param | what it does | where |
|---|---|---|
| the control, whatever its name | Is the part. The slider's value goes straight in, so the part is that value in `share_rest`'s units and the share is value / (value + `share_rest`). All 351 nodes have exactly one | BudgetSplit.tsx:45-53, share.ts:29-33 |
| `share_rest` | The rest, a constant: nothing moves it. Not shown in the header | share.ts:29-33, BudgetSplit.tsx:53, 60 |
| `part` | The part when a node has no control, which none here lacks | BudgetSplit.tsx:52 |
| anything else | Shown in the header and drawn nowhere: `d_model` on three nodes, `heads` on one | BudgetSplit.tsx:60, 66 |

The contract is that raising the control raises the part's share, saturating rather than
marching to 100% (share.ts:7-11). What it cannot draw, which is what most flags below come
down to:

- **A rest that changes.** `share_rest` is a constant, so whatever the part gains is added to
  the whole rather than taken from the rest. A fixed whole re-divided, k of N against N − k,
  is drawn as k against a constant, and the part reaches the whole only by rounding. On
  screen the rest's segment still narrows as the part grows; rounding to a whole percent
  (share.ts:37-39) can hold it still for a run of steps, never across the range.
- **A rest of one when `share_rest` is more.** Whatever `share_rest` holds is the rest's size
  in the part's units, whatever the caption calls it.
- **A part inside the rest.** The two are drawn side by side, so a part as large as the thing
  containing it fills half the bar.
- **Any curve but part / (part + rest).** Not linear, not a square root, not exponential, and
  no cliff or peak. From a slider starting at zero the share rises fastest at the left and
  slows all the way. The only plateaus are rounding's: where the share moves less than half
  a point a step, the bar can read the same whole percent for many steps (share.ts:37-39).
- **A second quantity.** One bar, two segments and two percentages: no cost, metric, total,
  line or second model.

## Verdicts — five smaller templates (#559)

**131 nodes: 95 pass, 36 flag.**

Within each template, flags come first and then passes, each in alphabetical order.

### `update-spectrum` — 51 nodes: 32 pass, 19 flag

| id | template | verdict | reason |
|---|---|---|---|
| backpropagation | update-spectrum | flag | Asks the reader to watch the signal attenuate as depth grows; flattening preserves the total (spectrum.ts:89-93), so the right group's tall bars fall while its short ones rise from 0.45 to 0.65 of the peak and nothing weakens overall. |
| beam-search | update-spectrum | flag | Calls the groups surviving candidates against pruned ones and promises a wider beam keeps more of the field alive; the groups are the same 8 values before and after flattening (UpdateSpectrum.tsx:73-76, spectrum.ts:93), so nothing is pruned and no candidate survives or dies. |
| byte-pair-encoding | update-spectrum | flag | Promises frequent pairs fusing as merges rise; both groups always hold the same 8 bars (spectrum.ts:76) and the control only pulls the right group toward its mean (spectrum.ts:93), so no two bars ever combine. |
| determinism-and-reproducibility | update-spectrum | flag | Says pinned runs land on one outcome that live nondeterminism spreads into a range whose width can be read; the left group is a 12-bar decay from 1 down to 0.22 (spectrum.ts:83-87), not one outcome, and flattening keeps all 12 bars in place (spectrum.ts:76, 93), so no width grows. |
| dropout | update-spectrum | flag | Promises units dropped and the representation thinning out; the template drops nothing, since every bar is pulled toward the shared mean with a 2% floor (spectrum.ts:93, UpdateSpectrum.tsx:132-135), so the right group evens out and only the preserved total matches the caption. |
| gradient-clipping | update-spectrum | flag | Says the rest pass through untouched while the outliers are pulled in; every bar moves toward the mean (spectrum.ts:93), so at the default the smallest norm rises from 0.34 to 0.48 of the peak as the largest falls. |
| knowledge-distillation | update-spectrum | flag | Says the small probabilities are invisible at temperature one; the control runs 0 to 1, so temperature one is its maximum, where t = 1 pulls the right group completely flat (spectrum.ts:56-62, 93) and the small bars are as tall as they ever get. |
| layer-normalization | update-spectrum | flag | Promises the raw signal drifting while the normalized one keeps its scale; it is the other way round, since the left group reads only the seed and `bars` and never moves (spectrum.ts:83-87), while the right group flattens as `spread` rises (spectrum.ts:93). |
| llm-as-judge | update-spectrum | flag | Describes the scores one pair gets in each presentation order, which is two scores, but each group draws 8 seeded bars (spectrum.ts:76, 83) and averaging over swaps only flattens the right group (spectrum.ts:93); no pair of order-specific scores is drawn to cancel. |
| muon-optimizer | update-spectrum | flag | Says the spectrum flattens toward one; bars are scaled so the left group's tallest is 1 (spectrum.ts:86-87) and flattening pulls every bar to the group mean (spectrum.ts:89-93), here 0.67, so the largest singular value falls instead of the rest rising to one. |
| nucleus-sampling | update-spectrum | flag | Promises a highlighted nucleus and a tail cut away as p falls; every bar is the same violet (UpdateSpectrum.tsx:136), none is ever removed (spectrum.ts:76), and lowering p only returns the right group to the left group's shape (spectrum.ts:56-62, 93). |
| positional-encoding | update-spectrum | flag | Calls the control the band count, but the number of bands drawn is fixed by `bars` at 8 (UpdateSpectrum.tsx:59, spectrum.ts:76); dragging `frequencies` only flattens the right group (spectrum.ts:93), so no band is added and nothing shows how finely position is resolved. |
| proximal-policy-optimization | update-spectrum | flag | Says the rest pass through while the largest moves are pulled back to the band; every bar moves toward the shared mean (spectrum.ts:93), so the small ones rise, and there is no band, only the mean they all converge on. |
| residual-connection | update-spectrum | flag | Asks the reader to drag depth and watch the unaided signal decay while the residual one holds; the unaided (left) group never moves (spectrum.ts:83-87), and the residual (right) group is the one that changes, flattening as depth rises (spectrum.ts:93). |
| rmsnorm | update-spectrum | flag | Promises inputs of very different scale arriving at one normalized scale; the input (left) group is fixed whatever `spread` is (spectrum.ts:83-87), and the output (right) group is the one that changes, flattening as `spread` rises (spectrum.ts:93). |
| rotary-position-embedding | update-spectrum | flag | Calls the control a count, but the bars are fixed at 8 (UpdateSpectrum.tsx:59, spectrum.ts:76), and raising `frequencies` flattens the right group toward its mean (spectrum.ts:93), so the spread of rates the caption points at shrinks to nothing at the top of the range. |
| softmax | update-spectrum | flag | Promises a collapse onto the argmax as temperature falls; the template never sharpens past the left group, since at the control's minimum t is 0 and the right group equals the left (spectrum.ts:56-62, 77), whose smallest bar is still 0.47 of the largest. |
| tokenization | update-spectrum | flag | Promises sequences shortening as the vocabulary grows; both groups always hold 8 bars (spectrum.ts:76), and raising `vocab` only pulls the right group toward its mean (spectrum.ts:93), so the token count never changes. |
| top-k-sampling | update-spectrum | flag | Promises the tail disappearing as k changes; no bar is ever removed (spectrum.ts:76, UpdateSpectrum.tsx:132-135), and k only sets how flat the right group is, so at k = 1 it equals the untruncated left group (spectrum.ts:56-62, 93). |
| adam | update-spectrum | pass | |
| autoregressive-decoding | update-spectrum | pass | |
| bayesian-neural-network | update-spectrum | pass | |
| calibration | update-spectrum | pass | |
| conditional-computation | update-spectrum | pass | |
| contrastive-learning | update-spectrum | pass | Borderline: "positives against negatives" reads as a name for the two groups, which are labelled before and after (UpdateSpectrum.tsx:74-75). Read as describing the scores inside a group, highest first, it fits what is drawn. |
| cross-entropy-loss | update-spectrum | pass | Borderline: the groups are labelled before and after (UpdateSpectrum.tsx:74-75) and the caption names them prediction and target. Read as left = target and right = prediction, everything it asks the reader to watch is drawn, the loss through the top bar's height. |
| data-mixing | update-spectrum | pass | |
| entropy | update-spectrum | pass | |
| feature-attribution | update-spectrum | pass | |
| label-smoothing | update-spectrum | pass | |
| language-imbalance | update-spectrum | pass | |
| logistic-regression | update-spectrum | pass | |
| low-rank-factorization | update-spectrum | pass | Borderline: the right group is called truncated, but the caption itself says it flattens, which is what is drawn (spectrum.ts:93). Truncation proper, the small singular values dropped, is not something this template can show. |
| matrix-factorization | update-spectrum | pass | Borderline: the right group is called truncated, but the caption itself says it flattens, which is what is drawn (spectrum.ts:93). Truncation proper, the small singular values dropped, is not something this template can show. |
| momentum | update-spectrum | pass | |
| oversmoothing | update-spectrum | pass | |
| probabilistic-forecasting | update-spectrum | pass | |
| quantization | update-spectrum | pass | |
| sampling-temperature | update-spectrum | pass | |
| score-matching | update-spectrum | pass | |
| seasonality | update-spectrum | pass | |
| sharpness | update-spectrum | pass | |
| sim-to-real | update-spectrum | pass | |
| sparse-autoencoder | update-spectrum | pass | |
| sparse-retrieval | update-spectrum | pass | |
| spectrogram | update-spectrum | pass | |
| text-to-speech | update-spectrum | pass | |
| value-function | update-spectrum | pass | |
| vector-quantization | update-spectrum | pass | |
| weight-decay | update-spectrum | pass | |
| weight-initialization | update-spectrum | pass | |

### `loss-curve` — 33 nodes: 28 pass, 5 flag

| id | template | verdict | reason |
|---|---|---|---|
| data-scaling-laws | loss-curve | flag | Calls the shrinking gain per doubling what a data constraint looks like; the floor is a pure power law in `params`, 1.4·params^-0.076 (losscurve.ts:96), with no data term, so nothing saturates: the last doubling (20 to 40) lowers the run's end by 0.05 against 0.08 for the first. |
| early-stopping | loss-curve | flag | Points to "the crossing" as where stopping pays; the held-out line is the training line plus a gap that is never negative (losscurve.ts:148-151), so the two never cross. What turns, at about 80% of the run at the default `holdout`, is the held-out line's own minimum. |
| probing-classifier | loss-curve | flag | Implies capacity opens the gap between the fitted and held-out lines ("the held-out line trails it"); the held-out line is the fitted line plus a gap set only by `holdout` and the step (losscurve.ts:145-152), so dragging `params` moves both down together and the end gap stays 0.40 from 0.05 to 40. |
| quantization-aware-training | loss-curve | flag | Says training with the gap in the loop pulls the second curve back down; the dashed line is the main line plus a gap that only widens after the first 32% of the run (losscurve.ts:148-151), so no setting draws it returning toward the first. |
| sampling-steps | loss-curve | flag | Says capacity stops buying anything past a floor that more sampling steps would lower; the floor keeps falling as 1.4·params^-0.076 across the whole slider (losscurve.ts:96), and the template has no sampling-step parameter, since its x-axis, `step 0` to 1000, is the run's own progress (LossCurve.tsx:6, 121-125). |
| compute-optimal-training | loss-curve | pass | |
| diffusion-model | loss-curve | pass | |
| direct-preference-optimization | loss-curve | pass | |
| distribution-shift | loss-curve | pass | |
| dp-sgd | loss-curve | pass | |
| edge-of-stability | loss-curve | pass | |
| emergent-abilities | loss-curve | pass | |
| gradient-boosting | loss-curve | pass | |
| gradient-descent | loss-curve | pass | |
| imitation-learning | loss-curve | pass | |
| learning-rate | loss-curve | pass | |
| learning-rate-schedule | loss-curve | pass | |
| loss-function | loss-curve | pass | |
| manipulation | loss-curve | pass | |
| membership-inference | loss-curve | pass | |
| neighborhood-sampling | loss-curve | pass | |
| overfitting | loss-curve | pass | |
| perplexity | loss-curve | pass | |
| pretraining | loss-curve | pass | |
| regularization | loss-curve | pass | |
| rlhf | loss-curve | pass | |
| robustness-accuracy-tradeoff | loss-curve | pass | |
| scaling-laws | loss-curve | pass | Borderline: step 0 stays at 6 for every `params` (losscurve.ts:97, 109), so "the whole curve" pivots on its first point rather than shifting, though everything after it does move down. |
| shortcut-learning | loss-curve | pass | |
| stochastic-gradient-descent | loss-curve | pass | Borderline: "while each step costs more" is not drawn, since `batch` only sets the jitter (losscurve.ts:99), but what the caption asks the reader to watch, the trajectory smoothing, is. |
| time-series-forecasting | loss-curve | pass | |
| vision-transformer | loss-curve | pass | |
| warmup | loss-curve | pass | |

### `attention-heatmap` — 23 nodes: 15 pass, 8 flag

| id | template | verdict | reason |
|---|---|---|---|
| clip | attention-heatmap | flag | Describes image-text similarity across a batch, where every off-diagonal pair is a negative; `lookahead: 0` draws the upper triangle as masked outlines, meaning "cannot see" here (attention.ts:112, AttentionHeatmap.tsx:102-108), so half the negatives appear as pairs never scored. The bright diagonal comes from `decay` penalising only keys left of it (attention.ts:119). |
| dense-retrieval | attention-heatmap | flag | Describes query-passage scores across a batch with in-batch negatives; `lookahead: 0` draws the upper triangle as masked outlines (attention.ts:112, AttentionHeatmap.tsx:102-108), so half the in-batch negatives appear as pairs never scored. The bright diagonal comes from `decay` penalising only keys left of it (attention.ts:119). |
| graph-attention | attention-heatmap | flag | Promises each node's fixed budget spreading thinner as neighbours are added; brightness is rescaled to each frame's brightest cell (AttentionHeatmap.tsx:106), so from 10 to 24 neighbours the mean weight per cell falls from 0.10 to 0.04 while mean brightness holds at 0.35 and bright cells per row roughly triple. |
| graph-transformer | attention-heatmap | flag | Promises one virtual node added and joined to all the others, as how distant nodes reach each other in one hop; `sink` brightens column 0, the first of the 12 nodes rather than an extra one (attention.ts:120), and the grid is unmasked (attention.ts:81, 112), so every node already reads every other directly at any pull. |
| hidden-markov-model | attention-heatmap | flag | Says raising lookahead lets the model see further back, and that at one the whole of history is the current state; `lookahead` unmasks keys ahead of each row (masked when j > i + lookahead, attention.ts:112) and keys behind are never masked, so at 1 every row reads its entire history plus one step ahead. |
| induction-head | attention-heatmap | flag | Says the penalty collapses the head onto the token it just passed; the penalty is zero at distance 0 and falls only on keys behind the row (attention.ts:119), so the weight collapses onto each row's own diagonal cell, 92% of it at the top of the range, not onto the cell before it. |
| optical-flow | attention-heatmap | flag | Promises a single bright cell where each pixel matched, and a cost quadratic in the search radius; scores are seeded noise (attention.ts:118), so each row has two or three comparably bright cells, and the control is `keys`, one column per step (attention.ts:79), so the volume grows linearly in what is dragged. |
| receptive-field | attention-heatmap | flag | Promises influence concentrating at the centre as decay rises; the grid is unmasked and the penalty falls only on keys behind each row (attention.ts:81, 119), so at the top of the range each row's weight piles onto its diagonal cell and the cells right of it (72% right and 27% on the diagonal, averaged over rows), with no centre. |
| alibi | attention-heatmap | pass | |
| attention | attention-heatmap | pass | |
| attention-sink | attention-heatmap | pass | |
| automatic-speech-recognition | attention-heatmap | pass | |
| causal-discovery | attention-heatmap | pass | Borderline: what grows on screen is the n×n grid; the space of candidate graphs, and the data it outgrows, are context the caption adds rather than marks it points at. |
| causal-masking | attention-heatmap | pass | |
| cross-attention | attention-heatmap | pass | |
| dilated-convolution | attention-heatmap | pass | |
| dynamic-programming-inference | attention-heatmap | pass | Borderline: each row draws one cell per state (attention.ts:79), so the table widens linearly; the square of the states is the work behind each row, which the caption gives as context, not as something on screen. |
| long-range-dependency | attention-heatmap | pass | |
| masked-language-modeling | attention-heatmap | pass | |
| multi-head-attention | attention-heatmap | pass | |
| query-key-value | attention-heatmap | pass | |
| self-attention | attention-heatmap | pass | |
| streaming-asr | attention-heatmap | pass | |

### `threshold-sweep` — 22 nodes: 18 pass, 4 flag

| id | template | verdict | reason |
|---|---|---|---|
| needle-in-a-haystack | threshold-sweep | flag | Says dragging distinctiveness up makes the task trivial; the control is `separation`, which only pulls the found and not-found humps apart on an axis the caption already calls distinctiveness, while the share of contexts where the model finds the target stays at `base_rate` 0.5 (threshold.ts:72-78, 118). |
| refusal | threshold-sweep | flag | Says raising the threshold makes refusals of harmful and harmless requests both rise; the template's contract is the reverse, since everything right of the cut is flagged and raising it flags fewer of both (threshold.ts:10-13, 125-126): across the slider caught falls from 150 to 3 and false alarms from 823 to 1. |
| selective-prediction | threshold-sweep | flag | Says everything left of the cut goes to a person; the template flags everything right of the cut and labels the left `let through` (threshold.ts:125-126, ThresholdSweep.tsx:106-110), and it draws the mistakes, the population to be caught, at the high-confidence end. |
| semi-supervised-learning | threshold-sweep | flag | Says every pseudo-label kept below the threshold is trained on as though it were real; in the template the kept side is right of the cut, labelled `flagged` (threshold.ts:125-126, ThresholdSweep.tsx:106-110), and what lies below the cut is discarded. |
| canary-rollout | threshold-sweep | pass | |
| dangerous-capability-evaluation | threshold-sweep | pass | Borderline: the slider reads `separation` and the caption says "elicitation effort", the cause rather than the quantity in content/schema/README.md's terms, but it also says what moves ("watch them separate"), which the metaphor rule allows. |
| early-exit | threshold-sweep | pass | |
| execution-verification | threshold-sweep | pass | Borderline: "no threshold helps, because a test has none" sits beside a drawn cut, but at `separation` 0 every cut gives precision equal to the base rate, 35% (threshold.ts:107-110, 141), so the claim holds for what is drawn. |
| fairness-criteria | threshold-sweep | pass | Borderline: the two rates conditioned on the truth are not displayed, since the grid shows caught, false alarms, missed and precision (ThresholdSweep.tsx:116-119), but with both populations fixed, caught and false alarms move in proportion to them. |
| guardrail | threshold-sweep | pass | |
| hallucination | threshold-sweep | pass | Borderline: the template always draws the population to be flagged as the right-hand, higher-scoring hump (threshold.ts:107-110), so with confidence as the axis the false statements sit at the more confident end. The caption never says which end, so the figure misleads without the caption claiming anything it cannot show. |
| impossibility-result | threshold-sweep | pass | |
| membership-in-training-data | threshold-sweep | pass | Borderline: the template always draws the population to be flagged as the right-hand, higher-scoring hump (threshold.ts:107-110), so with surprise as the axis the training documents sit at the more surprising end. The caption never says which end, so the figure misleads without the caption claiming anything it cannot show. |
| model-routing | threshold-sweep | pass | |
| online-experiment | threshold-sweep | pass | |
| online-learning | threshold-sweep | pass | |
| out-of-distribution-detection | threshold-sweep | pass | |
| output-watermarking | threshold-sweep | pass | |
| precision-and-recall | threshold-sweep | pass | |
| semantic-cache | threshold-sweep | pass | |
| silent-failure | threshold-sweep | pass | |
| verifier-model | threshold-sweep | pass | Borderline: most of what is accepted is wrong at the left, as claimed (precision 5%), but also at the right, because in axis units `separation` moves only the correct-answer hump (threshold.ts:107-110), so false alarms stay at 194 and precision never passes 20%. |

### `router-dispatch` — 2 nodes: 2 pass, 0 flag

| id | template | verdict | reason |
|---|---|---|---|
| expert-parallelism | router-dispatch | pass | |
| mixture-of-experts | router-dispatch | pass | |

## Verdicts — `budget-split` (#560)

**351 nodes: 303 pass, 48 flag.**

Coverage for this half is checked the same way:

```zsh
node web/scripts/audit-coverage.mjs docs/audits/figure-captions.md budget-split
```

How the rules above were applied to this template, so the line can be checked:

- **"The single X" is one X.** A caption that sets the part against "the single query",
  "the one that ships" or "the load itself", in the part's own units, says the rest is one.
  Sixteen nodes set `share_rest` to between 4 and 20, so at the default the bar shows the
  part at 13–50% where the caption's own units give 75–89%. [`PLAN.md`](../PLAN.md) §8
  records this class: units overclaimed in a caption.
- **How much of the bar a segment takes is read at the top of the slider.** "Everything",
  "crowd out", "swallow", "eat" and the like pass when the rest is 10% or less at the
  control's maximum, are borderline at 11–14%, and are flagged at 15% or more. "Take the run"
  and "take over" mean passing half. A verb for what the system does, "stop learning",
  "stop waiting", is read as a metaphor for the share and not held to a number.
- **A control named by its cause is a borderline pass**, as in #559, when the caption also
  says what visibly moves and the cause would move the part. Each of those rows says what the
  slider actually is. A cause that would move the rest, which the template holds fixed, is a
  flag.
- **A whole the default implies is not a claim.** Where the default sums to a round whole,
  200 + 9,800 = 10,000, and the slider runs to it, the bar shows about half where the whole
  would be full. If the caption names no such whole the row is a borderline pass, as #559's
  `hallucination` was: the figure misleads without the caption claiming anything. A caption
  that names the rest as the whole containing the part does claim it, and is flagged.
- **A growth law is graded when its variable is the control**, or when the reader is told to
  watch that shape. A law in something with no control, duration, population, stride, is
  context.
- **An undrawn quantity said to hold still** is a flag when the reader is told to watch it,
  and a borderline pass when it is an aside.
- **Every percentage in a reason is `percent(split(value, share_rest))`**, the whole percent
  the bar draws, at the control's minimum, the node's value, its maximum, or a value the
  caption names, at slider positions the step can reach.

Flags by kind:

| kind | flags | nodes |
|---|---|---|
| "The single X", drawn as several | 16 | `action-chunking`, `autotuning`, `deduplication`, `few-shot-learning`, `flow-matching`, `gradient-leakage`, `hierarchical-rl`, `implicit-feedback`, `meta-learning`, `process-supervision`, `script-and-orthography`, `self-consistency`, `self-play`, `streaming-synthesis`, `tiling`, `weight-averaging` |
| An end state the bar cannot reach | 8 | `aleatoric-uncertainty`, `context-window`, `decision-tree`, `hybrid-search`, `kernel-fusion`, `loss-spike`, `patch-embedding`, `speech-representation-learning` |
| A shape the share cannot take | 7 | `elo-rating`, `feature-pyramid`, `multilingual-model`, `principal-component-analysis`, `rollback`, `search-over-thoughts`, `sparsity-hardware` |
| A mark that is not drawn, or one said to hold still that moves | 6 | `benchmark-contamination`, `convolutional-network`, `energy-cost-of-inference`, `image-generation-evaluation`, `merge-vs-ensemble`, `sequence-labelling` |
| A part drawn beside the whole that contains it | 4 | `flash-attention`, `lottery-ticket-hypothesis`, `manifold-hypothesis`, `numerical-stability` |
| A number the bar disagrees with | 3 | `agentic-coding`, `feed-forward-network`, `transformer-block` |
| A direction the template reverses | 3 | `certified-robustness`, `gradient-accumulation`, `variational-autoencoder` |
| A control that is not there, acting on the fixed rest | 1 | `beam-search-tradeoffs` |

77 of the passes carry a *Borderline* note. Flags come first and then passes, each in
alphabetical order.

| id | template | verdict | reason |
|---|---|---|---|
| action-chunking | budget-split | flag | Puts the steps a chunk executes against "the decision that produced them", in steps, but the rest is 6 steps (share_rest), so the default chunk of 6 draws the one decision as large as the chunk, 50%, where 6 against one would be 86% (share.ts:29-33). |
| agentic-coding | budget-split | flag | Tells the reader to drag the task length, but the slider is `failed_trajectories`, the failures task length causes; and the completed share it gives for fifty actions, under a tenth, is out of reach, since 240 failed against a fixed 40 completed still leaves 14% (share.ts:29-33). |
| aleatoric-uncertainty | budget-split | flag | Says the irreducible share swallows the rest as label noise rises; the rest is fixed at 40 (share.ts:29-33), so at the top of the slider, 120, label noise holds 75% and a quarter of the bar is still error a better model could remove. |
| autotuning | budget-split | flag | Puts the configurations measured against "the one that ships", in candidates, but the rest is 8 candidates (share_rest), so the default of 8 tried draws 50% where 8 against one would be 89% (share.ts:29-33). |
| beam-search-tradeoffs | budget-split | flag | Tells the reader to drag the beam width up, but the slider is `model_errors`, and a wider beam would shrink the search errors, which the template holds fixed at 40 (share.ts:29-33). Model error never takes everything either: at the top of the slider it is 86%. |
| benchmark-contamination | budget-split | flag | Promises a weak model closing the gap; there is one score split and no second model to close on. The slider reads as a contamination rate, and at the default, 10, the bar agrees at 10%, but the rest is fixed at 90 (share.ts:29-33), so a rate of 50 draws 36% memorised against 64% genuine, and the two segments never meet either. |
| certified-robustness | budget-split | flag | Names the rest as the clean accuracy given up and says the classifier gets worse as the noise rises; the rest is fixed at 18 (share.ts:29-33), so its share falls from 75% at the default to 9% at the top, and the cost the caption says grows is drawn shrinking. |
| context-window | budget-split | flag | Says the conversation crowds everything else out; the reserve is fixed at 1,096 tokens (share.ts:29-33), so at the top of the slider, 4,096 tokens used, it still holds 21% of the bar. |
| convolutional-network | budget-split | flag | Says the convolution's bar never moves; there is one bar, and the convolution is its right-hand segment, which narrows from 67% at the default to 9% at the top (share.ts:29-33, BudgetSplit.tsx:70-75). Its count is fixed, but on screen it moves as much as the dense part does. |
| decision-tree | budget-split | flag | Says the training set becomes pure as the tree deepens; the impurity left at the leaves is fixed at 7 (share.ts:29-33), so at the top of the slider, 20 removed, 26% of the bar is still impurity. The slider is the impurity removed, not the depth the caption names. |
| deduplication | budget-split | flag | Puts the repeated copies against the document's "single original", in copies, but the rest is 6 copies (share_rest), so the default of 6 repeats draws 50% where 6 against one would be 86% (share.ts:29-33). |
| elo-rating | budget-split | flag | Says the unresolved share shrinks with the square root of the votes; the template draws it as 40 / (votes + 40) (share.ts:29-33), which falls like one over the votes, so quadrupling them from 40 to 160 takes it from 50% to 20%, not to 25%. |
| energy-cost-of-inference | budget-split | flag | Says "the two lines cross exactly once"; the template draws one stacked bar and no lines (BudgetSplit.tsx:70-75). What does happen once is the serving share crossing half, at 100 against training's fixed 100 (share.ts:29-33). |
| feature-pyramid | budget-split | flag | Asks the reader to drag the levels up and watch the bar stop, because each level has a quarter of the one below; the slider adds coarse pixels one at a time, not levels, so the bar climbs a point at 25 of its 33 steps and stops only where the slider ends, at 33, on the 25% the caption gives (share.ts:29-33). |
| feed-forward-network | budget-split | flag | Says d_ff at the conventional 4× d_model takes two thirds; the header shows `d_model = 512`, and at d_ff 2,048 the bar reads 50%, because `share_rest` is 2,048, four times d_model rather than the two times the engineer caption's formula uses (share.ts:29-33). Two thirds arrives at 4,096, eight times d_model, so that caption's "exactly 4/6" fails too. |
| few-shot-learning | budget-split | flag | Puts the support examples against "the single query being classified", in examples, but the rest is 4 examples (share_rest), so the default of 4 support examples draws 50% where 4 against one would be 80% (share.ts:29-33). |
| flash-attention | budget-split | flag | Puts the traffic tiling saves against what a materialised score matrix would move, which contains it, but the template draws the two side by side (share.ts:29-33): at the default tile, 128, the saving equals the whole and fills half the bar. The trade the drag promises, on-chip residency against passes, has no mark either. |
| flow-matching | budget-split | flag | Puts the evaluations spent against "the single evaluation a perfectly straight path would need", in evaluations, but the rest is 6 evaluations (share_rest), so the default of 6 steps draws 50% where 6 against one would be 86% (share.ts:29-33). |
| gradient-accumulation | budget-split | flag | Says peak memory falls as the micro-batch count rises; the part is the activations' share of memory, and raising the control raises it (share.ts:7-11), from 50% at the default 4 to 89% at 32, so the figure shows activations taking more of memory, not less. The step taking longer is not drawn. |
| gradient-leakage | budget-split | flag | Puts the examples summed into the gradient against "the single example an attacker wants back", in examples, but the rest is 4 examples (share_rest), so the default batch of 4 draws 50% where 4 against one would be 80% (share.ts:29-33). |
| hierarchical-rl | budget-split | flag | Puts the steps an option runs against "the decision that launched it", in steps, but the rest is 8 steps (share_rest), so the default option of 8 draws the one decision as large as the option, 50%, where 8 against one would be 89% (share.ts:29-33). |
| hybrid-search | budget-split | flag | Says the drag slides the ranking between the two scores; the lexical weight is fixed at 50 (share.ts:29-33), so the left end is all lexical but the top of the slider, 100, still draws 33% lexical, and the ranking never reaches the dense end. |
| image-generation-evaluation | budget-split | flag | Asks the reader to watch a distribution metric stay perfectly happy; no metric is drawn, only the memorised share of the images, which rises from 33% at the default to 91% at the top (share.ts:29-33), so the one thing on screen moves and nothing stays put. |
| implicit-feedback | budget-split | flag | Puts the sampled negatives against "the single positive they are ranked against", in items, but the rest is 8 items (share_rest), so the default of 8 negatives draws 50% where 8 against one would be 89% (share.ts:29-33). |
| kernel-fusion | budget-split | flag | Promises the traffic collapsing into one pass; the operations still round-tripping are fixed at 5 (share.ts:29-33), so at the top of the slider, 16 fused, 24% of the bar still goes through main memory. |
| loss-spike | budget-split | flag | Says the replay eats the run; the steps that stuck are fixed at 4,000 (share.ts:29-33), so at the top of the slider, 12,000 replayed, they still hold 25% of the bar. |
| lottery-ticket-hypothesis | budget-split | flag | Puts the winning subnetwork against the network it was found inside, but the template draws the two side by side, so a ticket as large as the whole network, 24, fills half the bar (share.ts:29-33), and the ticket only approaches the whole once it is ten times the network it is part of, 256 at the top of the slider. |
| manifold-hypothesis | budget-split | flag | Puts the intrinsic dimension against the ambient dimensions it is stored in, which contain it, but the template draws the two side by side (share.ts:29-33), so data filling all 760 ambient dimensions occupies half the bar, and the slider runs on to 800. |
| merge-vs-ensemble | budget-split | flag | Says the merge's bar never moves; there is one bar, and the merge is its right-hand segment, which narrows from 50% at the default to 7% at the top (share.ts:29-33, BudgetSplit.tsx:70-75). Its cost is fixed, but on screen it moves as much as the ensemble's does. |
| meta-learning | budget-split | flag | Puts the adaptation steps against "the single step the meta-objective is trained through", in steps, but the rest is 6 steps (share_rest), so the default of 6 adaptation steps draws 50% where 6 against one would be 86% (share.ts:29-33). |
| multilingual-model | budget-split | flag | Says each language's share keeps thinning while the gain from sharing saturates; the share left to one language is drawn as 6 / (languages + 6) (share.ts:29-33), whose fall flattens, 17 points from the default, 6, to 12, and none at all from 88 to 96, where the bar reads 94 against 6 throughout. |
| numerical-stability | budget-split | flag | Puts the digits destroyed against the digits the format started with, which contain them, but the template draws the two side by side (share.ts:29-33): destroying all 24 fills half the bar, and the answer only becomes mostly rounding error past 24, more digits than the format has, up to 120 on the slider. The slider is the digits cancelled, not the operands' agreement the caption names. |
| patch-embedding | budget-split | flag | Promises a smaller patch crowding out everything else; the rest of the attention budget is fixed at 1,852 tokens (share.ts:29-33), so at the top of the slider, 3,136 tokens, the image holds 63% and everything else still 37%. |
| principal-component-analysis | budget-split | flag | Promises a few components carrying most of the variance; the captured share is components / (components + 90) (share.ts:29-33), so 10 components carry 10%, half takes 90, and the top of the slider, 200, reaches 69%. Each early component adds about a point, the same as the next, so nothing shows the first few carrying most. |
| process-supervision | budget-split | flag | Puts the step labels against "the single bit an outcome-only reward gives", in signals, but the rest is 20 signals (share_rest), so the default of 3 step labels draws 13% where 3 against one would be 75% (share.ts:29-33). The slider is the step labels, not the reasoning length the caption names. |
| rollback | budget-split | flag | Says the damage grows linearly with the duration; the bar draws minutes / (minutes + 60) (share.ts:29-33), which saturates: the first hour takes it from 0% to 50%, the fourth from 75% to 80%. |
| script-and-orthography | budget-split | flag | Puts the byte variants against "the one a normaliser would keep", in variants, but the rest is 12 variants (share_rest), so the default of 4 variants draws 25% where 4 against one would be 80% (share.ts:29-33). |
| search-over-thoughts | budget-split | flag | Asks the reader to watch the cost explode, branching factor to the depth; the slider adds calls in equal steps of 25 rather than branching, and the share it draws flattens as they grow (share.ts:7-11), from 38% at the default to 95%, slowing the whole way. |
| self-consistency | budget-split | flag | Puts the answers beyond the first against "the single sample a greedy decode would have given", in samples, but the rest is 20 samples (share_rest), so the default of 4 extra answers draws 17% where 4 against one would be 80% (share.ts:29-33). |
| self-play | budget-split | flag | Puts the past versions in the pool against "the current best alone", in versions, but the rest is 20 versions (share_rest), so the default pool of 4 draws 17% where 4 against one would be 80% (share.ts:29-33). |
| sequence-labelling | budget-split | flag | Asks the reader to watch entities fail far faster than tokens do; the slider is `broken_entities`, not the token error rate the caption names, and no token rate is drawn to compare with, so the broken share, 13% to 86%, is the only rate on screen (share.ts:29-33). |
| sparsity-hardware | budget-split | flag | Asks the reader to drag the model's sparsity up and watch the bar stop at half; the slider is `skipped_weights`, not sparsity, so the bar climbs the whole way, 32% at 48, and reaches half only where the slider ends, at 100 (share.ts:29-33). No setting shows sparsity rising while the skipped share holds, which is the caption's point. |
| speech-representation-learning | budget-split | flag | Says that past about half there is little context left; the visible frames are fixed at 52 (share.ts:29-33), so at the top of the slider, 100 masked, 34% of the bar is still visible, and no position shows little context. |
| streaming-synthesis | budget-split | flag | Puts the units per chunk against "the unit that must arrive before audio starts", in units, but the rest is 4 units (share_rest), so the default chunk of 4 draws 50% where 4 against one would be 80% (share.ts:29-33). |
| tiling | budget-split | flag | Puts the uses of each loaded value against "the load itself", in accesses, but the rest is 6 accesses (share_rest), so the default of 6 uses draws 50% where 6 against one load would be 86% (share.ts:29-33). The cliff where the tile stops fitting is not drawn either: the share rises smoothly to 94% at the top. |
| transformer-block | budget-split | flag | Says d_ff at the conventional 4× d_model takes two thirds; the header shows `d_model = 512`, and at d_ff 2,048 the bar reads 50%, because `share_rest` is 2,048, four times d_model rather than two (share.ts:29-33). Two thirds arrives at 4,096, eight times d_model. |
| variational-autoencoder | budget-split | flag | Defines the bar as the KL term in nats and asks the reader to drag the KL weight to watch the latent pulled toward the prior; the slider is `kl_nats`, and raising it raises the KL term's share, from 17% at the default to 83% (share.ts:7-11), while a latent pulled toward the prior carries fewer nats, not more. |
| weight-averaging | budget-split | flag | Puts the checkpoints in the averaging window against "the single final one you would otherwise ship", in checkpoints, but the rest is 20 checkpoints (share_rest), so the default window of 6 draws 23% where 6 against one would be 86% (share.ts:29-33). |
| ablation | budget-split | pass | Borderline: there is no component control to double the untried set or grow the tried set by one; the slider adds untried combinations in steps of 20 and the tried set stays at 20 (share.ts:29-33). Coverage collapsing is drawn. |
| accelerator-utilization | budget-split | pass |  |
| activation-checkpointing | budget-split | pass | Borderline: the default, 6 kept against 30 recomputed, is a 36-layer stack, yet at the slider's 36, every layer kept, the bar still shows 45% recomputed, because the rest is held fixed (share.ts:29-33). The caption names no layer count, so the figure misleads without the caption claiming anything it cannot show. |
| activation-function | budget-split | pass |  |
| activation-patching | budget-split | pass |  |
| activation-steering | budget-split | pass |  |
| active-learning | budget-split | pass |  |
| actor-critic | budget-split | pass |  |
| adamw | budget-split | pass |  |
| adaptive-computation | budget-split | pass |  |
| advantage-estimation | budget-split | pass | Borderline: the bias "traded for" the variance is the fixed rest, 40, so nothing is traded on screen, and the bar has no total for "neither endpoint minimises the total" to point at (share.ts:29-33). What it asks the reader to watch, variance dominating, is drawn. |
| adversarial-example | budget-split | pass |  |
| adversarial-training | budget-split | pass |  |
| agent-evaluation | budget-split | pass |  |
| agent-memory | budget-split | pass |  |
| annotation-quality | budget-split | pass |  |
| any-to-any-model | budget-split | pass | Borderline: the quadratic attention cost the caption says comes with the image tokens is not drawn. The bar splits tokens (share.ts:29-33), not attention cost, which would grow with their square, and the token share is what it asks the reader to watch. |
| approximate-nearest-neighbor | budget-split | pass | Borderline: the default, 200 examined against 9,800 never looked at, is a collection of 10,000, yet at the slider's 10,000 the bar still shows 51% examined, because the rest is held fixed (share.ts:29-33). The caption names no collection size, so the figure misleads without the caption claiming anything it cannot show. |
| arithmetic-intensity | budget-split | pass |  |
| audio-generation | budget-split | pass |  |
| audio-visual-learning | budget-split | pass |  |
| autoencoder | budget-split | pass |  |
| backdoor-attack | budget-split | pass | Borderline: "clean accuracy does not move anywhere along this bar" is about a quantity that is not drawn, and the one clean thing on screen, the examples without the trigger, narrows from 87% at the default to 11% at the top (share.ts:29-33). What it asks the reader to watch, the backdoor taking hold, is drawn. |
| batch-inference | budget-split | pass |  |
| batch-normalization | budget-split | pass |  |
| batch-size | budget-split | pass | Borderline: throughput is not on screen. What is, the batch's share of the step, rises and slows as the batch grows (share.ts:7-11), which is the diminishing return the caption pairs it with. |
| bayesian-inference | budget-split | pass |  |
| bellman-equation | budget-split | pass |  |
| bias-mitigation | budget-split | pass | Borderline: "it can never be zero" sits beside a slider whose left end, 0, draws 0% given up (share.ts:29-33); read as true of any binding constraint, it describes the concept rather than a position on the bar. The cost climbing is drawn. |
| bias-variance-tradeoff | budget-split | pass |  |
| candidate-generation | budget-split | pass |  |
| carbon-accounting | budget-split | pass | Borderline: from the default 20 to the top, 400, the run's emissions grow twentyfold, but the bar draws their share against the fixed energy, which rises from 40% to 93% (share.ts:29-33). Read as the emissions segment widening, the multiplying is drawn. |
| catastrophic-forgetting | budget-split | pass |  |
| causal-inference | budget-split | pass |  |
| chain-of-thought | budget-split | pass |  |
| checkpointing-strategy | budget-split | pass | Borderline: the slider is `checkpoint_minutes`, the minutes an hour spent writing, rather than the frequency the caption names. The write taking the run is drawn, though only just: 60% at the top. |
| chunking | budget-split | pass | Borderline: the caption's "rest of a chunk" is the left, solid segment, labelled `filler-tokens`, while the template labels the right segment, the answering span, `rest` (BudgetSplit.tsx:55-56, 78-83). The word points at opposite sides in the caption and on the bar. |
| classifier-free-guidance | budget-split | pass | Borderline: the slider is `beyond_conditional`, the extrapolation, which is the guidance scale minus one, so a reader taking its value for the scale is off by one. What it asks the reader to watch, the extrapolation becoming most of the move, is drawn. |
| code-generation | budget-split | pass | Borderline: the slider sets the extra problems solved, not the sample budget the caption names, so the saturation on screen is the share's own curve (share.ts:7-11) rather than solves levelling off as samples grow. The share does slow as claimed. |
| code-search | budget-split | pass |  |
| code-switching | budget-split | pass |  |
| cold-start | budget-split | pass |  |
| collaborative-filtering | budget-split | pass |  |
| collective-communication | budget-split | pass | Borderline: the slider is `peers`, the ring size less one, so a reader taking its value for the ring size is off by one. Saturating just below the whole is drawn, 98% at the top. |
| compilation-cache | budget-split | pass |  |
| compression-quality-tradeoff | budget-split | pass |  |
| computer-use | budget-split | pass |  |
| conditional-random-field | budget-split | pass |  |
| conformal-prediction | budget-split | pass | Borderline: the slider is `extra_labels`, the set size coverage buys, rather than the coverage demand the caption names. The hedge swamping the answer is drawn, 93% at the top. |
| confounding | budget-split | pass |  |
| connectionist-temporal-classification | budget-split | pass |  |
| constitutional-ai | budget-split | pass |  |
| constrained-decoding | budget-split | pass | Borderline: the default, 400 legal against 31,600 masked, is a 32,000-token vocabulary, yet at the top of the slider the bar still shows half masked, because the rest is held fixed (share.ts:29-33). The caption names no vocabulary size, so the figure misleads without the caption claiming anything it cannot show. |
| contact-dynamics | budget-split | pass |  |
| context-compression | budget-split | pass |  |
| continual-learning | budget-split | pass |  |
| continuous-batching | budget-split | pass |  |
| convexity | budget-split | pass |  |
| counterfactual | budget-split | pass |  |
| credit-assignment | budget-split | pass | Borderline: the slider and the solid segment are labelled `trajectory_length`, the whole trajectory, while the caption makes that segment only the decisions too far back for the reward to reach. The share it asks the reader to watch, the unattributable part taking over, is drawn. |
| cross-lingual-transfer | budget-split | pass |  |
| cross-modal-retrieval | budget-split | pass |  |
| cross-validation | budget-split | pass | Borderline: the default, 200 held out against 800 trained on, is a dataset of 1,000, yet at the slider's 900 the bar shows 53% held out where 900 of 1,000 would be 90%, because the rest is held fixed (share.ts:29-33). The caption names no dataset size, so the figure misleads without the caption claiming anything it cannot show. |
| curriculum | budget-split | pass |  |
| custom-kernel | budget-split | pass |  |
| data-augmentation | budget-split | pass |  |
| data-filtering | budget-split | pass |  |
| data-parallelism | budget-split | pass |  |
| data-poisoning | budget-split | pass |  |
| data-provenance | budget-split | pass | Borderline: "this bar only moves one way" is true of a real corpus, not of the figure, whose slider drags both ways and whose bar follows it (BudgetSplit.tsx:110-119). What it asks the reader to watch, the unattributed count taking over, is drawn. |
| data-versioning | budget-split | pass |  |
| deceptive-alignment | budget-split | pass | Borderline: the slider is `untested_conditions`, the conditions never visited, rather than the space of possible triggers the caption names. The untested region dominating is drawn, 93% at the top. |
| decoder-only-transformer | budget-split | pass |  |
| deep-ensemble | budget-split | pass |  |
| denoising-schedule | budget-split | pass | Borderline: "the total is yours to divide" describes one budget re-divided, but the template holds the late steps at 18 and grows the total as the high-noise steps rise (share.ts:29-33). In share terms, which is what is drawn, detail does lose the budget. |
| differential-privacy | budget-split | pass |  |
| disaggregated-serving | budget-split | pass | Borderline: "both terms grow with prompt length", but on screen only the transfer does; the time the split saves is the fixed rest, 40 (share.ts:29-33), and there is no prompt-length control. The gain disappearing is drawn, 9% left at the top. |
| disparate-impact | budget-split | pass |  |
| document-understanding | budget-split | pass |  |
| double-descent | budget-split | pass |  |
| effective-context-length | budget-split | pass | Borderline: the slider is `unusable_context`, the advertised length less the 8 it still performs over, so its value is not the advertised length the caption names. The unusable share dominating is drawn, though it already holds 75% at the default. |
| elastic-training | budget-split | pass |  |
| elastic-weight-consolidation | budget-split | pass |  |
| embodiment-gap | budget-split | pass |  |
| encoder-decoder | budget-split | pass |  |
| energy-cost-of-training | budget-split | pass |  |
| ensemble-methods | budget-split | pass |  |
| entity-linking | budget-split | pass | Borderline: there is no depth control, and "81% at four" is not a position on the slider: the default, 6, leaves 87% intact and the next step, 20, leaves 67% (share.ts:29-33). The drag the caption names, the broken count, is the slider, and end-to-end accuracy falling is drawn. |
| epistemic-uncertainty | budget-split | pass |  |
| evaluation-disaggregation | budget-split | pass |  |
| evidence-lower-bound | budget-split | pass |  |
| execution-feedback | budget-split | pass |  |
| expectation-maximization | budget-split | pass |  |
| experience-replay | budget-split | pass |  |
| experiment-tracking | budget-split | pass |  |
| exploration-exploitation | budget-split | pass | Borderline: the slider reads as the rate in percent, 10 at the default where the bar shows 10%, but the exploiting side is fixed at 90 (share.ts:29-33), so 50 draws 36% and the top, 100, draws 53%. The caption states no number, and the share it calls the rate does rise. |
| exposure-bias | budget-split | pass |  |
| failure-recovery | budget-split | pass |  |
| feature-store | budget-split | pass |  |
| federated-learning | budget-split | pass |  |
| feedback-loop | budget-split | pass |  |
| fill-in-the-middle | budget-split | pass |  |
| fine-tuning | budget-split | pass |  |
| fisher-weighted-merging | budget-split | pass |  |
| flops | budget-split | pass |  |
| foundation-model | budget-split | pass |  |
| function-calling | budget-split | pass |  |
| generative-adversarial-network | budget-split | pass |  |
| gpu-memory-hierarchy | budget-split | pass |  |
| grammar-constrained-decoding | budget-split | pass | Borderline: the slider is `masked_tokens`, the count strictness produces, rather than the strictness the caption names. Almost everything being masked is drawn, 91% at the top. |
| graph-capture | budget-split | pass |  |
| graph-convolution | budget-split | pass |  |
| graph-expressivity | budget-split | pass | Borderline: the slider is `separable_pairs`, the pairs told apart, rather than the expressivity the caption names. The blind spot shrinking without reaching zero is drawn, 8% at the top. |
| graph-neural-network | budget-split | pass |  |
| grokking | budget-split | pass |  |
| grounding | budget-split | pass |  |
| group-vs-individual-fairness | budget-split | pass |  |
| grouped-query-attention | budget-split | pass |  |
| human-evaluation | budget-split | pass |  |
| human-in-the-loop | budget-split | pass |  |
| implicit-regularization | budget-split | pass |  |
| in-context-learning | budget-split | pass |  |
| inductive-bias | budget-split | pass |  |
| inference-accelerator | budget-split | pass |  |
| inference-scaling-law | budget-split | pass |  |
| information-bottleneck | budget-split | pass |  |
| instance-segmentation | budget-split | pass | Borderline: the slider is `mask_heads`, the compute in them, rather than the object count the caption names. The per-object cost overtaking the per-image one is drawn, past 40. |
| instruction-tuning | budget-split | pass |  |
| instrumental-variable | budget-split | pass |  |
| interconnect-topology | budget-split | pass | Borderline: the slider is `cross_node_bytes`, the traffic itself, rather than the spread of the chattiest parallelism the caption names. The slow tier taking the traffic is drawn, 83% at the top. |
| intervention | budget-split | pass |  |
| invariant-risk-minimization | budget-split | pass |  |
| jailbreak | budget-split | pass | Borderline: the slider and the solid segment are labelled `attempts`, while the caption makes that segment the prompts that get through, so every added attempt is drawn as a success against a fixed 24 refusals (share.ts:29-33). The success share it asks the reader to watch does grow. |
| job-scheduling | budget-split | pass |  |
| k-means-clustering | budget-split | pass | Borderline: the slider is `variance_removed`, not k, so each step removes the same variance; the shrinking gain on screen is the share's own curve (share.ts:7-11) rather than each cluster buying less. The share does slow as claimed. |
| k-nearest-neighbors | budget-split | pass |  |
| kl-divergence | budget-split | pass |  |
| knowledge-conflict | budget-split | pass |  |
| knowledge-graph | budget-split | pass |  |
| knowledge-graph-embedding | budget-split | pass |  |
| kv-cache | budget-split | pass |  |
| latent-diffusion | budget-split | pass | Borderline: the default, 8 latent cells against 56 removed, is a 64-cell side, yet at the slider's 64, no compression at all, the bar still shows 47% removed, because the rest is held fixed (share.ts:29-33). The caption names no pixel size, so the figure misleads without the caption claiming anything it cannot show. |
| length-extrapolation | budget-split | pass | Borderline: the slider is `unseen_pairs`, not the inference length the caption names, and no position on it is marked as ten times the training length. Unseen distances taking the sequence is drawn, 92% at the top. |
| likelihood-vs-sample-quality | budget-split | pass |  |
| linear-regression | budget-split | pass |  |
| logical-constraint | budget-split | pass |  |
| logit | budget-split | pass |  |
| long-context-training | budget-split | pass |  |
| long-horizon-agent | budget-split | pass |  |
| long-short-term-memory | budget-split | pass |  |
| lora | budget-split | pass |  |
| loss-landscape | budget-split | pass |  |
| lost-in-the-middle | budget-split | pass | Borderline: the slider is `middle_positions`, the context length less the 20 positions at the ends, rather than the context length the caption names. The middle taking almost all of it is drawn, 95% at the top. |
| low-resource-language | budget-split | pass |  |
| machine-translation | budget-split | pass |  |
| machine-unlearning | budget-split | pass |  |
| markov-decision-process | budget-split | pass |  |
| maximum-likelihood | budget-split | pass |  |
| mechanistic-interpretability | budget-split | pass |  |
| memorisation | budget-split | pass |  |
| memory-bandwidth-wall | budget-split | pass | Borderline: the slider is `memory_bound_kernels`, the count, rather than the hardware generation the caption names. Memory-bound taking the workload is drawn, 89% at the top. |
| memory-planning | budget-split | pass |  |
| merge-interference | budget-split | pass | Borderline: "the useful signal grows only linearly", but on screen it is the fixed rest, 30, and does not grow at all (share.ts:29-33); there is no model-count control for the square either. The contested set taking over is drawn. |
| message-passing | budget-split | pass |  |
| minimum-description-length | budget-split | pass | Borderline: at the top of the slider, 192, the saving still holds 11% of the bar (share.ts:29-33), short of being consumed; read as the model bits outweighing the saving, which they do past 24, it is drawn. |
| mixed-precision-training | budget-split | pass |  |
| mixture-of-depths | budget-split | pass |  |
| modality-fusion | budget-split | pass |  |
| modality-imbalance | budget-split | pass |  |
| mode-collapse | budget-split | pass |  |
| mode-connectivity | budget-split | pass |  |
| model-based-rl | budget-split | pass |  |
| model-card | budget-split | pass |  |
| model-cascade | budget-split | pass | Borderline: the saving and the crossing past which the cascade costs more are costs, and no cost is drawn. The bar splits requests, and its halfway point, at 40 escalated, is not the price-ratio crossing the caption describes; the settled share shrinking is what it shows. |
| model-merging | budget-split | pass |  |
| model-predictive-control | budget-split | pass |  |
| model-soup | budget-split | pass |  |
| model-versioning | budget-split | pass |  |
| model-written-evaluation | budget-split | pass |  |
| monte-carlo-tree-search | budget-split | pass |  |
| multi-agent-systems | budget-split | pass |  |
| multi-hop-question-answering | budget-split | pass |  |
| multi-query-attention | budget-split | pass | Borderline: the slider is `heads_shared_away`, the head count less one, so a reader taking its value for the head count is off by one. The saving collapsing as it is dragged down is drawn. |
| mutual-information | budget-split | pass |  |
| n-gram-model | budget-split | pass |  |
| neural-audio-codec | budget-split | pass |  |
| neuro-symbolic | budget-split | pass |  |
| noise-contrastive-estimation | budget-split | pass | Borderline: the caption never says what the rest is; read as the one positive that "per positive" counts against, 16 negatives would draw 94%, not the 50% that `share_rest` 16 gives at the default (share.ts:29-33). The contrast dominating as negatives rise is drawn. |
| normalizing-flow | budget-split | pass |  |
| number-format | budget-split | pass |  |
| object-detection | budget-split | pass | Borderline: the slider is `background_anchors`, not the resolution the caption names, and its left end, 0, draws no background at all, where the caption says it was already almost all background. From the first step, 200, it is 91% and barely moves after, as claimed, rounding to 100% at the top, where the matching handful leaves the bar. |
| offline-online-gap | budget-split | pass |  |
| offline-rl | budget-split | pass |  |
| offload | budget-split | pass |  |
| open-weights | budget-split | pass |  |
| operator-fusion-pass | budget-split | pass |  |
| optimizer-state | budget-split | pass |  |
| paged-attention | budget-split | pass | Borderline: the trade's other side, bookkeeping, has no mark. The side that does, the slack, falls as the block grows, from 80% at block 4 to 20% at 64 (share.ts:29-33), so on screen the drag shrinks fragmentation and gives nothing for it. |
| parametric-vs-retrieved-knowledge | budget-split | pass |  |
| parsing | budget-split | pass | Borderline: the slider is `ambiguous_spans`, the count, rather than the sentence length the caption names. Ambiguity dominating is drawn, 88% at the top. |
| pass-at-k | budget-split | pass | Borderline: the default, k = 10 against 90 unsolved, reads as 10 problems of 100, and the slider runs to 100, where the bar shows 53% solved, because the unsolved are held fixed and k itself is drawn as the solved count (share.ts:29-33). The metric climbing is drawn. |
| permutation-symmetry | budget-split | pass | Borderline: at the top of the slider, 200, the distinct solutions still hold 11% of the bar (share.ts:29-33), short of being swamped, though the caption itself says a share can only show this as saturation. |
| pipeline-parallelism | budget-split | pass |  |
| policy-gradient | budget-split | pass | Borderline: the slider is `variance_reduced`, the variance removed, rather than the baseline quality the caption names. How much of the noise the baseline removes is drawn. |
| position-interpolation | budget-split | pass | Borderline: the slider is `stretched_frequencies`, the bands stretched, rather than the compression the caption names. Long range bought with local resolution is drawn as the stretched share rising. |
| post-training-quantization | budget-split | pass |  |
| prefill-and-decode | budget-split | pass |  |
| prefix-caching | budget-split | pass |  |
| production-monitoring | budget-split | pass | Borderline: the slider is `unlabelled_predictions`, the count, rather than the label latency the caption names. The unlabelled share taking everything is drawn, 91% at the top. |
| program-repair | budget-split | pass | Borderline: the slider is `overfitted_patches`, the count, rather than the suite's weakness the caption names. The wrong patches taking over is drawn, 90% at the top. |
| prompt-engineering | budget-split | pass |  |
| prompt-injection | budget-split | pass | Borderline: the trusted part is already the minority where the slider opens, 25% at 3,000 untrusted tokens; it is the majority only below 1,000, to the left of the default. Dragging up from the default shrinks it further, to 5%. |
| prompt-tuning | budget-split | pass |  |
| promptable-segmentation | budget-split | pass |  |
| proprioception | budget-split | pass |  |
| prosody-control | budget-split | pass |  |
| proxy-variable | budget-split | pass | Borderline: the slider is `proxy_signal`, the predictive power through proxies, rather than the proxy's correlation the caption names. The channel taking the model is drawn, 87% at the top. |
| pruning | budget-split | pass |  |
| q-learning | budget-split | pass | Borderline: consecutive samples already hold only 25% where the slider opens, 24 replayed updates against 8; they dominate only below 8, to the left of the default. Dragging up from the default shrinks them further, to 6%. |
| qlora | budget-split | pass |  |
| quantized-kv-cache | budget-split | pass |  |
| rate-distortion | budget-split | pass |  |
| react | budget-split | pass |  |
| reasoning-rl | budget-split | pass | Borderline: the slider is `unverifiable_problems`, the count, rather than the domain's width the caption names. The checkable set becoming the small part is drawn, 7% at the top. |
| reasoning-trace | budget-split | pass |  |
| recurrent-neural-network | budget-split | pass |  |
| red-teaming | budget-split | pass |  |
| regression-suite | budget-split | pass |  |
| repository-context | budget-split | pass | Borderline: the slider is `excluded_tokens`, the repository less the 32 that fit, rather than the repository size the caption names. Almost all of it falling outside is drawn, 96% at the top. |
| representation-bias | budget-split | pass |  |
| reranking | budget-split | pass |  |
| retrieval-augmented-generation | budget-split | pass |  |
| reward-hacking | budget-split | pass | Borderline: the slider is `proxy_gain`, the reward gained, rather than the optimisation pressure the caption names. The proxy coming apart from the fixed true quality is drawn. |
| reward-model | budget-split | pass |  |
| reward-shaping | budget-split | pass |  |
| saddle-point | budget-split | pass |  |
| safety-benchmark-validity | budget-split | pass |  |
| safety-envelope | budget-split | pass | Borderline: the slider is `vetoed_commands`, the count, rather than the envelope's tightness the caption names. The policy losing authority as vetoes rise is drawn. |
| sandboxing | budget-split | pass |  |
| scalable-oversight | budget-split | pass | Borderline: at the top of the slider, 500, the outputs a supervisor can check still hold 11% of the bar (share.ts:29-33), short of training on nothing anyone confirmed. The unverifiable share taking over is drawn. |
| schema-conformance | budget-split | pass | Borderline: every output on the bar is conformant, so conformity is the whole bar and cannot be seen rising; what moves is the wrong share, 17% to 88%, against correctness fixed at 30 (share.ts:29-33). The slider is the wrong outputs, not the schema's tightness the caption names. |
| secure-aggregation | budget-split | pass |  |
| selective-state-space | budget-split | pass |  |
| self-reflection | budget-split | pass | Borderline: at the top of the slider, 6,000 reflection tokens, the task still holds 13% of the bar (share.ts:29-33), short of the notes crowding out the work. |
| self-supervised-learning | budget-split | pass |  |
| semantic-segmentation | budget-split | pass | Borderline: the square of the stride is the law the caption gives for the pixel count, and there is no stride control; the slider adds pixels in equal steps of 32 and the share it draws flattens (share.ts:7-11). What it asks the reader to watch, guessing taking the image, is drawn, 94% at the top. |
| sequence-parallelism | budget-split | pass |  |
| sequence-to-sequence | budget-split | pass |  |
| shadow-deployment | budget-split | pass | Borderline: mirrored requests duplicate the live traffic, so mirroring all of it, 100, is the most there is, and the bar draws that as 50%; the slider runs on to 400, four times the traffic being copied (share.ts:29-33). The second bill growing is drawn. |
| shape-specialization | budget-split | pass | Borderline: the slider is `padding_waste`, the waste itself, rather than the bucket coarseness the caption names. The waste growing is drawn. |
| speaker-embedding | budget-split | pass |  |
| specification-gaming | budget-split | pass | Borderline: the slider is `optimised_beyond_agreement`, the disagreement itself, rather than the optimisation pressure the caption names. The disagreement taking everything is drawn, 91% at the top. |
| speculative-decoding | budget-split | pass | Borderline: the acceptance rate is not drawn, and nothing on screen turns where it "stops keeping up": the verify share falls from 80% to 33% the whole way (share.ts:29-33). Verification amortising is drawn. |
| speech-tokenization | budget-split | pass | Borderline: the slider is `acoustic_tokens`, rather than the acoustic levels the caption names, which set the tokens per frame. The acoustic tokens swamping the sequence is drawn, 97% at the top. |
| stability-plasticity | budget-split | pass |  |
| state-space-model | budget-split | pass |  |
| statistical-significance | budget-split | pass |  |
| straggler | budget-split | pass | Borderline: the mean step time the caption says barely moves is not drawn; the only mark, the waiting share, moves from 7% to 79% (share.ts:29-33). What it asks the reader to watch, waiting taking the step, is drawn. |
| straight-through-estimator | budget-split | pass |  |
| structured-output | budget-split | pass | Borderline: the slider is `malformed_sequences`, the count, rather than the output length the caption names. The malformed set swallowing the space is drawn, 90% at the top. |
| structured-sparsity | budget-split | pass | Borderline: the slider is `realised_speedup`, the compression that turns into latency, rather than the structure the caption names. The saving becoming real is drawn. |
| superposition | budget-split | pass |  |
| support-vector-machine | budget-split | pass | Borderline: the default, 12 support vectors against 288, is a training set of 300, yet at the slider's 300, every point a support vector, the bar shows 51%, because the rest is held fixed (share.ts:29-33). The caption names no training-set size, so the figure misleads without the caption claiming anything it cannot show. |
| sycophancy | budget-split | pass |  |
| synthesis-evaluation | budget-split | pass |  |
| synthetic-data | budget-split | pass |  |
| system-prompt | budget-split | pass |  |
| tail-latency | budget-split | pass | Borderline: the slider and the solid segment are labelled `fanout_calls`, while the caption makes that segment the spoiled pages, and the per-call percentile it says never moved is not drawn. The one point it gives holds: ten calls draw 9%, about one page in ten (share.ts:29-33). |
| task-arithmetic | budget-split | pass | Borderline: the slider is `conflicting_coordinates`, the count, rather than the number of task vectors the caption names. Conflict taking the sum is drawn, 91% at the top. |
| task-decomposition | budget-split | pass |  |
| task-interference | budget-split | pass |  |
| teacher-forcing | budget-split | pass |  |
| teleoperation-data | budget-split | pass |  |
| temporal-difference-learning | budget-split | pass |  |
| tensor-core | budget-split | pass | Borderline: the slider is `matmul_flops`, the work itself, rather than the layer width the caption names. Matmul dominating with a remainder that never reaches zero is drawn, 7% left at the top. |
| tensor-parallelism | budget-split | pass |  |
| test-generation | budget-split | pass | Borderline: the slider is `generated_tests`, while the solid segment it sets is the behaviours exercised, so each test is drawn as one more behaviour reached. Coverage saturating below the specification is drawn, 90% at the top. |
| test-time-compute | budget-split | pass |  |
| throughput | budget-split | pass |  |
| token-embedding | budget-split | pass |  |
| tokenizer-fairness | budget-split | pass | Borderline: the slider is `extra_tokens`, the surcharge itself, rather than the fertility the caption names. The surcharge exceeding the message is drawn, past 6. |
| tool-schema | budget-split | pass |  |
| tool-selection | budget-split | pass |  |
| training-corpus-contamination | budget-split | pass |  |
| training-data-extraction | budget-split | pass |  |
| training-data-licensing | budget-split | pass |  |
| training-observability | budget-split | pass |  |
| training-serving-skew | budget-split | pass |  |
| transfer-learning | budget-split | pass |  |
| trend-decomposition | budget-split | pass |  |
| two-tower-retrieval | budget-split | pass |  |
| vanishing-gradient | budget-split | pass | Borderline: the exponential collapse is the gradient's, which is not drawn. The bar counts layers, and the trainable share falls as 20 / (attenuated + 20), neither exponential nor linear (share.ts:29-33), shrinking to 6% at the top. |
| video-generation | budget-split | pass |  |
| video-understanding | budget-split | pass | Borderline: the slider is `fast_pathway`, the pathway's compute, rather than the temporal sampling the caption names. Motion taking the budget is drawn, 85% at the top. |
| vision-language-action | budget-split | pass |  |
| vision-language-model | budget-split | pass |  |
| vocoder | budget-split | pass |  |
| voice-conversion | budget-split | pass |  |
| weak-to-strong-generalization | budget-split | pass |  |
| word-embedding | budget-split | pass |  |
| word-error-rate | budget-split | pass |  |
| world-model | budget-split | pass |  |
| zero-redundancy-optimizer | budget-split | pass | Borderline: "the shared portion" is neither of the caption's names for the two segments. Read as what stays replicated it does shrink, to 11% at 64 workers, but read as the sharded part it grows, to 89% (share.ts:29-33). |
