import { describe, expect, it } from 'vitest';
import { DEFAULT, DEPTHS, fromSearch, hrefFor, parseDepth, resolve, searchFor } from './depth';

/**
 * The precedence, tested without a DOM (#42).
 *
 * This is the half of the depth toggle that was missing rather than broken:
 * the component had arrow keys and tablist semantics and no state at all, so
 * these are the first assertions that `?depth=` means anything.
 */

describe('parsing a depth', () => {
  it('takes the three that exist', () => {
    expect(parseDepth('intuition')).toBe('intuition');
    expect(parseDepth('engineer')).toBe('engineer');
    expect(parseDepth('math')).toBe('math');
  });

  it('refuses anything else rather than throwing, because both sources are reader-controlled', () => {
    // A hand-typed URL and a localStorage entry editable in devtools.
    for (const junk of ['banana', 'Math', 'INTUITION', '', ' math', '0', null, undefined]) {
      expect(parseDepth(junk)).toBeNull();
    }
  });
});

describe('precedence: URL, then storage, then default', () => {
  it('uses the URL when it is the only source', () => {
    expect(resolve('math', null)).toBe('math');
  });

  it('uses storage when the URL says nothing', () => {
    expect(resolve(null, 'engineer')).toBe('engineer');
  });

  it('falls back to the default when neither says anything', () => {
    expect(resolve(null, null)).toBe(DEFAULT);
    expect(resolve(null, null)).toBe('intuition');
  });

  it('LETS THE URL WIN, which is the case the issue is about', () => {
    // A shared link is an explicit instruction; storage is a standing
    // preference. If storage won, the same link would show different people
    // different things, and linking a depth would stop meaning anything.
    expect(resolve('math', 'engineer')).toBe('math');
    expect(resolve('intuition', 'math')).toBe('intuition');
  });

  it('falls through a junk URL to storage rather than to the default', () => {
    // A mangled link should still honour what the reader already chose.
    expect(resolve('banana', 'engineer')).toBe('engineer');
  });

  it('falls through junk storage to the default', () => {
    expect(resolve(null, 'banana')).toBe(DEFAULT);
  });

  it('survives both being junk', () => {
    expect(resolve('banana', 'kiwi')).toBe(DEFAULT);
  });
});

describe('reading the parameter out of a URL', () => {
  it('finds it wherever it sits in the query', () => {
    expect(fromSearch('?depth=math')).toBe('math');
    expect(fromSearch('?from=search&depth=engineer')).toBe('engineer');
  });

  it('is null when absent, which is what makes the fallthrough work', () => {
    expect(fromSearch('')).toBeNull();
    expect(fromSearch('?from=search')).toBeNull();
  });
});

describe('writing the parameter back', () => {
  it('names a deliberate depth', () => {
    expect(searchFor('', 'math')).toBe('?depth=math');
    expect(searchFor('', 'engineer')).toBe('?depth=engineer');
  });

  it('REMOVES the parameter for the default rather than writing it', () => {
    // An ordinary read should produce an ordinary URL. Only a deliberate depth
    // leaves a mark.
    expect(searchFor('', 'intuition')).toBe('');
    expect(searchFor('?depth=math', 'intuition')).toBe('');
  });

  it('replaces rather than appends, so toggling does not accumulate parameters', () => {
    expect(searchFor('?depth=math', 'engineer')).toBe('?depth=engineer');
  });

  it('leaves every other parameter alone', () => {
    expect(searchFor('?from=search', 'math')).toBe('?from=search&depth=math');
    // And switching back to the default keeps the others.
    expect(searchFor('?from=search&depth=math', 'intuition')).toBe('?from=search');
  });
});

describe('hrefFor builds the link that opens a concept at a depth (#508)', () => {
  it('leaves the default unmarked, exactly as the address bar does', () => {
    // THE PLANT. Build this by concatenation and it becomes
    // `/c/attention?depth=intuition` — a second spelling of a page the toggle
    // itself writes as `/c/attention` the moment a reader switches back.
    expect(hrefFor('attention', 'intuition')).toBe('/c/attention');
    expect(hrefFor('attention', 'intuition')).toBe(`/c/attention${searchFor('', 'intuition')}`);
  });

  it('marks a deliberate depth', () => {
    expect(hrefFor('attention', 'engineer')).toBe('/c/attention?depth=engineer');
    expect(hrefFor('kv-cache', 'math')).toBe('/c/kv-cache?depth=math');
  });

  it('agrees with what a toggle would leave in the address bar', () => {
    // The two surfaces have one rule between them, which is the point of
    // routing this through searchFor rather than writing the string twice.
    for (const d of DEPTHS) {
      expect(hrefFor('attention', d)).toBe(`/c/attention${searchFor('', d)}`);
    }
  });

  it('round-trips through the parser that reads it back', () => {
    for (const d of DEPTHS) {
      const href = hrefFor('attention', d);
      expect(resolve(fromSearch(href.slice(href.indexOf('?'))), null)).toBe(d);
    }
  });
});
