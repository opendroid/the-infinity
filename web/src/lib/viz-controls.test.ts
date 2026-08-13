/**
 * Does the slider actually move the picture?
 *
 * `nodes.test.ts` already asserts that `param_controls[].name` is a key of
 * `viz.params`, and `validate-content.mjs` asserts the same thing. Both are
 * spelling checks. Neither asks the question that matters, which is whether the
 * primitive *reads* that key — and three of the five primitives filter params
 * through a typed reader (`paramsFrom`, `shapeFrom`, `read`) that silently drops
 * anything it does not recognise.
 *
 * Seven nodes shipped a control the primitive ignored. The slider rendered, the
 * value changed, the figure did not, and every check was green — including the
 * one immediately above this file whose name says "names a viz parameter that
 * actually exists". It did exist. Nothing read it.
 *
 * So this test runs the primitive's own arithmetic at both ends of the control's
 * range and asserts the output differs. A name list would have to be kept in step
 * with five readers by hand; this cannot drift, because it calls them.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lossCurve, paramsFrom } from '../components/viz/losscurve';
import { attention, shapeFrom } from '../components/viz/attention';
import { frame as routerFrame } from '../components/viz/routing';
import { read as routerRead } from '../components/viz/RouterDispatch';
import { progress, spectrum } from '../components/viz/spectrum';
import { split } from '../components/viz/share';

const NODES_DIR = resolve(process.cwd(), '../content/nodes');

interface Control {
  name: string;
  min: number;
  max: number;
  step: number;
}
interface Viz {
  primitive: string;
  params: Record<string, number>;
  param_controls: Control[];
}
interface Node {
  id: string;
  viz: Viz;
}

const nodes: Node[] = readdirSync(NODES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(NODES_DIR, f), 'utf8')) as Node);

/**
 * The primitive's output at one slider position, as something comparable.
 *
 * Each branch mirrors what the component does in `Body`: spread the node's
 * params, overwrite the controlled key, hand the result to the same reader the
 * component uses. `budget-split` and `update-spectrum` take the control's value
 * directly rather than by name, which is why neither can have this bug — they
 * are covered anyway so a future primitive swap does not quietly lose the check.
 *
 * `loss-curve`'s frame carries its resolved params back for the caption row, so
 * they are dropped here. Comparing them would let a slider pass this test by
 * changing the number printed above a figure that never moved — which is the
 * failure being tested for, wearing a hat.
 */
function frameAt(node: Node, control: Control, value: number): string {
  const live = { ...node.viz.params, [control.name]: value };
  switch (node.viz.primitive) {
    case 'loss-curve': {
      const { params: _echo, ...drawn } = lossCurve(node.id, paramsFrom(live));
      return JSON.stringify(drawn);
    }
    case 'attention-heatmap': {
      // Same echo as loss-curve's, missed when that one was fixed: `attention`
      // returns its resolved `shape`, so comparing whole frames says "changed"
      // for a control the drawing ignores. Found by a probe that had the bug too.
      const { shape: _shape, ...drawn } = attention(node.id, shapeFrom(live));
      return JSON.stringify(drawn);
    }
    case 'router-dispatch':
      return JSON.stringify(routerFrame(node.id, routerRead(live)));
    case 'update-spectrum':
      return JSON.stringify(spectrum(node.id, live.bars ?? 8, progress(value, control.min, control.max)));
    case 'budget-split':
      return JSON.stringify(split(value, live.share_rest ?? 0));
    default:
      throw new Error(`no arithmetic wired for primitive "${node.viz.primitive}"`);
  }
}

const draggable = nodes.flatMap((node) =>
  node.viz.param_controls.map((control) => ({ id: node.id, node, control })),
);

describe('viz controls reach the primitive', () => {
  it('has controls to check', () => {
    expect(draggable.length).toBeGreaterThan(0);
  });

  it.each(draggable)('$id · $control.name moves the figure', ({ node, control }) => {
    expect(frameAt(node, control, control.min)).not.toEqual(frameAt(node, control, control.max));
  });

  /**
   * A DEAD TAIL: the slider keeps travelling after the figure has stopped
   * responding. The assertion above passes — the ends differ — while most of
   * the drag does nothing, which is the same promise-versus-delivery gap as an
   * inert control, just further along the track.
   *
   * Three shipped this way, and each had a different cause: `lookahead` past
   * the token count masks nothing more, `warmup` past steps/2 hits a clamp
   * inside the primitive, and `capacity_factor` moves an integer capacity that
   * only changes every twentieth position. All three were verified nodes.
   *
   * Checking the LAST step specifically, rather than demanding every step move
   * the figure: a quantised quantity legitimately repeats in the middle, and
   * requiring otherwise would fail honest figures. What is never legitimate is
   * a range whose end the figure cannot see.
   */
  it.each(draggable)('$id · $control.name still moves at the end of its range', ({ node, control }) => {
    const lastStep = control.max - control.step;
    expect(frameAt(node, control, lastStep)).not.toEqual(frameAt(node, control, control.max));
  });
});
