package store_test

import (
	"os"
	"strings"
	"testing"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/opendroid/the-infinity/api/internal/store"
)

// The queue readers added in #115 cross the wire, and the handler tests cannot
// see that: they run against store.Fake, which is Go structs in a map, so no
// serialisation happens.
//
// The specific defect this exists to catch: PendingReview's tags must match the
// literal snake_case keys EnqueueReview writes. A typo decodes as a zero value,
// which prints a blank row in a report nobody is reading closely — the failure
// would look exactly like an empty queue.
//
// Skipped rather than failed without an emulator, so `go test ./...` on a
// laptop stays one command. CI starts one; see the api job in ci.yml.
func queueClient(t *testing.T) *firestore.Client {
	t.Helper()

	if os.Getenv("FIRESTORE_EMULATOR_HOST") == "" {
		if os.Getenv("CI") != "" {
			t.Fatal("FIRESTORE_EMULATOR_HOST is not set in CI: the emulator step must run before the tests")
		}
		t.Skip("FIRESTORE_EMULATOR_HOST is not set — see `make test-emulator` to run the round-trip tests")
	}

	project := "test-" + strings.ToLower(strings.NewReplacer("/", "-", "_", "-").Replace(t.Name()))
	client, err := firestore.NewClient(t.Context(), project)
	if err != nil {
		t.Fatalf("connecting to the emulator: %v", err)
	}
	t.Cleanup(func() {
		if err := client.Close(); err != nil {
			t.Errorf("closing the emulator client: %v", err)
		}
	})
	// The emulator is a long-lived process on a laptop, and the project id is
	// derived from the test name, so a second run of the same test would read
	// the first run's documents. Found the hard way: a deliberately broken
	// field tag failed these tests with "read back 2, want 1" — the right
	// verdict for the wrong reason, which in CI (a fresh emulator every run)
	// would have been no verdict at all.
	emptyCollections(t, client, store.CollReviews, store.CollRequests, store.CollConcepts)
	return client
}

func emptyCollections(t *testing.T, client *firestore.Client, names ...string) {
	t.Helper()
	for _, name := range names {
		docs, err := client.Collection(name).Documents(t.Context()).GetAll()
		if err != nil {
			t.Fatalf("listing %s to empty it: %v", name, err)
		}
		for _, doc := range docs {
			if _, err := doc.Ref.Delete(t.Context()); err != nil {
				t.Fatalf("emptying %s: %v", name, err)
			}
		}
	}
}

func TestAQueuedReviewReadsBackWithEveryFieldIntact(t *testing.T) {
	client := queueClient(t)
	ctx := t.Context()
	s := store.NewFirestore(client)

	// EnqueueReview checks the concept exists before appending.
	if _, err := client.Collection(store.CollConcepts).Doc("attention").
		Set(ctx, map[string]any{"id": "attention", "title": "Attention"}); err != nil {
		t.Fatalf("seeding a concept: %v", err)
	}

	want := store.ReviewSubmission{
		ConceptID: "attention",
		Kind:      store.ReviewFlag,
		Note:      "The scaling factor is described wrongly.",
	}
	if err := s.EnqueueReview(ctx, want); err != nil {
		t.Fatalf("EnqueueReview: %v", err)
	}

	got, err := s.PendingReviews(ctx, 10)
	if err != nil {
		t.Fatalf("PendingReviews: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("read back %d reviews, want 1", len(got))
	}

	r := got[0]
	if r.ConceptID != want.ConceptID {
		t.Errorf("concept_id = %q, want %q", r.ConceptID, want.ConceptID)
	}
	if r.Kind != want.Kind {
		t.Errorf("kind = %q, want %q", r.Kind, want.Kind)
	}
	if r.Note != want.Note {
		t.Errorf("note = %q, want %q", r.Note, want.Note)
	}
	if r.CreatedAt.IsZero() {
		// The tag is the whole risk here: a zero time renders as "undated" and
		// would look like a quirk of the data rather than a broken read.
		t.Error("created_at decoded as the zero time — check the firestore tag")
	}
	if r.ID == "" {
		t.Error("no document id — nothing to name when acting on this one")
	}
}

func TestAQueuedConceptRequestReadsBackWithEveryFieldIntact(t *testing.T) {
	client := queueClient(t)
	ctx := t.Context()
	s := store.NewFirestore(client)

	want := store.ConceptRequest{Name: "grouped query attention", Referrer: "/c/multi-head-attention"}
	if err := s.EnqueueConceptRequest(ctx, want); err != nil {
		t.Fatalf("EnqueueConceptRequest: %v", err)
	}

	got, err := s.PendingRequests(ctx, 10)
	if err != nil {
		t.Fatalf("PendingRequests: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("read back %d requests, want 1", len(got))
	}

	r := got[0]
	if r.Name != want.Name {
		t.Errorf("name = %q, want %q", r.Name, want.Name)
	}
	if r.Referrer != want.Referrer {
		t.Errorf("referrer = %q, want %q", r.Referrer, want.Referrer)
	}
	if r.Status != "queued" {
		// Written at enqueue time and never transitioned. Read back so the day
		// it does mean something, the report already shows it.
		t.Errorf("status = %q, want %q", r.Status, "queued")
	}
	if r.CreatedAt.IsZero() {
		t.Error("created_at decoded as the zero time — check the firestore tag")
	}
}

func TestTheQueuesComeBackOldestFirst(t *testing.T) {
	client := queueClient(t)
	ctx := t.Context()
	s := store.NewFirestore(client)

	// Written directly with explicit timestamps: EnqueueReview stamps time.Now
	// through an unexported clock, so ordering cannot be tested through it.
	base := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	for i, id := range []string{"third", "first", "second"} {
		days := []int{2, 0, 1}[i]
		if _, _, err := client.Collection(store.CollReviews).Add(ctx, map[string]any{
			"concept_id": id,
			"kind":       "flag",
			"note":       "",
			"created_at": base.AddDate(0, 0, days),
		}); err != nil {
			t.Fatalf("seeding a review: %v", err)
		}
	}

	got, err := s.PendingReviews(ctx, 10)
	if err != nil {
		t.Fatalf("PendingReviews: %v", err)
	}
	// The backlog is the point: the flag that has waited longest reads first.
	want := []string{"first", "second", "third"}
	if len(got) != len(want) {
		t.Fatalf("read back %d reviews, want %d", len(got), len(want))
	}
	for i, w := range want {
		if got[i].ConceptID != w {
			t.Errorf("position %d = %q, want %q", i, got[i].ConceptID, w)
		}
	}
}

func TestTheLimitBoundsTheRead(t *testing.T) {
	client := queueClient(t)
	ctx := t.Context()
	s := store.NewFirestore(client)

	base := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	for i := range 5 {
		if _, _, err := client.Collection(store.CollReviews).Add(ctx, map[string]any{
			"concept_id": "attention",
			"kind":       "flag",
			"note":       "",
			"created_at": base.AddDate(0, 0, i),
		}); err != nil {
			t.Fatalf("seeding a review: %v", err)
		}
	}

	got, err := s.PendingReviews(ctx, 2)
	if err != nil {
		t.Fatalf("PendingReviews: %v", err)
	}
	if len(got) != 2 {
		t.Errorf("read %d reviews with -limit 2, want 2", len(got))
	}
}

func TestReadingAnEmptyQueueIsNotAnError(t *testing.T) {
	// "Nothing pending" is an answer. If this returned an error, `make queues`
	// would exit non-zero on the ordinary case.
	s := store.NewFirestore(queueClient(t))

	reviews, err := s.PendingReviews(t.Context(), 10)
	if err != nil {
		t.Errorf("PendingReviews on an empty collection: %v", err)
	}
	if len(reviews) != 0 {
		t.Errorf("got %d reviews from an empty collection", len(reviews))
	}

	requests, err := s.PendingRequests(t.Context(), 10)
	if err != nil {
		t.Errorf("PendingRequests on an empty collection: %v", err)
	}
	if len(requests) != 0 {
		t.Errorf("got %d requests from an empty collection", len(requests))
	}
}
