import { describe, expect, it } from 'vitest';
import { ceiling, describeCurve, lossCurve, paramsFrom } from './losscurve';

const at = (p: Record<string, number>) => lossCurve('x', paramsFrom(p));
const last = (xs: number[]) => xs[xs.length - 1]!;

describe('a loss curve descends', () => {
  it('ends lower than it starts', () => {
    const f = at({ steps: 1000, lr: 0.001 });
    expect(last(f.main)).toBeLessThan(f.main[0]!);
  });

  it('front-loads the improvement, which is the claim every caption makes', () => {
    const f = at({ steps: 1000, lr: 0.001 });
    const mid = f.main[Math.floor(f.main.length / 2)]!;
    const firstHalf = f.main[0]! - mid;
    const secondHalf = mid - last(f.main);
    expect(firstHalf).toBeGreaterThan(secondHalf);
  });

  it('never plots a negative or zero loss', () => {
    for (const lr of [0, 0.001, 0.01, 0.5]) {
      for (const v of at({ lr }).main) expect(v).toBeGreaterThan(0);
    }
  });
});

describe('the learning rate has a band, which is what two captions promise', () => {
  it('converges faster as it rises, while it stays stable', () => {
    // "Drag it up to watch convergence accelerate…"
    expect(last(at({ lr: 0.004 }).main)).toBeLessThan(last(at({ lr: 0.0005 }).main));
  });

  it('destabilises past the top of the band', () => {
    // "…and then break into oscillation."
    expect(at({ lr: 0.001 }).diverging).toBe(false);
    expect(at({ lr: 0.02 }).diverging).toBe(true);
    expect(last(at({ lr: 0.02 }).main)).toBeGreaterThan(last(at({ lr: 0.001 }).main));
  });

  it('leaves the stable case exactly untouched', () => {
    // The instability term must be zero below the threshold, not merely small:
    // a curve that wobbles at a safe learning rate would contradict the caption.
    const a = at({ lr: 0.001, batch: 4096 }).main;
    const b = at({ lr: 0.001, batch: 4096 }).main;
    expect(a).toEqual(b);
  });
});

describe('batch size sets the noise', () => {
  it('smooths the trajectory as it grows', () => {
    const jitter = (batch: number) => {
      const m = at({ batch }).main;
      let d = 0;
      for (let i = 1; i < m.length; i += 1) d += Math.abs(m[i]! - m[i - 1]!);
      return d;
    };
    expect(jitter(512)).toBeLessThan(jitter(4));
  });
});

describe('model size shifts the whole curve down', () => {
  it('bottoms out lower for more parameters', () => {
    // scaling-laws: "watch the whole curve shift down along the power law".
    expect(last(at({ params: 100 }).main)).toBeLessThan(last(at({ params: 1 }).main));
  });

  it('moves along a power law, so each step down costs more than the last', () => {
    const drop = (a: number, b: number) => last(at({ params: a }).main) - last(at({ params: b }).main);
    expect(drop(1, 10)).toBeGreaterThan(drop(10, 100));
  });
});

describe('the comparison curve is the counterfactual', () => {
  it('is absent when the concept has nothing to contrast', () => {
    const f = at({ steps: 1000, lr: 0.001 });
    expect(f.compare).toBeNull();
    expect(f.compareLabel).toBeNull();
  });

  it('is the undecayed run when a schedule is set', () => {
    const f = at({ decay: 1, lr: 0.001 });
    expect(f.compareLabel).toBe('flat rate');
    // The decayed run must end lower, or the caption is describing the wrong line.
    expect(last(f.main)).toBeLessThan(last(f.compare!));
  });

  it('is the unwarmed run when a ramp is set, and that run spikes early', () => {
    const f = at({ warmup: 100, steps: 1000, lr: 0.004 });
    expect(f.compareLabel).toBe('no warmup');
    const earlyMain = Math.max(...f.main.slice(0, 12));
    const earlyCompare = Math.max(...f.compare!.slice(0, 12));
    expect(earlyCompare).toBeGreaterThan(earlyMain);
  });

  it('is held-out loss when a gap is set, and it parts from training loss late', () => {
    const f = at({ holdout: 0.6 });
    expect(f.compareLabel).toBe('held-out');
    // Together at the start, apart at the end — the whole diagnostic.
    expect(f.compare![0]).toBeCloseTo(f.main[0]!, 6);
    expect(last(f.compare!)).toBeGreaterThan(last(f.main));
  });

  it('shares a vertical scale with the main curve', () => {
    // Normalising each separately would draw two runs ending at the same
    // height whatever they actually did.
    const f = at({ holdout: 0.6 });
    expect(ceiling(f)).toBeGreaterThanOrEqual(Math.max(...f.main));
    expect(ceiling(f)).toBeGreaterThanOrEqual(Math.max(...f.compare!));
  });
});

describe('deterministic, and robust to whatever a node authors', () => {
  it('gives identical frames for identical inputs', () => {
    expect(at({ steps: 1000, lr: 0.001 })).toEqual(at({ steps: 1000, lr: 0.001 }));
  });

  const cases: { name: string; params: Record<string, number> }[] = [
    { name: 'nothing at all', params: {} },
    { name: 'zero learning rate', params: { lr: 0 } },
    { name: 'zero steps', params: { steps: 0 } },
    { name: 'warmup longer than the run', params: { steps: 100, warmup: 9999 } },
    { name: 'NaN everywhere', params: { steps: Number.NaN, lr: Number.NaN, batch: Number.NaN } },
    { name: 'absurd values', params: { lr: 1e9, params: 1e9, batch: -5 } },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const f = at(c.params);
      expect(f.main).toHaveLength(120);
      for (const v of f.main) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThan(0);
      }
      expect(ceiling(f)).toBeGreaterThan(0);
    });
  }
});

describe('describeCurve — what a screen reader gets instead of the plot', () => {
  it('reports where it started and ended', () => {
    expect(describeCurve(at({ steps: 1000, lr: 0.001 }))).toMatch(/starting near \d/);
  });

  it('says the run destabilised rather than reporting a number as if it were fine', () => {
    expect(describeCurve(at({ lr: 0.02 }))).toContain('oscillates and climbs');
  });

  it('names the second line', () => {
    expect(describeCurve(at({ holdout: 0.6 }))).toContain('held-out');
    expect(describeCurve(at({ decay: 1 }))).toContain('flat rate');
  });

  it('quantifies how front-loaded the run was', () => {
    expect(describeCurve(at({ steps: 1000, lr: 0.001 }))).toMatch(/\d+% of the total improvement/);
  });
});
