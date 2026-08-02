/**
 * The arithmetic behind `update-spectrum`, kept out of the component.
 *
 * The primitive draws one distribution against another: a steeply-decaying
 * baseline on the left, and on the right the same values pulled toward flat by
 * however far the reader has dragged the control.
 *
 * The contract, which every node using this primitive has to agree with:
 * **raising the control flattens the right-hand group.** Muon's Newton–Schulz
 * steps flatten a singular-value spectrum; a relaxed gate's temperature
 * flattens its output distribution as it rises, and sharpens as it falls toward
 * a discrete choice. A node whose idea runs the other way — where more of the
 * parameter means *more* concentrated — is not describing this shape and needs
 * a different primitive, not an inverted flag.
 */

export interface Frame {
  /** The untransformed distribution, normalised so the largest bar is 1. */
  baseline: number[];
  /** The same values pulled toward flat by `t`. Same length, same normalisation. */
  transformed: number[];
  /** How far the control has been dragged, eased. 0 = untouched, 1 = fully flat. */
  t: number;
}

/** FNV-1a, matching routing.ts — same job, same reasoning. */
function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — deterministic, seeded, adequate for drawing a picture. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Maps a control's raw value onto 0..1, then eases it.
 *
 * The easing is not decoration. The handoff's own caption for Muon says "past 5
 * the gain per step is nearly nothing", which is a claim about *diminishing
 * returns* — a linear ramp would contradict the sentence printed under the
 * picture. `1 - (1 - x)²` moves fast early and crawls late, which is what both
 * Newton–Schulz iteration and a softmax temperature actually do.
 */
export function progress(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return 0;
  }
  const x = Math.min(1, Math.max(0, (value - min) / (max - min)));
  return 1 - (1 - x) ** 2;
}

/**
 * Builds one frame.
 *
 * `seed` is the concept id, so the three concepts sharing this primitive each
 * get their own stable silhouette. Same inputs always produce the same frame;
 * nothing here reads the clock or `Math.random`.
 */
export function spectrum(seed: string, bars: number, t: number): Frame {
  // NaN has to be caught before the clamp, not by it: Math.max(2, NaN) is NaN,
  // which reaches Array.from({ length: NaN }) as an empty array and draws an
  // island with no bars in it. A clamp that propagates its own bad input is not
  // a clamp.
  const n = Number.isFinite(bars) ? Math.min(24, Math.max(2, Math.floor(bars))) : 8;
  const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const next = rng(seedFrom(seed));

  // A decaying spectrum with a little seeded jitter, so the three concepts do
  // not draw identical staircases. Sorted descending because a spectrum is
  // ordered by definition — an unsorted one would read as noise.
  const raw = Array.from({ length: n }, (_, i) => 0.92 ** (i * 1.6) * (0.78 + next() * 0.44));
  raw.sort((a, b) => b - a);

  const peak = raw[0] ?? 1;
  const baseline = raw.map((v) => v / peak);

  // Flat means every bar at the mean, so total mass is preserved as the
  // spectrum spreads. Pulling toward zero instead would read as "the update
  // shrinks", which is a different and wrong claim.
  const mean = baseline.reduce((a, b) => a + b, 0) / n;
  const transformed = baseline.map((v) => v + (mean - v) * clamped);

  return { baseline, transformed, t: clamped };
}

/**
 * How uneven a distribution is, 0 (flat) to 1 (all mass in one bar).
 *
 * Exported because it is what the screen-reader summary reports and what the
 * tests assert on: "flatter" has to be a number somewhere, or the claim the
 * caption makes is not checkable.
 */
export function spread(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

/** The frame in words — what a screen reader gets instead of the bars. */
export function describeSpectrum(f: Frame): string {
  const before = spread(f.baseline);
  const after = spread(f.transformed);
  const pct = Math.round(f.t * 100);

  if (pct === 0) {
    return `${f.baseline.length} values, steeply decaying. The control is at its lowest, so the right-hand group is unchanged from the left.`;
  }
  const verb = after < before ? 'flatter' : 'unchanged';
  return `${f.baseline.length} values. The left group decays steeply; the right group is ${pct}% of the way to flat, and reads ${verb} than the left.`;
}
