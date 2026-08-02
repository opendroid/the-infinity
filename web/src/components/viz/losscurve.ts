/**
 * The arithmetic behind `loss-curve`, kept out of the component.
 *
 * Loss against training step. Ten concepts point at this primitive and between
 * them they need the curve to descend, to destabilise, to be noisy, to sit
 * lower for a bigger model, and to be contrasted against a second run.
 *
 * THE COMPARISON CURVE IS A COUNTERFACTUAL
 *
 * Three nodes draw two curves and they mean slightly different things by it:
 * a decayed schedule against a flat rate, a run with warmup against one
 * without, training loss against held-out loss. Rather than three flags, the
 * rule is one sentence: **the faint curve is the same run without the thing
 * this concept adds.** Set `decay` and the counterfactual is undecayed; set
 * `warmup` and it is unwarmed; set `holdout` and it is the same run measured on
 * data it did not train on.
 *
 * Every knob is a quantity. `lr` at 0.02 is not a mode, it is a learning rate
 * that happens to be past the point where this loss surface tolerates it — the
 * oscillation is what that looks like, not a branch.
 */

export interface Params {
  steps: number;
  lr: number;
  batch: number;
  warmup: number;
  decay: number;
  holdout: number;
  /** Model size, in arbitrary units. Bigger models bottom out lower. */
  params: number;
}

export interface Frame {
  /** The run itself, one entry per sample, normalised to 0..1 for drawing. */
  main: number[];
  /** The counterfactual, or null when the concept has nothing to contrast. */
  compare: number[] | null;
  /** What the comparison is, for the caption and the screen reader. */
  compareLabel: string | null;
  /** True when the learning rate has pushed the run past stability. */
  diverging: boolean;
  params: Params;
}

const SAMPLES = 120;
/** Above this the surface stops tolerating the step size. Chosen to sit inside
 *  the range `learning-rate` offers, so the reader can actually reach it. */
const STABLE_LR = 0.006;

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const num = (v: number | undefined, fallback: number, lo: number, hi: number): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v as number)) : fallback;

export function paramsFrom(p: Record<string, number>): Params {
  return {
    steps: num(p.steps, 1000, 10, 100_000),
    lr: num(p.lr, 0.001, 0, 1),
    batch: num(p.batch, 64, 1, 4096),
    warmup: num(p.warmup, 0, 0, 100_000),
    decay: num(p.decay, 0, 0, 1),
    holdout: num(p.holdout, 0, 0, 1),
    params: num(p.params, 1, 0.01, 1000),
  };
}

/**
 * One run, sampled.
 *
 * Returns raw loss rather than normalised, so the counterfactual and the main
 * curve share a scale — normalising each separately would draw two runs that
 * ended at the same height whatever they actually did.
 */
function run(seed: string, p: Params, opts: { warmup: number; decay: number }): number[] {
  const next = rng(seedFrom(seed));
  // A bigger model bottoms out lower, along a power law rather than linearly:
  // this is the shape `scaling-laws` describes in words.
  const floor = 1.4 * p.params ** -0.076;
  const start = 6;
  // Noise falls as 1/√batch — the reason doubling the batch buys less than it costs.
  const noise = 0.35 / Math.sqrt(p.batch);
  const warmFrac = Math.min(0.5, opts.warmup / p.steps);

  const out: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const u = i / (SAMPLES - 1);

    // Descent: fast then slow, which is what a loss curve does and why the
    // late fraction of a run buys so little.
    const speed = 1 + p.lr * 900;
    let loss = floor + (start - floor) / (1 + speed * u * 4) ** 0.85;

    // A decaying schedule lets the run settle further in its final stretch.
    if (opts.decay > 0) loss -= opts.decay * 0.28 * (start - floor) * u ** 2.2;

    // Past the stable learning rate the run oscillates and then climbs. Below
    // it, this term is exactly zero.
    const excess = Math.max(0, p.lr - STABLE_LR);
    if (excess > 0) {
      const violence = excess * 260;
      loss += violence * u * (0.5 + 0.5 * Math.sin(u * 34));
    }

    // Without a ramp the opening of the run is unstable: large steps on random
    // parameters. With one, the spike is gone.
    if (warmFrac === 0 && p.lr > 0.0015) {
      const early = Math.max(0, 1 - u / 0.12);
      loss += early ** 2 * 2.4 * (p.lr / 0.004);
    } else if (u < warmFrac) {
      // Inside the ramp the model is deliberately taking small steps, so it
      // improves more slowly rather than not at all.
      loss += (1 - u / warmFrac) * 0.5;
    }

    loss += (next() - 0.5) * noise;
    out.push(Math.max(0.02, loss));
  }
  return out;
}

export function lossCurve(seed: string, p: Params): Frame {
  const main = run(seed, p, { warmup: p.warmup, decay: p.decay });

  let compare: number[] | null = null;
  let compareLabel: string | null = null;

  if (p.holdout > 0) {
    // Held-out loss tracks training loss and then parts from it. The gap opens
    // late and widens, which is the shape the overfitting caption describes.
    compare = main.map((v, i) => {
      const u = i / (SAMPLES - 1);
      return v + p.holdout * 2.6 * Math.max(0, u - 0.32) ** 1.7;
    });
    compareLabel = 'held-out';
  } else if (p.decay > 0) {
    compare = run(seed, p, { warmup: p.warmup, decay: 0 });
    compareLabel = 'flat rate';
  } else if (p.warmup > 0) {
    compare = run(seed, p, { warmup: 0, decay: p.decay });
    compareLabel = 'no warmup';
  }

  return {
    main,
    compare,
    compareLabel,
    diverging: p.lr > STABLE_LR,
    params: p,
  };
}

/** The largest value across both curves, so they can share one vertical scale. */
export function ceiling(f: Frame): number {
  return Math.max(...f.main, ...(f.compare ?? [0]));
}

/**
 * The frame in words — what a screen reader gets instead of the plot.
 *
 * Reports the shape rather than the numbers: where the loss started, where it
 * ended, whether it was still falling, and what the second line is.
 */
export function describeCurve(f: Frame): string {
  const first = f.main[0] ?? 0;
  const last = f.main[f.main.length - 1] ?? 0;
  const mid = f.main[Math.floor(f.main.length / 2)] ?? 0;

  const parts = [`Loss over ${f.params.steps} training steps, starting near ${first.toFixed(1)}.`];

  if (f.diverging) {
    parts.push(
      `The learning rate is past the point this run tolerates: the curve oscillates and climbs instead of settling, ending near ${last.toFixed(1)}.`,
    );
  } else {
    const firstHalf = first - mid;
    const secondHalf = mid - last;
    const share = firstHalf + secondHalf > 0 ? firstHalf / (firstHalf + secondHalf) : 0;
    parts.push(
      `It falls to about ${last.toFixed(2)}, with ${Math.round(share * 100)}% of the total improvement arriving in the first half.`,
    );
  }

  if (f.compareLabel) {
    const other = f.compare?.[f.compare.length - 1] ?? 0;
    parts.push(
      other > last
        ? `A second line shows ${f.compareLabel}, ending higher at about ${other.toFixed(2)}.`
        : `A second line shows ${f.compareLabel}, ending at about ${other.toFixed(2)}.`,
    );
  }
  return parts.join(' ');
}
