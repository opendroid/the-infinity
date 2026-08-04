import { useState } from 'react';
import { describeSpectrum, progress, spectrum } from './spectrum';
import VizBoundary from './VizBoundary';

/**
 * `update-spectrum` — one distribution against another.
 *
 * Two bar groups, 104px tall: the baseline on the left, and on the right the
 * same values pulled toward flat by the control. Three concepts point at this
 * primitive and mean three different things by it — singular values under
 * Newton–Schulz, a gate's output under temperature, a block's parameter mass —
 * which is exactly the point of a primitive being a *shape* rather than a
 * drawing of one idea.
 *
 * Nothing animates, for the same reason as `router-dispatch`: CLAUDE.md §5
 * rations the product to one animation, so the still is the rendering and
 * `prefers-reduced-motion` has nothing to suppress.
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

/** #47: the primitive renders inside the boundary, never instead of it. */
export default function UpdateSpectrum(props: Props) {
  return (
    <VizBoundary primitive="update-spectrum" caption={props.caption}>
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
  const [value, setValue] = useState<number>(control ? (params[control.name] ?? control.min) : 0);

  const live = control ? { ...params, [control.name]: value } : params;
  // `bars` is authored only by muon-optimizer; the other two nodes leave the
  // group width to the primitive rather than to a number they never chose.
  const t = control ? progress(value, control.min, control.max) : 0;
  const f = spectrum(seed, live.bars ?? 8, t);
  const summary = describeSpectrum(f);

  return (
    <figure className="rounded-island border border-line bg-void p-[22px]">
      <figcaption className="mb-[18px] flex flex-wrap justify-between gap-2 font-mono text-[10px] uppercase tracking-[.16em] text-dust">
        <span>Viz primitive · update-spectrum</span>
        <span>
          {Object.entries(live)
            .map(([k, v]) => `${k.replace(/_/g, '-')} = ${show(v)}`)
            .join(' · ')}
        </span>
      </figcaption>

      <div className="flex gap-[26px]" aria-hidden="true">
        <Group label="before" values={f.baseline} />
        <Group label="after" values={f.transformed} />
      </div>

      <p className="sr-only">{summary}</p>

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

function Group({ label, values }: { label: string; values: number[] }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex h-[104px] items-end gap-1.5">
        {values.map((v, i) => (
          <span
            key={i}
            className="min-w-px flex-1 rounded-t-[2px]"
            style={{
              // A floor of 2% so a bar that has flattened to almost nothing is
              // still a bar. Zero height reads as "this direction was removed",
              // which is not what flattening does.
              height: `${Math.max(2, v * 100)}%`,
              background: 'var(--color-thread)',
            }}
          />
        ))}
      </div>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[.12em] text-dust">{label}</p>
    </div>
  );
}
