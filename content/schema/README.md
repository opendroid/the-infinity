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

## Viz primitives — a closed set, extended only by a deliberate schema change

`viz.primitive` names **a reusable visual shape, not a drawing of one concept.** The same
primitive serves any concept whose idea has that shape: `update-spectrum` carries Muon's
singular values, the feed-forward block's parameter share, and a relaxed gate's output
distribution, because all three are *this distribution against that one*. Choosing a
primitive is choosing a shape, and the params re-point it.

| Primitive | What it shows | Params it reads |
|---|---|---|
| `router-dispatch` | A grid of cells, one per routed unit, shaded by how strongly each is selected — solid = first choice, faint = second, outlined = not selected. A per-unit load row underneath. | `experts` sets the grid width. `top_k`, `capacity_factor`, `devices` re-point it. |
| `update-spectrum` | Two bar groups side by side, 8 bars each: one distribution against another. The control morphs the second toward or away from the first. | `bars` sets the group width. `ns_steps`, `gate_temperature`, `d_model`/`d_ff` re-point it. |
| `attention-heatmap` | A query × key grid, cell opacity proportional to attention weight; causal-masked, since every concept that needs it is decoder-side. | `tokens` sets the grid side. `heads`, `temperature` re-point it. |
| `loss-curve` | Loss against training step, plotted as a line on a `--nebula` grid. A second faint line where a comparison run is meaningful. | `steps` sets the x extent. `lr`, `warmup`, `batch` re-point it. |

### `caption_engineer` — optional, and only where the picture actually changes

A primitive may render differently per depth ([ADR-0005](../../docs/adr/0005-depth-coupled-viz.md)):
`router-dispatch` is a token × expert grid at Intuition and per-expert utilisation bars at
Engineer. One caption cannot describe both — *"solid cells are each token's first-choice
expert"* names marks that do not exist in the bars.

So `viz.caption_engineer` replaces `viz.caption` at the Engineer depth, and **is omitted by
every node whose primitive draws one thing.** Three of the five committed nodes have no use
for it. That is why it is an optional sibling rather than `caption: {intuition, engineer,
math}`: mirroring `bodies` would have made every author write three captions to solve a
problem two nodes have, and would have modelled three depths when the rendering mechanism
distinguishes two.

The rule it encodes is the one worth keeping: **no caption may describe a mark absent from
the rendering it appears under.** Component-owned marks — a dashed cell, a bar — are
explained by the primitive's own depth-scoped legend; the caption carries the concept.

Two constraints on params that are easy to trip over:

- **Params are numbers only** (`additionalProperties: { type: number }`), so a flag has to be
  encoded `0`/`1`. That is deliberate — a param has to be draggable, and you cannot drag a
  string — but it means a primitive wanting a genuine mode switch is telling you it should
  be two primitives.
- **The schema does not check that a primitive gets the params it needs.** `attention-heatmap`
  with only `{ "lr": 3 }` validates. Encoding per-primitive requirements as `if`/`then` would
  put the component's contract in the schema, where it would drift from the component the
  first time one changed; the component owns its own defaults instead, and
  `param_controls[].name` naming a key that exists in `params` is the invariant actually
  worth enforcing.

### The rule: the enum grows by deliberate schema change, one name per landed primitive

The set is closed because a typo has no other backstop — a content PR naming
`atention-heatmap` would validate against an open schema, merge, publish, and reach a
reader as a broken island. Closing it moves that failure to CI, where it is a red check
instead of a bad page.

So extending it is its own reviewed decision, never a line that rides along in a content
PR. The four names above are the **v1 set**, fixed by
[#46](https://github.com/opendroid/the-infinity/issues/46); `attention-heatmap` and
`loss-curve` were added there ahead of their components (#48–#51) precisely so that the
schema change was reviewed once, on its own, rather than four times inside four feature
PRs.

That ordering has one consequence worth stating, because it is a promise the schema cannot
keep on its own: **a name in the enum does not mean a component answers to it.** Until the
matching primitive ships, `VizIsland` renders the same placeholder for every value, so an
unimplemented primitive degrades to a generic shape rather than to nothing. Each primitive
component must keep that fallback when it lands — a `switch` on `primitive` with no default
is how the closed enum stops protecting anybody.

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
