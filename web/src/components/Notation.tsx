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
          in it. The trailing space closes the run so the next character does
          not join the subscript in turn.

          sr-only hides with clip rather than display:none, so this stays in
          the tree; and it sits in DOM order, which is the order the tree is
          read in, not the visual order it is absolutely positioned out of.
        */}
        <span className="sr-only">{token.kind === 'sub' ? ' sub ' : ' super '}</span>
        <Tag>{render(token.children)}</Tag>
        <span className="sr-only"> </span>
      </Fragment>
    );
  });
}

export default function Notation({ text }: { text: string }) {
  return <>{render(parseNotation(text))}</>;
}
