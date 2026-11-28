# Figure captions against what the template draws

A screen for [`LAUNCH.md`](../LAUNCH.md) §6, *every figure read against its caption* (#559).
Each node's `viz.caption`, and its `caption_engineer` where it has one, is read against what
its template actually draws, taken from the template's source. A `flag` is for Ajay to confirm
or dismiss; a follow-up issue rewrites the captions he confirms. Nothing here changes a
caption, a param or a template.

This file covers five of the six templates, 131 nodes. `budget-split` (351 nodes) is #560,
which adds its own entry under **Templates** and its own verdict section.

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
  the modules the components draw from) at the control's minimum, at the node's value and at
  the maximum. Every number quoted in a reason comes from those runs.
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
