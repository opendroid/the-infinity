/**
 * The search index and the rule that matches against it.
 *
 * ADR-0003 defers `GET /v1/search` until the graph passes roughly 5–10k nodes:
 * a static index matched in the browser is faster, free per query, and — the
 * property that matters most — works while the API is asleep. Cloud Run scales
 * to zero, so "the API is unreachable" is an ordinary Tuesday, not an incident.
 *
 * THE MATCHING RULE, WRITTEN DOWN RATHER THAN LEFT EMERGENT
 *
 * A query is lowercased, stripped of accents, and split on whitespace. Every
 * term must match somewhere in an entry — AND, not OR, because with 57 concepts
 * an OR search returns most of the graph and ranks the noise.
 *
 * A term matches against the title, the domain path, and the id. Ranking is by
 * WHERE the best match landed, not by how many times it occurred:
 *
 *   4  the title starts with the term      "atten" → Attention
 *   3  a word in the title starts with it  "head"  → Multi-Head Attention
 *   2  the title contains it anywhere      "norm"  → RMSNorm
 *   1  the domain or the id contains it    "sparsity", "kv-cache"
 *
 * Frequency is deliberately not a signal. Titles are two or three words, so
 * counting occurrences measures nothing but title length.
 */
import type { ResolvedNode, Tier } from './graph';

export interface Entry {
  id: string;
  title: string;
  /** The joined domain path, e.g. "Attention / Core". */
  domain: string;
  tier: Tier;
}

export interface Hit extends Entry {
  score: number;
}

/**
 * Lowercase, decompose accents, drop the combining marks.
 *
 * So "MoE" finds "moe" and a pasted "Résidual" finds "Residual". Concept ids
 * are ASCII by schema, but queries come from people and clipboards.
 */
export function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Build-time index. Deliberately four fields: this ships to every searcher. */
export function buildIndex(nodes: ResolvedNode[]): Entry[] {
  return nodes
    .map((n) => ({
      id: n.id,
      title: n.title,
      domain: n.domain.join(' / '),
      tier: n.tier,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Where a single term landed in one entry. 0 means it did not. */
function scoreTerm(entry: Entry, term: string): number {
  const title = normalise(entry.title);
  if (title.startsWith(term)) return 4;
  if (title.split(/[\s-]+/).some((w) => w.startsWith(term))) return 3;
  if (title.includes(term)) return 2;
  if (normalise(entry.domain).includes(term) || normalise(entry.id).includes(term)) return 1;
  return 0;
}

/**
 * Matches a query against the index.
 *
 * Returns [] for an empty query rather than everything: an empty search box has
 * not asked a question, and answering it with the whole graph would make the
 * result list flash the entire index on every keystroke back to nothing.
 */
export function search(index: Entry[], query: string, limit = 12): Hit[] {
  const terms = normalise(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const hits: Hit[] = [];
  for (const entry of index) {
    let total = 0;
    let matchedAll = true;
    for (const term of terms) {
      const s = scoreTerm(entry, term);
      if (s === 0) {
        matchedAll = false;
        break;
      }
      total += s;
    }
    if (matchedAll) hits.push({ ...entry, score: total });
  }

  return hits
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}
