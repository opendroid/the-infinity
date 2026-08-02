package store_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/opendroid/the-infinity/api/internal/store"
)

func stops(pairs ...string) []store.NewTrailStop {
	out := make([]store.NewTrailStop, 0, len(pairs)/2)
	for i := 0; i+1 < len(pairs); i += 2 {
		out = append(out, store.NewTrailStop{ID: pairs[i], DepthReadAt: store.Depth(pairs[i+1])})
	}
	return out
}

// A trail's identity is what makes POST /trails idempotent, which openapi.yaml
// promises. Fake and Firestore both derive it here so they cannot disagree —
// they once did, and the fake's version was the one the tests saw.
func TestTrailKeyIdentifiesTheWalk(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		a, b []store.NewTrailStop
		same bool
	}{
		{
			name: "the same walk twice",
			a:    stops("attention", "intuition", "moe", "math"),
			b:    stops("attention", "intuition", "moe", "math"),
			same: true,
		},
		{
			// Order is the walk. Reversing it is a different journey through the
			// graph and must not collide with the first.
			name: "the same stops in the other order",
			a:    stops("attention", "intuition", "moe", "math"),
			b:    stops("moe", "math", "attention", "intuition"),
			same: false,
		},
		{
			// The depth is part of what was read, so it is part of the identity —
			// otherwise re-reading a trail at a deeper level silently overwrites
			// the shallower record.
			name: "the same stops read at different depths",
			a:    stops("attention", "intuition"),
			b:    stops("attention", "math"),
			same: false,
		},
		{
			name: "a longer walk sharing a prefix",
			a:    stops("attention", "intuition"),
			b:    stops("attention", "intuition", "moe", "math"),
			same: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			ka, kb := store.TrailKey(tt.a), store.TrailKey(tt.b)
			if (ka == kb) != tt.same {
				t.Errorf("TrailKey equal = %v, want %v (%q vs %q)", ka == kb, tt.same, ka, kb)
			}
		})
	}
}

// The slug is a URL someone shares, so it has to be readable as well as unique,
// and stable across processes — a nonce or a map iteration anywhere in here
// would break idempotency without breaking any single run.
func TestTrailSlugIsReadableAndStable(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		stops      []store.NewTrailStop
		wantPrefix string
	}{
		{name: "no stops still yields a slug", stops: nil, wantPrefix: "empty-"},
		{name: "one stop names it", stops: stops("attention", "math"), wantPrefix: "attention-"},
		{
			name:       "several stops name both ends",
			stops:      stops("attention", "math", "middle", "math", "expert-parallelism", "math"),
			wantPrefix: "attention-to-expert-parallelism-",
		},
		{
			// Long ids are truncated so a slug stays a URL rather than a wall.
			name:       "an over-long id is truncated",
			stops:      stops(strings.Repeat("a", 40), "math"),
			wantPrefix: strings.Repeat("a", 20) + "-",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := store.TrailSlug(tt.stops)
			if !strings.HasPrefix(got, tt.wantPrefix) {
				t.Errorf("TrailSlug = %q, want prefix %q", got, tt.wantPrefix)
			}
			if got != store.TrailSlug(tt.stops) {
				t.Error("TrailSlug is not deterministic — idempotency depends on it")
			}
		})
	}
}

// The prefix drives 404 suggestions. Fake and Firestore once derived it
// differently, so an id starting with a hyphen matched everything in one and
// nothing in the other.
func TestConceptPrefix(t *testing.T) {
	t.Parallel()

	tests := []struct{ id, want string }{
		{id: "mixture-of-experts", want: "mixture"},
		{id: "attention", want: "attention"},
		{id: "-leading", want: "-leading"}, // no split: index 0 is not > 0
		{id: "trailing-", want: "trailing"},
		{id: "", want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.id, func(t *testing.T) {
			t.Parallel()
			if got := store.ConceptPrefix(tt.id); got != tt.want {
				t.Errorf("ConceptPrefix(%q) = %q, want %q", tt.id, got, tt.want)
			}
		})
	}
}

// An id reaches Firestore's Doc() directly, so what this rejects is the
// difference between a 400 and a 500 — and, for the path separator, between a
// document and an odd-component path that means something else entirely.
func TestValidConceptID(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		id   string
		want bool
	}{
		{name: "an ordinary slug", id: "mixture-of-experts", want: true},
		{name: "digits are allowed", id: "gpt-4", want: true},
		{name: "the shortest legal id", id: "ab", want: true},

		{name: "a path separator, which would build an odd Firestore path", id: "a/b"},
		{name: "a parent traversal", id: ".."},
		{name: "an empty id"},
		{name: "one character", id: "a"},
		{name: "over the length limit", id: strings.Repeat("a", 65)},
		{name: "uppercase", id: "Attention"},
		{name: "a leading hyphen", id: "-attention"},
		{name: "a trailing hyphen", id: "attention-"},
		{name: "a double hyphen", id: "a--b"},
		{name: "a space", id: "mixture of experts"},
		{name: "an underscore", id: "mixture_of_experts"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := store.ValidConceptID(tt.id); got != tt.want {
				t.Errorf("ValidConceptID(%q) = %v, want %v", tt.id, got, tt.want)
			}
		})
	}
}

// openapi.yaml marks every edge group, citation list, and stop list required.
// A nil slice marshals as null by default, and a client doing edges.requires.map
// crashes on it — on exactly the leaf concepts the empty case exists for.
func TestListMarshalsEmptyAsArray(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		list store.List[store.Edge]
		want string
	}{
		{name: "nil", list: nil, want: "[]"},
		{name: "empty but allocated", list: store.List[store.Edge]{}, want: "[]"},
		{
			name: "populated",
			list: store.List[store.Edge]{{ID: "a", Title: "A", Tier: store.TierVerified}},
			want: `[{"id":"a","title":"A","tier":"verified","reviewed":false}]`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := json.Marshal(tt.list)
			if err != nil {
				t.Fatalf("Marshal: %v", err)
			}
			if string(got) != tt.want {
				t.Errorf("marshalled to %s, want %s", got, tt.want)
			}
		})
	}
}

// No REQUIRED field of a concept may serialise as null.
//
// The exceptions are exact rather than convenient: openapi.yaml declares review
// and provenance as `oneOf: [null, object]`, because a concept is verified or
// frontier and the absent one is meaningfully null. Everything else in the
// required list is a value a client will index into.
//
// This is the check that caught viz.params (#80). The bare struct is the point:
// a concept assembled without every field set is exactly what a partial write, a
// future migration, or a hand-built fixture produces.
func TestNoRequiredFieldSerialisesAsNull(t *testing.T) {
	t.Parallel()

	raw, err := json.Marshal(store.Concept{ID: "leaf", Title: "Leaf"})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}

	var got map[string]json.RawMessage
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}

	nullable := map[string]bool{"review": true, "provenance": true}
	// The required list from docs/openapi.yaml, Concept.
	for _, field := range []string{
		"id", "title", "domain", "tier", "bodies", "viz", "edges", "citations", "updated_at",
	} {
		v, ok := got[field]
		if !ok {
			t.Errorf("required field %q is absent from the response", field)
			continue
		}
		if nullable[field] {
			continue
		}
		if string(v) == "null" {
			t.Errorf("required field %q serialised as null", field)
		}
	}

	// Nested, since that is where it hid: viz.params is required and typed object.
	var viz map[string]json.RawMessage
	if err := json.Unmarshal(got["viz"], &viz); err != nil {
		t.Fatalf("viz is not an object: %v", err)
	}
	for _, field := range []string{"primitive", "params", "param_controls", "caption"} {
		if string(viz[field]) == "null" {
			t.Errorf("required field viz.%s serialised as null", field)
		}
	}

	if !strings.Contains(string(raw), `"params":{}`) {
		t.Errorf("nil params did not marshal as an empty object: %s", raw)
	}
}

func TestFakeCreateTrailIsIdempotent(t *testing.T) {
	t.Parallel()

	f := store.NewFake()
	f.Concepts["attention"] = &store.Concept{ID: "attention", Title: "Attention", Tier: store.TierVerified}

	nt := store.NewTrail{Stops: stops("attention", "math"), DurationS: 60}
	first, err := f.CreateTrail(context.Background(), nt)
	if err != nil {
		t.Fatalf("first CreateTrail: %v", err)
	}
	second, err := f.CreateTrail(context.Background(), nt)
	if err != nil {
		t.Fatalf("second CreateTrail: %v", err)
	}
	if first.Slug != second.Slug {
		t.Errorf("slugs differ: %q then %q — the same walk must land on the same trail", first.Slug, second.Slug)
	}
	if len(f.Trails) != 1 {
		t.Errorf("stored %d trails for one walk, want 1", len(f.Trails))
	}
}

// The daily cap is the layer that actually bounds the bill, so the fake has to
// enforce it the way Firestore's transaction does — a fake that always allows
// would let every handler test pass while the cap did nothing.
func TestFakeReserveWriteStopsAtTheCap(t *testing.T) {
	t.Parallel()

	f := store.NewFake()
	const day, limit = "2026-08-02", 2

	for i := range limit {
		ok, err := f.ReserveWrite(context.Background(), day, limit)
		if err != nil {
			t.Fatalf("reserve %d: %v", i+1, err)
		}
		if !ok {
			t.Fatalf("reserve %d was refused inside the cap", i+1)
		}
	}

	ok, err := f.ReserveWrite(context.Background(), day, limit)
	if err != nil {
		t.Fatalf("reserve past the cap: %v", err)
	}
	if ok {
		t.Error("a write past the daily cap was allowed")
	}

	// A new day is a new budget, which is the whole point of keying on the date.
	if ok, _ := f.ReserveWrite(context.Background(), "2026-08-03", limit); !ok {
		t.Error("the next day did not start with a fresh budget")
	}
}
