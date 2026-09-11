package analytics

import (
	"testing"
	"time"

	"github.com/opendroid/the-infinity/api/internal/publish"
	"github.com/opendroid/the-infinity/api/internal/store"
)

/**
 * A graph built by the REAL derivation, not by hand (#426).
 *
 * That is the point of the test as much as its fixture. `unlocks` is never
 * authored — publish inverts it from other nodes' `requires` — so a lookup
 * assembled from hand-written maps could agree with itself forever while
 * disagreeing with the graph the API serves and the pages render. Going through
 * publish.Derive is what makes "one derivation" true here rather than claimed.
 */
func derived(t *testing.T, nodes []publish.AuthoredNode) *publish.Graph {
	t.Helper()
	g, err := publish.Derive(nodes, time.Date(2026, 9, 11, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("deriving the fixture graph: %v", err)
	}
	return g
}

func node(id string, requires, adjacent []string) publish.AuthoredNode {
	n := publish.AuthoredNode{
		ID:        id,
		Title:     id,
		Domain:    []string{"Test"},
		Bodies:    store.Bodies{Intuition: "i", Engineer: "e", Math: "m"},
		Viz:       store.Viz{Primitive: "token-stream", Caption: "c"},
		Citations: []store.Citation{{Ref: "r", Title: "t", URL: "https://arxiv.org/abs/1"}},
		Review:    &store.Review{ReviewedBy: "someone", ReviewedAt: "2026-09-01"},
		UpdatedAt: "2026-09-01",
	}
	for _, r := range requires {
		n.Edges.Requires = append(n.Edges.Requires, publish.AuthoredEdge{ID: r})
	}
	for _, a := range adjacent {
		n.Edges.Adjacent = append(n.Edges.Adjacent, publish.AuthoredEdge{ID: a})
	}
	return n
}

func TestEdgesFrom(t *testing.T) {
	// rotary requires positional; attention and gnn are adjacent; nothing
	// connects backprop to qkv.
	g := derived(t, []publish.AuthoredNode{
		node("positional-encoding", nil, nil),
		node("rotary-position-embedding", []string{"positional-encoding"}, nil),
		node("attention", nil, []string{"graph-neural-network"}),
		node("graph-neural-network", nil, nil),
		node("backpropagation", nil, nil),
		node("query-key-value", nil, nil),
	})
	edge := EdgesFrom(g)

	cases := []struct {
		name     string
		from, to string
		want     store.EdgeType
		declared bool
	}{
		{
			// Direction is the whole point: the same line, travelled forwards,
			// is a reader advancing.
			name: "along an unlocks edge, which nobody authored",
			from: "positional-encoding", to: "rotary-position-embedding",
			want: store.EdgeUnlocks, declared: true,
		},
		{
			name: "back along the same line is a prerequisite",
			from: "rotary-position-embedding", to: "positional-encoding",
			want: store.EdgeRequires, declared: true,
		},
		{
			name: "adjacent, as authored",
			from: "attention", to: "graph-neural-network",
			want: store.EdgeAdjacent, declared: true,
		},
		{
			name: "adjacent is symmetric after derivation",
			from: "graph-neural-network", to: "attention",
			want: store.EdgeAdjacent, declared: true,
		},
		{
			// The live run reported this pair as an edge. It is not one.
			name: "two unconnected concepts",
			from: "backpropagation", to: "query-key-value",
			declared: false,
		},
		{name: "a concept that does not exist", from: "nope", to: "attention", declared: false},
		{name: "a target that does not exist", from: "attention", to: "nope", declared: false},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := edge(c.from, c.to)
			if ok != c.declared {
				t.Fatalf("edge(%q, %q) declared = %v, want %v", c.from, c.to, ok, c.declared)
			}
			if ok && got != c.want {
				t.Errorf("edge(%q, %q) = %q, want %q", c.from, c.to, got, c.want)
			}
		})
	}
}

func TestNoEdgesKnowsNothing(t *testing.T) {
	if _, ok := NoEdges("attention", "softmax"); ok {
		t.Error("NoEdges must declare no edge, or every jump is reported as one")
	}
}
