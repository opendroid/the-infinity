/**
 * The arithmetic behind `attention-heatmap`, kept out of the component.
 *
 * A grid of attention weights: one row per query, one column per key, each row
 * summing to one because a softmax cannot do anything else. Brightness is
 * weight.
 *
 * WHY THE PARAMS LOOK LIKE THIS
 *
 * Eight concepts point at this primitive and they need four different pictures:
 * a full square grid, a causal triangle, a rectangle where the source is not the
 * target, and a grid with one column every row leans on. The tempting way to get
 * those is a `causal` flag and a `sink` flag.
 *
 * `content/schema/README.md` calls that a smell, and it is right: `viz.params`
 * are numbers so that a control is draggable, and a primitive with modes is two
 * primitives wearing one name. So every knob here is a real quantity —
 * `lookahead` is how many positions ahead a query may read, and 0 and 64 are
 * both meaningful values rather than false and true. The triangle is what
 * lookahead 0 looks like, not a branch in the code.
 */

export interface Shape {
  /** Query rows. */
  rows: number;
  /** Key columns. Differs from `rows` when the source is not the target. */
  cols: number;
  /** How many positions ahead of itself a query may attend. 0 is causal. */
  lookahead: number;
  /** Heads the budget is split across. The last one is the one drawn. */
  heads: number;
  /** Strength of the distance penalty added to scores before the softmax. */
  decay: number;
  /** How hard every row is pulled toward the first column. */
  sink: number;
}

export interface Frame {
  /** `weights[query][key]`, each row summing to 1. */
  weights: number[][];
  /** The largest weight anywhere, so the component can scale brightness to it. */
  peak: number;
  shape: Shape;
}

function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clampInt = (v: number, lo: number, hi: number, fallback: number): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : fallback;

/**
 * Reads a shape out of a node's params, defaulting to plain full attention.
 *
 * A node that authors only `tokens` gets a square, unmasked grid — which is
 * what "attention" means before anything is done to it. Everything else is an
 * addition a concept opts into.
 */
export function shapeFrom(params: Record<string, number>): Shape {
  const rows = clampInt(params.tokens ?? 8, 2, 24, 8);
  return {
    rows,
    cols: clampInt(params.keys ?? rows, 2, 24, rows),
    // Absent means unrestricted, not causal: masking is the special case.
    lookahead: clampInt(params.lookahead ?? 64, 0, 64, 64),
    heads: clampInt(params.heads ?? 1, 1, 16, 1),
    decay: Number.isFinite(params.decay) ? Math.max(0, params.decay ?? 0) : 0,
    sink: Number.isFinite(params.sink) ? Math.min(1, Math.max(0, params.sink ?? 0)) : 0,
  };
}

/**
 * Builds one frame.
 *
 * The head drawn is the last one, so dragging the head count changes the
 * picture rather than adding heads nobody sees. Under a distance penalty the
 * per-head slopes form a geometric sequence, which is what makes "steeply local
 * to nearly flat" a true description of dragging that control.
 */
export function attention(seed: string, shape: Shape): Frame {
  const { rows, cols, lookahead, heads, decay, sink } = shape;
  const head = heads - 1;
  const slope = decay * 2 ** ((-8 * head) / heads);

  // More heads, narrower views: each head sees a smaller subspace, so its
  // attention is sharper. This is what the multi-head caption promises.
  const temperature = 1 / (1 + Math.log2(heads));

  const next = rng(seedFrom(`${seed}:${head}`));
  const weights: number[][] = [];
  let peak = 0;

  for (let i = 0; i < rows; i += 1) {
    const scores: number[] = [];
    for (let j = 0; j < cols; j += 1) {
      if (j > i + lookahead) {
        scores.push(Number.NEGATIVE_INFINITY);
        continue;
      }
      // Content similarity, a distance penalty, and the pull toward position 0
      // that a trained model develops when a head has nothing to retrieve.
      let s = next() * 2;
      if (j < i) s -= slope * (i - j);
      if (j === 0) s += sink * 6;
      scores.push(s / temperature);
    }

    const max = Math.max(...scores.filter((s) => Number.isFinite(s)));
    const exps = scores.map((s) => (Number.isFinite(s) ? Math.exp(s - max) : 0));
    const total = exps.reduce((a, b) => a + b, 0);
    // total is only 0 if every column is masked, which lookahead >= 0 prevents:
    // column i is always visible to row i.
    const row = exps.map((e) => (total === 0 ? 0 : e / total));
    peak = Math.max(peak, ...row);
    weights.push(row);
  }

  return { weights, peak, shape };
}

/**
 * The frame in words — what a screen reader gets instead of the grid.
 *
 * Says what a bright cell means, because the grid is `aria-hidden` and this is
 * the only place that answer exists for a reader who cannot see it.
 */
export function describeAttention(f: Frame): string {
  const { rows, cols, lookahead, sink } = f.shape;
  const masked = lookahead < cols - 1;

  const parts = [
    `${rows} queries against ${cols} keys; a brighter cell means more of that query's attention went to that key.`,
  ];
  if (masked) {
    parts.push(
      lookahead === 0
        ? 'Each query sees itself and everything before it, and nothing after — the upper triangle is masked.'
        : `Each query sees up to ${lookahead} positions ahead of itself; the rest is masked.`,
    );
  } else if (rows !== cols) {
    parts.push('Nothing is masked: every target position can read every source position.');
  } else {
    parts.push('Nothing is masked: every position can read every other, itself included.');
  }
  if (sink > 0) {
    const first = f.weights.map((r) => r[0] ?? 0).reduce((a, b) => a + b, 0) / rows;
    parts.push(`The first key takes ${Math.round(first * 100)}% of the average row on its own.`);
  }
  return parts.join(' ');
}
