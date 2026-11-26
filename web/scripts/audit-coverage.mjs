/**
 * Checks that a caption audit covers exactly the nodes using the templates it
 * names (#559).
 *
 *   node web/scripts/audit-coverage.mjs docs/audits/figure-captions.md update-spectrum loss-curve
 *
 * An audit row is `| id | template | verdict | reason |`, one per node. This
 * exits 0 only when the rows for the named templates are exactly the set of
 * node ids using them — none missing, none extra, none twice — and every one
 * of those rows says `pass` or `flag`. Anything else exits 1 and names what
 * differs.
 *
 * WHY A SCRIPT. The audit is a hand-read list, and a hand-kept list has no way
 * to say it skipped one. "Every figure read against its caption" (LAUNCH.md §6)
 * is a claim about all of them, so the coverage is checked rather than
 * asserted.
 *
 * WHAT IT DELIBERATELY DOES NOT CHECK: whether a verdict is right. That is the
 * judgment the audit exists to record, and Ajay confirms or dismisses each
 * flag; a script that graded verdicts would be a second audit nobody reviewed.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Resolved from this file, not from process.cwd() as validate-content.mjs
// does: #559's acceptance test runs this from the repo root and npm runs
// scripts from /web, so neither working directory can be assumed. CLAUDE.md's
// warning about import.meta.url is about code Astro bundles; nothing bundles
// this.
const NODES_DIR = fileURLToPath(new URL('../../content/nodes/', import.meta.url));

/** The header that marks a table as audit rows. Any other table is prose. */
export const HEADER = ['id', 'template', 'verdict', 'reason'];

/** What a screen can say. Confirming or dismissing a flag happens elsewhere. */
export const VERDICTS = ['pass', 'flag'];

/**
 * @typedef {object} AuditRow
 * @property {string} id
 * @property {string} template
 * @property {string} verdict
 * @property {string} reason
 * @property {number} line  1-based, so a message points where an editor does
 */

/**
 * The cells of one markdown table row, trimmed, with `\|` read as a literal
 * pipe — a reason quoting a pipe must not shift the verdict into a new column.
 *
 * @param {string} line
 * @returns {string[] | null} null when the line is not a table row
 */
function cellsOf(line) {
  const row = line.trim();
  if (!row.startsWith('|')) return null;
  const cells = [];
  let cell = '';
  for (let i = 1; i < row.length; i += 1) {
    if (row[i] === '\\' && row[i + 1] === '|') {
      cell += '|';
      i += 1;
    } else if (row[i] === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += row[i];
    }
  }
  // A row written without its closing pipe still has a last cell.
  if (cell.trim() !== '') cells.push(cell.trim());
  return cells;
}

/** `adam` and adam name the same node. */
const unquote = (cell) => cell.replace(/^`(.*)`$/, '$1');

const isSeparator = (cells) => cells !== null && cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));

/**
 * Every row of every audit table in a markdown document.
 *
 * An audit table is one whose header row is exactly HEADER; its rows run from
 * the line after the `|---|` separator to the first line that is not a table
 * row. Other tables — the Templates section has some — are not rows of
 * anything. A row with the wrong number of cells is reported, not skipped: a
 * row this reader drops would be a node the audit silently stops covering.
 *
 * @param {string} markdown
 * @returns {{ rows: AuditRow[], problems: string[] }}
 */
export function auditRows(markdown) {
  const lines = markdown.split('\n');
  /** @type {AuditRow[]} */
  const rows = [];
  /** @type {string[]} */
  const problems = [];

  for (let i = 0; i < lines.length; i += 1) {
    const header = cellsOf(lines[i] ?? '');
    if (header === null || header.join('|').toLowerCase() !== HEADER.join('|')) continue;

    if (!isSeparator(cellsOf(lines[i + 1] ?? ''))) {
      problems.push(`line ${i + 1}: an audit header with no |---| row under it is not a table`);
      continue;
    }

    let j = i + 2;
    for (; j < lines.length; j += 1) {
      const cells = cellsOf(lines[j] ?? '');
      if (cells === null) break;
      const [id, template, verdict, reason = ''] = cells;
      // Three cells is a row whose empty reason has no cell of its own, which
      // markdown renders the same. More than four is a reason with a bare pipe.
      if (id === undefined || template === undefined || verdict === undefined || cells.length > HEADER.length) {
        const hint = cells.length > HEADER.length ? ' — write a pipe inside a reason as \\|' : '';
        problems.push(`line ${j + 1}: expected ${HEADER.length} cells, found ${cells.length}${hint}`);
        continue;
      }
      rows.push({ id: unquote(id), template: unquote(template), verdict, reason, line: j + 1 });
    }
    i = j;
  }
  return { rows, problems };
}

/**
 * What differs between an audit's rows and the corpus, for the named templates.
 *
 * Rows for any other template are ignored entirely, verdict included: the
 * `budget-split` half of this audit (#560) lands in the same file on its own
 * schedule, and must neither fail this half nor be passed by it.
 *
 * @param {AuditRow[]} rows
 * @param {string[]} templates
 * @param {{ id: string, primitive: string }[]} nodes
 * @returns {string[]} one message per difference; empty means an exact cover
 */
export function coverageProblems(rows, templates, nodes) {
  const problems = [];
  const wanted = new Set(templates);
  const primitiveOf = new Map(nodes.map((n) => [n.id, n.primitive]));

  // A misspelt template selects no nodes and no rows, and "no rows for no
  // nodes" is an exact cover — the check passing for the wrong reason. So a
  // template nothing uses is a failure in its own right.
  for (const template of wanted) {
    if (!nodes.some((n) => n.primitive === template)) {
      problems.push(`template: no node uses "${template}" — is the name right?`);
    }
  }

  /** @type {Map<string, number[]>} */
  const linesOf = new Map();
  for (const row of rows) {
    if (!wanted.has(row.template)) continue;
    linesOf.set(row.id, [...(linesOf.get(row.id) ?? []), row.line]);

    const actual = primitiveOf.get(row.id);
    if (actual === undefined) {
      problems.push(`extra: line ${row.line} names "${row.id}", which is not a node`);
    } else if (actual !== row.template) {
      problems.push(`extra: line ${row.line} files "${row.id}" under ${row.template}, but it uses ${actual}`);
    }
    if (!VERDICTS.includes(row.verdict)) {
      problems.push(`verdict: line ${row.line} gives "${row.id}" the verdict "${row.verdict}" — it must be pass or flag`);
    }
  }

  for (const [id, lines] of linesOf) {
    if (lines.length > 1) problems.push(`duplicate: "${id}" has ${lines.length} rows, on lines ${lines.join(', ')}`);
  }

  for (const node of nodes) {
    if (wanted.has(node.primitive) && !linesOf.has(node.id)) {
      problems.push(`missing: "${node.id}" uses ${node.primitive} and has no row`);
    }
  }
  return problems;
}

/**
 * The id and template of every node in a directory of node files.
 *
 * @param {string} dir
 * @returns {{ id: string, primitive: string }[]}
 */
export function readNodes(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
    .map((n) => ({ id: n.id, primitive: n.viz?.primitive }));
}

/**
 * The command line, minus process.exit, so the suite can drive it.
 *
 * @param {string[]} args  the audit's path, then one or more template names
 * @param {string} [nodesDir]
 * @returns {{ code: 0 | 1, lines: string[] }}
 */
export function run(args, nodesDir = NODES_DIR) {
  const [auditPath, ...named] = args;
  if (auditPath === undefined || named.length === 0) {
    return { code: 1, lines: ['usage: node web/scripts/audit-coverage.mjs <audit.md> <template>...'] };
  }

  let markdown;
  try {
    markdown = readFileSync(auditPath, 'utf8');
  } catch (err) {
    return { code: 1, lines: [`✗ cannot read ${auditPath}: ${err instanceof Error ? err.message : err}`] };
  }

  const templates = [...new Set(named)];
  const { rows, problems: unreadable } = auditRows(markdown);
  const problems = [...unreadable, ...coverageProblems(rows, templates, readNodes(nodesDir))];
  if (problems.length > 0) {
    return {
      code: 1,
      lines: [
        `✗ ${auditPath} against ${templates.join(', ')}`,
        ...problems.map((p) => `    ${p}`),
        `${problems.length} problem(s)`,
      ],
    };
  }

  const covered = rows.filter((r) => templates.includes(r.template));
  const flags = covered.filter((r) => r.verdict === 'flag').length;
  return {
    code: 0,
    lines: [
      `✓ ${auditPath}: one row for each of the ${covered.length} nodes using ${templates.join(', ')} — ` +
        `${covered.length - flags} pass, ${flags} flag`,
    ],
  };
}

// CLI entry — only when run directly, so importing this stays side-effect free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, lines } = run(process.argv.slice(2));
  for (const line of lines) (code === 0 ? console.log : console.error)(line);
  process.exitCode = code;
}
