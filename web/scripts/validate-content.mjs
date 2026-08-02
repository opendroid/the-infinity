/**
 * Validates /content/nodes against /content/schema/node.schema.json, plus the
 * cross-field invariants JSON Schema cannot express.
 *
 * Lives under /web because that is where the Node toolchain is; the content it
 * checks belongs to the repo, not to the site. Exported so the vitest suite can
 * run exactly these checks rather than a second copy that drifts.
 *
 *   node scripts/validate-content.mjs      # CLI, exits 1 on any failure
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ROOT = resolve(process.cwd(), '..');
const NODES_DIR = join(ROOT, 'content/nodes');
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
    for (const type of ['requires', 'adjacent']) {
      for (const edge of node.edges?.[type] ?? []) {
        if (!ids.has(edge.id)) errors.push(`edges.${type} points at "${edge.id}", which does not exist`);
        if (edge.id === node.id) errors.push(`edges.${type} points at itself`);
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

export function countNodes() {
  return readdirSync(NODES_DIR).filter((f) => f.endsWith('.json')).length;
}

// CLI entry — only when run directly, so importing this stays side-effect free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = validateContent();
  if (failures.length === 0) {
    console.log(`✓ ${countNodes()} node(s) valid`);
  } else {
    for (const { file, errors } of failures) {
      console.error(`\n✗ ${file}`);
      for (const e of errors) console.error(`    ${e}`);
    }
    console.error(`\n${failures.length} file(s) failed validation`);
    process.exit(1);
  }
}
