/**
 * Concept references written inline in body copy (#298).
 *
 * Authors name a sibling concept in backticks — `constrained-decoding` — as an
 * explicit pointer at another node. Before this, those backticks reached the
 * reader as characters: no `<code>`, no styling, no link, just two grave
 * accents that read as a typo.
 *
 * WHY THIS IS NARROWER THAN AUTO-LINKING PROSE. A body mentions neighbouring
 * concepts constantly, and turning every mention into a link is the wiki
 * failure mode — over-linked paragraphs and links to the wrong sense of a word.
 * A backtick is different: the author typed the node's ID, not a phrase that
 * might mean it, so there is nothing to disambiguate. 45 of the corpus's 46
 * backticked spans resolve to a node; the one that does not is a JSON snippet
 * in `schema-conformance` and must stay text.
 *
 * That last case is why `resolve` returns null rather than this module holding
 * a list: the content decides, and the page has the graph.
 */

/**
 * A plain string is ordinary body copy; an object is a resolved reference.
 *
 * The compact shape rather than a tagged union — `{kind:'text',text:'…'}` —
 * because the concept page serialises three bodies into an island and a string
 * needs no discriminant. It is a small win: measured against the same corpus
 * with and without this change, the whole feature costs 79 gzipped bytes of
 * HTML and 81 of JavaScript on `/c/*`.
 *
 * That number is here because the first version of this comment claimed 35%,
 * having compared two `perf` runs taken 16 nodes apart and credited the corpus
 * growth to the change. The budget records a route, not a diff; isolating a
 * change means building both ways.
 */
export type Segment = string | { id: string; label: string };

/**
 * Splits body copy on backticked spans.
 *
 * An unresolved span keeps its text and loses its backticks, so a JSON snippet
 * reads as it was written and a typo in an id degrades to plain words rather
 * than to a broken link. Backticks never reach the reader either way.
 *
 * An unterminated backtick is left alone, backtick and all: it is a typo in the
 * source and silently eating the rest of the paragraph would hide it.
 */
export function segments(text: string, resolve: (id: string) => string | null): Segment[] {
  const out: Segment[] = [];
  let i = 0;

  const pushText = (s: string) => {
    if (!s) return;
    const last = out[out.length - 1];
    if (typeof last === 'string') out[out.length - 1] = last + s;
    else out.push(s);
  };

  while (i < text.length) {
    const open = text.indexOf('`', i);
    if (open === -1) {
      pushText(text.slice(i));
      break;
    }
    const close = text.indexOf('`', open + 1);
    if (close === -1) {
      pushText(text.slice(i));
      break;
    }
    pushText(text.slice(i, open));
    const inner = text.slice(open + 1, close);
    const label = resolve(inner);
    if (label === null) pushText(inner);
    else out.push({ id: inner, label });
    i = close + 1;
  }

  return out;
}

/** The same text with backticks removed and nothing linked — for meta descriptions. */
export function withoutMarkers(text: string): string {
  return text.replace(/`([^`]*)`/g, '$1');
}
