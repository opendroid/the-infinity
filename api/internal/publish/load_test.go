package publish_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/opendroid/the-infinity/api/internal/publish"
)

// valid is the smallest node that satisfies content/schema/node.schema.json.
// Written out rather than marshalled from a struct: the point of these tests is
// what happens to bytes on disk, and a struct round-trip would only prove the
// encoder agrees with the decoder.
const valid = `{
  "id": "%s",
  "title": "A Concept",
  "domain": ["Architecture", "Sparsity"],
  "bodies": { "intuition": "i", "engineer": "e", "math": "m" },
  "viz": { "primitive": "router-dispatch", "params": {"n": 1}, "param_controls": [], "caption": "c" },
  "edges": { "requires": [], "adjacent": [] },
  "citations": [{ "ref": "r", "title": "t", "url": "https://example.invalid" }],
  "review": { "reviewed_by": "someone", "reviewed_at": "2026-01-01" },
  "updated_at": "2026-01-01"
}`

func writeNodes(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
			t.Fatalf("writing %s: %v", name, err)
		}
	}
	return dir
}

func TestLoadSortsByID(t *testing.T) {
	t.Parallel()

	dir := writeNodes(t, map[string]string{
		"zebra.json":  strings.Replace(valid, "%s", "zebra", 1),
		"alpha.json":  strings.Replace(valid, "%s", "alpha", 1),
		"middle.json": strings.Replace(valid, "%s", "middle", 1),
		"notes.md":    "ignored",
	})

	nodes, err := publish.Load(dir)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	var got []string
	for _, n := range nodes {
		got = append(got, n.ID)
	}
	want := []string{"alpha", "middle", "zebra"}
	if !equal(got, want) {
		t.Errorf("ids = %v, want %v — a publish must be reproducible", got, want)
	}
}

func TestLoadRejects(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		files map[string]string
		want  string
	}{
		{
			name:  "an id that does not match its filename, which would serve the wrong URL",
			files: map[string]string{"alpha.json": strings.Replace(valid, "%s", "beta", 1)},
			want:  "does not match its filename",
		},
		{
			name: "an authored tier, which is derived and must never be written down",
			files: map[string]string{"alpha.json": strings.Replace(
				strings.Replace(valid, "%s", "alpha", 1),
				`"updated_at"`, `"tier": "verified", "updated_at"`, 1)},
			want: "unknown field",
		},
		{
			name: "authored unlocks, which are inverted from other nodes' requires",
			files: map[string]string{"alpha.json": strings.Replace(
				strings.Replace(valid, "%s", "alpha", 1),
				`"adjacent": []`, `"adjacent": [], "unlocks": []`, 1)},
			want: "unknown field",
		},
		{
			name:  "an id that is not a slug",
			files: map[string]string{"Not A Slug.json": strings.Replace(valid, "%s", "Not A Slug", 1)},
			want:  "not a valid concept slug",
		},
		{
			name:  "malformed JSON",
			files: map[string]string{"alpha.json": "{"},
			want:  "decoding",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			_, err := publish.Load(writeNodes(t, tt.files))
			if err == nil {
				t.Fatal("Load succeeded, want an error")
			}
			if !strings.Contains(err.Error(), tt.want) {
				t.Errorf("error = %q, want it to mention %q", err, tt.want)
			}
		})
	}
}

func TestLoadMissingDirectory(t *testing.T) {
	t.Parallel()

	if _, err := publish.Load(filepath.Join(t.TempDir(), "nope")); err == nil {
		t.Fatal("Load succeeded on a missing directory — a mistyped path must not publish an empty graph")
	}
}
