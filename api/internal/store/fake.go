package store

import (
	"context"
	"fmt"
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
	return c, nil
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
	return n, nil
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
	return t, nil
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
		return existing, nil
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
	return t, nil
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
