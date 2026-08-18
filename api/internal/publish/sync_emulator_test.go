package publish_test

import (
	"fmt"
	"os"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/opendroid/the-infinity/api/internal/publish"
	"github.com/opendroid/the-infinity/api/internal/store"
)

// Everything in this file runs against the Firestore emulator, and only there.
//
// It exists because the handler tests cannot catch a whole class of defect: they
// run against store.Fake, which is Go structs in a map, so serialisation never
// happens. #26 shipped two bugs that lived exactly there — the store types had
// no `firestore` tags, so every snake_case field decoded as its zero value, and
// nothing noticed because no test ever crossed the wire. This does.
//
// Skipped rather than failed without an emulator: `go test ./...` on a laptop
// must stay a single command with no daemon to start. CI starts one — see the
// api job in .github/workflows/ci.yml.
func emulatorClient(t *testing.T) *firestore.Client {
	t.Helper()

	if os.Getenv("FIRESTORE_EMULATOR_HOST") == "" {
		// Loud in CI, quiet on a laptop. A skip prints nothing without -v, so a
		// dropped env var would turn the only tests that touch real
		// serialisation into a no-op and leave the run green — the exact shape
		// of the problem these tests exist to catch.
		if os.Getenv("CI") != "" {
			t.Fatal("FIRESTORE_EMULATOR_HOST is not set in CI: the emulator step must run before the tests")
		}
		t.Skip("FIRESTORE_EMULATOR_HOST is not set — see `make test-emulator` to run the round-trip tests")
	}

	// The emulator accepts any project id and never authenticates. A distinct one
	// per test keeps parallel tests off each other's documents, which matters
	// because Sync deletes everything the current graph does not name.
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
	return client
}

// publishRealContent syncs the repo's actual nodes and returns a Store reading
// the same database — the two halves of the seam, meeting on real documents.
func publishRealContent(t *testing.T, client *firestore.Client) (*publish.Graph, store.Store) {
	t.Helper()

	nodes, err := publish.Load(nodesDir)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	graph, err := publish.Derive(nodes, time.Date(2026, 8, 2, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("Derive: %v", err)
	}
	if _, err := publish.Sync(t.Context(), client, graph); err != nil {
		t.Fatalf("Sync: %v", err)
	}
	return graph, store.NewFirestore(client)
}

// Every field publish computes has to arrive at the API intact. The failure this
// catches is a field that crosses the wire and comes back changed — a nested
// struct Firestore flattens, a slice that decodes short, a pointer that arrives
// nil — none of which store.Fake can express, because it hands back the same Go
// value it was given.
//
// It does NOT catch a missing struct tag; see the field-name test below for why.
func TestPublishedConceptRoundTrips(t *testing.T) {
	client := emulatorClient(t)
	graph, st := publishRealContent(t, client)

	for _, want := range graph.Concepts {
		t.Run(want.ID, func(t *testing.T) {
			got, err := st.Concept(t.Context(), want.ID)
			if err != nil {
				t.Fatalf("reading back %s: %v", want.ID, err)
			}

			// Field by field, because the failure mode is one field silently
			// zeroed rather than the whole document missing.
			if got.Title != want.Title {
				t.Errorf("title = %q, want %q", got.Title, want.Title)
			}
			if got.Domain != want.Domain {
				t.Errorf("domain = %q, want %q", got.Domain, want.Domain)
			}
			if got.Tier != want.Tier {
				t.Errorf("tier = %q, want %q", got.Tier, want.Tier)
			}
			if got.UpdatedAt != want.UpdatedAt {
				t.Errorf("updated_at = %q, want %q", got.UpdatedAt, want.UpdatedAt)
			}
			if got.Bodies != want.Bodies {
				t.Error("bodies did not survive the round trip")
			}
			if got.Viz.Primitive != want.Viz.Primitive || got.Viz.Caption != want.Viz.Caption {
				t.Errorf("viz = %+v, want %+v", got.Viz, want.Viz)
			}
			if len(got.Viz.Params) != len(want.Viz.Params) {
				t.Errorf("viz.params has %d keys, want %d", len(got.Viz.Params), len(want.Viz.Params))
			}
			if len(got.Viz.ParamControls) != len(want.Viz.ParamControls) {
				t.Errorf("viz.param_controls has %d entries, want %d",
					len(got.Viz.ParamControls), len(want.Viz.ParamControls))
			}
			if len(got.Citations) != len(want.Citations) {
				t.Fatalf("citations has %d entries, want %d", len(got.Citations), len(want.Citations))
			}
			for i := range want.Citations {
				if got.Citations[i] != want.Citations[i] {
					t.Errorf("citations[%d] = %+v, want %+v", i, got.Citations[i], want.Citations[i])
				}
			}
			assertEdges(t, "requires", got.Edges.Requires, want.Edges.Requires)
			assertEdges(t, "unlocks", got.Edges.Unlocks, want.Edges.Unlocks)
			assertEdges(t, "adjacent", got.Edges.Adjacent, want.Edges.Adjacent)

			// A verified concept must come back with its reviewer: the tier is
			// derived from it, so losing it would leave the badge and the byline
			// contradicting each other.
			switch {
			case want.Review != nil:
				if got.Review == nil || *got.Review != *want.Review {
					t.Errorf("review = %+v, want %+v", got.Review, want.Review)
				}
			case want.Prov != nil:
				if got.Prov == nil || *got.Prov != *want.Prov {
					t.Errorf("provenance = %+v, want %+v", got.Prov, want.Prov)
				}
			}
		})
	}
}

func assertEdges(t *testing.T, group string, got, want store.List[store.Edge]) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("edges.%s has %d entries, want %d", group, len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("edges.%s[%d] = %+v, want %+v", group, i, got[i], want[i])
		}
	}
}

func TestPublishedNeighborhoodRoundTrips(t *testing.T) {
	client := emulatorClient(t)
	graph, st := publishRealContent(t, client)

	for id, want := range graph.Neighborhoods {
		t.Run(id, func(t *testing.T) {
			got, err := st.Neighborhood(t.Context(), id)
			if err != nil {
				t.Fatalf("reading back the neighborhood for %s: %v", id, err)
			}
			if got.Center != want.Center {
				t.Errorf("center = %+v, want %+v", got.Center, want.Center)
			}
			if len(got.Nodes) != len(want.Nodes) {
				t.Fatalf("nodes has %d entries, want %d", len(got.Nodes), len(want.Nodes))
			}
			for i := range want.Nodes {
				if got.Nodes[i] != want.Nodes[i] {
					t.Errorf("nodes[%d] = %+v, want %+v", i, got.Nodes[i], want.Nodes[i])
				}
			}
			if len(got.Links) != len(want.Links) {
				t.Fatalf("links has %d entries, want %d", len(got.Links), len(want.Links))
			}
			for i := range want.Links {
				if got.Links[i] != want.Links[i] {
					t.Errorf("links[%d] = %+v, want %+v", i, got.Links[i], want.Links[i])
				}
			}
		})
	}
}

// The round-trip tests above cannot catch a missing `firestore` tag, and it is
// worth being precise about why: publish and the API share one set of structs,
// so a wrong field name is wrong symmetrically and the value comes back intact.
// That is a real improvement over #26 — the two sides cannot disagree — but it
// means the tests are self-consistent rather than correct.
//
// This is the test that checks correctness: what the field is actually called in
// Firestore. Those names are the API's shape (/docs/openapi.yaml), the shape a
// backup restores, and the shape anything that is not this Go binary reads. A
// dropped tag renames `grew_this_week` to `GrewThisWeek` and nothing else in the
// suite would notice.
func TestPublishedDocumentsUseTheDocumentedFieldNames(t *testing.T) {
	client := emulatorClient(t)
	graph, _ := publishRealContent(t, client)

	// Pick a concept per assertion rather than reusing the first one for all of
	// them. `review` and `edges.unlocks[]` only exist on concepts that have
	// them, so a single id checks those two paths only while it happens to be
	// a verified concept with dependents — which is a property of alphabetical
	// order, not of the test. Seed batch 1 added `alibi`, it sorted to the
	// front, and both assertions started reading nil.
	//
	// find() fails loudly when the corpus has no such concept, because the
	// alternative is an assertion that quietly stops running.
	find := func(what string, ok func(store.Concept) bool) string {
		t.Helper()
		for _, c := range graph.Concepts {
			if ok(c) {
				return c.ID
			}
		}
		t.Fatalf("no concept in /content/nodes %s — this assertion cannot run", what)
		return ""
	}

	id := graph.Concepts[0].ID
	verifiedID := find("carries a review", func(c store.Concept) bool { return c.Review != nil })
	unlocksID := find("has an unlocks edge", func(c store.Concept) bool { return len(c.Edges.Unlocks) > 0 })
	concepts := client.Collection(store.CollConcepts)

	tests := []struct {
		name string
		doc  *firestore.DocumentRef
		// Dotted path to the map whose keys are checked; "" for the root. A
		// segment of "[]" takes the first element of an array — without it the
		// structs that only ever appear inside a slice, Edge and MiniMapLink,
		// would have no field-name assertion at all, which is exactly the gap
		// this test exists to close.
		at   string
		want []string
	}{
		{
			name: "concept",
			doc:  concepts.Doc(id),
			// "origin" is stored for every concept, not only the eight that author
			// one: the firestore tag carries no omitempty, so an absent array is
			// written as null rather than skipped. Listing it here is the point of
			// this test — a field reaches Firestore only when someone says so.
			want: []string{"bodies", "citations", "domain", "edges", "emphasis", "id",
				"origin", "provenance", "review", "tier", "title", "updated_at", "viz"},
		},
		{name: "concept.bodies", doc: concepts.Doc(id), at: "bodies",
			want: []string{"engineer", "intuition", "math"}},
		// caption_engineer carries no `omitempty` on its firestore tag, so it is
		// stored — as "" — even for the nodes that do not author one. That is
		// deliberate: the stored shape stays the same for every concept, and the
		// "absent means use the default" distinction is made at the JSON edge,
		// where clients read it, rather than in the document layout.
		{name: "concept.viz", doc: concepts.Doc(id), at: "viz",
			want: []string{"caption", "caption_engineer", "param_controls", "params", "primitive"}},
		{name: "concept.edges", doc: concepts.Doc(id), at: "edges",
			want: []string{"adjacent", "requires", "unlocks"}},
		{name: "concept.edges.unlocks[]", doc: concepts.Doc(unlocksID), at: "edges.unlocks.[]",
			want: []string{"id", "reviewed", "tier", "title"}},
		{name: "concept.citations[]", doc: concepts.Doc(id), at: "citations.[]",
			want: []string{"ref", "title", "url"}},
		{name: "concept.review", doc: concepts.Doc(verifiedID), at: "review",
			want: []string{"reviewed_at", "reviewed_by"}},
		{
			name: "neighborhood",
			doc:  concepts.Doc(id).Collection(store.SubNeighborhood).Doc(store.DocNeighborhood),
			want: []string{"center", "links", "nodes"},
		},
		{
			name: "neighborhood.center",
			doc:  concepts.Doc(id).Collection(store.SubNeighborhood).Doc(store.DocNeighborhood),
			at:   "center",
			want: []string{"id", "tier", "title", "x", "y"},
		},
		{
			name: "neighborhood.nodes[]",
			doc:  concepts.Doc(id).Collection(store.SubNeighborhood).Doc(store.DocNeighborhood),
			at:   "nodes.[]",
			want: []string{"id", "tier", "title", "x", "y"},
		},
		{
			// The struct this change reshaped. `type` is new, and it is the one
			// field no other assertion in the suite would notice losing its tag.
			name: "neighborhood.links[]",
			doc:  concepts.Doc(id).Collection(store.SubNeighborhood).Doc(store.DocNeighborhood),
			at:   "links.[]",
			want: []string{"from", "reviewed", "to", "type"},
		},
		{
			name: "stats",
			doc:  client.Collection(store.CollCounters).Doc(store.DocStats),
			want: []string{"concepts", "grew_this_week"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			snap, err := tt.doc.Get(t.Context())
			if err != nil {
				t.Fatalf("reading %s: %v", tt.doc.Path, err)
			}
			data := snap.Data()
			if tt.at != "" {
				var err error
				if data, err = descend(snap.Data(), tt.at); err != nil {
					t.Fatal(err)
				}
			}

			got := make([]string, 0, len(data))
			for k := range data {
				got = append(got, k)
			}
			sort.Strings(got)

			if !equal(got, tt.want) {
				t.Errorf("stored field names = %v, want %v — a `firestore` struct tag is missing or misspelled",
					got, tt.want)
			}
		})
	}
}

// descend walks a dotted path into a decoded document. A "[]" segment takes the
// first element of an array, which is how the structs that only exist inside a
// slice become reachable.
func descend(data map[string]any, path string) (map[string]any, error) {
	current := any(data)
	for _, seg := range strings.Split(path, ".") {
		if seg == "[]" {
			list, ok := current.([]any)
			if !ok {
				return nil, fmt.Errorf("%s: %T is not an array", path, current)
			}
			if len(list) == 0 {
				return nil, fmt.Errorf("%s: the array is empty, so nothing is asserted", path)
			}
			current = list[0]
			continue
		}
		m, ok := current.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("%s: %T is not a map", path, current)
		}
		current = m[seg]
	}
	out, ok := current.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%s resolves to %T, want a map", path, current)
	}
	return out, nil
}

func TestPublishedStatsRoundTrip(t *testing.T) {
	client := emulatorClient(t)

	nodes, err := publish.Load(nodesDir)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	// A clock late enough that nothing is inside the growth window, so the two
	// counters differ and a swapped or dropped field cannot pass by coincidence.
	graph, err := publish.Derive(nodes, time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("Derive: %v", err)
	}
	graph.Stats.GrewThisWeek = 3

	if _, err := publish.Sync(t.Context(), client, graph); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	got, err := store.NewFirestore(client).Stats(t.Context())
	if err != nil {
		t.Fatalf("reading back stats: %v", err)
	}
	if *got != graph.Stats {
		t.Errorf("stats = %+v, want %+v", *got, graph.Stats)
	}
}

// Idempotence is what makes a deploy safe to re-run: publishing the same commit
// twice must leave the database exactly as the first run did.
func TestSyncIsIdempotent(t *testing.T) {
	client := emulatorClient(t)
	graph, st := publishRealContent(t, client)

	first, err := st.Concept(t.Context(), graph.Concepts[0].ID)
	if err != nil {
		t.Fatalf("reading after the first publish: %v", err)
	}

	report, err := publish.Sync(t.Context(), client, graph)
	if err != nil {
		t.Fatalf("second Sync: %v", err)
	}
	if report.Deleted != 0 {
		t.Errorf("the second publish deleted %d concepts, want 0", report.Deleted)
	}

	second, err := st.Concept(t.Context(), graph.Concepts[0].ID)
	if err != nil {
		t.Fatalf("reading after the second publish: %v", err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Error("two publishes of one graph produced different documents")
	}
}

// A concept deleted from git must leave Firestore, mini-map included. An orphaned
// subcollection is unreachable through the API and nothing will ever clean it up.
func TestSyncRemovesConceptsGitNoLongerHas(t *testing.T) {
	client := emulatorClient(t)
	graph, st := publishRealContent(t, client)

	dropped := graph.Concepts[0].ID
	trimmed := &publish.Graph{
		Concepts:      graph.Concepts[1:],
		Neighborhoods: graph.Neighborhoods,
		Stats:         graph.Stats,
	}

	report, err := publish.Sync(t.Context(), client, trimmed)
	if err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if report.Deleted != 1 {
		t.Errorf("deleted %d concepts, want 1", report.Deleted)
	}

	if _, err := st.Concept(t.Context(), dropped); err == nil {
		t.Errorf("%s is still readable after being removed from the graph", dropped)
	}
	if _, err := st.Neighborhood(t.Context(), dropped); err == nil {
		t.Errorf("%s's mini-map outlived the concept it belongs to", dropped)
	}
}

// The 404 page's suggestions are a Firestore query, not a scan, and they depend
// on the published document carrying an `id` field to range over. Publishing
// without one would leave every 404 a dead end — and pass every handler test,
// since the fake ranges over a map key.
func TestPublishedConceptsAreQueryable(t *testing.T) {
	client := emulatorClient(t)
	graph, st := publishRealContent(t, client)

	target := graph.Concepts[0].ID
	near, err := st.Nearest(t.Context(), target, 3)
	if err != nil {
		t.Fatalf("Nearest: %v", err)
	}
	for _, n := range near {
		if n.ID == target {
			t.Errorf("suggestions for %s include itself", target)
		}
		if n.Title == "" || n.Tier == "" {
			t.Errorf("suggestion %+v is missing a denormalised field", n)
		}
	}
}
