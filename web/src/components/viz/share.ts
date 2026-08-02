/**
 * The arithmetic behind `budget-split`, kept out of the component.
 *
 * One whole divided in two. The control names the part; `share_rest` names the
 * fixed remainder in the same units; the share is `part / (part + rest)`.
 *
 * The contract, which every node using this primitive has to agree with:
 * **raising the control raises the part's share.** A saturating curve, not a
 * linear one — that is what a part-of-a-whole actually does when the rest is
 * held fixed, and it is why the picture slows down as the part takes over
 * instead of marching to 100%.
 */

export interface Frame {
  /** The part's fraction of the whole, 0..1. */
  share: number;
  /** The part, as given. */
  part: number;
  /** The fixed remainder. */
  rest: number;
}

/**
 * Builds one frame.
 *
 * Total nonsense in gives 0 out rather than NaN: a NaN width empties the bar,
 * which looks like "this concept has no parameters" rather than like a bug.
 */
export function split(part: number, rest: number): Frame {
  const p = Number.isFinite(part) ? Math.max(0, part) : 0;
  const r = Number.isFinite(rest) ? Math.max(0, rest) : 0;
  const total = p + r;
  return { share: total === 0 ? 0 : p / total, part: p, rest: r };
}

/** Whole percent. The bar is read, not measured — a decimal place would be false precision. */
export function percent(share: number): number {
  return Math.round(share * 100);
}

/**
 * The frame in words — what a screen reader gets instead of the bar.
 *
 * Names both sides, because "67%" alone does not say 67% *of what*, and the bar
 * is the only other place that answer exists.
 */
export function describeSplit(f: Frame, partLabel: string, restLabel: string): string {
  const p = percent(f.share);
  return `${partLabel} holds ${p}% of the budget; ${restLabel} holds the remaining ${100 - p}%.`;
}
