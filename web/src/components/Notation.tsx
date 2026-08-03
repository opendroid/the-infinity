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
    return <Tag key={i}>{render(token.children)}</Tag>;
  });
}

export default function Notation({ text }: { text: string }) {
  return <>{render(parseNotation(text))}</>;
}
