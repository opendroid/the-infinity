import { useState } from 'react';
import { describeSweep, percent, shapeFrom, sweep } from './threshold';
import VizBoundary from './VizBoundary';

/**
 * `threshold-sweep` — two overlapping populations and one cut through them.
 *
 * The shape `budget-split` cannot draw. A proportion bar says how a whole is
 * divided; it cannot say that moving the divider makes one kind of error worse
 * as it makes the other better, because a bar has one number and this has four
 * (ADR-0014).
 *
 * Two filled areas rather than two outlines: the OVERLAP is the subject, and an
 * outline draws two curves crossing where a fill draws the region where the two
 * populations cannot be told apart. Solid violet is what should be flagged, the
 * same violet at 40% is what should not — the `budget-split` convention, and for
 * its reason: inside the island violet is the data channel and a second hue
 * would be a meaning nobody defined.
 *
 * The cut is a plain vertical rule, not a shaded half-plane. Shading the flagged
 * side would put a third value on a surface that already carries two, and the
 * count grid under the figure says which side is which in words.
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

const W = 320;
const H = 96;

const show = (n: number): string => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))));
const label = (name: string): string => name.replace(/_/g, '-');

/** A closed area under the density, so the overlap reads as a region. */
function toArea(values: number[]): string {
  if (values.length === 0) return '';
  const step = W / (values.length - 1);
  const line = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(2)},${(H - v * H).toFixed(2)}`)
    .join(' ');
  return `${line} L${W},${H} L0,${H} Z`;
}

export default function ThresholdSweep(props: Props) {
  return (
    <VizBoundary primitive="threshold-sweep" caption={props.caption}>
      <Body {...props} />
    </VizBoundary>
  );
}

function Body({ seed, params, control, caption, captionEngineer }: Props) {
  const [value, setValue] = useState<number>(control ? (params[control.name] ?? control.min) : 0);
  const live = control ? { ...params, [control.name]: value } : params;
  const f = sweep(shapeFrom(live));

  return (
    <figure className="rounded-island border border-line bg-void p-[22px]">
      <figcaption className="mb-[18px] flex flex-wrap justify-between gap-2 font-mono text-[10px] uppercase tracking-[.16em] text-dust">
        <span>Viz primitive · threshold-sweep</span>
        <span>
          {Object.entries(live)
            .map(([k, v]) => `${label(k)} = ${show(v)}`)
            .join(' · ')}
        </span>
      </figcaption>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        preserveAspectRatio="none"
        style={{ height: '104px' }}
        aria-hidden="true"
      >
        <line x1="0" y1={H} x2={W} y2={H} stroke="var(--color-line)" strokeWidth="1" />
        <path
          d={toArea(f.negatives)}
          fill="color-mix(in srgb, var(--color-thread) 40%, transparent)"
        />
        <path d={toArea(f.positives)} fill="var(--color-thread)" fillOpacity="0.85" />
        <line
          x1={(f.cut * W).toFixed(2)}
          y1="0"
          x2={(f.cut * W).toFixed(2)}
          y2={H}
          stroke="var(--color-starlight)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="mt-2 flex justify-between font-mono text-[10px] uppercase tracking-[.12em] text-dust">
        <span>let through</span>
        <span>cut</span>
        <span>flagged</span>
      </div>

      <dl
        className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[10px] uppercase tracking-[.12em] text-dust sm:grid-cols-4"
        aria-hidden="true"
      >
        <Cell term="caught" value={f.truePositives} />
        <Cell term="false alarms" value={f.falsePositives} />
        <Cell term="missed" value={f.falseNegatives} />
        <Cell term="precision" value={`${percent(f.precision)}%`} />
      </dl>

      <p className="sr-only">{describeSweep(f)}</p>

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

/** The denominator lives in the screen-reader line rather than being repeated in four cells. */
function Cell({ term, value }: { term: string; value: number | string }) {
  return (
    <div>
      <dt>{term}</dt>
      <dd className="mt-0.5 text-[13px] tracking-normal text-starlight">{value}</dd>
    </div>
  );
}
