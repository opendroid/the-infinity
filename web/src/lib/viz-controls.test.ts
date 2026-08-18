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
import { progress, spectrum, spread } from '../components/viz/spectrum';
import { split, percent } from '../components/viz/share';

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
  caption: string;
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
  /**
   * A DEFAULT PARKED AT THE CEILING. Two nodes shipped with the control's
   * authored value equal to its own max, under captions reading "drag the state
   * UP to the fourteen this node counts" and "drag the decay to watch the
   * schedule pull the run further down" — both already there, both draggable
   * only backwards.
   *
   * Defaults at the MINIMUM are fine and thirteen nodes have one: starting at the
   * small end and dragging up is how every caption in this corpus is phrased. It
   * is the ceiling that makes the instruction impossible.
   *
   * A node that genuinely wants to open at the extreme needs a caption saying
   * drag down, and this assertion is where that conversation starts.
   */
  it.each(draggable)('$id · $control.name does not open at the top of its range', ({ node, control }) => {
    expect(node.viz.params[control.name]).not.toEqual(control.max);
  });

  /**
   * A FIGURE THAT CANNOT VISIBLY MOVE FROM WHERE IT OPENS.
   *
   * The three assertions above ask whether the numbers differ. This one asks
   * whether a reader could SEE them differ, which is a different question and
   * the one the reader is actually asking. Six nodes passed all three while
   * moving the picture by a single percentage point across the whole drag the
   * caption told them to make:
   *
   *   adam · beta2                        100% -> 100%   "watch the update even out"
   *   momentum · beta                      99% -> 100%   "watch the noise average away"
   *   nucleus-sampling · p                 99% -> 100%   "watch the kept set grow"
   *   constitutional-ai · ai_labels        90% ->  91%   "see how much human effort it replaces"
   *   multi-query-attention                97% ->  98%   "watch the saving grow with every head"
   *   decoder-only-transformer · layers    94% ->  98%   "watch the stack dominate"
   *
   * Three of those had one cause. `progress` eases with `1 - (1 - x)²`, steep
   * early, so an author using the GENUINE hyperparameter — β₂ = 0.999, β = 0.9,
   * p = 0.9 — lands at an eased t of 0.99 or better and the spectrum is already
   * flat at rest. Doing the honest thing produced a finished picture.
   *
   * WHY THIS IS NOT "THE BAR MUST MOVE".
   *
   * Five nodes move barely at all ON PURPOSE, and that immobility is the entire
   * lesson: `lora`'s trainable slice "stays a rounding error", `prompt-tuning`'s
   * "stays negligible", `collective-communication` "saturates just below the
   * whole — the reason all-reduce cost stops growing". A flat travel threshold
   * would fail all five and be wrong about every one.
   *
   * So the invariant is the PAIRING, not the movement: **either the figure moves,
   * or the caption says it does not.** That is checkable, and it is the promise
   * actually being made.
   *
   * Direction is read from the caption, defaulting to up — #195's note records
   * that dragging up from the small end is how every caption in this corpus is
   * phrased, so up is what a reader tries first. A caption that means down has
   * to say down, which is the same conversation that assertion started.
   *
   * COVERAGE IS PARTIAL AND DELIBERATELY SO. Only `budget-split` and
   * `update-spectrum` are checked — 113 of the corpus's figures — because only
   * they have a single scalar that honestly means "how far along is the
   * picture". A heatmap's peak and a loss curve's floor are not that, and
   * asserting on them would measure something other than what a reader sees.
   * The uncovered three are named here rather than skipped silently.
   *
   * THE THRESHOLD IS 10 BECAUSE NOTHING HONEST SITS BELOW 14. It shipped at 5,
   * which was as far as the evidence went at the time — #203 held the nine
   * figures in the 6-14 band pending a decision on each. Classifying them found
   * two that were not borderline at all: `reward-model` promised "out of a
   * hundred" from a split whose whole runs to 128, and `feed-forward-network`
   * told the reader to drag to 4x d_model for two thirds while the arithmetic
   * gave four fifths there. With those repaired and seven defaults moved off
   * the flat tail, the lowest figure not claiming immobility is `muon-optimizer`
   * at 14. Ten sits clear of it with room for honest authoring, rather than
   * tightening to the current corpus and failing the next node written.
   */
  const MIN_TRAVEL = 10;
  /** Captions whose point IS that the figure barely moves. */
  const SAYS_IT_STAYS = /\b(stays?|negligible|rounding error|saturat\w*|barely|hardly|never quite)\b/i;
  const SAYS_DOWN = /drag[^.]*?\b(down|lower)\b/i;

  /**
   * How far along the picture is, 0..100, or null when the primitive has no
   * such number. Whole units on purpose: `percent` already rounds because the
   * bar "is read, not measured", and a fractional threshold would pass figures
   * that move by less than the bar can draw.
   */
  function visible(node: Node, control: Control, value: number): number | null {
    const live = { ...node.viz.params, [control.name]: value };
    if (node.viz.primitive === 'budget-split') {
      return percent(split(value, live.share_rest ?? 0).share);
    }
    if (node.viz.primitive === 'update-spectrum') {
      const f = spectrum(node.id, live.bars ?? 8, progress(value, control.min, control.max));
      const base = spread(f.baseline);
      return base === 0 ? 0 : Math.round((1 - spread(f.transformed) / base) * 100);
    }
    return null;
  }

  it.each(draggable)('$id · $control.name moves visibly, or says it does not', ({ node, control }) => {
    const open = visible(node, control, node.viz.params[control.name]!);
    if (open === null) return;
    const end = visible(node, control, SAYS_DOWN.test(node.viz.caption) ? control.min : control.max)!;
    if (SAYS_IT_STAYS.test(node.viz.caption)) return;
    expect(Math.abs(end - open)).toBeGreaterThanOrEqual(MIN_TRAVEL);
  });
});
