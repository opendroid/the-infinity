/**
 * Notation in body copy: `_` for subscript, `^` for superscript.
 *
 * `bodies.math` was rendered into a `<p>` as a plain string, so
 * `p(x) = Π_t p(x_t | x_{<t})` arrived as the characters that were typed
 * (#112). Worse than unstyled: in `adam`, `β₁` rendered correctly and
 * `m_{t−1}` did not, three characters apart.
 *
 * This formalises the convention 40 of 57 nodes had already converged on
 * without anyone writing it down. See ADR-0009 for why this rather than KaTeX
 * (a 57-node migration and a stylesheet, to typeset material that is entirely
 * inline sub- and superscripts) or Unicode normalisation (no subscript `<`, no
 * superscript `×`, both of which the corpus needs).
 *
 * THE WHOLE GRAMMAR:
 *
 *   _x   _{…}       subscript      x_t, m_{t−1}, x_{<t}
 *   ^x   ^{…}       superscript    ^0, ℝ^{n×d_k}, 2^{−8h/H}
 *   \_ \^ \{ \} \\  the literal character
 *
 * Everything else is text, including a `{` that does not follow a marker —
 * `g(x) ∈ {0,1}` is set notation in `conditional-computation` and must survive.
 */

export type Token =
  | { kind: 'text'; text: string }
  | { kind: 'sub'; children: Token[] }
  | { kind: 'sup'; children: Token[] };

/**
 * A marker takes a RUN of letters and decimal digits, not a single character as
 * in LaTeX. The content decides this: `d_model` means *d* subscript *model*,
 * and `S_ij` is one subscript rather than `S` sub-*i* followed by a stray *j*.
 * Unicode-aware because `^α` is in the corpus.
 *
 * `\p{Nd}` and NOT `\p{N}`: the latter includes ² and ₁, which are already
 * raised and lowered glyphs. With `\p{N}`, `g_t²` in `adam` rendered as *g*
 * subscript *t²* — the squared swallowed into the subscript. Found by reading
 * the built HTML, not by a test.
 */
const RUN = /[\p{L}\p{Nd}]/u;

/**
 * Finds the `}` matching an opening `{` at `open`, or -1.
 *
 * Counts depth rather than searching for the next `}`, because groups nest:
 * `ℝ^{|V|×d_model}` is a superscript containing a subscript.
 */
function matchBrace(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '\\') {
      i++;
      continue;
    }
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Parses body copy into text, subscript, and superscript.
 *
 * NEVER THROWS AND NEVER DROPS INPUT. A dangling `_` or an unclosed `{` is
 * emitted as the literal character it is, so a typo degrades to what the page
 * showed before this existed rather than to a blank paragraph. `validate:content`
 * is where that fails; a reader's page is not.
 */
export function parseNotation(source: string): Token[] {
  const tokens: Token[] = [];
  let text = '';

  const flush = () => {
    if (text !== '') {
      tokens.push({ kind: 'text', text });
      text = '';
    }
  };

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;

    if (ch === '\\') {
      const next = source[i + 1];
      // An escape before one of ours is that character, literally. Before
      // anything else the backslash is itself — bodies are prose, and a lone
      // backslash should not silently eat the letter after it.
      if (next === '_' || next === '^' || next === '{' || next === '}' || next === '\\') {
        text += next;
        i++;
      } else {
        text += ch;
      }
      continue;
    }

    if (ch !== '_' && ch !== '^') {
      text += ch;
      continue;
    }

    const kind = ch === '_' ? 'sub' : 'sup';
    const next = source[i + 1];

    if (next === '{') {
      const close = matchBrace(source, i + 1);
      if (close === -1) {
        text += ch;
        continue;
      }
      flush();
      tokens.push({ kind, children: parseNotation(source.slice(i + 2, close)) });
      i = close;
      continue;
    }

    if (next !== undefined && RUN.test(next)) {
      let end = i + 1;
      while (end < source.length && RUN.test(source[end]!)) end++;
      flush();
      tokens.push({ kind, children: [{ kind: 'text', text: source.slice(i + 1, end) }] });
      i = end - 1;
      continue;
    }

    // A marker with nothing to raise or lower. Literal.
    text += ch;
  }

  flush();
  return tokens;
}

/**
 * Reports why a string is not valid notation, or null if it is.
 *
 * Used by `validate:content` so a typo fails CI. Deliberately separate from the
 * parser: the parser's job is to never fail a reader, and this one's job is to
 * fail an author.
 */
export function notationError(source: string): string | null {
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch !== '_' && ch !== '^') continue;

    const next = source[i + 1];
    if (next === '{') {
      const close = matchBrace(source, i + 1);
      if (close === -1) return `unclosed "${ch}{" at character ${i}`;
      i = close;
      continue;
    }
    if (next === undefined || !RUN.test(next)) {
      return `"${ch}" at character ${i} has nothing to raise or lower — write "\\${ch}" for a literal one`;
    }
    while (i + 1 < source.length && RUN.test(source[i + 1]!)) i++;
  }
  return null;
}

/** The text a reader would hear or copy, with the markup removed. */
/**
 * What a reader hears — the flattened string with the separators ADR-0010 adds.
 *
 * `plain` below is the visual flattening and answers "what characters are on
 * screen". This answers a different question: what does the accessibility tree
 * contain, once `Notation` has put its `sr-only` markers in. They are not the
 * same string and conflating them is how `d_model` came to be spoken as
 * "dmodel" (#144).
 *
 * Exported so the tests assert on the thing a person actually receives, rather
 * than on the markup that produces it. The markup was always right.
 */
export function spoken(source: string): string {
  const say = (tokens: Token[]): string =>
    tokens
      .map((t) => {
        if (t.kind === 'text') return t.text;
        return `${t.kind === 'sub' ? ' sub ' : ' super '}${say(t.children)} `;
      })
      .join('');
  // Collapsed because the markers butt against whitespace already in the prose:
  // `d_model / h` would otherwise be "d sub model  / h".
  return say(parseNotation(source)).replace(/ {2,}/g, ' ');
}

export function plain(source: string): string {
  const strip = (tokens: Token[]): string =>
    tokens.map((t) => (t.kind === 'text' ? t.text : strip(t.children))).join('');
  return strip(parseNotation(source));
}
