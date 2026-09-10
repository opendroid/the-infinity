package publish_test

import (
	"strings"
	"testing"
	"time"

	"github.com/opendroid/the-infinity/api/internal/publish"
	"github.com/opendroid/the-infinity/api/internal/store"
)

// node builds a minimal valid authored node. Verified by default — a reviewer is
// one line to remove and two to add back.
func node(id string, opts ...func(*publish.AuthoredNode)) publish.AuthoredNode {
	n := publish.AuthoredNode{
		ID:        id,
		Title:     id,
		Domain:    []string{"Domain", "Sub"},
		Bodies:    store.Bodies{Intuition: "i", Engineer: "e", Math: "m"},
		Viz:       store.Viz{Primitive: "router-dispatch", Caption: "c"},
		Citations: []store.Citation{{Ref: "r", Title: "t", URL: "https://example.invalid"}},
		Review:    &store.Review{ReviewedBy: "someone", ReviewedAt: "2026-01-01"},
		UpdatedAt: "2026-01-01",
	}
	for _, o := range opts {
		o(&n)
	}
	return n
}

func frontier(updated string) func(*publish.AuthoredNode) {
	return func(n *publish.AuthoredNode) {
		n.Review = nil
		n.Prov = &store.Provenance{DraftedAt: updated}
		n.UpdatedAt = updated
	}
}

func requires(edges ...publish.AuthoredEdge) func(*publish.AuthoredNode) {
	return func(n *publish.AuthoredNode) { n.Edges.Requires = edges }
}

func adjacent(edges ...publish.AuthoredEdge) func(*publish.AuthoredNode) {
	return func(n *publish.AuthoredNode) { n.Edges.Adjacent = edges }
}

func title(t string) func(*publish.AuthoredNode) {
	return func(n *publish.AuthoredNode) { n.Title = t }
}

var epoch = time.Date(2026, 8, 2, 0, 0, 0, 0, time.UTC)

func deriveOrFatal(t *testing.T, nodes ...publish.AuthoredNode) *publish.Graph {
	t.Helper()
	g, err := publish.Derive(nodes, epoch)
	if err != nil {
		t.Fatalf("Derive: %v", err)
	}
	return g
}

func conceptOrFatal(t *testing.T, g *publish.Graph, id string) store.Concept {
	t.Helper()
	for _, c := range g.Concepts {
		if c.ID == id {
			return c
		}
	}
	t.Fatalf("no concept %q in the derived graph", id)
	return store.Concept{}
}

func ids(edges store.List[store.Edge]) []string {
	out := make([]string, 0, len(edges))
	for _, e := range edges {
		out = append(out, e.ID)
	}
	return out
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestDeriveTier(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		node publish.AuthoredNode
		want store.Tier
	}{
		{name: "a reviewer makes it verified", node: node("a"), want: store.TierVerified},
		{name: "no reviewer makes it frontier", node: node("a", frontier("2026-01-01")), want: store.TierFrontier},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := conceptOrFatal(t, deriveOrFatal(t, tt.node), "a").Tier; got != tt.want {
				t.Errorf("tier = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestDeriveEdges(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		nodes []publish.AuthoredNode
		id    string
		typ   store.EdgeType
		want  []string
	}{
		{
			name:  "requires is kept as authored",
			nodes: []publish.AuthoredNode{node("a", requires(publish.AuthoredEdge{ID: "b"})), node("b")},
			id:    "a", typ: store.EdgeRequires, want: []string{"b"},
		},
		{
			name:  "unlocks is inverted onto the target",
			nodes: []publish.AuthoredNode{node("a", requires(publish.AuthoredEdge{ID: "b"})), node("b")},
			id:    "b", typ: store.EdgeUnlocks, want: []string{"a"},
		},
		{
			name:  "the target declares nothing itself",
			nodes: []publish.AuthoredNode{node("a", requires(publish.AuthoredEdge{ID: "b"})), node("b")},
			id:    "b", typ: store.EdgeRequires, want: []string{},
		},
		{
			name:  "adjacency declared from one side reaches the other",
			nodes: []publish.AuthoredNode{node("a", adjacent(publish.AuthoredEdge{ID: "b"})), node("b")},
			id:    "b", typ: store.EdgeAdjacent, want: []string{"a"},
		},
		{
			name: "adjacency declared from both sides lands once",
			nodes: []publish.AuthoredNode{
				node("a", adjacent(publish.AuthoredEdge{ID: "b"})),
				node("b", adjacent(publish.AuthoredEdge{ID: "a"})),
			},
			id: "a", typ: store.EdgeAdjacent, want: []string{"b"},
		},
		{
			name: "edges are sorted by id, whatever order they were written in",
			nodes: []publish.AuthoredNode{
				node("a", requires(publish.AuthoredEdge{ID: "z"}, publish.AuthoredEdge{ID: "m"}, publish.AuthoredEdge{ID: "b"})),
				node("z"), node("m"), node("b"),
			},
			id: "a", typ: store.EdgeRequires, want: []string{"b", "m", "z"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			c := conceptOrFatal(t, deriveOrFatal(t, tt.nodes...), tt.id)
			var got []string
			switch tt.typ {
			case store.EdgeRequires:
				got = ids(c.Edges.Requires)
			case store.EdgeUnlocks:
				got = ids(c.Edges.Unlocks)
			case store.EdgeAdjacent:
				got = ids(c.Edges.Adjacent)
			}
			if !equal(got, tt.want) {
				t.Errorf("%s = %v, want %v", tt.typ, got, tt.want)
			}
		})
	}
}

// Adjacency is one relationship written from two places, so it must land once
// whichever side declares it. It used to also need reconciling: the two sides
// each carried a `reviewed` flag and could disagree, and keeping the first
// arrival would have settled that on slug order. ADR-0022 removed the flag, so
// there is nothing left to disagree about — id, title and tier all come from
// the target rather than from whoever wrote the edge.
func TestDeriveLandsTwoSidedAdjacencyOnce(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		first, second publish.AuthoredNode
	}{
		{
			name:   "a declares it first",
			first:  node("a", adjacent(publish.AuthoredEdge{ID: "b"})),
			second: node("b"),
		},
		{
			name:   "both sides declare it",
			first:  node("a", adjacent(publish.AuthoredEdge{ID: "b"})),
			second: node("b", adjacent(publish.AuthoredEdge{ID: "a"})),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			g := deriveOrFatal(t, tt.first, tt.second)
			for _, id := range []string{"a", "b"} {
				edges := conceptOrFatal(t, g, id).Edges.Adjacent
				if len(edges) != 1 {
					t.Fatalf("%s has %d adjacent edges, want 1", id, len(edges))
				}
			}
		})
	}
}

func TestDeriveDenormalisesTheTarget(t *testing.T) {
	t.Parallel()

	g := deriveOrFatal(t,
		node("a", requires(publish.AuthoredEdge{ID: "b"})),
		node("b", title("Bee"), frontier("2026-01-01")))

	edge := conceptOrFatal(t, g, "a").Edges.Requires[0]
	if edge.Title != "Bee" || edge.Tier != store.TierFrontier {
		t.Errorf("edge = %+v, want the target's title and tier", edge)
	}
}

func TestDeriveJoinsTheDomainPath(t *testing.T) {
	t.Parallel()

	n := node("a")
	n.Domain = []string{"Architecture", "Sparsity"}

	if got := conceptOrFatal(t, deriveOrFatal(t, n), "a").Domain; got != "Architecture / Sparsity" {
		t.Errorf("domain = %q, want %q", got, "Architecture / Sparsity")
	}
}

func TestDeriveRejects(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		nodes []publish.AuthoredNode
		want  string
	}{
		{
			name:  "an edge to a node that does not exist",
			nodes: []publish.AuthoredNode{node("a", requires(publish.AuthoredEdge{ID: "ghost"}))},
			want:  "does not exist",
		},
		{
			name:  "an adjacent edge to a node that does not exist",
			nodes: []publish.AuthoredNode{node("a", adjacent(publish.AuthoredEdge{ID: "ghost"}))},
			want:  "does not exist",
		},
		{
			name:  "an edge to itself, which would put a node in its own mini-map",
			nodes: []publish.AuthoredNode{node("a", requires(publish.AuthoredEdge{ID: "a"}))},
			want:  "edge to itself",
		},
		{
			name:  "two nodes claiming one id",
			nodes: []publish.AuthoredNode{node("a"), node("a")},
			want:  "claim the id",
		},
		{
			// Two circles for one concept at two coordinates, and a link drawn
			// to whichever the renderer resolved last.
			name: "one target in two authored groups",
			nodes: []publish.AuthoredNode{
				node("a", requires(publish.AuthoredEdge{ID: "b"}), adjacent(publish.AuthoredEdge{ID: "b"})),
				node("b"),
			},
			want: "related in two ways at once",
		},
		{
			// The same fault via the derived inverse, which neither file looks
			// wrong on its own: a circular prerequisite has no first concept.
			name: "a mutual requires",
			nodes: []publish.AuthoredNode{
				node("a", requires(publish.AuthoredEdge{ID: "b"})),
				node("b", requires(publish.AuthoredEdge{ID: "a"})),
			},
			want: "related in two ways at once",
		},
		{
			name: "adjacency that is also a prerequisite, declared from opposite sides",
			nodes: []publish.AuthoredNode{
				node("a", requires(publish.AuthoredEdge{ID: "b"})),
				node("b", adjacent(publish.AuthoredEdge{ID: "a"})),
			},
			want: "related in two ways at once",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			_, err := publish.Derive(tt.nodes, epoch)
			if err == nil {
				t.Fatal("Derive succeeded, want an error — a broken graph must not reach Firestore")
			}
			if !strings.Contains(err.Error(), tt.want) {
				t.Errorf("error = %q, want it to mention %q", err, tt.want)
			}
		})
	}
}

func TestDeriveStats(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		nodes []publish.AuthoredNode
		want  store.Stats
	}{
		{
			name:  "a frontier node updated today counts as growth",
			nodes: []publish.AuthoredNode{node("a", frontier("2026-08-02"))},
			want:  store.Stats{Concepts: 1, GrewThisWeek: 1},
		},
		{
			name:  "exactly seven days ago is still inside the window",
			nodes: []publish.AuthoredNode{node("a", frontier("2026-07-26"))},
			want:  store.Stats{Concepts: 1, GrewThisWeek: 1},
		},
		{
			name:  "eight days ago is outside it",
			nodes: []publish.AuthoredNode{node("a", frontier("2026-07-25"))},
			want:  store.Stats{Concepts: 1, GrewThisWeek: 0},
		},
		{
			name: "a verified node is not growth, however recently it changed",
			nodes: []publish.AuthoredNode{node("a", func(n *publish.AuthoredNode) {
				n.UpdatedAt = "2026-08-02"
			})},
			want: store.Stats{Concepts: 1, GrewThisWeek: 0},
		},
		{
			name:  "an unparseable date is not counted rather than fatal",
			nodes: []publish.AuthoredNode{node("a", frontier("not-a-date"))},
			want:  store.Stats{Concepts: 1, GrewThisWeek: 0},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := deriveOrFatal(t, tt.nodes...).Stats; got != tt.want {
				t.Errorf("stats = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestNeighborhoodLayout(t *testing.T) {
	t.Parallel()

	g := deriveOrFatal(t,
		node("center", requires(publish.AuthoredEdge{ID: "req"}),
			adjacent(publish.AuthoredEdge{ID: "adj"})),
		node("req"),
		node("adj"),
		node("unl", requires(publish.AuthoredEdge{ID: "center"})),
	)

	n, ok := g.Neighborhoods["center"]
	if !ok {
		t.Fatal("no neighborhood for center")
	}

	at := func(id string) store.MiniMapNode {
		t.Helper()
		for _, p := range n.Nodes {
			if p.ID == id {
				return p
			}
		}
		t.Fatalf("%q is missing from the mini-map", id)
		return store.MiniMapNode{}
	}

	if at("req").X >= n.Center.X {
		t.Error("a prerequisite was not placed left of centre")
	}
	if at("unl").X <= n.Center.X {
		t.Error("an unlocked concept was not placed right of centre")
	}
	for _, p := range append([]store.MiniMapNode{n.Center}, n.Nodes...) {
		if p.X < 0 || p.X > 240 || p.Y < 0 || p.Y > 132 {
			t.Errorf("%s at (%v,%v) is outside the 240x132 viewBox", p.ID, p.X, p.Y)
		}
	}
}

// The direction is the relationship, not the traversal — a prerequisite points
// inwards. /docs/openapi.yaml's example says so, and the mini-map is the only
// place a reader can see which way an edge runs.
func TestNeighborhoodLinkDirection(t *testing.T) {
	t.Parallel()

	g := deriveOrFatal(t,
		node("center", requires(publish.AuthoredEdge{ID: "req"})),
		node("req"),
		node("unl", requires(publish.AuthoredEdge{ID: "center"})),
	)

	tests := []struct {
		typ      store.EdgeType
		from, to string
	}{
		{typ: store.EdgeRequires, from: "req", to: "center"},
		{typ: store.EdgeUnlocks, from: "center", to: "unl"},
	}

	links := g.Neighborhoods["center"].Links
	for _, tt := range tests {
		t.Run(string(tt.typ), func(t *testing.T) {
			for _, l := range links {
				if l.Type == tt.typ {
					if l.From != tt.from || l.To != tt.to {
						t.Errorf("%s runs %s→%s, want %s→%s", tt.typ, l.From, l.To, tt.from, tt.to)
					}
					return
				}
			}
			t.Errorf("no %s link in the mini-map", tt.typ)
		})
	}
}

// An empty group must serialise as [] rather than null: openapi.yaml marks every
// edge group required, and a client doing edges.requires.map(...) crashes on
// null — on exactly the leaf nodes the empty state exists for.
func TestDeriveEmptyGroupsAreNotNull(t *testing.T) {
	t.Parallel()

	c := conceptOrFatal(t, deriveOrFatal(t, node("a")), "a")
	for name, group := range map[string]store.List[store.Edge]{
		"requires": c.Edges.Requires,
		"unlocks":  c.Edges.Unlocks,
		"adjacent": c.Edges.Adjacent,
	} {
		encoded, err := group.MarshalJSON()
		if err != nil {
			t.Fatalf("marshalling %s: %v", name, err)
		}
		if string(encoded) != "[]" {
			t.Errorf("%s marshals as %s, want []", name, encoded)
		}
	}
}
