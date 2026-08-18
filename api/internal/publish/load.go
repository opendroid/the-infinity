// Package publish turns the authored nodes in /content/nodes into the documents
// the API serves, and writes them to Firestore.
//
// It is the only writer of the `concepts` collection. Firestore is downstream of
// git, always: to change a concept, change its JSON and open a pull request
// (ADR-0002).
//
// The derivations here mirror web/src/lib/graph.ts, which does the same work at
// build time for the pre-rendered pages. Both are checked against one shared
// fixture — /content/derived.golden.json — so "the static page and the API
// disagree about the graph" is a failing test rather than a support ticket.
package publish

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/opendroid/the-infinity/api/internal/store"
)

// AuthoredEdge is an edge as written: a target id and whether a human checked
// the claim. Reviewed is authored per edge rather than derived from the target's
// tier — the case that matters is an unchecked claim between two verified nodes.
type AuthoredEdge struct {
	ID       string `json:"id"`
	Reviewed bool   `json:"reviewed"`
}

// AuthoredEdges holds only what a node may declare. `unlocks` is absent by
// construction: it is inverted from other nodes' `requires` at publish time, and
// authoring it would let two files disagree about one fact.
type AuthoredEdges struct {
	Requires []AuthoredEdge `json:"requires"`
	Adjacent []AuthoredEdge `json:"adjacent"`
}

// AuthoredNode mirrors content/schema/node.schema.json exactly.
//
// The shared sub-structs come from package store because their JSON shapes are
// identical either side of publish; the fields that differ — domain, edges, and
// the absent tier — are spelled out here. Decoding rejects unknown fields, so a
// schema change that this struct has not caught up with fails the publish
// instead of silently dropping the new data on the floor.
type AuthoredNode struct {
	ID     string   `json:"id"`
	Title  string   `json:"title"`
	Domain []string `json:"domain"`

	Bodies   store.Bodies    `json:"bodies"`
	Emphasis *store.Emphasis `json:"emphasis,omitempty"`
	Viz      store.Viz       `json:"viz"`

	Edges     AuthoredEdges    `json:"edges"`
	Citations []store.Citation `json:"citations"`
	Origin    []store.Origin   `json:"origin,omitempty"`

	// Exactly one of Review and Prov is present; the schema's oneOf enforces it.
	// Review's presence IS the tier (ADR-0002).
	Review *store.Review     `json:"review,omitempty"`
	Prov   *store.Provenance `json:"provenance,omitempty"`

	UpdatedAt string `json:"updated_at"`
}

// Tier is derived, never authored: a concept is verified iff its node carries a
// reviewer, which is to say iff a human merged the pull request that added one.
func (n AuthoredNode) Tier() store.Tier {
	if n.Review != nil {
		return store.TierVerified
	}
	return store.TierFrontier
}

// domainPath joins the authored two-level array into the served string:
// ["Architecture","Sparsity"] becomes "Architecture / Sparsity", which is what
// the mono eyebrow renders.
func (n AuthoredNode) domainPath() string {
	return strings.Join(n.Domain, " / ")
}

// Load reads every *.json in dir, sorted by id.
//
// Sorted so a publish is byte-identical across runs and across machines:
// ReadDir's order is documented as sorted by filename, but the derived output
// is keyed by id and the two coincide only because the id must match the
// filename — which is checked right here.
func Load(dir string) ([]AuthoredNode, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("reading nodes from %s: %w", dir, err)
	}

	var nodes []AuthoredNode
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		node, err := loadNode(filepath.Join(dir, e.Name()))
		if err != nil {
			return nil, err
		}
		nodes = append(nodes, *node)
	}

	sort.Slice(nodes, func(i, j int) bool { return nodes[i].ID < nodes[j].ID })
	return nodes, nil
}

func loadNode(path string) (*AuthoredNode, error) {
	f, err := os.Open(path) //nolint:gosec // paths come from ReadDir over a directory the caller named
	if err != nil {
		return nil, fmt.Errorf("opening %s: %w", path, err)
	}
	defer func() { _ = f.Close() }() // read-only: a close error cannot lose data

	dec := json.NewDecoder(f)
	dec.DisallowUnknownFields()

	var node AuthoredNode
	if err := dec.Decode(&node); err != nil {
		return nil, fmt.Errorf("decoding %s: %w", path, err)
	}

	// The id is the URL and the Firestore document id. A mismatch would serve
	// the file at a path nothing links to.
	name := strings.TrimSuffix(filepath.Base(path), ".json")
	if node.ID != name {
		return nil, fmt.Errorf("%s: id %q does not match its filename", path, node.ID)
	}
	if !store.ValidConceptID(node.ID) {
		return nil, fmt.Errorf("%s: id %q is not a valid concept slug", path, node.ID)
	}
	return &node, nil
}
