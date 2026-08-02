# `/content/nodes` — concept nodes

One JSON file per concept, named `<id>.json`, where `id` is the kebab-case slug that also
serves as the URL: `speculative-decoding.json` → `theinfinity.ai/c/speculative-decoding`.

These files are the **canonical source of the graph.** Firestore is downstream: CI syncs
this directory to Firestore on merge to `main`. To change content, change the JSON and
open a PR — never edit Firestore directly.

**To write a batch, read [`../README.md`](../README.md)** — the workflow, the prompt, and
what is checked by a machine versus what rests on a human. **For what each field means and
what the schema rejects, read [`../schema/README.md`](../schema/README.md).** This file is
only the shape at a glance.

## Shape

Validated in CI against [`../schema/node.schema.json`](../schema):

| Field | Notes |
|---|---|
| `id` | kebab-case slug, matches the filename |
| `title` | display name |
| `domain[]` | a two-level path, e.g. `["Architecture", "Sparsity"]` |
| `bodies` | `{ intuition, engineer, math }` — the depth toggle |
| `emphasis` | optional; each value a **verbatim** substring of the matching body |
| `edges` | `{ requires[], adjacent[] }` — `{ id, reviewed }` pairs |
| `viz` | `{ primitive, params, param_controls, caption }`, plus optional `caption_engineer` |
| `citations[]` | real, resolvable source links |
| `review` **xor** `provenance` | exactly one. Its presence is the tier |
| `updated_at` | `YYYY-MM-DD` |

## What is *not* authored here

Three fields are derived at publish time and the schema **rejects** them in a file
(ADR-0002). They are the fields most likely to be added back by someone reasoning from the
API's response shape rather than from the schema:

| Not authored | Where it comes from |
|---|---|
| `tier` | derived — a node is `verified` iff it carries `review` |
| `edges.unlocks` | inverted from other nodes' `requires` |
| the joined `domain` string | joined from the `domain` array |

## Trust tiers

- **`frontier`** — generated and cited, awaiting human review. Teal `#5FD4C4`.
- **`verified`** — reviewed and merged to `main`. Gold `#E5B54A`.

**The merge is the verification.** Nothing else promotes a node, and no endpoint may write
`review` — asserted by `TestReviewDoesNotChangeTier`.

## Rules

- Edges may only reference node ids that exist, or that are added in the same PR.
- No pair of concepts may be related in two ways at once.
- Citations must resolve. No invented papers, no invented authors, no hallucinated arXiv
  ids — and "resolve" means someone ran the check with network access, not that CI was green.
- Content is authored via Claude Code on the Max subscription. **No paid LLM API calls from
  code or CI.**
