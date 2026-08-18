/**
 * The contract this primitive makes, asserted rather than described.
 *
 * `viz-controls.test.ts` checks that a node's control reaches the primitive.
 * This file checks the primitive is worth reaching: that the four counts add up,
 * that raising the threshold moves both flagged counts the same way, and that
 * the base rate does the thing it exists to show.
 */
import { describe, expect, it } from 'vitest';
import { POPULATION, describeSweep, percent, shapeFrom, sweep } from './threshold';

const at = (over: Partial<Record<string, number>> = {}) =>
  sweep(shapeFrom({ separation: 2, threshold: 1, base_rate: 0.5, ...over }));

describe('the four counts', () => {
  it('accounts for every item exactly once', () => {
    for (const threshold of [-3, -1, 0, 1, 2.5, 5, 9]) {
      const f = at({ threshold });
      expect(f.truePositives + f.falsePositives + f.falseNegatives + f.trueNegatives).toBe(
        POPULATION,
      );
    }
  });

  it('never reports a negative count', () => {
    for (const base_rate of [0.001, 0.01, 0.5, 1]) {
      const f = at({ base_rate, threshold: -3 });
      for (const n of [f.truePositives, f.falsePositives, f.falseNegatives, f.trueNegatives]) {
        expect(n).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('computes precision from the counts it printed, so the two cannot disagree', () => {
    const f = at({ threshold: 1.4 });
    expect(f.precision).toBeCloseTo(f.truePositives / (f.truePositives + f.falsePositives), 10);
  });
});

describe('the contract: raising the threshold flags fewer of both', () => {
  it('lowers true positives and false positives together', () => {
    let prevTp = Infinity;
    let prevFp = Infinity;
    for (const threshold of [-2, -1, 0, 1, 2, 3, 4]) {
      const f = at({ threshold });
      expect(f.truePositives).toBeLessThanOrEqual(prevTp);
      expect(f.falsePositives).toBeLessThanOrEqual(prevFp);
      prevTp = f.truePositives;
      prevFp = f.falsePositives;
    }
  });

  it('raises misses as it lowers false alarms — there is no cut that removes both', () => {
    const low = at({ threshold: -1 });
    const high = at({ threshold: 3 });
    expect(high.falsePositives).toBeLessThan(low.falsePositives);
    expect(high.falseNegatives).toBeGreaterThan(low.falseNegatives);
  });

  it('trades precision for recall rather than improving both', () => {
    const low = at({ threshold: -1 });
    const high = at({ threshold: 2.5 });
    expect(high.precision).toBeGreaterThan(low.precision);
    expect(high.recall).toBeLessThan(low.recall);
  });
});

describe('separation is how good the detector is', () => {
  it('buys precision and recall at once, which moving the threshold cannot', () => {
    const poor = at({ separation: 0.5 });
    const good = at({ separation: 4 });
    expect(good.precision).toBeGreaterThan(poor.precision);
    expect(good.recall).toBeGreaterThan(poor.recall);
  });

  it('at zero separation the populations are indistinguishable, so precision is the base rate', () => {
    const f = at({ separation: 0, threshold: 0, base_rate: 0.25 });
    expect(f.precision).toBeCloseTo(0.25, 2);
  });
});

describe('the base rate, which is what this primitive exists to show', () => {
  it('collapses precision for a rare event even with a strong detector', () => {
    const common = at({ separation: 3, threshold: 1.5, base_rate: 0.5 });
    const rare = at({ separation: 3, threshold: 1.5, base_rate: 0.005 });
    expect(common.precision).toBeGreaterThan(0.9);
    expect(rare.precision).toBeLessThan(0.2);
  });

  it('leaves recall alone, because recall does not know how rare the thing is', () => {
    const common = at({ separation: 3, threshold: 1.5, base_rate: 0.5 });
    const rare = at({ separation: 3, threshold: 1.5, base_rate: 0.02 });
    expect(rare.recall).toBeCloseTo(common.recall, 1);
  });
});

describe('bad input draws a readable figure rather than a broken one', () => {
  it('falls back rather than propagating NaN into the bins', () => {
    const f = sweep(shapeFrom({ separation: NaN, threshold: NaN, base_rate: NaN }));
    expect(f.negatives.every(Number.isFinite)).toBe(true);
    expect(f.positives.every(Number.isFinite)).toBe(true);
    expect(f.cut).toBeGreaterThanOrEqual(0);
  });

  it('clamps a base rate outside 0..1 instead of drawing a negative population', () => {
    expect(shapeFrom({ base_rate: 4 }).baseRate).toBe(1);
    expect(shapeFrom({ base_rate: -1 }).baseRate).toBe(0.001);
  });

  it('keeps both populations on the axis at every separation', () => {
    for (const separation of [0, 1, 3, 6]) {
      const f = sweep(shapeFrom({ separation, threshold: separation }));
      // The positive population peaks at `separation`, which must land inside the bins.
      const peak = f.positives.indexOf(Math.max(...f.positives));
      expect(peak).toBeGreaterThan(0);
      expect(peak).toBeLessThan(f.positives.length - 1);
    }
  });
});

describe('the words a screen reader gets', () => {
  it('names the false alarms and the misses, not just a percentage', () => {
    const f = at({ threshold: 1 });
    const said = describeSweep(f);
    expect(said).toContain(String(f.falsePositives));
    expect(said).toContain(String(f.falseNegatives));
  });

  it('says so plainly when the cut is above everything', () => {
    expect(describeSweep(at({ threshold: 9 }))).toMatch(/nothing is flagged/);
  });
});

describe('percent', () => {
  it('rounds to whole, because these are read and not measured', () => {
    expect(percent(0.666)).toBe(67);
    expect(percent(0)).toBe(0);
    expect(percent(1)).toBe(100);
  });
});
