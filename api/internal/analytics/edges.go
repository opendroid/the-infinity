package analytics

import (
	"github.com/opendroid/the-infinity/api/internal/publish"
	"github.com/opendroid/the-infinity/api/internal/store"
)

// EdgeLookup answers whether a declared edge runs from one concept to another,
// and of what type.
//
// A LOOKUP OVER THE DERIVATION, NOT A RE-IMPLEMENTATION OF IT. CLAUDE.md is
// explicit that there is one derivation, two implementations, one fixture —
// `internal/publish` computes what the API serves, `web/src/lib/graph.ts`
// computes what the pages render, and both are checked against
// derived.golden.json. A third copy of "what counts as adjacent", living in an
// analytics tool, would be a defect in itself and a quiet one: the report would
// drift out of agreement with the graph it claims to describe, and nothing
// would fail.
type EdgeLookup func(from, to string) (store.EdgeType, bool)

// EdgesFrom builds a lookup over an already-derived graph.
//
// Only the edges declared ON the source concept are consulted, which is what
// makes direction meaningful. Derive has already materialised the other half —
// B requiring A puts B in A's Unlocks — so a reader going A → B follows
// `unlocks`, and one going B → A follows `requires`. The same line in the
// graph, travelled opposite ways, and the difference is a reader advancing
// versus a reader going back for a prerequisite.
func EdgesFrom(g *publish.Graph) EdgeLookup {
	byID := make(map[string]map[string]store.EdgeType, len(g.Concepts))
	for _, c := range g.Concepts {
		out := make(map[string]store.EdgeType)
		for _, e := range c.Edges.Requires {
			out[e.ID] = store.EdgeRequires
		}
		for _, e := range c.Edges.Unlocks {
			out[e.ID] = store.EdgeUnlocks
		}
		// Adjacent last. `checkOneRelationship` in publish already rejects a
		// corpus where a pair holds two relationships, so this is belt rather
		// than behaviour.
		for _, e := range c.Edges.Adjacent {
			out[e.ID] = store.EdgeAdjacent
		}
		byID[c.ID] = out
	}
	return func(from, to string) (store.EdgeType, bool) {
		t, ok := byID[from][to]
		return t, ok
	}
}

// NoEdges knows of no edges at all, so every traversal is reported as a jump.
// Used when the node corpus could not be read: saying so is honest, and
// reporting every jump as an edge would not be.
func NoEdges(string, string) (store.EdgeType, bool) { return "", false }
