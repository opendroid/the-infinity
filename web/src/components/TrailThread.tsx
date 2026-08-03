import type { Tier } from '../lib/graph';
import { TRAIL, spread, toPathD } from '../lib/curve';

/**
 * The thread, on a shared trail — the React half of `Thread.astro`'s `trail`
 * variant, for the one route that is an island end to end (ADR-0008).
 *
 * The geometry is NOT duplicated: both draw the stroke and place the beads from
 * `curve.ts`, which exists because an earlier version kept two hand-written
 * lists in sync by hope and they drifted by up to 7px. Only the JSX differs.
 */
interface Props {
  beads: Tier[];
}

export default function TrailThread({ beads }: Props) {
  const placed = spread(TRAIL, beads.length).map((pt, i) => ({ ...pt, tier: beads[i]! }));
  const lastIndex = placed.length - 1;

  return (
    <svg viewBox="0 0 1000 90" className="my-2 h-auto w-full max-md:hidden" fill="none" aria-hidden="true">
      <path d={toPathD(TRAIL)} stroke="#8F7BFF" strokeWidth="1.6" opacity=".75" />
      {placed.map((bead, i) => (
        <circle
          key={i}
          cx={bead.x}
          cy={bead.y}
          // The final bead is one radius larger — the handoff's way of saying
          // "this is where you ended up".
          r={i === lastIndex ? 7 : 5.5}
          fill={bead.tier === 'verified' ? '#E5B54A' : '#5FD4C4'}
          className={bead.tier === 'frontier' ? `pulse pulse-${i % 3}` : ''}
        />
      ))}
    </svg>
  );
}
