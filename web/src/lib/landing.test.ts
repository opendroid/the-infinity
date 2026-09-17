import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEPTHS, hrefFor } from './depth';

/**
 * THE DEPTH CHOICE AT THE FRONT DOOR, asserted against the source (#508).
 *
 * `DepthToggle` is mounted on `/c/[id]` and nowhere else, so until this landed
 * a reader arriving as a mathematician met a paragraph written for a stranger
 * with no sign that a Math body existed underneath — while the lede overhead
 * claimed "connected at three depths".
 *
 * Two invariants, and the second is the one with teeth. A text scan rather than
 * a rendered-page harness on purpose: the repository has no page-test setup,
 * and the two things worth pinning are both visible in the template.
 */
const landing = readFileSync(join(process.cwd(), 'src', 'pages', 'index.astro'), 'utf8');

describe('the landing page offers a depth before the first concept', () => {
  it('links into every depth', () => {
    expect(landing).toContain('DEPTHS.map');
    for (const depth of DEPTHS) {
      expect(landing).toContain(`${depth}:`);
    }
  });

  it('builds those links with hrefFor rather than writing the parameter itself', () => {
    // One rule between the landing link and the address bar after a toggle, or
    // they drift: `hrefFor` leaves Intuition unmarked because `searchFor` does,
    // and a hand-written `?depth=intuition` here would be a second spelling of
    // a page the toggle writes as `/c/attention`.
    expect(landing).toContain('hrefFor(sample.id, depth)');
    expect(landing).not.toMatch(/\?depth=/);
    expect(hrefFor('attention', 'intuition')).toBe('/c/attention');
  });

  it('adds no island, which is the whole constraint (#508, ADR-0023)', () => {
    // `/` is budgeted at js_gzip: 0 and `npm run perf` enforces it in CI — but
    // that needs a build, and this fails in milliseconds. ADR-0023 already
    // declined an island here once on a measurement: the React floor is 57 KB
    // gzipped, so the cheapest possible island on this page costs 60 KB. A
    // depth control that needed one would be that same decision wearing a
    // different feature, and it does not get to arrive quietly.
    expect(landing).not.toMatch(/client:(load|idle|visible|only|media)/);
  });
});
