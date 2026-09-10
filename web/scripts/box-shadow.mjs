/**
 * Does a computed `box-shadow` actually paint anything? (#419)
 *
 * This exists because getting it wrong is what created #419. Tailwind v4 does
 * not set `box-shadow` to a value; it composes five variables, four of which
 * are the initial `0 0 #0000` unless a ring or an inset shadow is in play. So
 * a single glow is reported by the browser as:
 *
 *   rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px,
 *   rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px,
 *   rgba(143, 123, 255, 0.16) 0px 0px 44px 0px
 *
 * The real shadow is the FIFTH component. A test asking whether the string
 * contains `rgba(0, 0, 0, 0)` answers "no shadow" for a page that is painting
 * one perfectly — which is exactly the measurement that made me file #419
 * against working code.
 *
 * So: split into components and ask whether ANY of them has a visible colour.
 */

/** Split on commas that are not inside `rgb(...)` / `rgba(...)`. */
export function components(value) {
  if (typeof value !== 'string') return [];
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    const c = value[i];
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    else if (c === ',' && depth === 0) {
      out.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(value.slice(start).trim());
  return out.filter((p) => p !== '');
}

/**
 * Is the component's colour fully transparent?
 *
 * Written by position, not by "ends in a zero". `rgb(0, 0, 0)` — plain black —
 * ends in `, 0)` too, and a looser test reads its BLUE channel as the alpha and
 * calls an opaque shadow invisible. The unit test for a black offset shadow is
 * what caught that.
 */
function alphaIsZero(part) {
  const call = /rgba?\(([^)]*)\)/.exec(part);
  if (!call) return false;
  const body = call[1];
  const zero = (v) => /^0(\.0+)?$/.test(v.trim());
  // Modern syntax puts alpha after a slash: rgb(143 123 255 / 0).
  const slash = body.split('/');
  if (slash.length === 2) return zero(slash[1]);
  // Legacy syntax has alpha as a fourth comma-separated argument, and only then.
  const args = body.split(',');
  return args.length === 4 && zero(args[3]);
}

/**
 * Is one component invisible?
 *
 * Fully transparent by colour, or — the case a colour test alone misses — a
 * coloured shadow with no offset, no blur and no spread, which occupies exactly
 * the element's own box and so paints nothing you can see.
 */
export function isInvisible(part) {
  if (part === '' || part === 'none') return true;
  if (/\btransparent\b/.test(part)) return true;
  if (alphaIsZero(part)) return true;
  const lengths = part.replace(/rgba?\([^)]*\)/g, '').match(/-?\d*\.?\d+(px|r?em|%)/g) ?? [];
  return lengths.length > 0 && lengths.every((l) => parseFloat(l) === 0);
}

/** Does this computed value put any visible shadow on the screen? */
export function paints(value) {
  if (typeof value !== 'string' || value.trim() === '' || value.trim() === 'none') return false;
  return components(value).some((part) => !isInvisible(part));
}

/**
 * The elements that glow, out of `[label, computedBoxShadow]` pairs.
 *
 * CLAUDE.md §5 rule 3 rations glow to one element per screen, so the caller
 * asserts on the length of this as much as on its contents.
 */
export function glowing(measured) {
  return measured.filter(([, value]) => paints(value)).map(([label]) => label);
}
