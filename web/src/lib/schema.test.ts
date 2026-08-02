/**
 * The schema's real job is what it REJECTS.
 *
 * Validating the five good nodes proves almost nothing — a schema of `{}`
 * would pass that. These cases assert the shapes ADR-0002 ruled out actually
 * fail, so the rejected design cannot creep back in a future content PR.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { validateContent } from '../../scripts/validate-content.mjs';

const ROOT = resolve(process.cwd(), '..');
const schema = JSON.parse(readFileSync(join(ROOT, 'content/schema/node.schema.json'), 'utf8'));

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

/** A minimal node that passes, so each case below varies exactly one thing. */
const valid = () => ({
  id: 'a-concept',
  title: 'A Concept',
  domain: ['Architecture', 'Sparsity'],
  bodies: {
    intuition: 'x'.repeat(50),
    engineer: 'y'.repeat(50),
    math: 'z'.repeat(50),
  },
  viz: {
    primitive: 'router-dispatch',
    params: { top_k: 2 },
    param_controls: [{ name: 'top_k', min: 1, max: 4, step: 1 }],
    caption: 'A caption long enough to pass.',
  },
  edges: { requires: [], adjacent: [] },
  citations: [{ ref: 'arXiv:1', title: 'T', url: 'https://example.com/1' }],
  review: { reviewed_by: 'someone', reviewed_at: '2026-01-01' },
  updated_at: '2026-01-01',
});

describe('node.schema.json accepts', () => {
  it('a well-formed verified node', () => {
    expect(validate(valid())).toBe(true);
  });

  it('a frontier node with provenance instead of review', () => {
    const node = { ...valid(), review: undefined, provenance: { drafted_at: '2026-01-01' } };
    delete node.review;
    expect(validate(node)).toBe(true);
  });

  it('a node with no draggable viz parameter', () => {
    const node = valid();
    node.viz.param_controls = [];
    expect(validate(node)).toBe(true);
  });
});

describe('node.schema.json rejects', () => {
  const cases: { name: string; mutate: (n: ReturnType<typeof valid>) => void }[] = [
    { name: 'a stored tier — it is derived (ADR-0002)', mutate: (n) => Object.assign(n, { tier: 'verified' }) },
    { name: 'authored unlocks — it is inverted (ADR-0002)', mutate: (n) => Object.assign(n.edges, { unlocks: [] }) },
    { name: 'the pre-ADR `updated` field', mutate: (n) => Object.assign(n, { updated: '2026-01-01' }) },
    { name: 'citations nested under provenance', mutate: (n) => Object.assign(n, { provenance: { drafted_at: '2026-01-01', sources: [] } }) },
    { name: 'both review and provenance', mutate: (n) => Object.assign(n, { provenance: { drafted_at: '2026-01-01' } }) },
    {
      name: 'neither review nor provenance',
      mutate: (n) => {
        delete (n as { review?: unknown }).review;
      },
    },
    { name: 'a one-level domain', mutate: (n) => Object.assign(n, { domain: ['Architecture'] }) },
    { name: 'a three-level domain', mutate: (n) => Object.assign(n, { domain: ['A', 'B', 'C'] }) },
    { name: 'a non-kebab id', mutate: (n) => Object.assign(n, { id: 'Not Kebab' }) },
    { name: 'an empty citations array', mutate: (n) => Object.assign(n, { citations: [] }) },
    { name: 'a non-https citation url', mutate: (n) => Object.assign(n, { citations: [{ ref: 'r', title: 't', url: 'http://insecure.example' }] }) },
    { name: 'an unknown viz primitive', mutate: (n) => Object.assign(n.viz, { primitive: 'not-implemented' }) },
    { name: 'two draggable viz parameters', mutate: (n) => n.viz.param_controls.push({ name: 'other', min: 0, max: 1, step: 1 }) },
    { name: 'an edge without a reviewed flag', mutate: (n) => n.edges.requires.push({ id: 'x' } as never) },
    { name: 'a missing depth body', mutate: (n) => delete (n.bodies as { math?: string }).math },
    { name: 'an unrecognised top-level field', mutate: (n) => Object.assign(n, { vibes: 'immaculate' }) },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const node = valid();
      c.mutate(node);
      expect(validate(node)).toBe(false);
    });
  }
});

describe('validate-content over the real /content/nodes', () => {
  it('reports no failures', () => {
    expect(validateContent()).toEqual([]);
  });
});
