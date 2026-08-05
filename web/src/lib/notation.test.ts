import { describe, expect, it } from 'vitest';
import { notationError, parseNotation, plain, spoken, type Token } from './notation';
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

/**
 * ADR-0010. `plain` above answers "what is on screen"; this answers "what does
 * a reader hear", and they are different strings. Asserting the first told us
 * nothing about the second, which is how 43 nodes shipped speaking their
 * identifiers as run-together nonwords (#144).
 */
describe('what a screen reader receives', () => {
  it('separates a subscript from what it hangs off', () => {
    // The defect verbatim: this was "dmodel".
    expect(spoken('d_model')).toBe(`d\u00A0sub\u00A0model\u00A0`);
    expect(spoken('W_Q')).toBe(`W\u00A0sub\u00A0Q\u00A0`);
  });

  it('distinguishes a superscript from a subscript', () => {
    // A bare space would make these identical, which is the reason for words.
    expect(spoken('x_2')).toBe(`x\u00A0sub\u00A02\u00A0`);
    expect(spoken('x^2')).toBe(`x\u00A0super\u00A02\u00A0`);
  });

  it('does not let the following text join the subscript', () => {
    expect(spoken('d_model/h')).toBe(`d\u00A0sub\u00A0model\u00A0/h`);
    expect(spoken('head_i = Attention')).toBe(`head\u00A0sub\u00A0i\u00A0= Attention`);
  });

  it('speaks a braced group as one run', () => {
    expect(spoken('x_{<t}')).toBe(`x\u00A0sub\u00A0<t\u00A0`);
    expect(spoken('2^{\u22128h/H}')).toBe(`2\u00A0super\u00A0\u22128h/H\u00A0`);
  });

  it('speaks nesting from the inside out', () => {
    expect(spoken('\u211d^{n\u00d7d_k}')).toBe(`\u211d\u00A0super\u00A0n\u00d7d\u00A0sub\u00A0k\u00A0`);
  });

  it('leaves prose with no notation exactly as it was', () => {
    const prose = 'Attention is that decision made numerically.';
    expect(spoken(prose)).toBe(prose);
  });

  it('is not the same string as the visual flattening', () => {
    // If these ever agree, the separator has been lost and #144 is back.
    expect(spoken('d_model')).not.toBe(plain('d_model'));
    expect(plain('d_model')).toBe('dmodel');
  });
});

/**
 * The corpus, not a fixture someone chose. #144 measured 181 groups across 43
 * of 57 nodes; this is the check that none of them is still run-together, and
 * it grows with the graph rather than needing to be remembered.
 */
describe('every node speaks its notation', () => {
  const withNotation = allNodes.filter((n) =>
    (['intuition', 'engineer', 'math'] as const).some(
      (d) => parseNotation(n.bodies[d]).some((t) => t.kind !== 'text'),
    ),
  );

  it('covers the corpus #144 measured', () => {
    expect(withNotation.length).toBeGreaterThanOrEqual(40);
  });

  it('leaves no subscript touching what precedes it', () => {
    for (const node of withNotation) {
      for (const depth of ['intuition', 'engineer', 'math'] as const) {
        const body = node.bodies[depth];
        if (!parseNotation(body).some((t) => t.kind !== 'text')) continue;
        const heard = spoken(body);
        // The marker is the separator; its absence is the defect. It has to be
        // the NO-BREAK space: an ordinary one is stripped out of an absolutely
        // positioned box before anybody hears it, which is what shipped once.
        expect(heard, `${node.id}/${depth}`).toMatch(/\u00A0(sub|super)\u00A0/);
        expect(heard, `${node.id}/${depth}`).not.toBe(plain(body));
      }
    }
  });

  /**
   * THE TEST THAT WAS MISSING. Everything above passed while VoiceOver read
   * "headsub1", because every assertion was about the DOM and the defect was
   * in CSS: `sr-only` is absolutely positioned, and a block container has its
   * leading and trailing collapsible whitespace stripped before the
   * accessibility tree ever sees it.
   *
   * No DOM assertion can observe that — jsdom has no layout and would report
   * the spaces present, which is exactly what happened. What IS assertable is
   * the property that makes the string survive: the separator must be a
   * character CSS cannot collapse. That is checkable here, and it is the thing
   * a future tidy-up would break.
   */
  it('separates with a character CSS cannot strip', () => {
    for (const source of ['d_model', 'x^2', '\u211d^{n\u00d7d_k}', 'head_i']) {
      const heard = spoken(source);
      expect(heard, source).toContain('\u00A0');
      // An ordinary space beside the marker word means someone replaced the
      // no-break one. On screen the two are identical; in the tree they are
      // not, and only one of them is heard.
      expect(heard, source).not.toMatch(/\u0020(sub|super)|(sub|super)\u0020/);
    }
  });

  it('speaks the values that actually occur', () => {
    // The alphabet from #144 — the raised and lowered runs the corpus really
    // uses, most common first. Each must come back with its marker attached.
    for (const [source, heard] of [
      ['d_model', `d\u00A0sub\u00A0model\u00A0`],
      ['x_i', `x\u00A0sub\u00A0i\u00A0`],
      ['x_t', `x\u00A0sub\u00A0t\u00A0`],
      ['W_K', `W\u00A0sub\u00A0K\u00A0`],
      ['W_V', `W\u00A0sub\u00A0V\u00A0`],
      ['W_Q', `W\u00A0sub\u00A0Q\u00A0`],
      ['S_ij', `S\u00A0sub\u00A0ij\u00A0`],
      ['d_ff', `d\u00A0sub\u00A0ff\u00A0`],
      ['x_{t+1}', `x\u00A0sub\u00A0t+1\u00A0`],
      ['x_{<t}', `x\u00A0sub\u00A0<t\u00A0`],
      ['d_head', `d\u00A0sub\u00A0head\u00A0`],
      ['X^i', `X\u00A0super\u00A0i\u00A0`],
      ['θ_max', `θ\u00A0sub\u00A0max\u00A0`],
    ] as const) {
      expect(spoken(source), source).toBe(heard);
    }
  });
});
