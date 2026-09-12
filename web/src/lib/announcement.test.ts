// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { announcement } from '../components/SearchPanel';

/**
 * #453. Every substantive query announced itself — "12 results for attention",
 * even "0 results for zzzz" — while the empty state announced the empty string.
 * A reader who cleared twelve results heard nothing, and silence is how a page
 * that has stopped responding sounds too.
 */
describe('what the search live region says', () => {
  it('counts results, singular and plural', () => {
    expect(announcement('ready', 'attention', 12)).toBe('12 results for attention');
    expect(announcement('ready', 'flow matching', 1)).toBe('1 result for flow matching');
  });

  it('still announces a zero-result query', () => {
    // This already worked, and is the reason the silence stood out.
    expect(announcement('ready', 'zzzz', 0)).toBe('0 results for zzzz');
  });

  it('says the box is empty rather than saying nothing', () => {
    for (const q of ['', '   ']) {
      const said = announcement('ready', q, 0);
      expect(said).not.toBe('');
      expect(said).toMatch(/cleared/i);
    }
  });

  it('says so when the index could not be loaded', () => {
    expect(announcement('failed', 'attention', 0)).toMatch(/could not be loaded/i);
  });

  it('never returns an empty string for any state', () => {
    // The defect in one line: an empty region is an unannounced change.
    for (const state of ['idle', 'loading', 'ready', 'failed'] as const) {
      for (const q of ['', '  ', 'attention']) {
        expect(announcement(state, q, 3)).not.toBe('');
      }
    }
  });
});
