/**
 * The performance budget: how much JavaScript each route is allowed to ship.
 *
 * Static-first is the project's central claim — fast first paint, real SEO,
 * near-zero idle cost — and until this ran, nothing measured whether it was
 * true (#60). Islands land one at a time and each one is small; the way a
 * static-first site stops being one is a hundred reasonable decisions, none of
 * which was the problem.
 *
 *   node scripts/perf-budget.mjs            # measure, compare, exit 1 if over
 *   node scripts/perf-budget.mjs --update   # rewrite the budget to what is measured
 *
 * `--update` is deliberately a separate, explicit act. A budget that rewrote
 * itself on every build would record whatever happened rather than what was
 * decided, which is the opposite of a budget.
 *
 * WHAT IS MEASURED. Per route: the gzipped bytes of the transitive closure of
 * JavaScript modules the page pulls, plus the gzipped HTML. Transitive matters
 * and is easy to get wrong — an island's `component-url` is in the markup, but
 * the React runtime it imports is not, and counting only what the HTML names
 * would have reported a concept page at a fraction of its real cost.
 *
 * Gzip rather than brotli, which is what Hosting actually serves: brotli's
 * output depends on a quality setting we do not control, so the number would
 * move without the code moving. Gzip -9 is stable, and it overstates, which is
 * the safe direction for a limit.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

const WEB = resolve(process.cwd());
const DIST = join(WEB, 'dist');
const BUDGET_PATH = join(WEB, 'perf-budget.json');

/**
 * Routes are patterns, not pages: there are 57 concept pages and they differ
 * only in prose, so one budget covers them and the WORST one is measured.
 * A budget met by the smallest page in a family is not a budget.
 */
const ROUTES = [
  { id: '/', match: (r) => r === '/' },
  { id: '/concepts', match: (r) => r === '/concepts' },
  { id: '/search', match: (r) => r === '/search' },
  { id: '/request', match: (r) => r === '/request' },
  { id: '/404', match: (r) => r === '/404' },
  { id: '/c/*', match: (r) => r.startsWith('/c/') },
  { id: '/t/*', match: (r) => r.startsWith('/t') },
];

const gz = (buf) => gzipSync(buf, { level: 9 }).length;

function htmlFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) htmlFiles(full, out);
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

function routeOf(file) {
  const rel = '/' + relative(DIST, file).replaceAll('\\', '/');
  if (rel.endsWith('/index.html')) return rel.slice(0, -'/index.html'.length) || '/';
  return rel.replace(/\.html$/, '');
}

/**
 * Every module a page ends up executing.
 *
 * Seeded from the markup — `src`, and Astro's `component-url` / `renderer-url`
 * — then closed over each module's own static imports.
 */
function moduleClosure(html) {
  const source = readFileSync(html, 'utf8');
  const queue = [];
  const seen = new Set();

  for (const m of source.matchAll(/(?:src|component-url|renderer-url)="(\/_astro\/[^"]+\.js)"/g)) {
    queue.push(m[1]);
  }

  while (queue.length > 0) {
    const spec = queue.pop();
    if (seen.has(spec)) continue;
    const file = join(DIST, spec.replace(/^\//, ''));
    let code;
    try {
      code = readFileSync(file, 'utf8');
    } catch {
      // Referenced and absent is a broken build, not a budget question.
      throw new Error(`${relative(WEB, html)} references ${spec}, which does not exist`);
    }
    seen.add(spec);
    for (const imp of code.matchAll(/(?:from|import)\s*"(\.\/[^"]+\.js)"/g)) {
      queue.push('/_astro/' + basename(imp[1]));
    }
  }
  return seen;
}

/** The measured cost of one page. */
function measure(html) {
  const modules = moduleClosure(html);
  let js = 0;
  for (const spec of modules) js += gz(readFileSync(join(DIST, spec.replace(/^\//, ''))));
  return { js, html: gz(readFileSync(html)), modules: modules.size };
}

export function measureRoutes() {
  const pages = htmlFiles(DIST);
  if (pages.length === 0) throw new Error('no built pages in dist — run `npm run build` first');

  const results = [];
  for (const route of ROUTES) {
    // The worst page in the family, measured by JavaScript.
    let worst = null;
    for (const page of pages) {
      if (!route.match(routeOf(page))) continue;
      const m = measure(page);
      if (worst === null || m.js > worst.js) worst = { ...m, page: relative(DIST, page) };
    }
    if (worst !== null) results.push({ id: route.id, ...worst });
  }

  // Driven from what was BUILT, not from the pattern list. Checking the list
  // against itself is what the first version did: every pattern had a budget,
  // so the "unbudgeted route" branch could never fire, and a new page was
  // measured by nobody. Proved by adding one and watching the run stay green.
  const uncovered = pages
    .map((page) => routeOf(page))
    .filter((route) => !ROUTES.some((r) => r.match(route)))
    .sort();

  return { results, uncovered: [...new Set(uncovered)] };
}

function main() {
  const update = process.argv.includes('--update');
  // TWO FLAGS, BECAUSE THEY ARE TWO DECISIONS (#327). Refreshing the record is
  // routine and safe; raising a budget is a decision the file itself says has to
  // be justified in a commit message. `--update` used to do both, so the only way
  // to refresh a stale measurement was to also flatten every js_gzip to exactly
  // what it measured — deleting the ~5% headroom on all seven routes at once,
  // silently. The next 2 KB then turned CI red for a reason nobody chose.
  //
  // The care already existed one line below, for HTML: "--update must not quietly
  // turn a note into a limit." It was never applied to the field that gates CI.
  // Named for what it does. It SETS each budget to what that route measures now,
  // which LOWERS every one that still has headroom — the danger is not a budget
  // creeping up, it is the slack quietly disappearing.
  const setBudgets = process.argv.includes('--set-budgets');
  const { results: measured, uncovered } = measureRoutes();
  const budget = JSON.parse(readFileSync(BUDGET_PATH, 'utf8'));

  if (update || setBudgets) {
    for (const row of measured) {
      const entry = budget.routes[row.id];
      if (!entry) continue;
      // Only when asked. The default leaves every budget exactly where the last
      // person to think about it put it.
      if (setBudgets) entry.js_gzip = row.js;
      // A route whose HTML is recorded rather than enforced stays that way:
      // --update must not quietly turn a note into a limit.
      if (typeof entry.html_gzip === 'number') entry.html_gzip = row.html;
      // The measurement is written unconditionally and compared by nobody (#286).
      // perf-budget.json said its HTML numbers were "here so a jump is visible"
      // while every one of them was null — the size was measured on each run,
      // printed, and stored nowhere, so a jump between two runs a month apart
      // was invisible unless somebody kept the terminal output. Two fields
      // because they are two different jobs: `html_gzip` is an opt-in limit,
      // `html_gzip_measured` is the record.
      entry.html_gzip_measured = row.html;
    }
    budget.measured_on = new Date().toISOString().slice(0, 10);
    writeFileSync(BUDGET_PATH, JSON.stringify(budget, null, 2) + '\n');
    console.log(
      setBudgets
        ? `set the budgets in ${relative(WEB, BUDGET_PATH)} — commit it, and say in the message what the extra weight bought`
        : `recorded the measurements in ${relative(WEB, BUDGET_PATH)} — budgets untouched; use --set-budgets to move one`,
    );
    return;
  }

  const over = [];
  const missing = [];
  console.log('route        js gzip   budget  headroom   html gzip  modules');
  for (const row of measured) {
    const entry = budget.routes[row.id];
    if (!entry) {
      missing.push(row.id);
      continue;
    }
    const room = entry.js_gzip - row.js;
    const flag = room < 0 ? '  OVER' : '';
    console.log(
      `${row.id.padEnd(12)} ${String(row.js).padStart(7)}  ${String(entry.js_gzip).padStart(7)}  ${String(room).padStart(8)}   ${String(row.html).padStart(9)}  ${String(row.modules).padStart(7)}${flag}`,
    );
    if (row.js > entry.js_gzip) {
      over.push(`${row.id}: ${row.js} B of JavaScript, budget ${entry.js_gzip} B (+${-room})`);
    }
    if (entry.html_gzip && row.html > entry.html_gzip) {
      over.push(`${row.id}: ${row.html} B of HTML, budget ${entry.html_gzip} B`);
    }
  }

  // A route nobody decided about. This is what stops a new page arriving
  // unmeasured — and it reads the built output, so it cannot be satisfied by
  // the pattern list agreeing with itself.
  for (const id of missing) over.push(`${id} has no budget — add one to perf-budget.json`);
  for (const route of uncovered) {
    over.push(`${route} is built but matches no route pattern — add it to ROUTES and give it a budget`);
  }

  if (over.length > 0) {
    console.error('\nover budget:');
    for (const line of over) console.error(`  ${line}`);
    console.error(
      '\nRaising a budget is a decision, not a fix. If the weight is worth it, run\n' +
        '`npm run perf -- --update` and say in the commit message what it bought.',
    );
    process.exit(1);
  }
  console.log('\nwithin budget');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
