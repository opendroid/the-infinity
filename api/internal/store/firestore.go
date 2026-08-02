package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Collection names. Concepts is written only by the publish tool on merge to
// main; everything else is written at runtime and never syncs back to git.
// See ADR-0002.
const (
	collConcepts = "concepts"
	collTrails   = "trails"
	collRequests = "concept_requests"
	collReviews  = "concept_reviews"
	collCounters = "counters"
)

// Firestore implements Store against Firestore in Native mode.
type Firestore struct {
	client *firestore.Client
	now    func() time.Time
}

// NewFirestore wraps an existing client. The caller owns its lifetime, so a
// single client is shared across requests rather than dialled per call.
func NewFirestore(client *firestore.Client) *Firestore {
	return &Firestore{client: client, now: time.Now}
}

// notFound translates Firestore's NotFound status into our sentinel, so
// handlers can match with errors.Is without importing gRPC.
func notFound(err error, what string) error {
	if status.Code(err) == codes.NotFound {
		return fmt.Errorf("%s: %w", what, ErrNotFound)
	}
	return fmt.Errorf("%s: %w", what, err)
}

func (f *Firestore) Concept(ctx context.Context, id string) (*Concept, error) {
	doc, err := f.client.Collection(collConcepts).Doc(id).Get(ctx)
	if err != nil {
		return nil, notFound(err, "fetching concept "+id)
	}
	var c Concept
	if err := doc.DataTo(&c); err != nil {
		return nil, fmt.Errorf("decoding concept %s: %w", id, err)
	}
	return &c, nil
}

// Nearest offers suggestions for a 404 by prefix. Deliberately crude: it exists
// so the page is not a dead end, not to be a search engine — real search ships
// as a static index (ADR-0003).
func (f *Firestore) Nearest(ctx context.Context, id string, limit int) ([]NearestConcept, error) {
	prefix := id
	if i := strings.Index(id, "-"); i > 0 {
		prefix = id[:i]
	}

	docs, err := f.client.Collection(collConcepts).
		Where("id", ">=", prefix).
		Where("id", "<", prefix+"").
		Limit(limit).
		Documents(ctx).GetAll()
	if err != nil {
		return nil, fmt.Errorf("finding concepts near %s: %w", id, err)
	}

	out := make([]NearestConcept, 0, len(docs))
	for _, d := range docs {
		var c Concept
		if err := d.DataTo(&c); err != nil {
			continue // one bad document should not sink the suggestion list
		}
		if c.ID == id {
			continue
		}
		out = append(out, NearestConcept{ID: c.ID, Title: c.Title, Tier: c.Tier})
	}
	return out, nil
}

func (f *Firestore) Neighborhood(ctx context.Context, id string) (*Neighborhood, error) {
	doc, err := f.client.Collection(collConcepts).Doc(id).
		Collection("neighborhood").Doc("default").Get(ctx)
	if err != nil {
		return nil, notFound(err, "fetching neighborhood "+id)
	}
	var n Neighborhood
	if err := doc.DataTo(&n); err != nil {
		return nil, fmt.Errorf("decoding neighborhood %s: %w", id, err)
	}
	return &n, nil
}

func (f *Firestore) Stats(ctx context.Context) (*Stats, error) {
	doc, err := f.client.Collection(collCounters).Doc("stats").Get(ctx)
	if err != nil {
		// Stats gates nothing — the landing page ships build-time values — so
		// an absent counter is zeroes rather than an error.
		if status.Code(err) == codes.NotFound {
			return &Stats{}, nil
		}
		return nil, fmt.Errorf("fetching stats: %w", err)
	}
	var s Stats
	if err := doc.DataTo(&s); err != nil {
		return nil, fmt.Errorf("decoding stats: %w", err)
	}
	return &s, nil
}

func (f *Firestore) Trail(ctx context.Context, slug string) (*Trail, error) {
	doc, err := f.client.Collection(collTrails).Doc(slug).Get(ctx)
	if err != nil {
		return nil, notFound(err, "fetching trail "+slug)
	}
	var t Trail
	if err := doc.DataTo(&t); err != nil {
		return nil, fmt.Errorf("decoding trail %s: %w", slug, err)
	}
	return &t, nil
}

func (f *Firestore) CreateTrail(ctx context.Context, nt NewTrail) (*Trail, error) {
	stops := make([]TrailStop, 0, len(nt.Stops))
	for i, s := range nt.Stops {
		c, err := f.Concept(ctx, s.ID)
		if err != nil {
			return nil, err // already wrapped; ErrNotFound survives
		}
		stops = append(stops, TrailStop{
			N: i + 1, ID: c.ID, Title: c.Title, Tier: c.Tier, DepthReadAt: s.DepthReadAt,
		})
	}

	// Idempotent on the stop sequence: the fingerprint is the document id, so a
	// client retrying after a dropped response reuses the same trail instead of
	// littering. Slug stays human-shaped for sharing.
	slug := trailSlug(stops)
	ref := f.client.Collection(collTrails).Doc(slug)

	if existing, err := ref.Get(ctx); err == nil {
		var t Trail
		if err := existing.DataTo(&t); err == nil {
			return &t, nil
		}
	} else if status.Code(err) != codes.NotFound {
		return nil, fmt.Errorf("checking for existing trail %s: %w", slug, err)
	}

	t := Trail{
		Slug:      slug,
		Title:     trailTitle(stops),
		CreatedAt: f.now().UTC().Format("2006-01-02"),
		DurationS: nt.DurationS,
		Stops:     stops,
	}
	if _, err := ref.Set(ctx, t); err != nil {
		return nil, fmt.Errorf("writing trail %s: %w", slug, err)
	}
	return &t, nil
}

func (f *Firestore) EnqueueConceptRequest(ctx context.Context, r ConceptRequest) error {
	_, _, err := f.client.Collection(collRequests).Add(ctx, map[string]any{
		"name":       r.Name,
		"referrer":   r.Referrer,
		"status":     "queued",
		"created_at": f.now().UTC(),
	})
	if err != nil {
		return fmt.Errorf("queueing concept request: %w", err)
	}
	return nil
}

// EnqueueReview appends a submission. It does not touch the concept — see the
// package comment in internal/queues and ADR-0002.
func (f *Firestore) EnqueueReview(ctx context.Context, r ReviewSubmission) error {
	if _, err := f.Concept(ctx, r.ConceptID); err != nil {
		return err
	}
	_, _, err := f.client.Collection(collReviews).Add(ctx, map[string]any{
		"concept_id": r.ConceptID,
		"kind":       string(r.Kind),
		"note":       r.Note,
		"created_at": f.now().UTC(),
	})
	if err != nil {
		return fmt.Errorf("queueing review for %s: %w", r.ConceptID, err)
	}
	return nil
}

// ReserveWrite increments the day's counter inside a transaction, so two
// instances racing cannot both slip past the cap.
func (f *Firestore) ReserveWrite(ctx context.Context, day string, limit int64) (bool, error) {
	ref := f.client.Collection(collCounters).Doc("writes-" + day)

	allowed := false
	err := f.client.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		var count int64
		doc, err := tx.Get(ref)
		switch {
		case err == nil:
			if v, err := doc.DataAt("count"); err == nil {
				if n, ok := v.(int64); ok {
					count = n
				}
			}
		case status.Code(err) == codes.NotFound:
			count = 0
		default:
			return fmt.Errorf("reading write counter for %s: %w", day, err)
		}

		if count >= limit {
			allowed = false
			return nil
		}
		allowed = true
		return tx.Set(ref, map[string]any{"count": count + 1, "day": day})
	})
	if err != nil {
		return false, fmt.Errorf("reserving write for %s: %w", day, err)
	}
	return allowed, nil
}

// trailSlug is {first-stop}-to-{last-stop}-{nonce}, truncated. The nonce keeps
// two different walks between the same endpoints from colliding.
func trailSlug(stops []TrailStop) string {
	if len(stops) == 0 {
		return "empty-" + nonce()
	}
	first := stops[0].ID
	last := stops[len(stops)-1].ID
	if len(stops) == 1 {
		return truncate(first, 40) + "-" + nonce()
	}
	return truncate(first, 20) + "-to-" + truncate(last, 20) + "-" + nonce()
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return strings.TrimRight(s[:n], "-")
}

func nonce() string {
	var b [2]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand failing is not recoverable here, and a predictable slug
		// is better than no trail at all.
		return "0000"
	}
	return hex.EncodeToString(b[:])
}

var _ Store = (*Firestore)(nil)

// ErrNoClient is returned by the constructor when Firestore is unreachable at
// startup, so main can fail loudly rather than serving 500s.
var ErrNoClient = errors.New("no firestore client")
