/**
 * The arithmetic behind `router-dispatch`, kept out of the component.
 *
 * A router scores every token against every expert, each token goes to its
 * top-k, and an expert that fills up drops what arrives after. That is the
 * whole idea the primitive draws, and it is worth testing without mounting
 * anything — the interesting failures here are "raising top-k un-lit a cell"
 * and "the loads do not add up", neither of which a render test would catch.
 */

/** The sample sequence the grid routes. */
export const TOKENS = ['the', 'protein', 'folds', 'into', 'a', 'helix'] as const;

export interface RouterParams {
  /** Number of experts — the grid's width. */
  experts: number;
  /** Experts each token is dispatched to. */
  topK: number;
  /** Multiplier on the fair share each expert will accept before dropping. */
  capacityFactor: number;
}

export interface Cell {
  /** 0 = first choice, 1 = second, … `null` = this expert is asleep for this token. */
  rank: number | null;
  /** Chosen by the router, then refused because the expert was full. */
  dropped: boolean;
}

export interface Frame {
  tokens: readonly string[];
  experts: number;
  /** `cells[token][expert]`. */
  cells: Cell[][];
  /** Accepted assignments per expert — the `load` row under the grid. */
  load: number[];
  /** What each expert accepted before refusing. */
  capacity: number;
  /** Total assignments refused for want of capacity. */
  dropped: number;
}

/** FNV-1a. Small, stable, and not trying to be a hash function that matters. */
function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — deterministic, seeded, and adequate for drawing a picture. */
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
 * Router scores, drawn once per concept and independent of `topK`.
 *
 * Independence is the point: the caption promises that dragging top-k *wakes
 * more experts*, so raising it must only ever add cells. If the scores were
 * redrawn per k the picture would reshuffle on every drag, which reads as
 * noise and contradicts the sentence under it.
 */
function scores(seed: string, tokens: number, experts: number): number[][] {
  const next = rng(seedFrom(seed));
  return Array.from({ length: tokens }, () => Array.from({ length: experts }, () => next()));
}

/**
 * Builds one frame.
 *
 * `seed` is the concept id, so two concepts using this primitive get different
 * — but individually stable — pictures. Same inputs always produce the same
 * frame; nothing here reads the clock or `Math.random`.
 */
export function frame(seed: string, params: RouterParams, tokens: readonly string[] = TOKENS): Frame {
  // A node may omit `top_k` entirely — `expert-parallelism` does — so the
  // caller's value is clamped rather than trusted. Zero experts would divide
  // by zero below; one expert is a legal, if dull, picture.
  const experts = Math.max(1, Math.floor(params.experts));
  const topK = Math.min(experts, Math.max(1, Math.floor(params.topK)));

  const table = scores(seed, tokens.length, experts);

  // Every expert accepts its fair share of the total dispatch, times the
  // factor. `capacity_factor` of 1 means no slack at all, which is exactly
  // when dropping starts — that is the trade the caption asks the reader to
  // feel, so it must not be rounded away.
  const capacity = Math.max(1, Math.ceil((params.capacityFactor * tokens.length * topK) / experts));

  const load = Array.from({ length: experts }, () => 0);
  let dropped = 0;

  const cells = table.map((row) => {
    const chosen = row
      .map((score, expert) => ({ score, expert }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    const line: Cell[] = Array.from({ length: experts }, () => ({ rank: null, dropped: false }));

    chosen.forEach(({ expert }, rank) => {
      // Tokens are served in order, so an expert that fills early refuses the
      // tokens behind it. That ordering is the mechanism, not an artefact:
      // capacity is a queue, and which token gets dropped depends on where it
      // sat in the batch.
      const used = load[expert] ?? 0;
      const full = used >= capacity;
      if (full) {
        dropped += 1;
      } else {
        load[expert] = used + 1;
      }
      line[expert] = { rank, dropped: full };
    });

    return line;
  });

  return { tokens, experts, cells, load, capacity, dropped };
}

/**
 * The frame in words — what a screen reader gets instead of the grid.
 *
 * This is not a caption substitute; the node's own caption still ships and
 * carries the takeaway. This carries the *state*: which experts are idle and
 * how much was dropped, both of which change as the reader drags the control
 * and neither of which a static caption can track.
 *
 * Lives here rather than in the component because it is the only output some
 * readers ever receive, which makes it worth testing — including the grammar,
 * since "1 assignments were dropped" is the kind of thing nobody sees when it
 * is only ever rendered to a canvas nobody reads aloud.
 */
export function describeFrame(f: Frame, topK: number, devices = 0): string {
  const asleep = f.load.reduce<number[]>((acc, n, i) => (n === 0 ? [...acc, i + 1] : acc), []);
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

  return [
    `${f.tokens.length} tokens routed across ${f.experts} ${plural(f.experts, 'expert', 'experts')}${
      devices > 1 ? `, sharded across ${devices} devices` : ''
    }.`,
    `Each token wakes its top ${topK}.`,
    asleep.length === 0
      ? 'Every expert runs for this batch.'
      : `${plural(asleep.length, 'Expert', 'Experts')} ${asleep.join(', ')} ${plural(asleep.length, 'stays', 'stay')} asleep.`,
    f.dropped === 0
      ? 'No token was dropped: no expert exceeded its capacity.'
      : `${f.dropped} ${plural(f.dropped, 'assignment was', 'assignments were')} dropped where an expert exceeded its capacity of ${f.capacity}.`,
  ].join(' ');
}

/**
 * Opacity by choice rank.
 *
 * The handoff specifies two levels — solid first choice, `.45` second — because
 * it draws top-k of 2. `top_k` goes to 4, so ranks beyond the second continue
 * the same fade rather than inventing a colour: violet is the only data channel
 * in the island, and a third hue would be a new meaning nobody defined.
 */
export function rankOpacity(rank: number): number {
  const ramp = [1, 0.45, 0.28, 0.18];
  return ramp[rank] ?? 0.12;
}
