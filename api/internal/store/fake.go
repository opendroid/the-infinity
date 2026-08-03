package store

import (
	"context"
	"fmt"
	"maps"
	"slices"
	"sort"
	"strings"
	"sync"
)

// Fake is an in-memory Store for tests. It is safe for concurrent use so the
// rate-limit tests can hammer it from several goroutines.
//
// Handlers test against this rather than a Firestore emulator: an emulator
// would test Google's client library, which is not the part that breaks.
type Fake struct {
	mu sync.Mutex

	Concepts      map[string]*Concept
	Neighborhoods map[string]*Neighborhood
	StatsValue    Stats
	Trails        map[string]*Trail

	Requests []ConceptRequest
	Reviews  []ReviewSubmission

	// Writes counts per day key, mirroring ReserveWrite's contract.
	Writes map[string]int64

	// Err, when set, is returned by every method — for exercising the 500 path.
	Err error
	// NearestErr fails only Nearest, so a test can reach the 404 path and check
	// that a failed suggestion lookup degrades it rather than replacing it with
	// a 500. One shared Err cannot express that: it fails Concept() first.
	NearestErr error
}

func NewFake() *Fake {
	return &Fake{
		Concepts:      map[string]*Concept{},
		Neighborhoods: map[string]*Neighborhood{},
		Trails:        map[string]*Trail{},
		Writes:        map[string]int64{},
	}
}

func (f *Fake) Concept(_ context.Context, id string) (*Concept, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Err != nil {
		return nil, f.Err
	}
	c, ok := f.Concepts[id]
	if !ok {
		return nil, fmt.Errorf("concept %s: %w", id, ErrNotFound)
	}
	return cloneConcept(c), nil
}

func (f *Fake) Nearest(_ context.Context, id string, limit int) ([]NearestConcept, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.NearestErr != nil {
		return nil, f.NearestErr
	}
	if f.Err != nil {
		return nil, f.Err
	}
	// Same prefix rule and self-exclusion as Firestore, so a test here proves
	// something about production.
	prefix := ConceptPrefix(id)
	var out []NearestConcept
	for _, c := range f.Concepts {
		if c.ID != id && strings.HasPrefix(c.ID, prefix) {
			out = append(out, NearestConcept{ID: c.ID, Title: c.Title, Tier: c.Tier})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (f *Fake) Neighborhood(_ context.Context, id string) (*Neighborhood, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Err != nil {
		return nil, f.Err
	}
	n, ok := f.Neighborhoods[id]
	if !ok {
		return nil, fmt.Errorf("neighborhood %s: %w", id, ErrNotFound)
	}
	return cloneNeighborhood(n), nil
}

func (f *Fake) Stats(_ context.Context) (*Stats, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Err != nil {
		return nil, f.Err
	}
	s := f.StatsValue
	return &s, nil
}

func (f *Fake) Trail(_ context.Context, slug string) (*Trail, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Err != nil {
		return nil, f.Err
	}
	t, ok := f.Trails[slug]
	if !ok {
		return nil, fmt.Errorf("trail %s: %w", slug, ErrNotFound)
	}
	return cloneTrail(t), nil
}

func (f *Fake) CreateTrail(_ context.Context, nt NewTrail) (*Trail, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Err != nil {
		return nil, f.Err
	}

	// Idempotent on an identical stop sequence. The key comes from the shared
	// TrailKey so this cannot drift from the Firestore implementation.
	if existing, ok := f.Trails[TrailSlug(nt.Stops)]; ok {
		return cloneTrail(existing), nil
	}

	stops := make([]TrailStop, 0, len(nt.Stops))
	for i, s := range nt.Stops {
		c, ok := f.Concepts[s.ID]
		if !ok {
			return nil, fmt.Errorf("trail stop %s: %w", s.ID, ErrNotFound)
		}
		stops = append(stops, TrailStop{
			N: i + 1, ID: c.ID, Title: c.Title, Tier: c.Tier, DepthReadAt: s.DepthReadAt,
		})
	}

	t := &Trail{
		Slug:      TrailSlug(nt.Stops),
		Title:     trailTitle(stops),
		CreatedAt: "2026-01-01",
		DurationS: nt.DurationS,
		Stops:     stops,
	}
	f.Trails[t.Slug] = t
	return cloneTrail(t), nil
}

func (f *Fake) EnqueueConceptRequest(_ context.Context, r ConceptRequest) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Err != nil {
		return f.Err
	}
	f.Requests = append(f.Requests, r)
	return nil
}

func (f *Fake) EnqueueReview(_ context.Context, r ReviewSubmission) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Err != nil {
		return f.Err
	}
	if _, ok := f.Concepts[r.ConceptID]; !ok {
		return fmt.Errorf("concept %s: %w", r.ConceptID, ErrNotFound)
	}
	f.Reviews = append(f.Reviews, r)
	return nil
}

func (f *Fake) ReserveWrite(_ context.Context, day string, limit int64) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Err != nil {
		return false, f.Err
	}
	if f.Writes[day] >= limit {
		return false, nil
	}
	f.Writes[day]++
	return true, nil
}

// Every read returns a copy, because Firestore does.
//
// Handing back the pointer in the map made the fixture writable by anything
// that read it: a handler test that sorted a returned edge list, or a
// serialisation test that blanked a field to check an omitempty, silently
// reordered or emptied the fixture for every test that ran afterwards. The
// symptom is a test that passes alone and fails in a suite, or worse, the
// reverse — and the cause is nowhere near the failure.
//
// A store backed by a database cannot alias its caller's memory. A fake that
// does is not a simpler store, it is a store with a behaviour production does
// not have, which is the one thing a fake must never be.
//
// The element types below are all flat, so cloning the containers is enough.
// TestTheFakeSharesNoMemoryWithItsCaller checks that structurally rather than
// on trust: it fills the struct through reflection and walks both copies, so a
// field added here and forgotten in the clone fails rather than aliases.
func cloneConcept(c *Concept) *Concept {
	if c == nil {
		return nil
	}
	out := *c
	out.Emphasis = clonePtr(c.Emphasis)
	out.Review = clonePtr(c.Review)
	out.Prov = clonePtr(c.Prov)
	out.Viz.Params = maps.Clone(c.Viz.Params)
	out.Viz.ParamControls = slices.Clone(c.Viz.ParamControls)
	out.Edges.Requires = slices.Clone(c.Edges.Requires)
	out.Edges.Unlocks = slices.Clone(c.Edges.Unlocks)
	out.Edges.Adjacent = slices.Clone(c.Edges.Adjacent)
	out.Citations = slices.Clone(c.Citations)
	return &out
}

func cloneNeighborhood(n *Neighborhood) *Neighborhood {
	if n == nil {
		return nil
	}
	out := *n
	out.Nodes = slices.Clone(n.Nodes)
	out.Links = slices.Clone(n.Links)
	return &out
}

func cloneTrail(t *Trail) *Trail {
	if t == nil {
		return nil
	}
	out := *t
	out.Stops = slices.Clone(t.Stops)
	return &out
}

// clonePtr copies the pointee, preserving nil. maps.Clone and slices.Clone
// already do this for the other two shapes; the standard library has no
// equivalent for a pointer field.
func clonePtr[T any](p *T) *T {
	if p == nil {
		return nil
	}
	v := *p
	return &v
}

// trailTitle is generated from the first and last stop; the page appends
// "— one pull of the thread".
func trailTitle(stops []TrailStop) string {
	switch len(stops) {
	case 0:
		return "An empty thread"
	case 1:
		return stops[0].Title
	default:
		return fmt.Sprintf("From %s to %s", stops[0].Title, stops[len(stops)-1].Title)
	}
}

var _ Store = (*Fake)(nil)
