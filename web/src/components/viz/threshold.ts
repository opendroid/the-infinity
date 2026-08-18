/**
 * The arithmetic behind `threshold-sweep`, kept out of the component.
 *
 * Two populations that overlap, and one cut through them. Everything above the
 * cut is flagged; everything below is let through. Moving the cut trades the
 * two ways of being wrong against each other, and there is no position that
 * removes both — which is the whole idea, and the reason a proportion bar
 * cannot draw it.
 *
 * The contract, which every node using this primitive has to agree with:
 * **raising the threshold flags fewer of both populations.** True positives and
 * false positives fall together; misses rise. A concept where raising the
 * control catches MORE is not describing this shape.
 *
 * WHY NOT SEEDED, WHEN THE OTHER FOUR PRIMITIVES ARE. `spectrum` and `routing`
 * jitter from the concept id so the three or four nodes sharing them do not draw
 * identical staircases. Here the per-concept parameter is `separation` — how far
 * apart the two populations sit is exactly what distinguishes a good detector
 * from a poor one — so the silhouette already differs per node for a reason a
 * reader can act on. Adding noise on top would make the curves lumpy without
 * making them more distinct, and a lumpy density invites a reader to read
 * structure that is not there.
 */

/** Total items drawn from, so counts are readable integers rather than fractions. */
export const POPULATION = 1000;
/** Bins across the axis. Enough to look smooth at island width, few enough to stay cheap. */
const BINS = 48;
/** Both populations have unit spread; `separation` is measured in those units. */
const SPREAD = 1;

export interface Frame {
  /** Density per bin for the population that should NOT be flagged, peak-normalised. */
  negatives: number[];
  /** Density per bin for the population that SHOULD be flagged, peak-normalised. */
  positives: number[];
  /** Where the cut falls, as a fraction 0..1 across the bins. */
  cut: number;
  /** Flagged and should have been. */
  truePositives: number;
  /** Flagged and should not have been. */
  falsePositives: number;
  /** Let through and should not have been. */
  falseNegatives: number;
  /** Let through and should have been. */
  trueNegatives: number;
  /** Of what was flagged, the share that was right. 0 when nothing was flagged. */
  precision: number;
  /** Of what should have been flagged, the share that was. 0 when there is nothing to find. */
  recall: number;
}

export interface Shape {
  /** Distance between the two populations, in spreads. 0 means indistinguishable. */
  separation: number;
  /** Where the cut sits on the same axis. */
  threshold: number;
  /** Share of the population that should be flagged, 0..1. */
  baseRate: number;
}

const clamp = (v: number, lo: number, hi: number, fallback: number): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/**
 * Reads a node's params into the shape this primitive draws.
 *
 * Named keys rather than positional, and every one clamped, because a node
 * authors these by hand and a negative spread or a base rate of 4 would
 * otherwise reach the drawing as a shape nobody can read.
 */
export function shapeFrom(params: Record<string, number>): Shape {
  return {
    separation: clamp(params.separation ?? 2, 0, 6, 2),
    threshold: clamp(params.threshold ?? 1, -3, 9, 1),
    baseRate: clamp(params.base_rate ?? 0.5, 0.001, 1, 0.5),
  };
}

/** Φ, via the logistic approximation. Max error ~1e-4 — far below a drawn pixel. */
function normalCdf(z: number): number {
  return 1 / (1 + Math.exp(-1.702 * z));
}

/** Unnormalised Gaussian density. Only ratios are drawn, so the constant is dropped. */
function density(x: number, mean: number): number {
  const z = (x - mean) / SPREAD;
  return Math.exp(-0.5 * z * z);
}

/**
 * Builds one frame.
 *
 * The axis is pinned to `[-3, separation + 3]` so both populations are fully on
 * screen at every separation. It moves with the separation on purpose: a fixed
 * axis would push the positive population off the right-hand edge as a node
 * authored a stronger detector, which is the setting where the figure has the
 * most to say.
 */
export function sweep(shape: Shape): Frame {
  const { separation, threshold, baseRate } = shape;

  const lo = -3;
  const hi = separation + 3;
  const span = hi - lo;

  const rawNeg = Array.from({ length: BINS }, (_, i) => density(lo + (span * i) / (BINS - 1), 0));
  const rawPos = Array.from({ length: BINS }, (_, i) =>
    density(lo + (span * i) / (BINS - 1), separation),
  );
  // Peak-normalised together, not separately: normalising each to its own peak
  // would draw two equally tall humps whatever the base rate, and the base rate
  // is the thing this figure most often exists to show.
  const scale = Math.max(...rawNeg.map((v) => v * (1 - baseRate)), ...rawPos.map((v) => v * baseRate));
  const negatives = rawNeg.map((v) => (scale === 0 ? 0 : (v * (1 - baseRate)) / scale));
  const positives = rawPos.map((v) => (scale === 0 ? 0 : (v * baseRate) / scale));

  const nPos = POPULATION * baseRate;
  const nNeg = POPULATION - nPos;

  // Above the cut is flagged. Counts are rounded for display and the derived
  // rates computed from the rounded counts, so a reader adding up the four cells
  // gets the precision printed beside them rather than one that disagrees by a
  // rounding step.
  const truePositives = Math.round(nPos * (1 - normalCdf((threshold - separation) / SPREAD)));
  const falsePositives = Math.round(nNeg * (1 - normalCdf(threshold / SPREAD)));
  const falseNegatives = Math.round(nPos) - truePositives;
  const trueNegatives = Math.round(nNeg) - falsePositives;

  const flagged = truePositives + falsePositives;
  const actual = truePositives + falseNegatives;

  return {
    negatives,
    positives,
    cut: span === 0 ? 0 : (threshold - lo) / span,
    truePositives,
    falsePositives,
    falseNegatives,
    trueNegatives,
    precision: flagged === 0 ? 0 : truePositives / flagged,
    recall: actual === 0 ? 0 : truePositives / actual,
  };
}

/** Whole percent, for the same reason `share.ts` rounds: these are read, not measured. */
export function percent(rate: number): number {
  return Math.round(rate * 100);
}

/**
 * The frame in words — what a screen reader gets instead of the two curves.
 *
 * Leads with precision, because that is the number the base rate ambushes and
 * the one a reader looking at the picture is least likely to estimate correctly.
 */
export function describeSweep(f: Frame): string {
  const flagged = f.truePositives + f.falsePositives;
  if (flagged === 0) {
    return `The threshold sits above both populations, so nothing is flagged: all ${f.falseNegatives} that should have been caught were missed.`;
  }
  return `${flagged} of ${POPULATION} flagged. ${percent(f.precision)}% of them were right and ${f.falsePositives} were false alarms; ${percent(f.recall)}% of what should have been caught was, leaving ${f.falseNegatives} missed.`;
}
