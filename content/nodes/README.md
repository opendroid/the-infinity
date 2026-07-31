# `/content/nodes` — concept nodes

One JSON file per concept, named `<id>.json`, where `id` is the kebab-case slug that also
serves as the URL: `speculative-decoding.json` → `theinfinity.ai/c/speculative-decoding`.

These files are the **canonical source of the graph.** Firestore is downstream: CI syncs
this directory to Firestore on merge to `main`. To change content, change the JSON and
open a PR — never edit Firestore directly.

## Shape

Validated in CI against [`../schema/node.schema.json`](../schema) (written in Phase 2):

| Field | Notes |
|---|---|
| `id` | kebab-case slug, matches the filename |
| `title` | display name |
| `domain[]` | e.g. `["Inference", "Optimization"]` |
| `tier` | `verified` \| `frontier` |
| `bodies` | `{ intuition, engineer, math }` — the depth toggle |
| `edges` | `{ requires[], unlocks[], adjacent[] }` — arrays of node ids |
| `viz` | `{ primitive, config }` |
| `citations[]` | real, resolvable source links |
| `updated` | ISO 8601 date |

## Trust tiers

- **`frontier`** — generated and cited, awaiting human review. Teal `#5FD4C4`.
- **`verified`** — reviewed and merged to `main`. Gold `#E5B54A`.

**The merge is the verification.** Nothing else promotes a node.

## Rules

- Edges may only reference node ids that exist, or that are added in the same PR.
- Citations must resolve. No invented papers, no invented authors, no hallucinated arXiv ids.
- Content is authored via Claude Code on the Max subscription. **No paid LLM API calls
  from code or CI.**
