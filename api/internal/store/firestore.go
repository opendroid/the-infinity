package store

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"cloud.google.com/go/firestore"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// prefixUpperBound sorts after any ordinary string, so `>= p AND < p+bound`
// means "starts with p".
//
// Named rather than written inline: the raw code point renders as nothing in a
// terminal, so `prefix+"\uf8ff"` looks exactly like `prefix+""` \u2014 an empty range
// that could never match. It read as a bug during review and was not one.
const prefixUpperBound = "\uf8ff"

// Collection and document names.
//
// Exported because the publish tool writes the documents this file reads, and a
// second hand-typed copy of "concepts" in cmd/publish is exactly the kind of
// divergence that passes every test and serves an empty graph.
//
// CollConcepts is written only by the publish tool on merge to main; everything
// else is written at runtime and never syncs back to git. See ADR-0002.
const (
	CollConcepts = "concepts"
	CollTrails   = "trails"
	CollRequests = "concept_requests"
	CollReviews  = "concept_reviews"
	CollCounters = "counters"

	// A concept's mini-map lives in a subcollection with a single document, so
	// reading a concept never drags its neighbourhood along.
	SubNeighborhood = "neighborhood"
	DocNeighborhood = "default"

	DocStats = "stats"
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
	doc, err := f.client.Collection(CollConcepts).Doc(id).Get(ctx)
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
	prefix := ConceptPrefix(id)

	// Fetch one extra: self-exclusion happens below, and limiting in the query
	// would silently return limit-1 suggestions whenever the queried id exists.
	docs, err := f.client.Collection(CollConcepts).
		Select("id", "title", "tier").
		Where("id", ">=", prefix).
		Where("id", "<", prefix+prefixUpperBound).
		Limit(limit + 1).
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
		if len(out) == limit {
			break
		}
	}
	return out, nil
}

func (f *Firestore) Neighborhood(ctx context.Context, id string) (*Neighborhood, error) {
	doc, err := f.client.Collection(CollConcepts).Doc(id).
		Collection(SubNeighborhood).Doc(DocNeighborhood).Get(ctx)
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
	doc, err := f.client.Collection(CollCounters).Doc(DocStats).Get(ctx)
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
	doc, err := f.client.Collection(CollTrails).Doc(slug).Get(ctx)
	if err != nil {
		return nil, notFound(err, "fetching trail "+slug)
	}
	var t Trail
	if err := doc.DataTo(&t); err != nil {
		return nil, fmt.Errorf("decoding trail %s: %w", slug, err)
	}
	if err := f.markMissing(ctx, &t); err != nil {
		return nil, err
	}
	return &t, nil
}

// markMissing flags stops whose concept is no longer published (ADR-0012).
//
// The stops are denormalised, so the trail renders without this — with a link
// to a concept page that 404s, which the reader discovers by clicking. One
// batched read turns that into something the page can say up front.
//
// ONE GetAll for the whole walk, the same call CreateTrail uses and for the same
// reason: a trail carries up to 200 stops, and a loop here would be up to 200
// sequential round trips inside a 10-second handler timeout. GetAll returns one
// snapshot per ref in order, including duplicates, so a reader who doubled back
// still lines up with the right stop.
//
// A FAILURE HERE IS NOT A FAILURE OF THE READ. If the batch errors, the trail is
// returned unmarked rather than not at all — the shared page is the one route
// that says nothing useful without the API, and degrading it to an error because
// an enrichment failed would trade the whole page for a detail.
func (f *Firestore) markMissing(ctx context.Context, t *Trail) error {
	if len(t.Stops) == 0 {
		return nil
	}
	refs := make([]*firestore.DocumentRef, len(t.Stops))
	for i, s := range t.Stops {
		refs[i] = f.client.Collection(CollConcepts).Doc(s.ID)
	}
	snaps, err := f.client.GetAll(ctx, refs)
	if err != nil {
		slog.Warn("could not resolve trail stops; returning the trail unmarked",
			slog.String("slug", t.Slug), slog.Any("error", err))
		return nil
	}
	for i, snap := range snaps {
		if !snap.Exists() {
			t.Stops[i].Missing = true
		}
	}
	return nil
}

func (f *Firestore) CreateTrail(ctx context.Context, nt NewTrail) (*Trail, error) {
	// The slug needs only the request body, so check for an existing trail
	// before resolving anything. Resolving first made a retry — the exact case
	// idempotency exists for — pay N document reads to return a cached result,
	// and made the fake and Firestore disagree when a stop's concept had since
	// been removed.
	slug := TrailSlug(nt.Stops)
	ref := f.client.Collection(CollTrails).Doc(slug)

	if existing, err := ref.Get(ctx); err == nil {
		var t Trail
		if err := existing.DataTo(&t); err != nil {
			return nil, fmt.Errorf("decoding existing trail %s: %w", slug, err)
		}
		return &t, nil
	} else if status.Code(err) != codes.NotFound {
		return nil, fmt.Errorf("checking for existing trail %s: %w", slug, err)
	}

	// One BatchGetDocuments for the whole walk, not one per stop. A trail can
	// carry up to 200 stops (see internal/trails), so the loop this replaced
	// meant up to 200 sequential round trips inside a single request — against
	// a 10-second handler timeout, on a Cloud Run instance that may be cold.
	//
	// GetAll returns one snapshot per input ref, in order, including duplicates:
	// a reader who doubles back to a concept is the ordinary case, not an edge
	// one, and the ordering is what lets the index below name the right stop.
	refs := make([]*firestore.DocumentRef, len(nt.Stops))
	for i, s := range nt.Stops {
		refs[i] = f.client.Collection(CollConcepts).Doc(s.ID)
	}
	snaps, err := f.client.GetAll(ctx, refs)
	if err != nil {
		return nil, fmt.Errorf("fetching %d trail stops: %w", len(refs), err)
	}

	stops := make([]TrailStop, 0, len(snaps))
	for i, snap := range snaps {
		// A missing document is not an error from GetAll — it comes back as a
		// snapshot that does not exist. Reading it without checking would decode
		// into a zero Concept and put a nameless stop on a shared page.
		if !snap.Exists() {
			return nil, fmt.Errorf("trail stop %s: %w", nt.Stops[i].ID, ErrNotFound)
		}
		var c Concept
		if err := snap.DataTo(&c); err != nil {
			return nil, fmt.Errorf("decoding concept %s: %w", nt.Stops[i].ID, err)
		}
		stops = append(stops, TrailStop{
			N: i + 1, ID: c.ID, Title: c.Title, Tier: c.Tier, DepthReadAt: nt.Stops[i].DepthReadAt,
		})
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
	_, _, err := f.client.Collection(CollRequests).Add(ctx, map[string]any{
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
	_, _, err := f.client.Collection(CollReviews).Add(ctx, map[string]any{
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

// PendingReviews and PendingRequests read the two submission queues back for a
// maintainer (#115). They live here, beside the Enqueue methods, so the keys
// written and the tags read stay one edit apart.
//
// Oldest first: the queue is a backlog, and the flag that has been waiting
// longest is the one worth seeing at the top. Ordering on a single field needs
// no composite index, so this works against a fresh project with no setup.
//
// Neither is on the Store interface, and neither writes anything.
func (f *Firestore) PendingReviews(ctx context.Context, limit int) ([]PendingReview, error) {
	docs, err := f.client.Collection(CollReviews).
		OrderBy("created_at", firestore.Asc).Limit(limit).Documents(ctx).GetAll()
	if err != nil {
		return nil, fmt.Errorf("reading the review queue: %w", err)
	}
	out := make([]PendingReview, 0, len(docs))
	for _, doc := range docs {
		var r PendingReview
		if err := doc.DataTo(&r); err != nil {
			return nil, fmt.Errorf("decoding review %s: %w", doc.Ref.ID, err)
		}
		r.ID = doc.Ref.ID
		out = append(out, r)
	}
	return out, nil
}

func (f *Firestore) PendingRequests(ctx context.Context, limit int) ([]PendingRequest, error) {
	docs, err := f.client.Collection(CollRequests).
		OrderBy("created_at", firestore.Asc).Limit(limit).Documents(ctx).GetAll()
	if err != nil {
		return nil, fmt.Errorf("reading the concept-request queue: %w", err)
	}
	out := make([]PendingRequest, 0, len(docs))
	for _, doc := range docs {
		var r PendingRequest
		if err := doc.DataTo(&r); err != nil {
			return nil, fmt.Errorf("decoding concept request %s: %w", doc.Ref.ID, err)
		}
		r.ID = doc.Ref.ID
		out = append(out, r)
	}
	return out, nil
}

// ReserveWrite increments the day's counter inside a transaction, so two
// instances racing cannot both slip past the cap.
func (f *Firestore) ReserveWrite(ctx context.Context, day string, limit int64) (bool, error) {
	ref := f.client.Collection(CollCounters).Doc("writes-" + day)

	allowed := false
	err := f.client.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		var count int64
		doc, err := tx.Get(ref)
		switch {
		case err == nil:
			v, err := doc.DataAt("count")
			if err != nil {
				return fmt.Errorf("reading count from write counter for %s: %w", day, err)
			}
			// A counter of an unexpected type must fail the request, not silently
			// read as zero — that would leave the cap permanently disabled with
			// no signal. Firestore returns whole numbers as int64, but an export,
			// a console edit, or a restore can produce a float.
			switch n := v.(type) {
			case int64:
				count = n
			case float64:
				count = int64(n)
			default:
				return fmt.Errorf("write counter for %s has type %T, want a number", day, v)
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

var _ Store = (*Firestore)(nil)
