import { useState } from 'react';
import { attention, describeAttention, shapeFrom } from './attention';

/**
 * `attention-heatmap` — a grid of query rows against key columns, brightness
 * carrying the weight.
 *
 * Drawn as one SVG with a viewBox rather than a CSS grid of elements: the
 * concept page gives this 1fr of a `1fr 288px` layout and collapses to a single
 * column under 760px, so the picture has to survive a wide range of widths. A
 * viewBox scales; a grid of fixed cells reflows and stops being square.
 *
 * A single-hue violet ramp, per the design rule that violet is the island's
 * only data channel. Brightness is scaled to the frame's peak so the strongest
 * cell always reaches full violet — otherwise a sharply-peaked head and a flat
 * one would be drawn at wildly different overall brightness and the reader
 * would compare the wrong thing.
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

const show = (n: number): string => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))));
const label = (name: string): string => name.replace(/_/g, '-');

/** Bookkeeping the reader did not ask about. */
const HIDDEN = new Set(['lookahead', 'keys', 'decay', 'sink']);

export default function AttentionHeatmap({
  seed,
  params,
  control,
  caption,
  captionEngineer,
}: Props) {
  const [value, setValue] = useState<number>(control ? (params[control.name] ?? control.min) : 0);

  const live = control ? { ...params, [control.name]: value } : params;
  const f = attention(seed, shapeFrom(live));
  const { rows, cols } = f.shape;

  // One unit per cell with a small gap, so the viewBox is the grid's own
  // coordinate system and nothing has to know the rendered pixel size.
  const GAP = 0.12;

  return (
    <figure className="rounded-island border border-line bg-void p-[22px]">
      <figcaption className="mb-[18px] flex flex-wrap justify-between gap-2 font-mono text-[10px] uppercase tracking-[.16em] text-dust">
        <span>Viz primitive · attention-heatmap</span>
        <span>
          {Object.entries(live)
            .filter(([k]) => !HIDDEN.has(k))
            .map(([k, v]) => `${label(k)} = ${show(v)}`)
            .join(' · ')}
        </span>
      </figcaption>

      <svg
        viewBox={`0 0 ${cols} ${rows}`}
        // Width is capped rather than height. Capping height letterboxes the
        // picture inside a full-width box and leaves the grid marooned in empty
        // space; capping width keeps the cells square and the figure compact at
        // every column width, including one column on mobile.
        className="mx-auto block w-full"
        style={{ aspectRatio: `${cols} / ${rows}`, maxWidth: `${(cols / rows) * 300}px` }}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        {f.weights.map((row, i) =>
          row.map((w, j) => (
            <rect
              key={`${i}-${j}`}
              x={j + GAP / 2}
              y={i + GAP / 2}
              width={1 - GAP}
              height={1 - GAP}
              rx={0.14}
              // A masked cell is drawn as an outline rather than as a very dark
              // fill: "this query cannot see that key" and "it looked and found
              // nothing" are different statements, and the caption makes one.
              fill={w === 0 ? 'transparent' : 'var(--color-thread)'}
              fillOpacity={w === 0 ? 0 : Math.max(0.06, w / f.peak)}
              stroke={w === 0 ? 'var(--color-line)' : 'none'}
              strokeWidth={w === 0 ? 0.03 : 0}
            />
          )),
        )}
      </svg>

      <div className="mt-2.5 flex justify-between font-mono text-[10px] uppercase tracking-[.12em] text-dust">
        <span>query ↓</span>
        <span>key →</span>
      </div>

      <p className="sr-only">{describeAttention(f)}</p>

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
            className="w-10 text-right font-mono text-[10px] text-dust"
          >
            {show(value)}
          </output>
        </div>
      )}
    </figure>
  );
}
