import { describe, expect, it } from 'vitest';
import { notationError, parseNotation, plain, type Token } from './notation';
import { allNodes } from './content';
import { splitEmphasis } from './graph';

/** A compact rendering of the token tree, so cases read as what you'd see. */
function show(tokens: Token[]): string {
  return tokens
    .map((t) => (t.kind === 'text' ? t.text : `<${t.kind}>${show(t.children)}</${t.kind}>`))
    .join('');
}
const parse = (s: string) => show(parseNotation(s));

describe('the grammar', () => {
  const cases: Array<[name: string, source: string, want: string]> = [
    ['a bare subscript takes the following run', 'x_t', 'x<sub>t</sub>'],
    ['a run, not one character — d_model is d sub model', 'd_model', 'd<sub>model</sub>'],
    ['S_ij is one subscript, not i then a stray j', 'S_ij', 'S<sub>ij</sub>'],
    ['a braced group', 'm_{t−1}', 'm<sub>t−1</sub>'],
    ['a group can hold anything, including <', 'x_{<t}', 'x<sub>&lt;t</sub>'.replace('&lt;', '<')],
    ['a bare superscript', 'g^0', 'g<sup>0</sup>'],
    ['a braced superscript', '2^{−8h/H}', '2<sup>−8h/H</sup>'],
    ['a Unicode letter after a marker', 'x^α', 'x<sup>α</sup>'],
    ['groups nest: a subscript inside a superscript', 'ℝ^{|V|×d_model}', 'ℝ<sup>|V|×d<sub>model</sub></sup>'],
    ['the run stops at punctuation', 'd_model/h', 'd<sub>model</sub>/h'],
    ['text either side is preserved', 'and x_t then', 'and x<sub>t</sub> then'],
    ['two in a row', 'a_i b_j', 'a<sub>i</sub> b<sub>j</sub>'],
    // A run is letters and DECIMAL digits. `²` is already a raised glyph, so
    // it ends the subscript rather than joining it: adam's `g_t²` is g sub t,
    // squared — not g sub "t²".
    ['an existing superscript glyph ends the run', 'g_t²', 'g<sub>t</sub>²'],
    ['and an existing subscript glyph does too', 'x_t₁', 'x<sub>t</sub>₁'],
    // A Greek letter is a letter and DOES continue the run — the rule is about
    // already-raised glyphs, not about being non-ASCII.
    ['a Greek letter continues the run', 'x_iβ', 'x<sub>iβ</sub>'],
  ];
  for (const [name, source, want] of cases) {
    it(name, () => expect(parse(source)).toBe(want));
  }
});

describe('what must NOT be treated as notation', () => {
  it('leaves a brace that does not follow a marker alone', () => {
    // conditional-computation: "With gate g(x) ∈ {0,1} and branch f". Set
    // notation, and the one standalone brace in the whole corpus.
    expect(parse('g(x) ∈ {0,1} and')).toBe('g(x) ∈ {0,1} and');
  });

  it('renders an escaped marker as the character', () => {
    expect(parse('top\\_k')).toBe('top_k');
    expect(parse('2\\^8')).toBe('2^8');
    expect(parse('\\{literal\\}')).toBe('{literal}');
    expect(parse('a\\\\b')).toBe('a\\b');
  });

  it('keeps a backslash that is not escaping one of ours', () => {
    // Bodies are prose; a lone backslash must not eat the next letter.
    expect(parse('a \\n b')).toBe('a \\n b');
  });
});

describe('malformed input degrades, it does not throw', () => {
  // The parser's job is to never fail a reader. notationError is what fails
  // the author, in CI.
  const bad = ['x_', 'x_{unclosed', '^', 'a ^ b', 'x_ t', '}{', 'x^{a{b}'];

  for (const source of bad) {
    it(`survives ${JSON.stringify(source)}`, () => {
      expect(() => parseNotation(source)).not.toThrow();
      // Nothing is dropped: what cannot be parsed is shown as typed, which is
      // exactly what the page did before this existed.
      expect(plain(source)).toBe(source.replace(/\\(.)/g, '$1'));
    });
  }
});

describe('notationError fails the author where the parser would not', () => {
  it('accepts everything the grammar allows', () => {
    for (const ok of ['x_t', 'm_{t−1}', 'ℝ^{|V|×d_model}', 'g(x) ∈ {0,1}', 'top\\_k', 'no notation at all']) {
      expect(notationError(ok)).toBeNull();
    }
  });

  it('names an unclosed group', () => {
    expect(notationError('x_{t−1')).toMatch(/unclosed/);
  });

  it('names a marker with nothing to raise', () => {
    expect(notationError('x_ t')).toMatch(/nothing to raise or lower/);
    expect(notationError('trailing^')).toMatch(/nothing to raise or lower/);
  });

  it('suggests the escape, because that is the fix', () => {
    expect(notationError('a _ b')).toContain('\\_');
  });
});

describe('plain() is the text without the markup', () => {
  it('strips markers and keeps the characters', () => {
    expect(plain('x_t and ℝ^{n×d_k}')).toBe('x_t and ℝ^{n×d_k}'.replace(/[_^{}]/g, ''));
  });
});

describe('every authored body', () => {
  const bodies = allNodes.flatMap((n) =>
    (['intuition', 'engineer', 'math'] as const).map((d) => ({ id: n.id, depth: d, text: n.bodies[d] })),
  );

  it('is valid notation', () => {
    const bad = bodies.filter((b) => notationError(b.text) !== null);
    expect(bad.map((b) => `${b.id}/${b.depth}: ${notationError(b.text)}`)).toEqual([]);
  });

  it('loses no characters other than the markers', () => {
    // The guard against a parser that silently eats content. Braces are
    // stripped from both sides rather than predicted: which ones are notation
    // and which are set braces is precisely what the parser decides, so an
    // expectation that reproduced that judgement would be the parser again,
    // agreeing with itself.
    for (const b of bodies) {
      expect(plain(b.text).replace(/[{}]/g, '')).toBe(b.text.replace(/[_^{}]/g, ''));
    }
  });

  it('has no emphasis phrase that cuts a notation group in half', () => {
    // Emphasis is sliced out of the body BEFORE parsing, so a phrase whose
    // boundary falls inside `_{…}` leaves both halves literal — the exact
    // "renders as typed" defect this change exists to remove, reappearing on
    // one phrase in one node where nobody would look for it.
    const broken: string[] = [];
    for (const node of allNodes) {
      for (const depth of ['intuition', 'engineer', 'math'] as const) {
        const phrase = node.emphasis?.[depth];
        if (!phrase) continue;
        const [before, mid, after] = splitEmphasis(node.bodies[depth], phrase);
        for (const [name, segment] of [['before', before], ['emphasis', mid], ['after', after]] as const) {
          const err = notationError(segment);
          if (err) broken.push(`${node.id}/${depth} ${name}: ${err}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('actually produces subscripts where the corpus has them', () => {
    // A test that would pass on a parser that did nothing would be worthless.
    const adam = allNodes.find((n) => n.id === 'adam');
    expect(adam).toBeDefined();
    expect(parse(adam!.bodies.math)).toContain('<sub>t−1</sub>');
  });
});
