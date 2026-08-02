/**
 * The thread's geometry.
 *
 * Beads must sit ON the line — the thread is the product's one visual idea, and
 * a bead floating a few pixels off it reads as a rendering bug. The only way to
 * guarantee that is to derive both the path and the bead positions from the
 * same data, so this module owns the control points and everything else asks it
 * for coordinates.
 */

export interface Pt {
  x: number;
  y: number;
}

/** A cubic segment: two control points and an end point. Start is implicit. */
export interface Segment {
  c1: Pt;
  c2: Pt;
  to: Pt;
}

export interface Curve {
  from: Pt;
  segments: Segment[];
  closed?: boolean;
}

/** Renders a curve as an SVG path `d` attribute. */
export function toPathD(curve: Curve): string {
  const parts = [`M${curve.from.x} ${curve.from.y}`];
  for (const s of curve.segments) {
    parts.push(`C ${s.c1.x} ${s.c1.y}, ${s.c2.x} ${s.c2.y}, ${s.to.x} ${s.to.y}`);
  }
  if (curve.closed) parts.push('Z');
  return parts.join(' ');
}

/** de Casteljau evaluation of one cubic segment at t ∈ [0,1]. */
function cubicAt(p0: Pt, c1: Pt, c2: Pt, p1: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p1.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p1.y,
  };
}

/**
 * Point at t ∈ [0,1] across the whole curve, parameterised by segment index
 * rather than arc length. Segments here are of similar length, so the visual
 * spacing is even enough and the arithmetic stays exact.
 */
export function pointAt(curve: Curve, t: number): Pt {
  const n = curve.segments.length;
  if (n === 0) return curve.from;

  const clamped = Math.min(Math.max(t, 0), 1);
  const scaled = clamped * n;
  const index = Math.min(Math.floor(scaled), n - 1);
  const local = scaled - index;

  const start = index === 0 ? curve.from : curve.segments[index - 1]!.to;
  const seg = curve.segments[index]!;
  const p = cubicAt(start, seg.c1, seg.c2, seg.to, local);
  return { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 };
}

/** Evenly spaced points along a curve, excluding both endpoints. */
export function spread(curve: Curve, count: number): Pt[] {
  return Array.from({ length: count }, (_, i) => pointAt(curve, (i + 1) / (count + 1)));
}

const p = (x: number, y: number): Pt => ({ x, y });

/**
 * The landing lemniscate, in a 620×230 viewBox. Scaled from the original
 * exploration's figure-eight so the proportions carry over.
 *
 * Split into two halves so trust tiers can own a lobe each: verified on the
 * left, frontier on the right — the figure then reads as reviewed core flowing
 * into new growth, which is the graph's actual shape.
 */
export const LEMNISCATE_LEFT: Curve = {
  from: p(310, 115),
  segments: [
    { c1: p(310, 52), c2: p(199, 31), to: p(144, 73) },
    { c1: p(89, 115), c2: p(89, 115), to: p(144, 157) },
    { c1: p(199, 199), c2: p(310, 178), to: p(310, 115) },
  ],
};

export const LEMNISCATE_RIGHT: Curve = {
  from: p(310, 115),
  segments: [
    { c1: p(310, 52), c2: p(421, 31), to: p(476, 73) },
    { c1: p(531, 115), c2: p(531, 115), to: p(476, 157) },
    { c1: p(421, 199), c2: p(310, 178), to: p(310, 115) },
  ],
};

/** The two lobes as one closed figure, for the stroke. */
export const LEMNISCATE: Curve = {
  from: LEMNISCATE_LEFT.from,
  segments: [...LEMNISCATE_LEFT.segments, ...LEMNISCATE_RIGHT.segments],
  closed: true,
};

/** Where the two lobes cross — the thread's own centre. */
export const LEMNISCATE_CENTRE = p(310, 115);

/** The shared-trail thread, in a 1000×90 viewBox. */
export const TRAIL: Curve = {
  from: p(20, 60),
  segments: [
    { c1: p(140, 20), c2: p(260, 85), to: p(380, 50) },
    { c1: p(500, 15), c2: p(620, 80), to: p(760, 45) },
    { c1: p(860, 20), c2: p(930, 55), to: p(980, 35) },
  ],
};
