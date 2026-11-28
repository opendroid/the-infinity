import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditRows, coverageProblems, readNodes, run } from '../../scripts/audit-coverage.mjs';

/**
 * The coverage check behind docs/audits/figure-captions.md (#559).
 *
 * The functions take rows and nodes as arguments, so each failure the issue
 * names is shown on a four-node fixture rather than on whatever state the real
 * audit happens to be in — the reason validate-content extracts its rules
 * (ADR-0021). The last block runs the real entry point, because a CLI guard
 * that never fires would exit 0 on anything and every test above would still
 * pass.
 */

const nodes = [
  { id: 'adam', primitive: 'update-spectrum' },
  { id: 'softmax', primitive: 'update-spectrum' },
  { id: 'warmup', primitive: 'loss-curve' },
  { id: 'clip', primitive: 'attention-heatmap' },
];

const HEAD = ['| id | template | verdict | reason |', '|---|---|---|---|'];
const table = (...rows: string[]) => [...HEAD, ...rows].join('\n');

const ADAM = '| adam | update-spectrum | pass | |';
const SOFTMAX = '| softmax | update-spectrum | flag | Promises a collapse the template cannot draw. |';
const WARMUP = '| warmup | loss-curve | pass | |';
const TWO = ['update-spectrum', 'loss-curve'];

const problemsIn = (markdown: string, templates = TWO) => {
  const { rows, problems } = auditRows(markdown);
  return [...problems, ...coverageProblems(rows, templates, nodes)];
};

describe('auditRows reads audit tables and nothing else', () => {
  it('reads every row under the audit header, numbering lines as an editor does', () => {
    const { rows, problems } = auditRows(['# Audit', '', table(ADAM, SOFTMAX)].join('\n'));
    expect(problems).toEqual([]);
    expect(rows.map((r: { id: string; line: number }) => [r.id, r.line])).toEqual([
      ['adam', 5],
      ['softmax', 6],
    ]);
  });

  it('ignores a table with any other header', () => {
    // The Templates section documents params in tables of its own.
    const md = ['| param | what it does |', '|---|---|', '| bars | sets the group width |'].join('\n');
    expect(auditRows(md)).toEqual({ rows: [], problems: [] });
  });

  it('reads rows from every audit table in the file', () => {
    const md = [table(ADAM, SOFTMAX), '', '## loss-curve', '', table(WARMUP)].join('\n');
    expect(auditRows(md).rows.map((r: { id: string }) => r.id)).toEqual(['adam', 'softmax', 'warmup']);
  });

  it('stops at the first line that is not a table row', () => {
    const md = [table(ADAM), 'A paragraph.', '| softmax | update-spectrum | pass | |'].join('\n');
    expect(auditRows(md).rows.map((r: { id: string }) => r.id)).toEqual(['adam']);
  });

  it('reads an escaped pipe as part of the reason, not as a new column', () => {
    const { rows, problems } = auditRows(table('| adam | update-spectrum | flag | reads a \\| b |'));
    expect(problems).toEqual([]);
    expect(rows[0]?.reason).toBe('reads a | b');
  });

  it('reads `adam` and adam as the same id', () => {
    expect(auditRows(table('| `adam` | `update-spectrum` | pass | |')).rows[0]).toMatchObject({
      id: 'adam',
      template: 'update-spectrum',
    });
  });

  it('reports a row with the wrong number of cells rather than dropping it', () => {
    // An unescaped pipe in a reason makes five cells. Skipping that row would
    // quietly uncover a node; reporting it is the only safe reading.
    const { rows, problems } = auditRows(table('| adam | update-spectrum | flag | a | b |'));
    expect(rows).toEqual([]);
    expect(problems).toEqual(['line 3: expected 4 cells, found 5 — write a pipe inside a reason as \\|']);
  });

  it('reads a row whose empty reason has no cell of its own', () => {
    const { rows, problems } = auditRows(table('| adam | update-spectrum | pass |'));
    expect(problems).toEqual([]);
    expect(rows[0]).toMatchObject({ id: 'adam', verdict: 'pass', reason: '' });
  });

  it('reports a row too short to carry a verdict', () => {
    expect(auditRows(table('| adam | update-spectrum |')).problems).toEqual(['line 3: expected 4 cells, found 2']);
  });

  it('reports an audit header with no separator under it', () => {
    expect(auditRows(['| id | template | verdict | reason |', ADAM].join('\n')).problems).toEqual([
      'line 1: an audit header with no |---| row under it is not a table',
    ]);
  });
});

describe('coverageProblems is empty only for an exact cover', () => {
  it('passes one row per node for the named templates', () => {
    expect(problemsIn(table(ADAM, SOFTMAX, WARMUP))).toEqual([]);
  });

  it('names a node with no row', () => {
    expect(problemsIn(table(SOFTMAX, WARMUP))).toEqual(['missing: "adam" uses update-spectrum and has no row']);
  });

  it('names a row for an id that is not a node', () => {
    expect(problemsIn(table(ADAM, SOFTMAX, WARMUP, '| made-up | loss-curve | pass | |'))).toEqual([
      'extra: line 6 names "made-up", which is not a node',
    ]);
  });

  it('names a row filed under a template its node does not use', () => {
    // softmax is update-spectrum; a loss-curve row for it is extra, and its own
    // template still counts it covered, so the message is about the filing.
    expect(problemsIn(table(ADAM, SOFTMAX, WARMUP, '| softmax | loss-curve | pass | |'))).toEqual([
      'extra: line 6 files "softmax" under loss-curve, but it uses update-spectrum',
      'duplicate: "softmax" has 2 rows, on lines 4, 6',
    ]);
  });

  it('names an id with two rows, and both lines', () => {
    expect(problemsIn(table(ADAM, SOFTMAX, WARMUP, ADAM))).toEqual(['duplicate: "adam" has 2 rows, on lines 3, 6']);
  });

  it('names a verdict other than pass or flag, case included', () => {
    expect(
      problemsIn(table('| adam | update-spectrum | maybe | |', '| softmax | update-spectrum | Pass | |', WARMUP)),
    ).toEqual([
      'verdict: line 3 gives "adam" the verdict "maybe" — it must be pass or flag',
      'verdict: line 4 gives "softmax" the verdict "Pass" — it must be pass or flag',
    ]);
  });

  it('ignores rows for templates it was not asked about, verdicts included', () => {
    // #560 fills the budget-split half of the same file on its own schedule.
    const md = table(ADAM, SOFTMAX, WARMUP, '| clip | attention-heatmap | maybe | |', '| ghost | budget-split | | |');
    expect(problemsIn(md)).toEqual([]);
  });

  it('counts a node filed under a template outside the check as missing from its own', () => {
    expect(problemsIn(table('| adam | budget-split | pass | |', SOFTMAX, WARMUP))).toEqual([
      'missing: "adam" uses update-spectrum and has no row',
    ]);
  });

  it('fails a template no node uses, rather than calling zero rows for zero nodes a cover', () => {
    expect(problemsIn(table(ADAM, SOFTMAX, WARMUP), ['update-spectrm'])).toEqual([
      'template: no node uses "update-spectrm" — is the name right?',
    ]);
  });
});

describe('run, the command line without process.exit', () => {
  let dir: string;
  let nodesDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'audit-coverage-'));
    nodesDir = join(dir, 'nodes');
    mkdirSync(nodesDir);
    for (const n of nodes) {
      writeFileSync(join(nodesDir, `${n.id}.json`), JSON.stringify({ id: n.id, viz: { primitive: n.primitive } }));
    }
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const audit = (markdown: string) => {
    const path = join(dir, 'audit.md');
    writeFileSync(path, markdown);
    return path;
  };

  it('exits 0 on an exact cover and reports the counts', () => {
    const path = audit(table(ADAM, SOFTMAX, WARMUP));
    expect(run([path, ...TWO], nodesDir)).toEqual({
      code: 0,
      lines: [`✓ ${path}: one row for each of the 3 nodes using update-spectrum, loss-curve — 2 pass, 1 flag`],
    });
  });

  it('exits 1 and names every difference', () => {
    const path = audit(table(SOFTMAX, WARMUP, '| made-up | loss-curve | maybe | |'));
    const { code, lines } = run([path, ...TWO], nodesDir);
    expect(code).toBe(1);
    expect(lines).toEqual([
      `✗ ${path} against update-spectrum, loss-curve`,
      '    extra: line 5 names "made-up", which is not a node',
      '    verdict: line 5 gives "made-up" the verdict "maybe" — it must be pass or flag',
      '    missing: "adam" uses update-spectrum and has no row',
      '3 problem(s)',
    ]);
  });

  it('exits 1 with a usage line when no template is named', () => {
    expect(run([audit(table(ADAM))], nodesDir).code).toBe(1);
    expect(run([], nodesDir).lines).toEqual(['usage: node web/scripts/audit-coverage.mjs <audit.md> <template>...']);
  });

  it('exits 1 on an audit it cannot read', () => {
    const { code, lines } = run([join(dir, 'absent.md'), 'update-spectrum'], nodesDir);
    expect(code).toBe(1);
    expect(lines[0]).toMatch(/^✗ cannot read .*absent\.md/);
  });
});

describe('the real entry point', () => {
  const SCRIPT = fileURLToPath(new URL('../../scripts/audit-coverage.mjs', import.meta.url));
  const CORPUS = fileURLToPath(new URL('../../../content/nodes/', import.meta.url));
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'audit-coverage-cli-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('exits 0 on a complete audit of the real corpus and 1 once a row is gone', () => {
    // Built from the corpus rather than hard-coded, so a new router-dispatch
    // node changes the fixture instead of breaking the test.
    const rows = readNodes(CORPUS)
      .filter((n: { primitive: string }) => n.primitive === 'router-dispatch')
      .map((n: { id: string }) => `| ${n.id} | router-dispatch | pass | |`);
    expect(rows.length).toBeGreaterThan(0);

    const path = join(dir, 'audit.md');
    writeFileSync(path, table(...rows));
    const whole = spawnSync(process.execPath, [SCRIPT, path, 'router-dispatch'], { encoding: 'utf8' });
    expect(whole.status, whole.stderr).toBe(0);
    expect(whole.stdout).toContain(`one row for each of the ${rows.length} nodes using router-dispatch`);

    writeFileSync(path, table(...rows.slice(1)));
    const short = spawnSync(process.execPath, [SCRIPT, path, 'router-dispatch'], { encoding: 'utf8' });
    expect(short.status).toBe(1);
    expect(short.stderr).toContain('missing: "');
  });
});
