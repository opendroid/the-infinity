/**
 * Validates /content/nodes against /content/schema/node.schema.json, plus the
 * cross-field invariants JSON Schema cannot express.
 *
 * Lives under /web because that is where the Node toolchain is; the content it
 * checks belongs to the repo, not to the site. Exported so the vitest suite can
 * run exactly these checks rather than a second copy that drifts.
 *
 *   node scripts/validate-content.mjs      # CLI, exits 1 on any failure
 *
 * Notation (`_`/`^`, ADR-0009) is NOT checked here. Its validator lives beside
 * its parser in src/lib/notation.ts, which this file cannot import — and a
 * second copy of the grammar is precisely the drift this file exists to avoid.
 * `src/lib/notation.test.ts` runs it over every body, so a malformed marker
 * fails `npm test` and the same CI job.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ROOT = resolve(process.cwd(), '..');
const NODES_DIR = join(ROOT, 'content/nodes');
const LAYOUT_PATH = join(ROOT, 'content/layout/lemniscate.json');
const SCHEMA_PATH = join(ROOT, 'content/schema/node.schema.json');

/** @returns {{file: string, errors: string[]}[]} one entry per file with problems */
export function validateContent() {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const files = readdirSync(NODES_DIR).filter((f) => f.endsWith('.json'));
  const nodes = files.map((file) => ({
    file,
    node: JSON.parse(readFileSync(join(NODES_DIR, file), 'utf8')),
  }));
  const ids = new Set(nodes.map(({ node }) => node.id));

  const failures = [];

  for (const { file, node } of nodes) {
    const errors = [];

    if (!validate(node)) {
      for (const e of validate.errors ?? []) {
        errors.push(`${e.instancePath || '/'} ${e.message}${e.params?.additionalProperty ? ` ("${e.params.additionalProperty}")` : ''}`);
      }
    }

    // The id is the URL. A mismatch would serve the file at the wrong path.
    if (node.id !== basename(file, '.json')) {
      errors.push(`id "${node.id}" does not match the filename`);
    }

    // Emphasis is a substring of the body, duplicated. Edit one without the
    // other and the highlight silently disappears — no error, no visual break,
    // just a paragraph that quietly lost its takeaway.
    for (const [depth, phrase] of Object.entries(node.emphasis ?? {})) {
      if (!String(node.bodies?.[depth] ?? '').includes(phrase)) {
        errors.push(`emphasis.${depth} is not a verbatim substring of bodies.${depth}`);
      }
    }

    // Edges may only reference nodes that exist, or are added in the same PR —
    // which, since this runs over the whole directory, is the same check.
    //
    // A pair of concepts is related in exactly one way. Naming a target twice —
    // in both authored groups here, or as a mutual `requires` across two files —
    // has no coherent reading, and it breaks the mini-map: one circle per edge
    // per group means two circles for one concept at two coordinates. Caught
    // here so it names the file; the two derivations also reject it, but only
    // once a build is already running.
    const relationship = new Map();
    for (const type of ['requires', 'adjacent']) {
      for (const edge of node.edges?.[type] ?? []) {
        if (!ids.has(edge.id)) errors.push(`edges.${type} points at "${edge.id}", which does not exist`);
        if (edge.id === node.id) errors.push(`edges.${type} points at itself`);

        const first = relationship.get(edge.id);
        if (first) {
          errors.push(`edges names "${edge.id}" in both ${first} and ${type} — a pair of concepts has exactly one relationship`);
        }
        relationship.set(edge.id, type);
      }
    }
    // The derived inverse: if this node requires X, X unlocks it, so X may not
    // also require this node. Checked across files because neither one alone
    // looks wrong.
    for (const edge of node.edges?.requires ?? []) {
      const other = nodes.find(({ node: n }) => n.id === edge.id)?.node;
      if (other?.edges?.requires?.some((e) => e.id === node.id)) {
        errors.push(`requires "${edge.id}", which requires it back — a circular prerequisite has no first concept`);
      }
    }

    // A control naming a parameter that isn't there renders a slider that
    // changes nothing.
    for (const control of node.viz?.param_controls ?? []) {
      if (!(control.name in (node.viz?.params ?? {}))) {
        errors.push(`viz.param_controls names "${control.name}", absent from viz.params`);
      }
    }

    if (errors.length) failures.push({ file, errors });
  }

  return failures;
}

/**
 * The committed lemniscate layout against the concepts it names (#52).
 *
 * Lives here rather than beside the renderer in src/lib/layout.ts because it is
 * content validation — /content/layout against /content/nodes — and because a
 * second copy of the rules is what this file exists to prevent. The renderer
 * throws on a missing id; this says which line to change.
 *
 * @returns {string[]} one sentence per problem; empty means the layout is fine
 */
export function validateLayout() {
  let layout;
  try {
    layout = JSON.parse(readFileSync(LAYOUT_PATH, 'utf8'));
  } catch (err) {
    return [`cannot read content/layout/lemniscate.json: ${err.message}`];
  }

  const tierOf = (node) => (node.review ? 'verified' : 'frontier');
  const nodes = new Map(
    readdirSync(NODES_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(NODES_DIR, f), 'utf8')))
      .map((n) => [n.id, n]),
  );

  const errors = [];
  for (const [lobe, tier] of [
    ['left', 'verified'],
    ['right', 'frontier'],
  ]) {
    const seen = new Set();
    for (const bead of layout[lobe] ?? []) {
      const node = nodes.get(bead.id);
      if (!node) {
        errors.push(`${lobe}: "${bead.id}" is not a concept in /content/nodes`);
        continue;
      }
      // Tier decides the lobe and nothing else may: the figure's argument is
      // reviewed core flowing into new growth, so a teal bead on the gold lobe
      // would break the colour rule on the front page.
      if (tierOf(node) !== tier) {
        errors.push(`${lobe}: "${bead.id}" is ${tierOf(node)}, but this lobe is ${tier}`);
      }
      if (typeof bead.t !== 'number' || bead.t < 0 || bead.t > 1) {
        errors.push(`${lobe}: "${bead.id}" has t=${bead.t}; it must be a fraction of the lobe, 0 to 1`);
      }
      if (seen.has(bead.id)) errors.push(`${lobe}: "${bead.id}" appears twice`);
      seen.add(bead.id);
    }
  }

  const chips = new Set();
  for (const id of layout.chips ?? []) {
    if (!nodes.has(id)) errors.push(`chips: "${id}" is not a concept in /content/nodes`);
    if (chips.has(id)) errors.push(`chips: "${id}" appears twice`);
    chips.add(id);
  }

  return errors;
}

export function countNodes() {
  return readdirSync(NODES_DIR).filter((f) => f.endsWith('.json')).length;
}

// CLI entry — only when run directly, so importing this stays side-effect free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = validateContent();
  const layoutErrors = validateLayout();
  if (layoutErrors.length > 0) {
    console.error('\n✗ content/layout/lemniscate.json');
    for (const e of layoutErrors) console.error(`    ${e}`);
  }
  if (failures.length === 0 && layoutErrors.length === 0) {
    console.log(`✓ ${countNodes()} node(s) valid, lemniscate layout resolves`);
  } else if (failures.length === 0) {
    console.error('\nthe lemniscate layout is stale');
    process.exit(1);
  } else {
    for (const { file, errors } of failures) {
      console.error(`\n✗ ${file}`);
      for (const e of errors) console.error(`    ${e}`);
    }
    console.error(`\n${failures.length} file(s) failed validation`);
    process.exit(1);
  }
}
