package store_test

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/opendroid/the-infinity/api/internal/store"
)

// A store backed by a database cannot hand its caller a pointer into its own
// state. Fake did, so every value it returned was a live handle on the fixture:
// a test that sorted a returned edge list reordered it for every test after it,
// and the failure surfaced somewhere else entirely.
//
// The check below is structural rather than a list of fields to remember.
// `fill` populates every field through reflection and `assertDistinct` walks
// both values in step, so a slice or pointer added to Concept later is covered
// the moment it exists — the clone that forgets it fails here with the path.
func TestTheFakeSharesNoMemoryWithItsCaller(t *testing.T) {
	t.Parallel()

	ctx := t.Context()
	f := store.NewFake()

	var concept store.Concept
	fill(reflect.ValueOf(&concept).Elem())
	concept.ID = "attention"
	f.Concepts["attention"] = &concept

	var hood store.Neighborhood
	fill(reflect.ValueOf(&hood).Elem())
	f.Neighborhoods["attention"] = &hood

	var trail store.Trail
	fill(reflect.ValueOf(&trail).Elem())
	f.Trails["abc123"] = &trail

	got, err := f.Concept(ctx, "attention")
	if err != nil {
		t.Fatalf("Concept: %v", err)
	}
	assertDistinct(t, reflect.ValueOf(&concept).Elem(), reflect.ValueOf(got).Elem(), "Concept")

	gotHood, err := f.Neighborhood(ctx, "attention")
	if err != nil {
		t.Fatalf("Neighborhood: %v", err)
	}
	assertDistinct(t, reflect.ValueOf(&hood).Elem(), reflect.ValueOf(gotHood).Elem(), "Neighborhood")

	gotTrail, err := f.Trail(ctx, "abc123")
	if err != nil {
		t.Fatalf("Trail: %v", err)
	}
	assertDistinct(t, reflect.ValueOf(&trail).Elem(), reflect.ValueOf(gotTrail).Elem(), "Trail")
}

// The same property stated the way it actually bites: mutate what you were
// given, read again, and the second read must be untouched.
func TestMutatingAResultDoesNotCorruptALaterRead(t *testing.T) {
	t.Parallel()

	ctx := t.Context()
	f := store.NewFake()
	f.Concepts["attention"] = &store.Concept{
		ID:        "attention",
		Title:     "Attention",
		Tier:      store.TierVerified,
		Citations: store.List[store.Citation]{{Ref: "arXiv:1706.03762", Title: "Attention Is All You Need"}},
		Edges: store.Edges{
			Requires: store.List[store.Edge]{{ID: "vector-embeddings", Title: "Vector Embeddings"}},
		},
		Review: &store.Review{ReviewedBy: "ajay", ReviewedAt: "2026-08-01"},
	}

	first, err := f.Concept(ctx, "attention")
	if err != nil {
		t.Fatalf("first read: %v", err)
	}
	first.Title = "Mutated"
	first.Citations[0].Title = "Mutated"
	first.Edges.Requires[0].ID = "mutated"
	first.Review.ReviewedBy = "mutated"

	second, err := f.Concept(ctx, "attention")
	if err != nil {
		t.Fatalf("second read: %v", err)
	}
	for _, c := range []struct {
		what string
		got  string
		want string
	}{
		{"Title", second.Title, "Attention"},
		{"Citations[0].Title", second.Citations[0].Title, "Attention Is All You Need"},
		{"Edges.Requires[0].ID", second.Edges.Requires[0].ID, "vector-embeddings"},
		{"Review.ReviewedBy", second.Review.ReviewedBy, "ajay"},
	} {
		if c.got != c.want {
			t.Errorf("after mutating the first result, %s = %q, want %q", c.what, c.got, c.want)
		}
	}
}

// A trail comes back from CreateTrail and again from Trail; both must be copies,
// and neither may be the document the fake stored.
func TestACreatedTrailIsAlsoACopy(t *testing.T) {
	t.Parallel()

	ctx := t.Context()
	f := store.NewFake()
	f.Concepts["attention"] = &store.Concept{ID: "attention", Title: "Attention", Tier: store.TierFrontier}

	nt := store.NewTrail{
		Stops:     []store.NewTrailStop{{ID: "attention", DepthReadAt: store.DepthIntuition}},
		DurationS: 42,
	}
	created, err := f.CreateTrail(ctx, nt)
	if err != nil {
		t.Fatalf("CreateTrail: %v", err)
	}
	created.Stops[0].Title = "Mutated"

	// The idempotent path returns the stored trail; it must not be the one just
	// scribbled on. This is the retry case the idempotency exists for.
	again, err := f.CreateTrail(ctx, nt)
	if err != nil {
		t.Fatalf("CreateTrail again: %v", err)
	}
	if again.Stops[0].Title != "Attention" {
		t.Errorf("re-creating returned the mutated trail: %q", again.Stops[0].Title)
	}

	read, err := f.Trail(ctx, created.Slug)
	if err != nil {
		t.Fatalf("Trail: %v", err)
	}
	if read.Stops[0].Title != "Attention" {
		t.Errorf("reading back returned the mutated trail: %q", read.Stops[0].Title)
	}
}

// fill sets every field to a non-zero value, allocating pointers and giving
// every slice and map one entry, so assertDistinct has something to compare.
// A zero field is invisible to an aliasing check — two nil slices share nothing
// because neither exists.
func fill(v reflect.Value) {
	switch v.Kind() {
	case reflect.String:
		v.SetString("x")
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		v.SetInt(1)
	case reflect.Float32, reflect.Float64:
		v.SetFloat(1)
	case reflect.Bool:
		v.SetBool(true)
	case reflect.Ptr:
		v.Set(reflect.New(v.Type().Elem()))
		fill(v.Elem())
	case reflect.Slice:
		v.Set(reflect.MakeSlice(v.Type(), 1, 1))
		fill(v.Index(0))
	case reflect.Map:
		v.Set(reflect.MakeMap(v.Type()))
		key := reflect.New(v.Type().Key()).Elem()
		fill(key)
		val := reflect.New(v.Type().Elem()).Elem()
		fill(val)
		v.SetMapIndex(key, val)
	case reflect.Struct:
		for i := range v.NumField() {
			if v.Field(i).CanSet() {
				fill(v.Field(i))
			}
		}
	default:
		panic(fmt.Sprintf("fill: unhandled kind %s — teach it this shape", v.Kind()))
	}
}

// assertDistinct walks two values in step and fails on any shared backing
// memory: the same slice array, the same map, the same pointee.
func assertDistinct(t *testing.T, a, b reflect.Value, path string) {
	t.Helper()

	switch a.Kind() {
	case reflect.Ptr:
		if a.IsNil() || b.IsNil() {
			return
		}
		if a.Pointer() == b.Pointer() {
			t.Errorf("%s: the copy points at the original", path)
			return
		}
		assertDistinct(t, a.Elem(), b.Elem(), path)
	case reflect.Slice:
		if a.Len() == 0 || b.Len() == 0 {
			return
		}
		if a.Pointer() == b.Pointer() {
			t.Errorf("%s: the copy shares the original's backing array — writing to one writes to both", path)
			return
		}
		for i := range a.Len() {
			assertDistinct(t, a.Index(i), b.Index(i), fmt.Sprintf("%s[%d]", path, i))
		}
	case reflect.Map:
		if a.IsNil() || b.IsNil() {
			return
		}
		if a.Pointer() == b.Pointer() {
			t.Errorf("%s: the copy shares the original map", path)
			return
		}
		for _, key := range a.MapKeys() {
			v := b.MapIndex(key)
			if v.IsValid() {
				assertDistinct(t, a.MapIndex(key), v, fmt.Sprintf("%s[%v]", path, key))
			}
		}
	case reflect.Struct:
		for i := range a.NumField() {
			assertDistinct(t, a.Field(i), b.Field(i), path+"."+a.Type().Field(i).Name)
		}
	default:
		// A scalar is copied by assignment; there is nothing to share.
	}
}

// The tripwire needs to be able to fail. If `fill` ever stops populating a
// shape — a field type it does not handle, a struct it skips — the walk above
// goes quiet and every clone looks perfect. This proves it does not.
func TestTheAliasingWalkCatchesASharedSlice(t *testing.T) {
	t.Parallel()

	var original store.Concept
	fill(reflect.ValueOf(&original).Elem())

	shallow := original // shares every slice, map and pointer

	fake := &testing.T{}
	assertDistinct(fake, reflect.ValueOf(&original).Elem(), reflect.ValueOf(&shallow).Elem(), "Concept")
	if !fake.Failed() {
		t.Error("the walk passed a struct copied by assignment, which shares everything")
	}
}

// And that `fill` reaches all the way down, not just the top level: a Concept
// filled by it must have no empty string anywhere the walk would need one.
func TestFillPopulatesNestedShapes(t *testing.T) {
	t.Parallel()

	var c store.Concept
	fill(reflect.ValueOf(&c).Elem())

	for _, empty := range []struct {
		what string
		ok   bool
	}{
		{"Citations", len(c.Citations) == 1},
		{"Edges.Requires", len(c.Edges.Requires) == 1},
		{"Viz.Params", len(c.Viz.Params) == 1},
		{"Viz.ParamControls", len(c.Viz.ParamControls) == 1},
		{"Emphasis", c.Emphasis != nil},
		{"Review", c.Review != nil},
		{"Prov", c.Prov != nil},
		{"Bodies.Intuition", c.Bodies.Intuition != ""},
	} {
		if !empty.ok {
			t.Errorf("fill left %s empty, so the aliasing walk would skip it", empty.what)
		}
	}

	if strings.TrimSpace(c.Title) == "" {
		t.Error("fill left Title empty")
	}
}
