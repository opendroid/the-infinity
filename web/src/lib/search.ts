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
 * Lowercase, decompose accents, drop the combining marks and the invisibles.
 *
 * So "MoE" finds "moe" and a pasted "Résidual" finds "Residual". Concept ids
 * are ASCII by schema, but queries come from people and clipboards.
 *
 * THE INVISIBLES ARE THE CLIPBOARD'S DOING, not the reader's (#454). A zero-width
 * space inside "attention" made it match nothing while looking exactly like the
 * word that matches twelve things, so a reader concludes the concept does not
 * exist rather than that their paste was dirty. PDFs, docs and rendered pages
 * carry these routinely. Diacritics were already folded here; these belong in
 * the same place and for the same reason.
 *
 * U+200B-U+200D zero-width space / non-joiner / joiner, U+2060 word joiner, and
 * U+FEFF — a byte-order mark at the start of a file, a zero-width no-break space
 * anywhere else, and a pasted query is anywhere else.
 */
export function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
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

/**
 * The nearest entries for a query that matched nothing. For the zero state.
 *
 * THIS IS NOT A RELAXATION OF THE MATCHING RULE. `search` still requires every
 * term, deliberately — its own test says why: "OR would return every attention
 * concept and rank the noise." That reasoning stands, so what comes back here is
 * offered to the reader as a SUGGESTION and never as a result.
 *
 * What it fixes is the dead end (#451). "attention mechanism" and "positional
 * embedding" are the natural way to ask for concepts that exist, and both
 * answered with nothing at all — the second while Positional Encoding sits on
 * the landing page as a suggested concept.
 *
 * Ranked by how many terms an entry matched first, then by where they landed, so
 * an entry answering two thirds of the query outranks one answering a common
 * word. Single-term queries get nothing: with one term there is no partial match
 * to offer, only a different word, and guessing that is a typo problem rather
 * than this one.
 */
export function suggest(index: Entry[], query: string, limit = 4): Hit[] {
  const terms = normalise(query).split(/\s+/).filter(Boolean);
  if (terms.length < 2) return [];

  const near: Hit[] = [];
  for (const entry of index) {
    let matched = 0;
    let total = 0;
    for (const term of terms) {
      const s = scoreTerm(entry, term);
      if (s > 0) {
        matched += 1;
        total += s;
      }
    }
    // Terms matched dominates placement: MATCHED_WEIGHT is larger than any
    // achievable `total`, so no pile of weak hits outranks a broader match.
    if (matched > 0) near.push({ ...entry, score: matched * MATCHED_WEIGHT + total });
  }

  return near
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}

/** Larger than any reachable per-term total, so "how many matched" wins first. */
const MATCHED_WEIGHT = 1000;

/**
 * The path+query a /search URL should carry for a given question.
 *
 * The URL is where the question LIVES on /search — it is what the page reads on
 * load, and what a reader reloads, bookmarks and shares. It was written only on
 * submit, so clearing the box left `?q=` behind: the visible state said nothing
 * was being asked and the URL still said "attention" (#452).
 *
 * Pure and string-taking so the rule is testable without a DOM, and so the
 * "did anything actually change?" comparison the caller makes is exact rather
 * than a guess about how URLSearchParams will re-encode what it was given.
 */
export function queryUrl(pathname: string, currentSearch: string, query: string): string {
  const params = new URLSearchParams(currentSearch);
  if (query.trim() === '') params.delete('q');
  else params.set('q', query);
  const rest = params.toString();
  return rest === '' ? pathname : `${pathname}?${rest}`;
}
