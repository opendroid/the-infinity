package publish

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/opendroid/the-infinity/api/internal/store"
)

// The mini-map viewBox, and the insets that place a node inside it. Coordinates
// are computed here rather than in the browser (ADR-0003), so the map is
// identical on every render and never jitters between two loads of one page.
const (
	viewBoxW = 240.0
	viewBoxH = 132.0
	// Requires sit in a left column, unlocks in a right one, adjacent along the
	// top and bottom edges — the placement carries the same meaning as the edge
	// type rather than being arbitrary.
	columnInset = 40.0
	rowInset    = 22.0
)

// growthWindow is what "grew this week" counts back over.
const growthWindow = 7 * 24 * time.Hour

// Graph is everything a publish writes: one document per concept, one mini-map
// per concept, and the single counters/stats document.
type Graph struct {
	Concepts      []store.Concept
	Neighborhoods map[string]store.Neighborhood
	Stats         store.Stats
}

// Derive resolves authored nodes into served documents.
//
// now is a parameter rather than a call to time.Now so the output is a pure
// function of its inputs — the only field that moves with the clock is
// Stats.GrewThisWeek, and a publish that cannot be reproduced from the same
// commit is one nobody can debug.
func Derive(nodes []AuthoredNode, now time.Time) (*Graph, error) {
	byID := make(map[string]AuthoredNode, len(nodes))
	for _, n := range nodes {
		if _, dup := byID[n.ID]; dup {
			return nil, fmt.Errorf("two nodes claim the id %q", n.ID)
		}
		byID[n.ID] = n
	}

	concepts, err := resolve(nodes, byID)
	if err != nil {
		return nil, err
	}

	neighborhoods := make(map[string]store.Neighborhood, len(concepts))
	for _, c := range concepts {
		neighborhoods[c.ID] = neighborhood(c)
	}

	return &Graph{
		Concepts:      concepts,
		Neighborhoods: neighborhoods,
		Stats:         stats(nodes, now),
	}, nil
}

// resolve denormalises every edge with its target's title and tier, inverts
// requires into unlocks, and symmetrises adjacency.
//
// A dangling edge is an error, not a skipped row: it is a content bug, and
// failing the publish is far cheaper than serving a graph with a hole in it.
func resolve(nodes []AuthoredNode, byID map[string]AuthoredNode) ([]store.Concept, error) {
	out := make(map[string]*store.Concept, len(nodes))
	order := make([]string, 0, len(nodes))

	for _, n := range nodes {
		out[n.ID] = &store.Concept{
			ID:        n.ID,
			Title:     n.Title,
			Domain:    n.domainPath(),
			Tier:      n.Tier(),
			Bodies:    n.Bodies,
			Emphasis:  n.Emphasis,
			Viz:       n.Viz,
			Edges:     store.Edges{},
			Citations: n.Citations,
			Origin:    n.Origin,
			Review:    n.Review,
			Prov:      n.Prov,
			UpdatedAt: n.UpdatedAt,
		}
		order = append(order, n.ID)
	}

	// push adds an edge, or merges it into the one already naming that target so
	// adjacency declared from both sides lands once.
	//
	// The merge takes the AND of `reviewed`, not the first arrival. When the two
	// sides disagree — `a → b` checked, `b → a` unchecked — first-wins would
	// resolve on slug order, and half the time it would publish an explicitly
	// unchecked claim as a verified one: solid line, no dashed legend, nothing
	// to tell a reader the relationship was never confirmed. An unreviewed
	// assertion from either side has to survive.
	push := func(nodeID string, group func(*store.Edges) *store.List[store.Edge], edge store.Edge) {
		c, ok := out[nodeID]
		if !ok {
			return
		}
		g := group(&c.Edges)
		for i := range *g {
			if (*g)[i].ID == edge.ID {
				(*g)[i].Reviewed = (*g)[i].Reviewed && edge.Reviewed
				return
			}
		}
		*g = append(*g, edge)
	}

	requires := func(e *store.Edges) *store.List[store.Edge] { return &e.Requires }
	unlocks := func(e *store.Edges) *store.List[store.Edge] { return &e.Unlocks }
	adjacent := func(e *store.Edges) *store.List[store.Edge] { return &e.Adjacent }

	// target is the denormalised row rendered on the page: the edge's own
	// reviewed flag, plus the target's current title and tier.
	target := func(from string, e AuthoredEdge) (store.Edge, error) {
		t, ok := byID[e.ID]
		if !ok {
			return store.Edge{}, fmt.Errorf("node %q has an edge to %q, which does not exist", from, e.ID)
		}
		if e.ID == from {
			return store.Edge{}, fmt.Errorf("node %q has an edge to itself", from)
		}
		return store.Edge{ID: t.ID, Title: t.Title, Tier: t.Tier(), Reviewed: e.Reviewed}, nil
	}

	for _, n := range nodes {
		self := store.Edge{ID: n.ID, Title: n.Title, Tier: n.Tier()}

		for _, e := range n.Edges.Requires {
			row, err := target(n.ID, e)
			if err != nil {
				return nil, err
			}
			push(n.ID, requires, row)
			// The inverse: if A requires B then B unlocks A. Authored once.
			inverse := self
			inverse.Reviewed = e.Reviewed
			push(e.ID, unlocks, inverse)
		}

		for _, e := range n.Edges.Adjacent {
			row, err := target(n.ID, e)
			if err != nil {
				return nil, err
			}
			push(n.ID, adjacent, row)
			// Adjacency is symmetric — declare it from whichever side reads better.
			back := self
			back.Reviewed = e.Reviewed
			push(e.ID, adjacent, back)
		}
	}

	concepts := make([]store.Concept, 0, len(order))
	for _, id := range order {
		c := out[id]
		for _, g := range []*store.List[store.Edge]{&c.Edges.Requires, &c.Edges.Unlocks, &c.Edges.Adjacent} {
			sortEdges(*g)
		}
		if err := checkOneRelationship(*c); err != nil {
			return nil, err
		}
		concepts = append(concepts, *c)
	}
	sort.Slice(concepts, func(i, j int) bool { return concepts[i].ID < concepts[j].ID })
	return concepts, nil
}

func sortEdges(edges store.List[store.Edge]) {
	sort.Slice(edges, func(i, j int) bool { return edges[i].ID < edges[j].ID })
}

// checkOneRelationship enforces that a pair of concepts is related in exactly
// one way.
//
// Two concepts in two groups at once is a content error with no coherent
// reading — "B is a prerequisite for A" and "B is merely adjacent to A" cannot
// both hold — and mutual `requires` lands here too, which is a circular
// prerequisite: neither concept can be the one you learn first.
//
// It is also the condition that breaks the mini-map. The layout places one
// circle per edge per group, so a target in two groups gets two circles at two
// coordinates, and the renderer — which resolves a link's endpoints by id —
// draws one line to the wrong circle and orphans the other. Rejecting the graph
// is better than laying it out defensively: the defensive version renders
// something plausible for content that means nothing.
func checkOneRelationship(c store.Concept) error {
	groups := []struct {
		name  store.EdgeType
		edges store.List[store.Edge]
	}{
		{store.EdgeRequires, c.Edges.Requires},
		{store.EdgeUnlocks, c.Edges.Unlocks},
		{store.EdgeAdjacent, c.Edges.Adjacent},
	}

	seen := make(map[string]store.EdgeType, len(groups))
	for _, g := range groups {
		for _, e := range g.edges {
			if first, dup := seen[e.ID]; dup {
				return fmt.Errorf(
					"concepts %q and %q are related in two ways at once (%s and %s): a pair of concepts has exactly one relationship",
					c.ID, e.ID, first, g.name)
			}
			seen[e.ID] = g.name
		}
	}
	return nil
}

// neighborhood lays out one concept's immediate graph, deterministically.
//
// The link direction follows the relationship rather than the traversal: a
// requires edge runs from the prerequisite into the centre, an unlocks edge runs
// out of it. That is what /docs/openapi.yaml documents and what the arrowless
// mini-map still needs in order to dash the unreviewed ones correctly.
func neighborhood(c store.Concept) store.Neighborhood {
	cx, cy := viewBoxW/2, viewBoxH/2
	center := store.MiniMapNode{ID: c.ID, Title: c.Title, Tier: c.Tier, X: cx, Y: cy}

	column := func(edges store.List[store.Edge], x float64) []store.MiniMapNode {
		placed := make([]store.MiniMapNode, 0, len(edges))
		for i, e := range edges {
			placed = append(placed, store.MiniMapNode{
				ID: e.ID, Title: e.Title, Tier: e.Tier,
				X: x,
				// Spread evenly down the column: n items get n+1 gaps.
				Y: math.Round(viewBoxH * float64(i+1) / float64(len(edges)+1)),
			})
		}
		return placed
	}

	row := func(edges store.List[store.Edge]) []store.MiniMapNode {
		placed := make([]store.MiniMapNode, 0, len(edges))
		for i, e := range edges {
			y := rowInset
			if i%2 != 0 {
				y = viewBoxH - rowInset
			}
			placed = append(placed, store.MiniMapNode{
				ID: e.ID, Title: e.Title, Tier: e.Tier,
				X: math.Round(viewBoxW * float64(i+1) / float64(len(edges)+1)),
				Y: y,
			})
		}
		return placed
	}

	nodes := store.List[store.MiniMapNode]{}
	nodes = append(nodes, column(c.Edges.Requires, columnInset)...)
	nodes = append(nodes, column(c.Edges.Unlocks, viewBoxW-columnInset)...)
	nodes = append(nodes, row(c.Edges.Adjacent)...)

	placed := make(map[string]bool, len(nodes))
	for _, n := range nodes {
		placed[n.ID] = true
	}

	links := store.List[store.MiniMapLink]{}
	groups := []struct {
		typ   store.EdgeType
		edges store.List[store.Edge]
	}{
		{store.EdgeRequires, c.Edges.Requires},
		{store.EdgeUnlocks, c.Edges.Unlocks},
		{store.EdgeAdjacent, c.Edges.Adjacent},
	}
	for _, g := range groups {
		for _, e := range g.edges {
			if !placed[e.ID] {
				continue
			}
			from, to := c.ID, e.ID
			if g.typ == store.EdgeRequires {
				from, to = e.ID, c.ID
			}
			links = append(links, store.MiniMapLink{From: from, To: to, Type: g.typ, Reviewed: e.Reviewed})
		}
	}

	return store.Neighborhood{Center: center, Nodes: nodes, Links: links}
}

// stats backs the landing pulse line.
//
// GrewThisWeek counts frontier nodes only: the number is there to say the graph
// is still growing, and a verified node is one that stopped being new.
// An unparseable date is not counted rather than fatal — the schema already
// requires YYYY-MM-DD, so reaching here means the counter is the least of it.
func stats(nodes []AuthoredNode, now time.Time) store.Stats {
	cutoff := now.Add(-growthWindow)
	grew := 0
	for _, n := range nodes {
		if n.Tier() != store.TierFrontier {
			continue
		}
		updated, err := time.Parse(time.DateOnly, n.UpdatedAt)
		if err != nil {
			continue
		}
		if !updated.Before(cutoff) {
			grew++
		}
	}
	return store.Stats{Concepts: len(nodes), GrewThisWeek: grew}
}
