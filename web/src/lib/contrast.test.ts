import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Text fields have to be findable before they can be filled in (#349).
 *
 * WCAG 1.4.11 asks for 3:1 on "visual information required to identify user
 * interface components". A text field's boundary is exactly that: unfocused and
 * empty it is identified by its placeholder, and one keystroke later the
 * placeholder is gone and the only thing left saying where the field is, is its
 * border. Every field on this site but the landing one was drawn with `line`,
 * which is 1.44:1 on `void` — over a fill that IS `void`, so there was nothing
 * to see at all.
 *
 * The ratios are computed from tokens.json rather than written down here, so
 * this test tracks the palette instead of a snapshot of it. Buttons and edge
 * rows are deliberately not covered: each carries a visible text label at
 * 6.2:1 or better, and 1.4.11 does not ask a boundary to repeat what the label
 * already says.
 */

const WEB = resolve(process.cwd());
const TOKENS = join(WEB, '../docs/design/handoff-v1/tokens.json');
const read = (p: string) => readFileSync(join(WEB, p), 'utf8');

/** The surfaces a control can sit on. A boundary has to work against all of them. */
const SURFACES = ['void', 'nebula', 'nebula-2'] as const;
const MIN_RATIO = 3;

/** Files holding a text-entry control, checked as source because the rule is about what is written. */
const SOURCES = [
  'src/pages/index.astro',
  'src/components/SearchPanel.tsx',
  'src/components/RequestForm.tsx',
  'src/components/RequestConcept.tsx',
  'src/components/ReviewActions.tsx',
];

const palette: Record<string, string> = (() => {
  const raw = JSON.parse(readFileSync(TOKENS, 'utf8')) as { color: Record<string, string> };
  return raw.color;
})();

const channel = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string): number => {
  const h = hex.replace('#', '');
  const part = (i: number) => channel(parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * part(0) + 0.7152 * part(2) + 0.0722 * part(4);
};

/** WCAG relative-luminance contrast, as a ratio from 1 to 21. */
export const contrast = (a: string, b: string): number => {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

const carries = (token: string): boolean => {
  const hex = palette[token];
  if (hex === undefined) return false;
  return SURFACES.every((s) => contrast(hex, palette[s] as string) >= MIN_RATIO);
};

/**
 * Text-entry controls, with the border token each one declares.
 *
 * The tag is read with a brace-depth scan rather than a regex, because
 * `onChange={(e) => setName(...)}` contains a `>` and a lazy `[\s\S]*?>` stops
 * there — before the className. That is not a hypothetical: the first version of
 * this test did exactly that, found no border on the tag, silently fell through
 * to the wrapper heuristic below, and reported the wrong token. A check that
 * reads the wrong text is worse than no check.
 *
 * `type="range"` is a viz slider: it draws its own track and has no boundary to
 * contrast. A control may also delegate its boundary to a wrapper, which the
 * landing field and the search overlay both do — but only by saying
 * `bg-transparent`, so the delegation is written down rather than inferred from
 * the absence of a class.
 */
function tagAt(source: string, from: number): string {
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    const c = source[i];
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '>' && depth === 0) return source.slice(from, i + 1);
  }
  return source.slice(from);
}

function fields(source: string): { tag: string; border: string | null; delegated: boolean }[] {
  const out: { tag: string; border: string | null; delegated: boolean }[] = [];
  for (const match of source.matchAll(/<(input|textarea)\b/g)) {
    const tag = tagAt(source, match.index);
    if (/type=["']range["']/.test(tag)) continue;
    const name = match[1] as string;
    const own = /border-([a-z0-9-]+)\b/.exec(tag);
    if (own) {
      out.push({ tag: name, border: own[1] as string, delegated: false });
      continue;
    }
    // No boundary of its own. That is only legitimate when it has no fill of
    // its own either; otherwise the field is unaccounted for and the test says
    // so instead of guessing.
    if (!/bg-transparent/.test(tag)) {
      out.push({ tag: name, border: null, delegated: false });
      continue;
    }
    const wrappers = [...source.slice(0, match.index).matchAll(/border border-([a-z0-9-]+)\b/g)];
    const nearest = wrappers[wrappers.length - 1];
    out.push({ tag: name, border: nearest ? (nearest[1] as string) : null, delegated: true });
  }
  return out;
}

describe('a text field is visible before it is focused', () => {
  it('rules out the tokens that cannot carry a boundary, and admits the one that can', () => {
    // Not a snapshot of three numbers: it is why `line` was wrong and `thread`
    // is right, recomputed from the handoff every run.
    expect(carries('line')).toBe(false);
    expect(carries('thread')).toBe(true);
    expect(contrast(palette.line as string, palette.void as string)).toBeLessThan(1.5);
  });

  it('finds every text field, so a green run is not an empty search', () => {
    const found = SOURCES.flatMap((f) => fields(read(f)));
    expect(found.length).toBe(5);
    expect(found.every((f) => f.border !== null)).toBe(true);
  });

  it.each(SOURCES)('%s gives its text fields a boundary at 3:1', (file) => {
    for (const field of fields(read(file))) {
      expect(carries(field.border as string), `<${field.tag}> in ${file} bounded by "${field.border}"`).toBe(true);
    }
  });
});
