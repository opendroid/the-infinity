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

    // ADR-0013: `origin` names a source nothing fetched, so nothing in it may
    // look like something that was. The schema already forbids a `url` key
    // (additionalProperties is false); this catches a link smuggled into a
    // `ref`, `title` or `venue`, which is the shape the drift would actually
    // take — an author with a URL in hand and nowhere the schema will accept it.
    for (const o of node.origin ?? []) {
      for (const [field, value] of Object.entries(o)) {
        if (typeof value === 'string' && /https?:\/\//i.test(value)) {
          errors.push(`origin "${o.ref}" puts a URL in ${field} — origin entries are named, not linked`);
        }
      }
      // The two arrays answer different questions, so the same source appearing
      // in both means one of them is answering the wrong one.
      if ((node.citations ?? []).some((c) => c.ref === o.ref)) {
        errors.push(`origin "${o.ref}" is also a citation — a source is fetchable or it is not`);
      }
    }

    if (errors.length) failures.push({ file, errors });
  }

  // A PAIR OF CONCEPTS HAS EXACTLY ONE RELATIONSHIP, and the loop above cannot
  // see a violation split across two files. A says `adjacent: B` while B says
  // `requires: A`: each file is internally consistent, the per-node check that
  // rejects naming an id in two of your own groups sees nothing, and the pair is
  // related twice.
  //
  // `api/internal/publish` already rejects this and is how it was caught both
  // times it happened — superposition/sparse-autoencoder in #208 and
  // graph-expressivity/graph-transformer in the graph batch. But that surfaces
  // the error at `make golden`, away from every other content error and only for
  // whoever runs Go. Content mistakes should fail where content is checked.
  const claims = new Map();
  for (const { node } of nodes) {
    for (const type of ['requires', 'adjacent']) {
      for (const edge of node.edges?.[type] ?? []) {
        // Undirected key, because requires and unlocks are the same edge seen
        // from the two ends — that is the whole reason this can be missed.
        const key = [node.id, edge.id].sort().join('\u0000');
        const seen = claims.get(key);
        if (seen && (seen.type !== type || type === 'requires')) {
          failures.push({
            file: `${node.id}.json`,
            errors: [
              `${node.id} and ${edge.id} are related in two ways at once ` +
                `(${seen.from} says ${seen.type}, ${node.id} says ${type})`,
            ],
          });
        } else if (!seen) {
          claims.set(key, { type, from: node.id });
        }
      }
    }
  }


  // THE DOMAIN PATH IS A GROUPING KEY, so two spellings of one segment are two
  // groups — and a reader has no way to tell the sibling heading from the real
  // one. Four nodes shipped `["Evaluation", "Method"]` against the corpus's
  // `"Methods"` and every gate stayed green; it was caught by eye (#307).
  //
  // MEASURED BEFORE IT WAS BUILT, because two checks in this area were measured
  // and REJECTED — see content/schema/README.md on caption-word-overlap (75 of
  // 392) and citation-title-overlap (193 of 702). Normalising a segment and
  // looking for a collision flags 0 of 47 first-level and 0 of 89 second-level
  // values on the corpus as it stands, and flagged exactly the plural that
  // prompted it. No false positives is what earns a gate rather than a rule.
  //
  // Deliberately NOT an enum: the corpus adds a domain most batches, and closing
  // the set would put that behind a schema change for nothing this does not give.
  const spellings = [new Map(), new Map()];
  for (const { node } of nodes) {
    for (const level of [0, 1]) {
      const raw = node.domain?.[level];
      if (typeof raw !== 'string') continue;
      // Strip one trailing plural, case and separators — the ways a segment
      // drifts while still reading as the same word to whoever typed it.
      const key = raw.toLowerCase().replace(/[\s-]/g, '').replace(/s$/, '');
      const seen = spellings[level].get(key) ?? new Map();
      seen.set(raw, [...(seen.get(raw) ?? []), node.id]);
      spellings[level].set(key, seen);
    }
  }
  for (const [level, byKey] of spellings.entries()) {
    for (const variants of byKey.values()) {
      if (variants.size < 2) continue;
      // The majority spelling is the one the corpus already uses, so name it
      // rather than making whoever hits this go and count.
      const ranked = [...variants].sort((a, b) => b[1].length - a[1].length);
      const [winner] = ranked;
      for (const [spelling, owners] of ranked.slice(1)) {
        for (const id of owners) {
          failures.push({
            file: `${id}.json`,
            errors: [
              `domain[${level}] is "${spelling}" (${owners.length} node(s)) where ` +
                `the corpus uses "${winner[0]}" (${winner[1].length}) — one segment, ` +
                `two spellings, and the site would group them apart`,
            ],
          });
        }
      }
    }
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

  // AN EMPTY FRONTIER FAILS HERE, AND WITHOUT THIS IT FAILS OPAQUELY (#283).
  // Verifying the last frontier batch makes every right-lobe bead verified, so
  // the per-bead check below reports three separate "is verified, but this lobe
  // is frontier" errors and never names the cause. The reader's next move is to
  // edit the layout, which cannot work: there is nothing frontier to put in it.
  //
  // This says so once, and points at the open question rather than answering
  // it — whether an empty frontier should be representable at all is a design
  // decision about the landing page's signature figure, not a validator's call.
  const anyFrontier = [...nodes.values()].some((n) => tierOf(n) === 'frontier');
  if (!anyFrontier) {
    errors.push(
      'no concept is frontier, so the lemniscate\'s teal lobe cannot be filled — ' +
        'the layout is not the problem and editing it will not help. ' +
        'Seed a batch, or see #283 on whether steady state should be representable.',
    );
  }

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
