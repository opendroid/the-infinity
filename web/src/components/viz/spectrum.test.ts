import { describe, expect, it } from 'vitest';
import { describeSpectrum, progress, spectrum, spread } from './spectrum';

describe('spectrum is deterministic', () => {
  it('produces an identical frame for identical inputs', () => {
    // Pre-rendered at build time, hydrated in the browser. A disagreement here
    // would make the island visibly change on hydration.
    expect(spectrum('muon-optimizer', 8, 0.5)).toEqual(spectrum('muon-optimizer', 8, 0.5));
  });

  it('gives the three concepts sharing this primitive different silhouettes', () => {
    const a = spectrum('muon-optimizer', 8, 0).baseline;
    const b = spectrum('conditional-computation', 8, 0).baseline;
    const c = spectrum('feed-forward-network', 8, 0).baseline;
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(c);
  });
});

describe('the baseline is a spectrum', () => {
  it('is sorted descending, because a spectrum is ordered by definition', () => {
    const { baseline } = spectrum('muon-optimizer', 8, 0);
    for (let i = 1; i < baseline.length; i += 1) {
      expect(baseline[i]!).toBeLessThanOrEqual(baseline[i - 1]!);
    }
  });

  it('is normalised so the tallest bar fills the box', () => {
    expect(spectrum('muon-optimizer', 8, 0).baseline[0]).toBeCloseTo(1, 10);
  });

  it('never emits a negative or zero-height bar', () => {
    for (const bars of [2, 8, 24]) {
      for (const v of spectrum('x', bars, 0.5).transformed) expect(v).toBeGreaterThan(0);
    }
  });
});

describe('the control flattens the right-hand group', () => {
  /**
   * The primitive's whole contract, and the claim two captions make in words:
   * Muon's "watch a steep spectrum flatten toward one", and conditional
   * computation's "drag temperature toward zero to watch the soft gate harden".
   */
  it('reduces spread monotonically as the control rises', () => {
    let previous = Infinity;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const s = spread(spectrum('muon-optimizer', 8, t).transformed);
      expect(s).toBeLessThan(previous);
      previous = s;
    }
  });

  it('leaves the right group identical to the left at zero', () => {
    const f = spectrum('muon-optimizer', 8, 0);
    expect(f.transformed).toEqual(f.baseline);
  });

  it('is completely flat at one', () => {
    expect(spread(spectrum('muon-optimizer', 8, 1).transformed)).toBeCloseTo(0, 10);
  });

  it('preserves total mass, so flattening reads as spreading and not shrinking', () => {
    // Pulling toward zero would also "flatten" while claiming the update got
    // smaller, which is a different and wrong statement about the maths.
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const f = spectrum('muon-optimizer', 8, 0.7);
    expect(sum(f.transformed)).toBeCloseTo(sum(f.baseline), 10);
  });
});

describe('progress maps a control onto 0..1', () => {
  it('bottoms out at the control minimum and tops out at the maximum', () => {
    expect(progress(0, 0, 8)).toBe(0);
    expect(progress(8, 0, 8)).toBe(1);
  });

  it('shows diminishing returns, which is what the Muon caption claims', () => {
    // "Past 5 the gain per step is nearly nothing" — a linear ramp would
    // contradict the sentence printed under the picture.
    const early = progress(2, 0, 8) - progress(0, 0, 8);
    const late = progress(8, 0, 8) - progress(6, 0, 8);
    expect(early).toBeGreaterThan(late);
  });

  it('clamps a value outside the control range', () => {
    expect(progress(-5, 0, 8)).toBe(0);
    expect(progress(99, 0, 8)).toBe(1);
  });

  const degenerate: { name: string; args: [number, number, number] }[] = [
    { name: 'a zero-width range', args: [1, 1, 1] },
    { name: 'an inverted range', args: [1, 8, 0] },
    { name: 'NaN', args: [Number.NaN, 0, 8] },
    { name: 'Infinity', args: [Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY] },
  ];

  for (const c of degenerate) {
    it(`returns 0 for ${c.name} rather than NaN`, () => {
      // A NaN here would set every bar height to NaN and empty the island.
      expect(progress(...c.args)).toBe(0);
    });
  }
});

describe('degenerate bar counts still draw', () => {
  const cases = [0, 1, 2, 7.6, 200, Number.NaN];
  for (const bars of cases) {
    it(`bars = ${bars}`, () => {
      const f = spectrum('x', bars, 0.5);
      expect(f.baseline.length).toBeGreaterThanOrEqual(2);
      expect(f.baseline.length).toBeLessThanOrEqual(24);
      expect(f.transformed).toHaveLength(f.baseline.length);
      for (const v of f.baseline) expect(Number.isFinite(v)).toBe(true);
    });
  }
});

describe('describeSpectrum — the text a screen reader gets instead of the bars', () => {
  it('says the groups match when the control is untouched', () => {
    expect(describeSpectrum(spectrum('muon-optimizer', 8, 0))).toContain('unchanged from the left');
  });

  it('reports how far toward flat, and that it reads flatter', () => {
    const text = describeSpectrum(spectrum('muon-optimizer', 8, 1));
    expect(text).toContain('100% of the way to flat');
    expect(text).toContain('flatter');
  });

  it('names the number of values so the shape is not the only source of it', () => {
    expect(describeSpectrum(spectrum('x', 12, 0.4))).toContain('12 values');
  });
});
