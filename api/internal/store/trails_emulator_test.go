package store_test

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	"cloud.google.com/go/firestore"
	"github.com/opendroid/the-infinity/api/internal/store"
	"google.golang.org/api/option"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// CreateTrail resolves every stop in one batched read, and the only way to prove
// that is to count the reads. A loop and a batch return identical trails — the
// difference is 200 sequential round trips against a 10-second handler timeout
// versus one, which no assertion about the result can see.
//
// So this dials the emulator through a stream interceptor and counts
// BatchGetDocuments, which is the RPC behind both DocumentRef.Get and
// Client.GetAll. The count is the test.
//
// Skipped rather than failed without an emulator, so `go test ./...` on a laptop
// stays one command. CI starts one; see the api job in ci.yml.
func trailClient(t *testing.T, reads *atomic.Int64) *firestore.Client {
	t.Helper()

	addr := os.Getenv("FIRESTORE_EMULATOR_HOST")
	if addr == "" {
		if os.Getenv("CI") != "" {
			t.Fatal("FIRESTORE_EMULATOR_HOST is not set in CI: the emulator step must run before the tests")
		}
		t.Skip("FIRESTORE_EMULATOR_HOST is not set — see `make test-emulator` to run the round-trip tests")
	}

	count := func(ctx context.Context, desc *grpc.StreamDesc, cc *grpc.ClientConn, method string,
		streamer grpc.Streamer, opts ...grpc.CallOption,
	) (grpc.ClientStream, error) {
		if strings.HasSuffix(method, "/BatchGetDocuments") {
			reads.Add(1)
		}
		return streamer(ctx, desc, cc, method, opts...)
	}

	// Dialled here rather than letting firestore.NewClient do it, because the
	// interceptor has to be on the connection. Passing our own conn as the last
	// option wins over the one NewClient builds for the emulator.
	conn, err := grpc.NewClient(addr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithChainStreamInterceptor(count))
	if err != nil {
		t.Fatalf("dialling the emulator: %v", err)
	}

	project := "test-" + strings.ToLower(strings.NewReplacer("/", "-", "_", "-").Replace(t.Name()))
	client, err := firestore.NewClient(t.Context(), project, option.WithGRPCConn(conn))
	if err != nil {
		t.Fatalf("connecting to the emulator: %v", err)
	}
	t.Cleanup(func() {
		if err := client.Close(); err != nil {
			t.Errorf("closing the emulator client: %v", err)
		}
	})

	// The emulator outlives a single run on a laptop and the project id comes
	// from the test name, so a second run would read the first run's documents.
	emptyCollections(t, client, store.CollConcepts, store.CollTrails)
	return client
}

func seedConcepts(t *testing.T, client *firestore.Client, ids ...string) {
	t.Helper()
	for _, id := range ids {
		_, err := client.Collection(store.CollConcepts).Doc(id).Set(t.Context(), map[string]any{
			"id":    id,
			"title": strings.ToUpper(id[:1]) + id[1:],
			"tier":  string(store.TierFrontier),
		})
		if err != nil {
			t.Fatalf("seeding %s: %v", id, err)
		}
	}
}

func TestCreatingATrailResolvesEveryStopInOneRead(t *testing.T) {
	var reads atomic.Int64
	client := trailClient(t, &reads)
	seedConcepts(t, client, "attention", "backpropagation", "causal-masking", "adam")

	s := store.NewFirestore(client)
	nt := store.NewTrail{
		DurationS: 300,
		Stops: []store.NewTrailStop{
			{ID: "attention", DepthReadAt: store.DepthIntuition},
			{ID: "backpropagation", DepthReadAt: store.DepthEngineer},
			{ID: "causal-masking", DepthReadAt: store.DepthMath},
			// A reader doubling back to a concept is ordinary. GetAll returns one
			// snapshot per ref including repeats, which is what keeps the two
			// visits distinct rather than collapsing them.
			{ID: "attention", DepthReadAt: store.DepthMath},
			{ID: "adam", DepthReadAt: store.DepthIntuition},
		},
	}

	reads.Store(0)
	trail, err := s.CreateTrail(t.Context(), nt)
	if err != nil {
		t.Fatalf("CreateTrail: %v", err)
	}

	// Two, not one: the idempotency check reads the trail document before any
	// stop is resolved, which is the point of doing it first — a retry costs one
	// read regardless of how long the walk is.
	if got := reads.Load(); got != 2 {
		t.Errorf("CreateTrail issued %d document reads for a 5-stop trail, want 2 "+
			"(one existence check, one batch); a loop over the stops would be 6", got)
	}

	if len(trail.Stops) != 5 {
		t.Fatalf("trail has %d stops, want 5", len(trail.Stops))
	}
	for i, want := range []struct {
		id    string
		title string
		depth store.Depth
	}{
		{"attention", "Attention", store.DepthIntuition},
		{"backpropagation", "Backpropagation", store.DepthEngineer},
		{"causal-masking", "Causal-masking", store.DepthMath},
		{"attention", "Attention", store.DepthMath},
		{"adam", "Adam", store.DepthIntuition},
	} {
		got := trail.Stops[i]
		if got.ID != want.id || got.Title != want.title || got.DepthReadAt != want.depth || got.N != i+1 {
			t.Errorf("stop %d = %+v, want id=%s title=%s depth=%s n=%d",
				i, got, want.id, want.title, want.depth, i+1)
		}
	}
}

// The retry path: re-posting an identical walk returns the stored trail and must
// not resolve the stops again.
func TestRecreatingAnIdenticalTrailReadsOnlyTheTrail(t *testing.T) {
	var reads atomic.Int64
	client := trailClient(t, &reads)
	seedConcepts(t, client, "attention", "backpropagation")

	s := store.NewFirestore(client)
	nt := store.NewTrail{
		DurationS: 60,
		Stops: []store.NewTrailStop{
			{ID: "attention", DepthReadAt: store.DepthIntuition},
			{ID: "backpropagation", DepthReadAt: store.DepthEngineer},
		},
	}
	first, err := s.CreateTrail(t.Context(), nt)
	if err != nil {
		t.Fatalf("CreateTrail: %v", err)
	}

	reads.Store(0)
	again, err := s.CreateTrail(t.Context(), nt)
	if err != nil {
		t.Fatalf("CreateTrail again: %v", err)
	}
	if got := reads.Load(); got != 1 {
		t.Errorf("a retry cost %d reads, want 1 — the existing trail alone", got)
	}
	if again.Slug != first.Slug {
		t.Errorf("retry minted a second slug: %s then %s", first.Slug, again.Slug)
	}
}

// A stop naming a concept that does not exist is a stale trail in someone's
// localStorage, and the handler turns ErrNotFound into a field error rather than
// a 500. GetAll reports a missing document as a snapshot that does not exist,
// not as an error, so this is the case a batched read is easiest to get wrong.
func TestATrailNamingAMissingConceptIsNotFound(t *testing.T) {
	var reads atomic.Int64
	client := trailClient(t, &reads)
	seedConcepts(t, client, "attention")

	s := store.NewFirestore(client)
	nt := store.NewTrail{
		Stops: []store.NewTrailStop{
			{ID: "attention", DepthReadAt: store.DepthIntuition},
			{ID: "no-such-concept", DepthReadAt: store.DepthIntuition},
		},
	}

	reads.Store(0)
	trail, err := s.CreateTrail(t.Context(), nt)
	if !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("CreateTrail = (%v, %v), want ErrNotFound", trail, err)
	}
	if !strings.Contains(err.Error(), "no-such-concept") {
		t.Errorf("error does not name the missing stop: %v", err)
	}
	if got := reads.Load(); got != 2 {
		t.Errorf("the failing path cost %d reads, want 2", got)
	}

	// And nothing was written: a trail with a hole in it must not become a page.
	docs, err := client.Collection(store.CollTrails).Documents(t.Context()).GetAll()
	if err != nil {
		t.Fatalf("listing trails: %v", err)
	}
	if len(docs) != 0 {
		t.Errorf("a rejected trail left %d documents behind", len(docs))
	}
}
