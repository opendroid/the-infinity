# `/content` — the graph

The canonical concept graph, version-controlled alongside the code. Firestore is
downstream of this directory, always: to change a concept, change its JSON and open a
pull request. See [ADR-0002](../docs/adr/0002-content-as-code-and-trust-tiers.md).

```
nodes/                 one JSON file per concept — the id is the filename and the URL
schema/                node.schema.json — the authored shape
derived.golden.json    DERIVED. Do not edit.
```

## `derived.golden.json`

A test fixture, regenerated rather than written:

```zsh
cd api && make golden
```

The graph is derived twice, on purpose. `api/internal/publish` derives what the API serves;
`web/src/lib/graph.ts` derives what the static pages render. Neither can call the other —
the pages must build without the API running (ADR-0003), and the API must answer without a
Node runtime.

What that arrangement cannot survive is the two quietly disagreeing: a reader would open a
page whose edge list and mini-map describe different graphs, and nothing would be broken
enough to notice. So both derive the same values from the same nodes and both are checked
against this file. Change either derivation alone and a test goes red.

It holds only the derived fields — tier, the joined domain path, the resolved edges, the
mini-map layout. Bodies, viz, and citations pass through publish untouched, so copying them
here would make this a second copy of `nodes/` and every prose edit a fixture update.

**If a test says this file is stale**, run `make golden` and read the diff. A content change
should move only the nodes you touched. Anything more means the derivation moved, and the
other implementation needs the same change.
