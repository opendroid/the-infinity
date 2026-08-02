import { describe, expect, it } from 'vitest';
import { describeFrame, frame, rankOpacity, TOKENS, type RouterParams } from './routing';

const moe: RouterParams = { experts: 8, topK: 2, capacityFactor: 1.25 };

/** Cells a reader can see as "this expert is awake for this token". */
const lit = (f: ReturnType<typeof frame>) =>
  f.cells.flatMap((row, t) =>
    row.flatMap((cell, e) => (cell.rank === null ? [] : [`${t}:${e}`])),
  );

describe('frame is deterministic', () => {
  it('produces an identical frame for identical inputs', () => {
    // The page is pre-rendered at build time and hydrated in the browser. If
    // these two disagreed the island would visibly change on hydration.
    expect(frame('mixture-of-experts', moe)).toEqual(frame('mixture-of-experts', moe));
  });

  it('gives different concepts different pictures', () => {
    const a = frame('mixture-of-experts', moe);
    const b = frame('expert-parallelism', moe);
    expect(lit(a)).not.toEqual(lit(b));
  });
});

describe('top-k wakes experts without reshuffling them', () => {
  /**
   * The caption's exact promise: "Drag top-k to watch compute rise as more
   * experts wake." If raising k moved a cell instead of adding one, the picture
   * would contradict the sentence printed under it.
   */
  it('raising top-k only ever adds lit cells', () => {
    for (let k = 1; k < 4; k += 1) {
      const before = new Set(lit(frame('moe', { ...moe, topK: k, capacityFactor: 99 })));
      const after = lit(frame('moe', { ...moe, topK: k + 1, capacityFactor: 99 }));
      for (const cell of before) expect(after).toContain(cell);
      expect(after.length).toBeGreaterThan(before.size);
    }
  });

  it('lights exactly top-k experts per token when nothing is dropped', () => {
    const f = frame('moe', { ...moe, topK: 3, capacityFactor: 99 });
    for (const row of f.cells) {
      expect(row.filter((c) => c.rank !== null)).toHaveLength(3);
    }
  });

  it('ranks each token 0..k-1 exactly once', () => {
    const f = frame('moe', { ...moe, topK: 3, capacityFactor: 99 });
    for (const row of f.cells) {
      const ranks = row.flatMap((c) => (c.rank === null ? [] : [c.rank])).sort();
      expect(ranks).toEqual([0, 1, 2]);
    }
  });
});

describe('capacity', () => {
  it('drops nothing when there is slack', () => {
    expect(frame('moe', { ...moe, capacityFactor: 99 }).dropped).toBe(0);
  });

  it('drops tokens once capacity is tight', () => {
    // The trade `expert-parallelism`'s caption asks the reader to feel:
    // less slack, more dropped tokens.
    const tight = frame('expert-parallelism', { experts: 8, topK: 2, capacityFactor: 1 });
    const loose = frame('expert-parallelism', { experts: 8, topK: 2, capacityFactor: 2 });
    expect(tight.dropped).toBeGreaterThan(loose.dropped);
  });

  it('never lets an expert exceed its capacity', () => {
    for (const capacityFactor of [1, 1.25, 1.5, 2]) {
      const f = frame('moe', { ...moe, capacityFactor });
      for (const load of f.load) expect(load).toBeLessThanOrEqual(f.capacity);
    }
  });

  it('accounts for every assignment as either loaded or dropped', () => {
    // The load row is the only number on screen; if it did not add up, the
    // picture would be quietly lying about how much compute is running.
    const f = frame('moe', { ...moe, capacityFactor: 1 });
    const accepted = f.load.reduce((a, b) => a + b, 0);
    expect(accepted + f.dropped).toBe(TOKENS.length * moe.topK);
  });

  it('marks dropped cells as chosen, not as asleep', () => {
    // A dropped token was routed somewhere — drawing it as an unlit cell would
    // erase the very thing the caption points at.
    const f = frame('expert-parallelism', { experts: 4, topK: 2, capacityFactor: 1 });
    const droppedCells = f.cells.flat().filter((c) => c.dropped);
    expect(droppedCells.length).toBeGreaterThan(0);
    for (const cell of droppedCells) expect(cell.rank).not.toBeNull();
  });
});

describe('degenerate params still produce a drawable frame', () => {
  const cases: { name: string; params: RouterParams }[] = [
    // `expert-parallelism` authors no `top_k` at all, so the component passes
    // a fallback; these assert the shape survives whatever arrives.
    { name: 'top-k of zero', params: { ...moe, topK: 0 } },
    { name: 'top-k above the expert count', params: { experts: 3, topK: 9, capacityFactor: 1.25 } },
    { name: 'a single expert', params: { experts: 1, topK: 1, capacityFactor: 1.25 } },
    { name: 'zero experts', params: { experts: 0, topK: 2, capacityFactor: 1.25 } },
    { name: 'a fractional expert count', params: { experts: 6.7, topK: 2, capacityFactor: 1.25 } },
    { name: 'zero capacity', params: { ...moe, capacityFactor: 0 } },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const f = frame('moe', c.params);
      expect(f.experts).toBeGreaterThanOrEqual(1);
      expect(f.capacity).toBeGreaterThanOrEqual(1);
      expect(f.cells).toHaveLength(TOKENS.length);
      for (const row of f.cells) expect(row).toHaveLength(f.experts);
      // Never more choices than there are experts to choose from.
      for (const row of f.cells) {
        expect(row.filter((cell) => cell.rank !== null).length).toBeLessThanOrEqual(f.experts);
      }
    });
  }
});

describe('describe — the text a screen reader gets instead of the grid', () => {
  it('names the idle experts and the dropped count', () => {
    const f = frame('expert-parallelism', { experts: 8, topK: 2, capacityFactor: 1 });
    const text = describeFrame(f, 2);
    expect(text).toContain('6 tokens routed across 8 experts');
    expect(text).toContain('Each token wakes its top 2');
    expect(text).toMatch(/dropped where an expert exceeded its capacity of \d+/);
  });

  it('names the device shard when the node authors one', () => {
    // expert-parallelism's caption opens with "tokens dispatched across four
    // devices", so a reader who cannot see the banding still hears about it.
    const f = frame('expert-parallelism', { experts: 8, topK: 2, capacityFactor: 1.25 });
    expect(describeFrame(f, 2, 4)).toContain('sharded across 4 devices');
  });

  it('says nothing about devices when the node authors none', () => {
    const f = frame('moe', moe);
    expect(describeFrame(f, 2)).not.toContain('sharded');
    expect(describeFrame(f, 2, 1)).not.toContain('sharded');
  });

  it('says so plainly when nothing is dropped', () => {
    const f = frame('moe', { ...moe, capacityFactor: 99 });
    expect(describeFrame(f, 2)).toContain('No token was dropped');
  });

  /**
   * Grammar is not a nit here: this string is the whole experience for a reader
   * who cannot see the grid, and "1 assignments were dropped" is exactly the
   * sort of thing that survives forever when the only consumer is a canvas.
   */
  it('agrees in number for a single idle expert', () => {
    const f = frame('moe', { experts: 3, topK: 2, capacityFactor: 99 });
    // Force precisely one idle expert so the singular branch is exercised.
    f.load = [4, 8, 0];
    const text = describeFrame(f, 2);
    expect(text).toContain('Expert 3 stays asleep.');
    expect(text).not.toContain('Experts 3 stay');
  });

  it('agrees in number for a single dropped assignment', () => {
    const f = frame('moe', { ...moe, capacityFactor: 99 });
    f.dropped = 1;
    expect(describeFrame(f, 2)).toContain('1 assignment was dropped');
  });

  it('uses the plural for more than one', () => {
    const f = frame('moe', { ...moe, capacityFactor: 99 });
    f.dropped = 3;
    expect(describeFrame(f, 2)).toContain('3 assignments were dropped');
  });
});

describe('rankOpacity', () => {
  it('fades monotonically, so first choice always reads as strongest', () => {
    const ramp = [0, 1, 2, 3, 4].map(rankOpacity);
    for (let i = 1; i < ramp.length; i += 1) {
      expect(ramp[i]!).toBeLessThan(ramp[i - 1]!);
    }
  });

  it('stays visible past the ranks the handoff drew', () => {
    // top_k reaches 4; a rank that faded to zero would silently lose a cell.
    expect(rankOpacity(3)).toBeGreaterThan(0);
    expect(rankOpacity(99)).toBeGreaterThan(0);
  });
});
