package publish_test

import (
	"bytes"
	"flag"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/opendroid/the-infinity/api/internal/publish"
)

var update = flag.Bool("update", false, "rewrite content/derived.golden.json from the current nodes")

// The repo's real content, reached from this package's directory. Deriving the
// fixture from the actual graph rather than a hand-made one means the check also
// notices a node whose edges no longer resolve.
const (
	nodesDir   = "../../../content/nodes"
	goldenPath = "../../../content/derived.golden.json"
)

// The golden fixture is the contract between this package and
// web/src/lib/graph.ts. Both derive the same values from the same nodes; this
// test says Go still agrees with the file, and web/src/lib/golden.test.ts says
// TypeScript does. Neither can drift without one of them going red.
func TestGoldenFixtureIsCurrent(t *testing.T) {
	nodes, err := publish.Load(nodesDir)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	// A fixed clock: the only clock-dependent field is Stats.GrewThisWeek, which
	// the fixture deliberately omits, but passing time.Now would leave that
	// implicit and one added field away from a test that fails on Mondays.
	graph, err := publish.Derive(nodes, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("Derive: %v", err)
	}

	got, err := publish.Golden(graph)
	if err != nil {
		t.Fatalf("Golden: %v", err)
	}

	if *update {
		if err := os.WriteFile(goldenPath, got, 0o644); err != nil { //nolint:gosec // a fixture committed to a public repo
			t.Fatalf("writing %s: %v", goldenPath, err)
		}
		t.Logf("wrote %s", filepath.Clean(goldenPath))
		return
	}

	want, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatalf("reading %s: %v", goldenPath, err)
	}

	if !bytes.Equal(got, want) {
		t.Errorf("%s is stale. Regenerate it with `cd api && make golden`, and check the diff: "+
			"if the derivation changed rather than the content, web/src/lib/graph.ts needs the same change.",
			filepath.Clean(goldenPath))
	}
}

// Publishing the same commit twice must produce identical documents — otherwise
// every deploy rewrites the whole graph with new values and no way to tell a
// real change from noise.
func TestDeriveIsDeterministic(t *testing.T) {
	t.Parallel()

	nodes, err := publish.Load(nodesDir)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	at := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	first, err := publish.Derive(nodes, at)
	if err != nil {
		t.Fatalf("Derive: %v", err)
	}
	second, err := publish.Derive(nodes, at)
	if err != nil {
		t.Fatalf("Derive: %v", err)
	}

	a, err := publish.Golden(first)
	if err != nil {
		t.Fatalf("Golden: %v", err)
	}
	b, err := publish.Golden(second)
	if err != nil {
		t.Fatalf("Golden: %v", err)
	}
	if !bytes.Equal(a, b) {
		t.Error("two derivations of one graph differ")
	}
}
