/**
 * Groups the graph by its authored `domain` path, for the concept index.
 *
 * The taxonomy is not invented here. `domain` is already a two-level path —
 * `["Attention", "Core"]` — authored per node and rendered as the eyebrow on
 * every concept page. A directory that grouped by anything else would be a
 * second organising scheme for the same graph, free to disagree with the one
 * readers already see.
 *
 * Sorted rather than left in whatever order the filesystem produced: the index
 * is a reference, and a reference whose order changes between builds is not one.
 */
import type { ResolvedNode, Tier } from './graph';

export interface Entry {
  id: string;
  title: string;
  tier: Tier;
  /** The 30-second opening, trimmed to a line the index can show. */
  blurb: string;
}

export interface Section {
  /** The second level of the domain path, e.g. "Core". */
  name: string;
  entries: Entry[];
}

export interface Group {
  /** The first level, e.g. "Attention". */
  name: string;
  sections: Section[];
  /** Concepts under this heading, across all its sections. */
  count: number;
}

/**
 * The first sentence of the intuition body, or a truncation if the first
 * sentence is long.
 *
 * Deliberately derived rather than authored: adding a `summary` field would be
 * a third description of a concept sitting beside the three bodies, free to
 * drift from all of them. The intuition body already opens with the sentence a
 * reader should meet first — that is what it is for.
 */
export function blurb(intuition: string, limit = 118): string {
  const stop = intuition.search(/\.\s/);
  const first = stop > 0 ? intuition.slice(0, stop + 1) : intuition;
  if (first.length <= limit) return first;
  // Cut on a word boundary so the ellipsis does not land mid-word.
  const cut = first.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${(space > 40 ? cut.slice(0, space) : cut).replace(/[,;:]$/, '')}…`;
}

/** Groups nodes by `domain[0]`, then `domain[1]`, everything sorted by name. */
export function directory(nodes: ResolvedNode[]): Group[] {
  const byTop = new Map<string, Map<string, Entry[]>>();

  for (const node of nodes) {
    const [top, sub] = node.domain;
    // The schema requires exactly two levels, so this is belt-and-braces
    // rather than a real branch — but a node with a malformed domain should
    // land somewhere visible rather than vanish from the index silently.
    const topName = top ?? 'Unsorted';
    const subName = sub ?? 'Unsorted';

    const sections = byTop.get(topName) ?? new Map<string, Entry[]>();
    const entries = sections.get(subName) ?? [];
    entries.push({
      id: node.id,
      title: node.title,
      tier: node.tier,
      blurb: blurb(node.bodies.intuition),
    });
    sections.set(subName, entries);
    byTop.set(topName, sections);
  }

  return [...byTop.entries()]
    .map(([name, sections]) => {
      const built = [...sections.entries()]
        .map(([sectionName, entries]) => ({
          name: sectionName,
          entries: entries.sort((a, b) => a.title.localeCompare(b.title)),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return {
        name,
        sections: built,
        count: built.reduce((n, s) => n + s.entries.length, 0),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Totals for the index's own header. Counted, not asserted. */
export function tally(groups: Group[]): { concepts: number; verified: number; frontier: number } {
  const entries = groups.flatMap((g) => g.sections.flatMap((s) => s.entries));
  return {
    concepts: entries.length,
    verified: entries.filter((e) => e.tier === 'verified').length,
    frontier: entries.filter((e) => e.tier === 'frontier').length,
  };
}
