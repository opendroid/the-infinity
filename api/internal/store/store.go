// Package store defines the data the API serves and the interface it reads and
// writes through.
//
// Handlers depend on Store, never on Firestore directly, so they unit-test
// against Fake without an emulator. The types mirror /docs/openapi.yaml.
package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
)

// ErrNotFound is returned when a lookup finds nothing. Handlers match it with
// errors.Is rather than comparing strings, so wrapping stays lossless.
var ErrNotFound = errors.New("not found")

// Tier is derived at publish time, never authored: a concept is Verified iff
// its node carries a reviewer. See ADR-0002.
type Tier string

const (
	TierVerified Tier = "verified"
	TierFrontier Tier = "frontier"
)

// Depth is which body a reader had open.
type Depth string

const (
	DepthIntuition Depth = "intuition"
	DepthEngineer  Depth = "engineer"
	DepthMath      Depth = "math"
)

// ValidDepth reports whether d is one of the three depths.
func ValidDepth(d Depth) bool {
	return d == DepthIntuition || d == DepthEngineer || d == DepthMath
}

// EdgeType is the typed relationship between two concepts.
type EdgeType string

const (
	EdgeRequires EdgeType = "requires"
	EdgeUnlocks  EdgeType = "unlocks"
	EdgeAdjacent EdgeType = "adjacent"
)

// Edge is denormalized for serving: it carries the target's title and tier so
// a row renders without extra reads. Node JSON stores ids alone.
type Edge struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Tier  Tier   `json:"tier"`
	// Reviewed is authored per edge, not derived from the target's tier — the
	// case that matters is an unchecked claim between two verified concepts.
	Reviewed bool `json:"reviewed"`
}

type Citation struct {
	Ref   string `json:"ref"`
	Title string `json:"title"`
	URL   string `json:"url"`
}

type ParamControl struct {
	Name string  `json:"name"`
	Min  float64 `json:"min"`
	Max  float64 `json:"max"`
	Step float64 `json:"step"`
}

type Viz struct {
	Primitive     string             `json:"primitive"`
	Params        map[string]float64 `json:"params"`
	ParamControls []ParamControl     `json:"param_controls"`
	Caption       string             `json:"caption"`
}

type Bodies struct {
	Intuition string `json:"intuition"`
	Engineer  string `json:"engineer"`
	Math      string `json:"math"`
}

type Emphasis struct {
	Intuition string `json:"intuition,omitempty"`
	Engineer  string `json:"engineer,omitempty"`
	Math      string `json:"math,omitempty"`
}

type Review struct {
	ReviewedBy string `json:"reviewed_by"`
	ReviewedAt string `json:"reviewed_at"`
}

// Provenance holds frontier drafting metadata only. Sources live in the
// concept's top-level Citations, so verifying a node never drops them.
type Provenance struct {
	DraftedAt string `json:"drafted_at"`
}

// Edges is a struct rather than a map so the three groups always serialise,
// and MarshalJSON emits [] rather than null for an absent group. openapi.yaml
// marks all three required; a client doing edges.adjacent.map(...) would
// otherwise crash on exactly the nodes the empty-state design exists for.
type Edges struct {
	Requires []Edge `json:"requires"`
	Unlocks  []Edge `json:"unlocks"`
	Adjacent []Edge `json:"adjacent"`
}

// MarshalJSON guarantees the shape regardless of what a store populated.
func (e Edges) MarshalJSON() ([]byte, error) {
	type wire struct {
		Requires []Edge `json:"requires"`
		Unlocks  []Edge `json:"unlocks"`
		Adjacent []Edge `json:"adjacent"`
	}
	return json.Marshal(wire{
		Requires: orEmpty(e.Requires),
		Unlocks:  orEmpty(e.Unlocks),
		Adjacent: orEmpty(e.Adjacent),
	})
}

// Get returns the group for a type, so callers keep map-like access.
func (e Edges) Get(t EdgeType) []Edge {
	switch t {
	case EdgeRequires:
		return e.Requires
	case EdgeUnlocks:
		return e.Unlocks
	case EdgeAdjacent:
		return e.Adjacent
	default:
		return nil
	}
}

func orEmpty(in []Edge) []Edge {
	if in == nil {
		return []Edge{}
	}
	return in
}

type Concept struct {
	ID        string      `json:"id"`
	Title     string      `json:"title"`
	Domain    string      `json:"domain"`
	Tier      Tier        `json:"tier"`
	Bodies    Bodies      `json:"bodies"`
	Emphasis  *Emphasis   `json:"emphasis,omitempty"`
	Viz       Viz         `json:"viz"`
	Edges     Edges       `json:"edges"`
	Citations []Citation  `json:"citations"`
	Review    *Review     `json:"review"`
	Prov      *Provenance `json:"provenance"`
	UpdatedAt string      `json:"updated_at"`
}

// NearestConcept is what a 404 offers instead of a dead end.
type NearestConcept struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Tier  Tier   `json:"tier"`
}

// MiniMapNode carries coordinates computed at publish time in a 240x132
// viewBox (ADR-0003) — the client never runs layout, so the map never jitters.
type MiniMapNode struct {
	ID    string  `json:"id"`
	Title string  `json:"title"`
	Tier  Tier    `json:"tier"`
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
}

type MiniMapLink struct {
	From     string   `json:"from"`
	To       string   `json:"to"`
	Type     EdgeType `json:"type"`
	Reviewed bool     `json:"reviewed"`
}

type Neighborhood struct {
	Center MiniMapNode   `json:"center"`
	Nodes  []MiniMapNode `json:"nodes"`
	Links  []MiniMapLink `json:"links"`
}

type Stats struct {
	Concepts     int `json:"concepts"`
	GrewThisWeek int `json:"grew_this_week"`
}

type TrailStop struct {
	N           int    `json:"n"`
	ID          string `json:"id"`
	Title       string `json:"title"`
	Tier        Tier   `json:"tier"`
	DepthReadAt Depth  `json:"depth_read_at"`
}

type Trail struct {
	Slug      string      `json:"slug"`
	Title     string      `json:"title"`
	CreatedAt string      `json:"created_at"`
	DurationS int         `json:"duration_s"`
	Stops     []TrailStop `json:"stops"`
}

// NewTrail is a share request: concept ids and the depth each was read at.
type NewTrail struct {
	Stops     []NewTrailStop
	DurationS int
}

type NewTrailStop struct {
	ID          string
	DepthReadAt Depth
}

// ConceptRequest is the 404 page's "request this concept" form.
type ConceptRequest struct {
	Name     string
	Referrer string
}

// ReviewKind is which of the two frontier provenance actions was taken.
type ReviewKind string

const (
	ReviewFlag      ReviewKind = "flag"
	ReviewVolunteer ReviewKind = "volunteer"
)

// ReviewSubmission records that a human offered to look at a concept. It does
// NOT change the concept's tier: promotion happens by editing the node's JSON
// in a pull request and merging it. A runtime write to tier would make
// Firestore diverge from git, and git is the only writer of concept state.
// See ADR-0002.
type ReviewSubmission struct {
	ConceptID string
	Kind      ReviewKind
	Note      string
}

// Store is the whole data surface. Everything takes a context so a request
// deadline reaches the database call.
type Store interface {
	Concept(ctx context.Context, id string) (*Concept, error)
	// Nearest backs the 404 page's suggestions. Best-effort: an error here
	// should degrade the 404, not replace it with a 500.
	Nearest(ctx context.Context, id string, limit int) ([]NearestConcept, error)
	Neighborhood(ctx context.Context, id string) (*Neighborhood, error)
	Stats(ctx context.Context) (*Stats, error)

	Trail(ctx context.Context, slug string) (*Trail, error)
	// CreateTrail is idempotent on an identical stop sequence: re-posting the
	// same walk returns the existing trail rather than minting a second slug.
	CreateTrail(ctx context.Context, t NewTrail) (*Trail, error)

	EnqueueConceptRequest(ctx context.Context, r ConceptRequest) error
	EnqueueReview(ctx context.Context, r ReviewSubmission) error

	// ReserveWrite atomically counts one write against the day's budget and
	// reports whether it is allowed. This is the layer that actually bounds
	// the bill: the in-process rate limiter resets on cold start and does not
	// coordinate across instances, so it cannot.
	ReserveWrite(ctx context.Context, day string, limit int64) (bool, error)
}

// TrailKey fingerprints a stop sequence.
//
// Both Fake and Firestore derive a trail's identity from this one function, so
// they cannot disagree about what "the same walk" means. They previously did:
// the fake keyed on the sequence while Firestore appended a random nonce to the
// document id, so the idempotency openapi.yaml promises held in tests and would
// have failed in production. Sharing the derivation makes that unrepresentable
// rather than merely tested.
func TrailKey(stops []NewTrailStop) string {
	parts := make([]string, 0, len(stops))
	for _, s := range stops {
		parts = append(parts, s.ID+":"+string(s.DepthReadAt))
	}
	sum := sha256.Sum256([]byte(strings.Join(parts, "|")))
	return hex.EncodeToString(sum[:4])
}

// TrailKeyOf fingerprints an already-built trail, for comparison against
// TrailKey.
func TrailKeyOf(t *Trail) string {
	stops := make([]NewTrailStop, 0, len(t.Stops))
	for _, s := range t.Stops {
		stops = append(stops, NewTrailStop{ID: s.ID, DepthReadAt: s.DepthReadAt})
	}
	return TrailKey(stops)
}

// TrailSlug is the shareable id: readable endpoints plus the fingerprint, so
// the same walk always lands on the same document.
func TrailSlug(stops []NewTrailStop) string {
	key := TrailKey(stops)
	if len(stops) == 0 {
		return "empty-" + key
	}
	first := truncateSlug(stops[0].ID, 20)
	if len(stops) == 1 {
		return first + "-" + key
	}
	return first + "-to-" + truncateSlug(stops[len(stops)-1].ID, 20) + "-" + key
}

func truncateSlug(s string, n int) string {
	if len(s) > n {
		s = s[:n]
	}
	return strings.Trim(s, "-")
}
