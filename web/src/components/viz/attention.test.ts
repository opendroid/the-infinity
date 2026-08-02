import { describe, expect, it } from 'vitest';
import { attention, describeAttention, shapeFrom } from './attention';

const square = shapeFrom({ tokens: 8 });

const rowSums = (f: ReturnType<typeof attention>) =>
  f.weights.map((r) => r.reduce((a, b) => a + b, 0));

describe('a softmax row cannot do anything but sum to one', () => {
  it('holds for full attention', () => {
    for (const s of rowSums(attention('attention', square))) expect(s).toBeCloseTo(1, 10);
  });

  it('holds under a causal mask, where most of the row is zero', () => {
    const f = attention('causal-masking', shapeFrom({ tokens: 8, lookahead: 0 }));
    for (const s of rowSums(f)) expect(s).toBeCloseTo(1, 10);
  });

  it('holds when rows and columns differ', () => {
    const f = attention('cross-attention', shapeFrom({ tokens: 6, keys: 11 }));
    for (const s of rowSums(f)) expect(s).toBeCloseTo(1, 10);
  });
});

describe('lookahead is a quantity, not a flag', () => {
  /**
   * The picture `causal-masking` promises: "every position sees itself and
   * everything before it, nothing after". If a masked cell were merely small
   * rather than zero, the caption would be describing something not true.
   */
  it('zeroes everything after the diagonal at lookahead 0', () => {
    const f = attention('causal-masking', shapeFrom({ tokens: 8, lookahead: 0 }));
    f.weights.forEach((row, i) => {
      row.forEach((w, j) => {
        if (j > i) expect(w).toBe(0);
        else expect(w).toBeGreaterThan(0);
      });
    });
  });

  it('opens a window of exactly the width asked for', () => {
    const f = attention('x', shapeFrom({ tokens: 10, lookahead: 2 }));
    f.weights.forEach((row, i) => {
      row.forEach((w, j) => {
        if (j > i + 2) expect(w).toBe(0);
      });
    });
  });

  it('masks nothing when absent, because unmasked is the default meaning', () => {
    const f = attention('attention', shapeFrom({ tokens: 8 }));
    for (const row of f.weights) for (const w of row) expect(w).toBeGreaterThan(0);
  });

  it('never leaves a row with nothing to attend to', () => {
    // Row 0 under a causal mask sees only column 0. If that were masted too the
    // softmax would divide by zero and the row would render blank.
    const f = attention('x', shapeFrom({ tokens: 8, lookahead: 0 }));
    expect(f.weights[0]![0]).toBeCloseTo(1, 10);
  });
});

describe('the sink pulls weight to the first column', () => {
  it('makes column zero dominate as it rises', () => {
    const at = (sink: number) => {
      const f = attention('attention-sink', shapeFrom({ tokens: 8, sink }));
      return f.weights.map((r) => r[0] ?? 0).reduce((a, b) => a + b, 0) / 8;
    };
    expect(at(0.8)).toBeGreaterThan(at(0.3));
    expect(at(0.3)).toBeGreaterThan(at(0));
  });

  it('is absent by default, so an ordinary grid has no sink', () => {
    const plain = attention('attention', shapeFrom({ tokens: 8 }));
    const first = plain.weights.map((r) => r[0] ?? 0).reduce((a, b) => a + b, 0) / 8;
    expect(first).toBeLessThan(0.5);
  });
});

describe('the distance penalty makes attention local', () => {
  it('moves weight toward the diagonal as decay rises', () => {
    // ALiBi's claim: a steeper slope prefers near tokens by construction.
    const nearMass = (decay: number) => {
      const f = attention('alibi', shapeFrom({ tokens: 10, lookahead: 0, decay, heads: 1 }));
      let near = 0;
      f.weights.forEach((row, i) => {
        row.forEach((w, j) => {
          if (i - j <= 2) near += w;
        });
      });
      return near;
    };
    expect(nearMass(2)).toBeGreaterThan(nearMass(0));
  });

  it('flattens the drawn head as the head count rises', () => {
    // "Slopes from steeply local to nearly flat": the head drawn is the last,
    // and the per-head slopes are a geometric sequence, so more heads means a
    // shallower one on screen.
    const spreadOf = (heads: number) => {
      const f = attention('alibi', shapeFrom({ tokens: 10, lookahead: 0, decay: 3, heads }));
      const last = f.weights[9]!;
      return Math.max(...last) - Math.min(...last.slice(0, 10));
    };
    expect(spreadOf(8)).toBeLessThan(spreadOf(1));
  });
});

describe('frames are deterministic', () => {
  it('identical inputs give an identical grid', () => {
    expect(attention('attention', square)).toEqual(attention('attention', square));
  });

  it('different concepts get different grids', () => {
    expect(attention('attention', square).weights).not.toEqual(
      attention('self-attention', square).weights,
    );
  });
});

describe('shapeFrom survives whatever a node authors', () => {
  const cases: { name: string; params: Record<string, number> }[] = [
    { name: 'nothing at all', params: {} },
    { name: 'zero tokens', params: { tokens: 0 } },
    { name: 'a huge grid', params: { tokens: 9999, keys: 9999 } },
    { name: 'negative lookahead', params: { tokens: 8, lookahead: -5 } },
    { name: 'a fractional count', params: { tokens: 7.6 } },
    { name: 'NaN everywhere', params: { tokens: Number.NaN, heads: Number.NaN, sink: Number.NaN } },
    { name: 'a sink above one', params: { tokens: 8, sink: 40 } },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const f = attention('x', shapeFrom(c.params));
      expect(f.shape.rows).toBeGreaterThanOrEqual(2);
      expect(f.shape.cols).toBeGreaterThanOrEqual(2);
      expect(f.weights).toHaveLength(f.shape.rows);
      for (const row of f.weights) {
        expect(row).toHaveLength(f.shape.cols);
        for (const w of row) expect(Number.isFinite(w)).toBe(true);
      }
      expect(f.peak).toBeGreaterThan(0);
    });
  }
});

describe('describeAttention — what a screen reader gets instead of the grid', () => {
  it('says what a bright cell means', () => {
    expect(describeAttention(attention('attention', square))).toContain(
      "a brighter cell means more of that query's attention",
    );
  });

  it('names the triangle when there is one', () => {
    const f = attention('causal-masking', shapeFrom({ tokens: 8, lookahead: 0 }));
    expect(describeAttention(f)).toContain('the upper triangle is masked');
  });

  it('says nothing is masked when nothing is', () => {
    expect(describeAttention(attention('attention', square))).toContain('Nothing is masked');
  });

  it('quantifies the sink rather than just naming it', () => {
    const f = attention('attention-sink', shapeFrom({ tokens: 8, sink: 0.7 }));
    expect(describeAttention(f)).toMatch(/first key takes \d+% of the average row/);
  });
});
