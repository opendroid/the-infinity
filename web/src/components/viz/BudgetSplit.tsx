import { useState } from 'react';
import { describeSplit, percent, split } from './share';
import VizBoundary from './VizBoundary';

/**
 * `budget-split` — one whole divided in two, with the control moving the split.
 *
 * A single stacked bar rather than two: the point is a *proportion*, and two
 * separate bars would ask the reader to compare lengths instead of reading a
 * share off one. Solid violet is the part, the same violet at 45% is the rest —
 * inside the island violet is the data channel, and a second hue here would be
 * a meaning nobody defined.
 *
 * Nothing animates, per CLAUDE.md §5.
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

const show = (n: number): string => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))));
const label = (name: string): string => name.replace(/_/g, '-');

/** #47: the primitive renders inside the boundary, never instead of it. */
export default function BudgetSplit(props: Props) {
  return (
    <VizBoundary primitive="budget-split" caption={props.caption}>
      <Body {...props} />
    </VizBoundary>
  );
}

function Body({ seed, params, control, caption, captionEngineer }: Props) {
  const [value, setValue] = useState<number>(control ? (params[control.name] ?? control.min) : 0);

  const live = control ? { ...params, [control.name]: value } : params;

  // The control names the part; share_rest names the fixed remainder in the
  // same units (ADR-0007). Without a control there is nothing to drag and the
  // part is whatever the node authored.
  const part = control ? value : (live.part ?? 0);
  const f = split(part, live.share_rest ?? 0);

  const partName = control ? label(control.name) : 'part';
  const restName = 'rest';
  const pct = percent(f.share);

  // share_rest is bookkeeping, not something a reader wants in the header row.
  const shown = Object.entries(live).filter(([k]) => k !== 'share_rest');

  return (
    <figure className="rounded-island border border-line bg-void p-[22px]">
      <figcaption className="mb-[18px] flex flex-wrap justify-between gap-2 font-mono text-[10px] uppercase tracking-[.16em] text-dust">
        <span>Viz primitive · budget-split</span>
        <span>{shown.map(([k, v]) => `${label(k)} = ${show(v)}`).join(' · ')}</span>
      </figcaption>

      <div aria-hidden="true">
        <div className="flex h-7 overflow-hidden rounded-full bg-nebula">
          <span style={{ width: `${pct}%`, background: 'var(--color-thread)' }} />
          <span
            className="flex-1"
            style={{ background: 'color-mix(in srgb, var(--color-thread) 45%, transparent)' }}
          />
        </div>
        <div className="mt-2.5 flex justify-between font-mono text-[10px] uppercase tracking-[.12em] text-dust">
          <span>
            {partName} · {pct}%
          </span>
          <span>
            {restName} · {100 - pct}%
          </span>
        </div>
      </div>

      <p className="sr-only">{describeSplit(f, partName, restName)}</p>

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
            className="w-12 text-right font-mono text-[10px] text-dust"
          >
            {show(value)}
          </output>
        </div>
      )}
    </figure>
  );
}
