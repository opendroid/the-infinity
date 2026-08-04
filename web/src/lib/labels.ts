import type { EdgeType } from './graph';

/**
 * What an edge link says beyond its title.
 *
 * An edge row renders a title and a coloured dot. Both of the things that make
 * it an *edge* — which relationship it is, and whether the target has been
 * reviewed — were carried by position and colour alone, so the accessible name
 * was the bare title (#147):
 *
 *   [link] "Cross-Attention"
 *
 * Read top to bottom the group heading supplies the relationship. Navigated by
 * links list — the rotor, the elements list, which is how people move around a
 * page rather than reading it straight through — all three groups flatten into
 * one set of titles. The typed edge is what makes this a graph rather than a
 * page of links, and it was the part that did not survive.
 *
 * Composed here rather than written into each component so the spoken form
 * comes from the same values the visual one does. A hand-written `aria-label`
 * would be a second description of the edge, free to disagree with the first.
 */
const RELATIONSHIP: Record<EdgeType, string> = {
  requires: 'requires',
  unlocks: 'unlocks',
  adjacent: 'adjacent to',
};

/**
 * The suffix an edge link appends, visually hidden.
 *
 * Title first, because that is what a reader is scanning for and what an
 * alphabetical rotor sorts on. The relationship and the tier follow, in the
 * order the eye reads them.
 */
export function edgeAside(type: EdgeType, tier: string): string {
  return `${RELATIONSHIP[type]}, ${tier}`;
}

/** The word for a relationship on its own — the group heading uses it too. */
export function relationship(type: EdgeType): string {
  return RELATIONSHIP[type];
}
