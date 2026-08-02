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
	"regexp"
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
	ID    string `firestore:"id" json:"id"`
	Title string `firestore:"title" json:"title"`
	Tier  Tier   `firestore:"tier" json:"tier"`
	// Reviewed is authored per edge, not derived from the target's tier — the
	// case that matters is an unchecked claim between two verified concepts.
	Reviewed bool `firestore:"reviewed" json:"reviewed"`
}

type Citation struct {
	Ref   string `firestore:"ref" json:"ref"`
	Title string `firestore:"title" json:"title"`
	URL   string `firestore:"url" json:"url"`
}

type ParamControl struct {
	Name string  `firestore:"name" json:"name"`
	Min  float64 `firestore:"min" json:"min"`
	Max  float64 `firestore:"max" json:"max"`
	Step float64 `firestore:"step" json:"step"`
}

type Viz struct {
	Primitive     string               `firestore:"primitive" json:"primitive"`
	Params        Map[string, float64] `firestore:"params" json:"params"`
	ParamControls List[ParamControl]   `firestore:"param_controls" json:"param_controls"`
	Caption       string               `firestore:"caption" json:"caption"`
}

type Bodies struct {
	Intuition string `firestore:"intuition" json:"intuition"`
	Engineer  string `firestore:"engineer" json:"engineer"`
	Math      string `firestore:"math" json:"math"`
}

type Emphasis struct {
	Intuition string `firestore:"intuition" json:"intuition,omitempty"`
	Engineer  string `firestore:"engineer" json:"engineer,omitempty"`
	Math      string `firestore:"math" json:"math,omitempty"`
}

type Review struct {
	ReviewedBy string `firestore:"reviewed_by" json:"reviewed_by"`
	ReviewedAt string `firestore:"reviewed_at" json:"reviewed_at"`
}

// Provenance holds frontier drafting metadata only. Sources live in the
// concept's top-level Citations, so verifying a node never drops them.
type Provenance struct {
	DraftedAt string `firestore:"drafted_at" json:"drafted_at"`
}

// List marshals nil as [] rather than null.
//
// openapi.yaml marks a dozen arrays required, and a nil Go slice marshals as
// null — so a client doing citations.map(...) crashes on exactly the sparse
// nodes the empty-state design exists for. Fixing this per-struct means the
// next required array added is wrong by default; making it a property of the
// type means it cannot be.
type List[T any] []T

func (l List[T]) MarshalJSON() ([]byte, error) {
	if l == nil {
		return []byte("[]"), nil
	}
	return json.Marshal([]T(l))
}

// Map is List's counterpart: nil marshals as {} rather than null.
//
// The same argument, one shape later. `viz.params` is required by openapi.yaml
// and typed object, and it shipped serialising as null — while `param_controls`
// beside it in the same struct was already safe, because that one happened to be
// an array and arrays had been noticed. A client doing
// Object.entries(viz.params) on a null does not degrade, it throws.
type Map[K comparable, V any] map[K]V

func (m Map[K, V]) MarshalJSON() ([]byte, error) {
	if m == nil {
		return []byte("{}"), nil
	}
	return json.Marshal(map[K]V(m))
}

// Edges is a struct rather than a map so all three groups always serialise —
// openapi.yaml marks each of them required.
type Edges struct {
	Requires List[Edge] `firestore:"requires" json:"requires"`
	Unlocks  List[Edge] `firestore:"unlocks" json:"unlocks"`
	Adjacent List[Edge] `firestore:"adjacent" json:"adjacent"`
}

type Concept struct {
	ID        string         `firestore:"id" json:"id"`
	Title     string         `firestore:"title" json:"title"`
	Domain    string         `firestore:"domain" json:"domain"`
	Tier      Tier           `firestore:"tier" json:"tier"`
	Bodies    Bodies         `firestore:"bodies" json:"bodies"`
	Emphasis  *Emphasis      `firestore:"emphasis" json:"emphasis,omitempty"`
	Viz       Viz            `firestore:"viz" json:"viz"`
	Edges     Edges          `firestore:"edges" json:"edges"`
	Citations List[Citation] `firestore:"citations" json:"citations"`
	Review    *Review        `firestore:"review" json:"review"`
	Prov      *Provenance    `firestore:"provenance" json:"provenance"`
	UpdatedAt string         `firestore:"updated_at" json:"updated_at"`
}

// NearestConcept is what a 404 offers instead of a dead end.
type NearestConcept struct {
	ID    string `firestore:"id" json:"id"`
	Title string `firestore:"title" json:"title"`
	Tier  Tier   `firestore:"tier" json:"tier"`
}

// MiniMapNode carries coordinates computed at publish time in a 240x132
// viewBox (ADR-0003) — the client never runs layout, so the map never jitters.
type MiniMapNode struct {
	ID    string  `firestore:"id" json:"id"`
	Title string  `firestore:"title" json:"title"`
	Tier  Tier    `firestore:"tier" json:"tier"`
	X     float64 `firestore:"x" json:"x"`
	Y     float64 `firestore:"y" json:"y"`
}

type MiniMapLink struct {
	From     string   `firestore:"from" json:"from"`
	To       string   `firestore:"to" json:"to"`
	Type     EdgeType `firestore:"type" json:"type"`
	Reviewed bool     `firestore:"reviewed" json:"reviewed"`
}

type Neighborhood struct {
	Center MiniMapNode       `firestore:"center" json:"center"`
	Nodes  List[MiniMapNode] `firestore:"nodes" json:"nodes"`
	Links  List[MiniMapLink] `firestore:"links" json:"links"`
}

type Stats struct {
	Concepts     int `firestore:"concepts" json:"concepts"`
	GrewThisWeek int `firestore:"grew_this_week" json:"grew_this_week"`
}

type TrailStop struct {
	N           int    `firestore:"n" json:"n"`
	ID          string `firestore:"id" json:"id"`
	Title       string `firestore:"title" json:"title"`
	Tier        Tier   `firestore:"tier" json:"tier"`
	DepthReadAt Depth  `firestore:"depth_read_at" json:"depth_read_at"`
}

type Trail struct {
	Slug      string          `firestore:"slug" json:"slug"`
	Title     string          `firestore:"title" json:"title"`
	CreatedAt string          `firestore:"created_at" json:"created_at"`
	DurationS int             `firestore:"duration_s" json:"duration_s"`
	Stops     List[TrailStop] `firestore:"stops" json:"stops"`
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
	return hex.EncodeToString(sum[:8])
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

// ConceptPrefix is the search prefix for 404 suggestions.
//
// Shared so Fake and Firestore cannot disagree, which they did: one used
// strings.Split(id, "-")[0] and the other guarded on strings.Index(id, "-") > 0,
// so an id beginning with a hyphen matched everything in one and nothing in the
// other.
func ConceptPrefix(id string) string {
	if i := strings.Index(id, "-"); i > 0 {
		return id[:i]
	}
	return id
}

// conceptID is the slug pattern openapi.yaml declares for a concept id.
var conceptID = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// ValidConceptID reports whether id is a well-formed slug.
//
// Checked at every entry point that accepts one: an id containing "/" builds an
// odd-component Firestore path and an over-long id exceeds the 1500-byte
// document-id limit, both of which surface as a 500 for what is plainly a
// client error.
func ValidConceptID(id string) bool {
	return len(id) >= 2 && len(id) <= 64 && conceptID.MatchString(id)
}
