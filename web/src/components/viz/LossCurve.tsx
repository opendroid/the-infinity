import { useState } from 'react';
import { ceiling, describeCurve, lossCurve, paramsFrom } from './losscurve';

/**
 * `loss-curve` — loss against training step.
 *
 * One SVG with a viewBox, for the same reason as the heatmap: the concept page
 * gives this 1fr of a `1fr 288px` grid that collapses to one column under
 * 760px, and a viewBox scales where fixed geometry reflows.
 *
 * The counterfactual is drawn faint and dashed rather than in a second colour.
 * Violet is the island's only data channel, and "this is the other run" is a
 * weaker claim than "this is a different kind of thing" — dashing says it
 * without borrowing a hue that already means trust tier elsewhere.
 *
 * No gridlines. The issue asks for axes labelled in mono and no clutter, and a
 * loss curve's shape is the whole message; ruled lines behind it would be
 * decoration competing with the one thing worth reading.
 *
 * Nothing animates (CLAUDE.md §5).
 */

interface Control {
  name: string;
  min: number;
  max: number;
  step: number;
}

interface Props {
  seed: string;
  params: Record<string, number>;
  control?: Control | undefined;
  caption: string;
  captionEngineer?: string | undefined;
}

const show = (n: number): string =>
  Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
const label = (name: string): string => name.replace(/_/g, '-');

/** Modifiers the reader drags or reads in the caption, not bookkeeping. */
const HIDDEN = new Set(['holdout', 'decay']);

const W = 320;
const H = 130;

export default function LossCurve({ seed, params, control, caption, captionEngineer }: Props) {
  const [value, setValue] = useState<number>(control ? (params[control.name] ?? control.min) : 0);

  const live = control ? { ...params, [control.name]: value } : params;
  const f = lossCurve(seed, paramsFrom(live));
  const top = ceiling(f) * 1.04;

  // y grows downward in SVG, and loss is plotted with zero at the bottom.
  const toPath = (values: number[]): string =>
    values
      .map((v, i) => {
        const x = (i / (values.length - 1)) * W;
        const y = H - (v / top) * H;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');

  return (
    <figure className="rounded-island border border-line bg-void p-[22px]">
      <figcaption className="mb-[18px] flex flex-wrap justify-between gap-2 font-mono text-[10px] uppercase tracking-[.16em] text-dust">
        <span>Viz primitive · loss-curve</span>
        <span>
          {Object.entries(live)
            .filter(([k]) => !HIDDEN.has(k))
            .map(([k, v]) => `${label(k)} = ${show(v)}`)
            .join(' · ')}
        </span>
      </figcaption>

      <div className="flex gap-2.5">
        <span className="shrink-0 self-center font-mono text-[10px] uppercase tracking-[.12em] text-dust [writing-mode:vertical-rl] [transform:rotate(180deg)]">
          loss
        </span>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          preserveAspectRatio="none"
          style={{ height: '150px' }}
          aria-hidden="true"
        >
          {/* One baseline, not a grid: it says where zero is and nothing else. */}
          <line x1="0" y1={H} x2={W} y2={H} stroke="var(--color-line)" strokeWidth="1" />
          {f.compare && (
            <path
              d={toPath(f.compare)}
              fill="none"
              stroke="var(--color-thread)"
              strokeOpacity="0.4"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <path
            d={toPath(f.main)}
            fill="none"
            stroke="var(--color-thread)"
            strokeWidth="1.75"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      <div className="mt-2 flex justify-between pl-6 font-mono text-[10px] uppercase tracking-[.12em] text-dust">
        <span>step 0</span>
        <span>{f.compareLabel ? `dashed = ${f.compareLabel}` : ''}</span>
        <span>{show(f.params.steps)}</span>
      </div>

      <p className="sr-only">{describeCurve(f)}</p>

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

      {control && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label
            htmlFor={`viz-${seed}-${control.name}`}
            className="font-mono text-[10px] uppercase tracking-[.14em] text-dust"
          >
            {label(control.name)}
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
            className="w-14 text-right font-mono text-[10px] text-dust"
          >
            {show(value)}
          </output>
        </div>
      )}
    </figure>
  );
}
