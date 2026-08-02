# `/content/schema` — JSON schemas

[`node.schema.json`](node.schema.json) — JSON Schema draft 2020-12. Describes the
**authored** shape of a concept: what a file in `/content/nodes` may contain, not what the
API serves.

## What it forbids matters more than what it allows

`additionalProperties: false` is doing the real work. ADR-0002 decided that `tier` and
`edges.unlocks` are *derived*, and the schema is what stops them creeping back into a file
in six months:

| Rejected | Why |
|---|---|
| `tier` | Derived — a node is verified iff it carries `review` |
| `edges.unlocks` | Inverted from other nodes' `requires` at publish |
| `updated` | Renamed to `updated_at` |
| `provenance.sources` | Citations are top-level and tier-independent |
| both or neither of `review` / `provenance` | Exactly one, and it determines the tier |

## Four invariants live outside the schema

JSON Schema cannot express a constraint that spans fields or files, so
[`web/scripts/validate-content.mjs`](../../web/scripts/validate-content.mjs) checks:

- every `emphasis` phrase is a **verbatim substring** of the body it belongs to — edit one
  without the other and the highlight silently disappears
- every edge target resolves to a node that exists, and no node links to itself
- `id` matches the filename, because the id is the URL
- each `viz.param_controls[].name` names a key that exists in `viz.params`, so a slider
  cannot be wired to nothing

```zsh
cd web && npm run validate:content   # exits 1 on any failure
cd web && npm test                   # the same checks, plus the schema's rejection cases
```

A node that does not validate does not merge. There is no override.
