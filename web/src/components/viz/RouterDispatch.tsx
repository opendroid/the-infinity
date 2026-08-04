import { useState } from 'react';
import { describeFrame, frame, rankOpacity, type RouterParams } from './routing';
import VizBoundary from './VizBoundary';

/**
 * `router-dispatch` — a router scoring tokens against experts, and the top-k
 * waking.
 *
 * Nothing here animates. CLAUDE.md §5 rations motion to exactly one animation
 * in the whole product — the frontier pulse — so the still IS the rendering,
 * and `prefers-reduced-motion` has nothing to suppress. Adding a transition on
 * the cells would look nice and would be the second animation in a product that
 * ships one.
 *
 * The reader drags whichever parameter the node declares in `param_controls`,
 * not a parameter this component picked: `mixture-of-experts` offers `top_k`
 * and `expert-parallelism` offers `capacity_factor`, and both captions describe
 * what their own control does.
 */

interface Control {
  name: string;
  min: number;
  max: number;
  step: number;
}

interface Props {
  /** The concept id. Seeds the router scores, so each concept gets its own stable picture. */
  seed: string;
  params: Record<string, number>;
  control?: Control | undefined;
  caption: string;
  /** Shown instead of `caption` at Engineer depth. Absent means the one caption serves both. */
  captionEngineer?: string | undefined;
}

/** Trailing zeros make a mono row of numbers noisy; 1.25 and 8 should both read cleanly. */
const show = (n: number): string => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))));

/**
 * Reads the primitive's inputs out of the node's params.
 *
 * Defaults are for params a node genuinely omits, not overrides of what it
 * authored: `expert-parallelism` declares no `top_k` at all, and a component
 * that rendered nothing in that case would take a valid node off the page.
 * Two is the canonical MoE choice, and it is what makes capacity pressure —
 * the thing that node's caption is about — visible at all.
 */
function read(params: Record<string, number>): RouterParams {
  return {
    experts: params.experts ?? 8,
    topK: params.top_k ?? 2,
    capacityFactor: params.capacity_factor ?? 1.25,
  };
}

/** #47: the primitive renders inside the boundary, never instead of it. */
export default function RouterDispatch(props: Props) {
  return (
    <VizBoundary primitive="router-dispatch" caption={props.caption}>
      <Body {...props} />
    </VizBoundary>
  );
}

function Body({
  seed,
  params,
  control,
  caption,
  captionEngineer,
}: Props) {
  const [value, setValue] = useState<number>(
    control ? (params[control.name] ?? control.min) : 0,
  );

  const live = control ? { ...params, [control.name]: value } : params;
  const resolved = read(live);
  const f = frame(seed, resolved);

  // `expert-parallelism` authors `devices`, and its caption opens with "tokens
  // dispatched across four devices". Without banding, that param sits in the
  // header changing nothing and the caption describes something not on screen —
  // which is worse than the feature being absent, because the reader has no way
  // to know the sentence is stale rather than the picture being wrong.
  const devices = Math.min(Math.max(1, Math.floor(live.devices ?? 0)), f.experts);
  const perDevice = Math.ceil(f.experts / devices);
  const summary = describeFrame(f, resolved.topK, devices);

  return (
    <figure className="rounded-island border border-line bg-void p-[22px]">
      <figcaption className="mb-[18px] flex flex-wrap justify-between gap-2 font-mono text-[10px] uppercase tracking-[.16em] text-dust">
        <span>Viz primitive · router-dispatch</span>
        <span>
          {Object.entries(live)
            .map(([k, v]) => `${k.replace(/_/g, '-')} = ${show(v)}`)
            .join(' · ')}
        </span>
      </figcaption>

      {/*
        Intuition and Math: which expert each token woke.

        The grid is decoration for anyone not looking at it: every fact it
        carries is also in `summary` below and in the node's own caption, so a
        screen reader is not handed a wall of empty cells to walk through.

        Both depth variants render and CSS shows one (ADR-0005). Each carries
        its own `summary`, because `display: none` takes the hidden variant out
        of the accessibility tree — one summary outside them both would end up
        describing whichever picture is not on screen.
      */}
      <div className="depth-default">
        <div
          className="grid items-center gap-1.5"
          style={{ gridTemplateColumns: `78px repeat(${f.experts}, minmax(0, 1fr))` }}
          aria-hidden="true"
        >
          {devices > 1 && (
            <>
              <span />
              {Array.from({ length: devices }, (_, d) => (
                <span
                  key={`d${d}`}
                  style={{ gridColumn: `span ${Math.min(perDevice, f.experts - d * perDevice)}` }}
                  className="mb-0.5 border-b border-line pb-1 text-center font-mono text-[9px] uppercase tracking-[.12em] text-dust"
                >
                  D{d + 1}
                </span>
              ))}
            </>
          )}

          <span />
          {Array.from({ length: f.experts }, (_, e) => (
            <span key={`h${e}`} className="text-center font-mono text-[9px] text-dust">
              E{e + 1}
            </span>
          ))}

          {f.cells.map((row, t) => (
            <Row key={f.tokens[t]} token={f.tokens[t] ?? ''} cells={row} />
          ))}

          <span className="font-mono text-[10px] uppercase tracking-[.12em] text-dust">load</span>
          {f.load.map((n, e) => (
            <span key={`l${e}`} className="text-center font-mono text-[10px] text-dust">
              {n}
            </span>
          ))}
        </div>
        <p className="sr-only">{summary}</p>
      </div>

      {/*
        Engineer: the same batch, seen as per-expert utilisation.

        The handoff shows fractions here — 0.62, 0.18, 0.94 — drawn against a
        batch large enough to produce them. This batch is six tokens, so a
        fraction could only ever be 0.00, 0.50 or 1.00: precision these numbers
        do not have. The count against capacity says the same thing without the
        decimal places claiming otherwise.
      */}
      <div className="depth-engineer">
        <div className="flex flex-col gap-[9px]" aria-hidden="true">
          {f.load.map((n, e) => (
            <div key={`u${e}`} className="flex items-center gap-3">
              <span className="w-[78px] shrink-0 font-mono text-[10px] uppercase tracking-[.1em] text-dust">
                E{e + 1} load
              </span>
              <span className="h-[9px] flex-1 overflow-hidden rounded-full bg-nebula">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.min(100, (n / f.capacity) * 100)}%`,
                    background: 'var(--color-thread)',
                  }}
                />
              </span>
              <span className="w-10 shrink-0 text-right font-mono text-[10px] text-dust">
                {n}/{f.capacity}
              </span>
            </div>
          ))}
        </div>
        <p className="sr-only">{summary}</p>
      </div>

      {/*
        The caption is depth-scoped for the same reason the renderings and the
        legends are (#94). A node that authors only `caption` gets one <p> with
        no depth class, shown at every depth — the override is for a primitive
        whose Engineer depth is genuinely a different picture, not a tax on
        every node.
      */}
      {captionEngineer ? (
        <>
          <p className="depth-default mt-4 max-w-[58ch] text-[12.5px] leading-[1.6] text-dust">
            {caption}
          </p>
          <p className="depth-engineer mt-4 max-w-[58ch] text-[12.5px] leading-[1.6] text-dust">
            {captionEngineer}
          </p>
        </>
      ) : (
        <p className="mt-4 max-w-[58ch] text-[12.5px] leading-[1.6] text-dust">{caption}</p>
      )}

      {/*
        Not carried by colour alone: dropped cells are dashed AND named here,
        and the count is in the screen-reader summary above.
      */}
      {f.dropped > 0 && (
        <p className="depth-default mt-1.5 font-mono text-[10px] uppercase tracking-[.12em] text-dust">
          Dashed = dropped, expert at capacity ({f.capacity})
        </p>
      )}

      {/*
        The legend is depth-scoped for the same reason the renderings are: at
        engineer depth there are no dashed cells to explain, and a legend for a
        mark that is not on screen is the same defect as a caption for a picture
        that is not on screen.
      */}
      <p className="depth-engineer mt-1.5 font-mono text-[10px] uppercase tracking-[.12em] text-dust">
        Bar = share of each expert's capacity used
      </p>

      {control && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label
            htmlFor={`viz-${seed}-${control.name}`}
            className="font-mono text-[10px] uppercase tracking-[.14em] text-dust"
          >
            {control.name.replace(/_/g, '-')}
          </label>
          <input
            id={`viz-${seed}-${control.name}`}
            type="range"
            className="flex-1 cursor-pointer"
            min={control.min}
            max={control.max}
            step={control.step}
            value={value}
            onChange={(e) => setValue(Number(e.currentTarget.value))}
          />
          <output
            htmlFor={`viz-${seed}-${control.name}`}
            className="w-10 text-right font-mono text-[10px] text-dust"
          >
            {show(value)}
          </output>
        </div>
      )}
    </figure>
  );
}

function Row({ token, cells }: { token: string; cells: ReturnType<typeof frame>['cells'][number] }) {
  return (
    <>
      <span className="truncate font-mono text-[11px] text-dust">“{token}”</span>
      {cells.map((cell, e) => (
        <span
          key={e}
          className="h-5 rounded-[5px]"
          style={
            cell.rank === null
              ? { border: '1px solid var(--color-line)' }
              : cell.dropped
                ? { border: '1px dashed var(--color-thread)' }
                : { background: 'var(--color-thread)', opacity: rankOpacity(cell.rank) }
          }
        />
      ))}
    </>
  );
}
