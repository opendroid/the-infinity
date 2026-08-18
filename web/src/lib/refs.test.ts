import { describe, expect, it } from 'vitest';
import { segments, withoutMarkers, type Segment } from './refs';
import { allNodes } from './content';

const KNOWN = new Set(['constrained-decoding', 'sharpness']);
const resolve = (id: string) => (KNOWN.has(id) ? id.replace(/-/g, ' ') : null);
const kinds = (s: Segment[]) => s.map((x) => (typeof x === 'string' ? x : `ref:${x.id}`));

describe('splitting body copy on backticked spans', () => {
  it('leaves text with no backticks alone', () => {
    expect(kinds(segments('a plain sentence', resolve))).toEqual(['a plain sentence']);
  });

  it('turns a resolving span into a reference carrying its title', () => {
    const s = segments('see `sharpness` for more', resolve);
    expect(kinds(s)).toEqual(['see ', 'ref:sharpness', ' for more']);
    expect(s[1]).toMatchObject({ id: 'sharpness', label: 'sharpness' });
  });

  it('keeps a non-resolving span as text, without its backticks', () => {
    // `schema-conformance` carries a JSON snippet in backticks. It is not a
    // concept and must not become a link, and the backticks must still go.
    expect(kinds(segments('a `"severity": "low"` field', resolve))).toEqual([
      'a "severity": "low" field',
    ]);
  });

  it('handles several spans in one body', () => {
    expect(kinds(segments('`sharpness` then `constrained-decoding`', resolve))).toEqual([
      'ref:sharpness',
      ' then ',
      'ref:constrained-decoding',
    ]);
  });

  it('leaves an unterminated backtick alone, backtick and all', () => {
    // A typo in the source. Eating the rest of the paragraph would hide it.
    expect(kinds(segments('an `unclosed span', resolve))).toEqual(['an `unclosed span']);
  });

  it('does not emit empty text segments around an opening reference', () => {
    expect(segments('`sharpness` leads', resolve)[0]).toMatchObject({ id: 'sharpness' });
  });
});

describe('against the real corpus, which is the specification', () => {
  const ids = new Map(allNodes.map((n) => [n.id, n.title]));
  const real = (id: string) => ids.get(id) ?? null;

  it('resolves every backticked span except the one that is not a concept', () => {
    const unresolved: string[] = [];
    for (const node of allNodes) {
      for (const body of Object.values(node.bodies)) {
        for (const m of body.matchAll(/`([^`]+)`/g)) {
          if (!ids.has(m[1]!)) unresolved.push(`${node.id}: ${m[1]}`);
        }
      }
    }
    // Exactly one, and it is a JSON snippet rather than a broken reference.
    expect(unresolved).toEqual(['schema-conformance: "severity": "low" | "high"']);
  });

  it('leaves no backtick anywhere in what a reader sees', () => {
    for (const node of allNodes) {
      for (const body of Object.values(node.bodies)) {
        const rendered = segments(body, real)
          .map((s) => (typeof s === 'string' ? s : s.label))
          .join('');
        expect(rendered).not.toContain('`');
      }
    }
  });
});

describe('withoutMarkers', () => {
  it('strips backticks for places that take plain text, like a meta description', () => {
    expect(withoutMarkers('see `sharpness` now')).toBe('see sharpness now');
  });
});
