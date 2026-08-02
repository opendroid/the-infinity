import { describe, expect, it } from 'vitest';
import { describeSplit, percent, split } from './share';

describe('split computes a part of a whole', () => {
  it('halves at equal part and rest', () => {
    expect(split(100, 100).share).toBeCloseTo(0.5, 10);
  });

  it('is zero when the part is zero', () => {
    expect(split(0, 100).share).toBe(0);
  });

  it('approaches but never reaches one', () => {
    // A saturating proportion: the part can dominate, never eliminate.
    expect(split(1_000_000, 1).share).toBeLessThan(1);
    expect(split(1_000_000, 1).share).toBeGreaterThan(0.99);
  });

  /**
   * The claim `feed-forward-network`'s engineer body makes in words:
   * "d_ff is conventionally 4·d_model, which puts roughly two thirds of a
   * transformer's parameters in a block that never looks sideways."
   *
   * Attention ≈ 4·d_model² (Q, K, V, O); the block ≈ 2·d_model·d_ff. So the
   * share is d_ff / (d_ff + 2·d_model). This asserts the arithmetic the viz
   * exists to demonstrate — if it ever stops landing on two thirds, the node's
   * prose and its picture have parted company.
   */
  it('puts two thirds in the feed-forward block at the conventional 4x width', () => {
    const dModel = 512;
    const dFf = 4 * dModel;
    expect(split(dFf, 2 * dModel).share).toBeCloseTo(2 / 3, 10);
  });

  it('crosses half exactly when the part equals twice d_model', () => {
    expect(percent(split(1024, 1024).share)).toBe(50);
  });
});

describe('raising the control raises the share — the primitive contract', () => {
  it('is monotonic in the part', () => {
    let previous = -1;
    for (const dFf of [512, 1024, 2048, 3072, 4096]) {
      const s = split(dFf, 1024).share;
      expect(s).toBeGreaterThan(previous);
      previous = s;
    }
  });

  it('saturates, so the gain per step shrinks as the part takes over', () => {
    const at = (n: number) => split(n, 1024).share;
    const early = at(1024) - at(512);
    const late = at(4096) - at(3584);
    expect(early).toBeGreaterThan(late);
  });
});

describe('degenerate inputs still draw a bar', () => {
  const cases: { name: string; args: [number, number] }[] = [
    { name: 'both zero', args: [0, 0] },
    { name: 'a negative part', args: [-100, 100] },
    { name: 'a negative rest', args: [100, -100] },
    { name: 'NaN part', args: [Number.NaN, 100] },
    { name: 'NaN rest', args: [100, Number.NaN] },
    { name: 'Infinity', args: [Number.POSITIVE_INFINITY, 100] },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const f = split(...c.args);
      // A NaN width empties the bar, which reads as "this concept has no
      // parameters" rather than as a bug — so it must not be reachable.
      expect(Number.isFinite(f.share)).toBe(true);
      expect(f.share).toBeGreaterThanOrEqual(0);
      expect(f.share).toBeLessThanOrEqual(1);
    });
  }
});

describe('percent', () => {
  it('rounds to whole percent, since the bar is read and not measured', () => {
    expect(percent(2 / 3)).toBe(67);
    expect(percent(0.5)).toBe(50);
    expect(percent(0)).toBe(0);
  });
});

describe('describeSplit — the text a screen reader gets instead of the bar', () => {
  it('names both sides, because a bare percentage does not say of what', () => {
    const text = describeSplit(split(2048, 1024), 'Feed-forward', 'Attention');
    expect(text).toContain('Feed-forward holds 67%');
    expect(text).toContain('Attention holds the remaining 33%');
  });

  it('always accounts for the whole', () => {
    for (const part of [0, 1, 512, 4096]) {
      const text = describeSplit(split(part, 1024), 'A', 'B');
      const [a, b] = [...text.matchAll(/(\d+)%/g)].map((m) => Number(m[1]));
      expect(a! + b!).toBe(100);
    }
  });
});
