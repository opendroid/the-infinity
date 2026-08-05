import { Fragment } from 'react';
import { parseNotation, type Token } from '../lib/notation';

/**
 * Body copy with `_` and `^` rendered as real `<sub>` and `<sup>` (ADR-0009).
 *
 * `<sub>`/`<sup>` rather than styled spans: they are the elements that mean
 * this, they carry the meaning into the accessibility tree and into anything
 * that copies the text, and they need no CSS to be correct.
 *
 * No island. This renders at build time inside components that were already
 * hydrating; a reader with no JavaScript gets the same markup from Astro's
 * server render.
 */

function render(tokens: Token[]): React.ReactNode {
  return tokens.map((token, i) => {
    if (token.kind === 'text') return <Fragment key={i}>{token.text}</Fragment>;
    const Tag = token.kind === 'sub' ? 'sub' : 'sup';
    return (
      <Fragment key={i}>
        {/*
          ADR-0010. Without these the accessibility tree receives "dmodel" —
          `<sub>` reaches the tree, which is what ADR-0009 checked, but what
          arrives is the flattened string and the flattening has no separator
          in it. The trailing separator closes the run so the next character
          does not join the subscript in turn.

          sr-only hides with clip rather than display:none, so this stays in
          the tree; and it sits in DOM order, which is the order the tree is
          read in, not the visual order it is absolutely positioned out of.

          THE SEPARATORS ARE U+00A0, AND THAT IS THE WHOLE FIX. This first
          shipped with ordinary spaces and VoiceOver read "headsub1", "WsubO",
          "XWsubQsuperi" — the words arrived and the spaces did not. `sr-only`
          sets `position: absolute`, which makes each of these spans a block
          container, and CSS strips leading and trailing collapsible
          whitespace inside one. " sub " became "sub" and the lone trailing
          space collapsed to nothing at all, so the fix for a run-together
          nonword produced a longer run-together nonword.

          A no-break space is not collapsible whitespace, so it survives that
          processing and is still spoken as a word break. Do not "tidy" these
          back into ordinary spaces — the DOM looked correct both times, and
          only a real screen reader could tell the two apart.
        */}
        <span className="sr-only">{token.kind === 'sub' ? `${NBSP}sub${NBSP}` : `${NBSP}super${NBSP}`}</span>
        <Tag>{render(token.children)}</Tag>
        <span className="sr-only">{NBSP}</span>
      </Fragment>
    );
  });
}

/**
 * U+00A0. Written as an escape because the whole fix is which space this is,
 * and a literal one is indistinguishable on screen from the ordinary space
 * that failed.
 */
const NBSP = '\u00A0';

export default function Notation({ text }: { text: string }) {
  return <>{render(parseNotation(text))}</>;
}
