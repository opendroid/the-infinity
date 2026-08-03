import type { Tier } from '../lib/graph';

/**
 * The React counterpart of `TierDot.astro`.
 *
 * Two implementations exist because islands cannot render Astro components, not
 * because anyone wanted two. They must agree: node colour always encodes trust
 * tier, on graphs, edge links, mini-maps, trail stops and badges alike, and a
 * dot that is gold in one place and teal in another for the same node is a
 * design violation rather than a cosmetic one. Change one, change the other.
 *
 * Colour comes from the tier it is handed — never from where it is rendered.
 */
interface Props {
  tier: Tier;
  size?: number;
  className?: string;
}

export default function TierDot({ tier, size = 7, className = '' }: Props) {
  return (
    <span
      // Handoff: frontier pulses, verified does not.
      className={[
        'inline-block shrink-0 rounded-pill',
        tier === 'verified' ? 'bg-verified' : 'bg-frontier',
        tier === 'frontier' ? 'pulse' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ width: `${size}px`, height: `${size}px` }}
      aria-hidden="true"
    />
  );
}
