package publish

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"

	"github.com/opendroid/the-infinity/api/internal/store"
)

// The golden file is the contract between two implementations of one
// derivation: this package, which produces what the API serves, and
// web/src/lib/graph.ts, which produces what the static pages render. Both read
// the same authored nodes; if they ever stop agreeing, one of two tests fails
// rather than a reader seeing a page whose mini-map contradicts its edge list.
//
// It holds only the derived fields. Bodies, viz, and citations pass through
// publish untouched, so copying them here would make the fixture a second copy
// of /content and every prose edit a golden update.
const goldenNote = "DERIVED, NOT AUTHORED. Regenerate with `cd api && make golden`. " +
	"Checked by api/internal/publish (Go) and web/src/lib/golden.test.ts (TypeScript) " +
	"so the served graph and the pre-rendered graph cannot drift apart."

// GoldenConcept is a concept reduced to what publish computed about it.
type GoldenConcept struct {
	ID     string      `json:"id"`
	Title  string      `json:"title"`
	Domain string      `json:"domain"`
	Tier   store.Tier  `json:"tier"`
	Edges  store.Edges `json:"edges"`
}

// GoldenNeighborhood is a mini-map plus the id it belongs to. The embedded
// Neighborhood is the served type itself, so the fixture cannot describe a shape
// the API does not return.
type GoldenNeighborhood struct {
	ID string `json:"id"`
	store.Neighborhood
}

type GoldenFile struct {
	Note          string               `json:"_note"`
	Concepts      []GoldenConcept      `json:"concepts"`
	Neighborhoods []GoldenNeighborhood `json:"neighborhoods"`
}

// Golden renders g as the shared fixture, indented and newline-terminated so a
// regeneration shows up as a readable diff.
func Golden(g *Graph) ([]byte, error) {
	file := GoldenFile{
		Note:          goldenNote,
		Concepts:      make([]GoldenConcept, 0, len(g.Concepts)),
		Neighborhoods: make([]GoldenNeighborhood, 0, len(g.Neighborhoods)),
	}

	for _, c := range g.Concepts {
		file.Concepts = append(file.Concepts, GoldenConcept{
			ID: c.ID, Title: c.Title, Domain: c.Domain, Tier: c.Tier, Edges: c.Edges,
		})
		file.Neighborhoods = append(file.Neighborhoods, GoldenNeighborhood{
			ID: c.ID, Neighborhood: g.Neighborhoods[c.ID],
		})
	}
	// Concepts already arrive sorted; sorting again costs nothing and makes the
	// fixture's ordering a property of this function rather than of its caller.
	sort.Slice(file.Concepts, func(i, j int) bool { return file.Concepts[i].ID < file.Concepts[j].ID })
	sort.Slice(file.Neighborhoods, func(i, j int) bool { return file.Neighborhoods[i].ID < file.Neighborhoods[j].ID })

	// An encoder rather than MarshalIndent, with HTML escaping off: the default
	// rewrites & < > as & < >, which would turn a concept title
	// containing an ampersand into an unreadable diff for no benefit — this file
	// is never embedded in a page. The encoder terminates with a newline itself.
	//
	// It reaches the top level only. Anything inside a store.List — every edge,
	// mini-map node, and link — is encoded by List.MarshalJSON, which calls
	// json.Marshal with escaping on, and the outer encoder compacts the result
	// without undoing it. Left as is: turning escaping off in List would change
	// every API response to fix a fixture's readability, which is the wrong
	// trade. A title with an ampersand renders escaped in the nested entries and
	// plain at the top; both compare correctly, since the web side parses this
	// file rather than diffing its bytes.
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(file); err != nil {
		return nil, fmt.Errorf("rendering the golden fixture: %w", err)
	}
	return buf.Bytes(), nil
}
