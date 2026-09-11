import { describe, expect, it } from 'vitest';
import { components, glowing, isInvisible, paints } from '../../scripts/box-shadow.mjs';

/**
 * The regression this file exists for is #419: I measured the landing page with
 * `!/rgba\(0, 0, 0, 0\)/.test(boxShadow)` and filed a bug against working code,
 * because Tailwind v4's composed value always OPENS with transparent
 * placeholders. The first case below is that exact string.
 */

/** What Chromium reports for the landing search field. One real glow, four placeholders. */
const LANDING =
  'rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, ' +
  'rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, ' +
  'rgba(143, 123, 255, 0.16) 0px 0px 44px 0px';

/** What every other element on the page reports: the same shape, nothing set. */
const EMPTY = Array(5).fill('rgba(0, 0, 0, 0) 0px 0px 0px 0px').join(', ');

describe('components', () => {
  it('does not split inside a colour function', () => {
    expect(components(LANDING)).toHaveLength(5);
  });

  const cases: Array<[string, string, number]> = [
    ['empty', '', 0],
    ['one shadow', 'rgba(1, 2, 3, 0.5) 0px 0px 4px 0px', 1],
    ['trailing comma', 'rgb(1, 2, 3) 0 0 4px,', 1],
  ];
  it.each(cases)('%s', (_name, value, count) => {
    expect(components(value)).toHaveLength(count);
  });
});

describe('isInvisible', () => {
  const cases: Array<[string, string, boolean]> = [
    ['the transparent placeholder', 'rgba(0, 0, 0, 0) 0px 0px 0px 0px', true],
    ['the keyword', 'transparent 0px 0px 8px', true],
    ['alpha zero in slash syntax', 'rgb(143 123 255 / 0) 0px 0px 8px', true],
    ['coloured but zero-sized', 'rgb(143, 123, 255) 0px 0px 0px 0px', true],
    ['the real glow', 'rgba(143, 123, 255, 0.16) 0px 0px 44px 0px', false],
    ['a low but non-zero alpha', 'rgba(143, 123, 255, 0.01) 0px 0px 44px 0px', false],
    ['an offset with no blur', 'rgb(0, 0, 0) 0px 2px 0px 0px', false],
  ];
  it.each(cases)('%s', (_name, part, invisible) => {
    expect(isInvisible(part)).toBe(invisible);
  });
});

describe('paints', () => {
  const cases: Array<[string, unknown, boolean]> = [
    ['the landing glow, behind four placeholders', LANDING, true],
    ['nothing set, same shape', EMPTY, false],
    ['none', 'none', false],
    ['blank', '   ', false],
    ['not a string', undefined, false],
  ];
  it.each(cases)('%s', (_name, value, expected) => {
    expect(paints(value as string)).toBe(expected);
  });

  it('is not fooled by a placeholder appearing first', () => {
    // The #419 mistake, stated as an assertion: a substring test for the
    // placeholder answers "no shadow" here, and it is wrong.
    expect(LANDING).toContain('rgba(0, 0, 0, 0)');
    expect(paints(LANDING)).toBe(true);
  });
});

describe('glowing', () => {
  it('names only the elements that paint', () => {
    expect(
      glowing([
        ['form.search', LANDING],
        ['div.panel', EMPTY],
        ['a.chip', 'none'],
      ]),
    ).toEqual(['form.search']);
  });

  it('is empty when nothing glows', () => {
    expect(glowing([['div.panel', EMPTY]])).toEqual([]);
  });
});
