package analytics

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/opendroid/the-infinity/api/internal/store"
)

// The fixtures below are REAL entries from the live webrequests log, reduced to
// the fields this package reads. Using invented shapes here would test the
// tally and not the join — and the join is where the assumptions live.
var (
	// A concept page's own mini-map fetch. Referer is the page it hydrates, so
	// a naive referrer join counts this as a traversal. It is not one.
	//
	// TWO FIXTURES, DELIBERATELY. The live entry happened to be Googlebot, and a
	// test using only that one passes whether or not the target is checked at
	// all — the crawler filter excludes it first. Planting proved exactly that.
	// Every reader's mini-map fetch looks like miniMapReader, so that is the one
	// the traversal test uses.
	miniMap = Entry{
		URL:       "https://theinfinity.ai/api/v1/concepts/instrumental-variable/neighborhood",
		Referer:   "https://theinfinity.ai/c/instrumental-variable",
		UserAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
		Status:    200,
	}
	// The same fetch from a reader, which is the common case by far.
	miniMapReader = Entry{
		URL:       "https://theinfinity.ai/api/v1/concepts/attention/neighborhood",
		Referer:   "https://theinfinity.ai/c/attention",
		UserAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
		Status:    200,
	}
	// An http referer on a site that redirects to https — same reader.
	schemeHop = Entry{
		URL:       "https://theinfinity.ai/",
		Referer:   "http://theinfinity.ai/",
		UserAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
		Status:    200,
	}
	// A crawler hitting a cached concept page.
	ahrefs = Entry{
		URL:       "https://theinfinity.ai/c/hierarchical-rl",
		UserAgent: "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
		Status:    200,
		CacheHit:  true,
	}
	// A reader on the landing page, served from cache.
	reader = Entry{
		URL:       "https://theinfinity.ai/",
		UserAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
		Status:    200,
		CacheHit:  true,
	}
)

/** A reader pulling A→B, which is the thing this whole package exists to count. */
func traversal(from, to string) Entry {
	return Entry{
		URL:       "https://theinfinity.ai/c/" + to,
		Referer:   "https://theinfinity.ai/c/" + from,
		UserAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
		Status:    200,
	}
}

func TestConceptID(t *testing.T) {
	cases := []struct {
		name string
		url  string
		want string
	}{
		{"a concept page", "https://theinfinity.ai/c/attention", "attention"},
		{"with a trailing slash", "https://theinfinity.ai/c/attention/", "attention"},
		{"with a query", "https://theinfinity.ai/c/attention?depth=math", "attention"},
		{"the api, which the CDN logs too", "https://theinfinity.ai/api/v1/concepts/attention/neighborhood", ""},
		{"the landing page", "https://theinfinity.ai/", ""},
		{"the index", "https://theinfinity.ai/concepts", ""},
		{"a trail", "https://theinfinity.ai/t/abc123", ""},
		{"/c/ with nothing after it", "https://theinfinity.ai/c/", ""},
		{"a deeper path under /c/", "https://theinfinity.ai/c/a/b", ""},
		{"nonsense", "://", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := conceptID(c.url); got != c.want {
				t.Errorf("conceptID(%q) = %q, want %q", c.url, got, c.want)
			}
		})
	}
}

func TestIsBot(t *testing.T) {
	cases := []struct {
		name string
		ua   string
		want bool
	}{
		{"googlebot", miniMap.UserAgent, true},
		{"ahrefs", ahrefs.UserAgent, true},
		{"a real browser", reader.UserAgent, false},
		{"firefox", schemeHop.UserAgent, false},
		{"no user agent at all", "", true},
		{"curl", "curl/8.4.0", true},
		{"headless chrome", "Mozilla/5.0 HeadlessChrome/120.0.0.0", true},
		{"case is not significant", "AHREFSBOT/7.0", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := IsBot(c.ua); got != c.want {
				t.Errorf("IsBot(%q) = %v, want %v", c.ua, got, c.want)
			}
		})
	}
}

func TestTopConcepts(t *testing.T) {
	cases := []struct {
		name    string
		entries []Entry
		top     int
		want    []Count
	}{
		{
			name:    "counts concept pages and nothing else",
			entries: []Entry{traversal("a", "attention"), traversal("b", "attention"), reader, miniMap},
			top:     5,
			want:    []Count{{Key: "attention", N: 2}},
		},
		{
			name:    "a crawler is not a reader",
			entries: []Entry{ahrefs, ahrefs, ahrefs},
			top:     5,
			want:    []Count{},
		},
		{
			name:    "ties break by id, so two runs agree",
			entries: []Entry{traversal("x", "zebra"), traversal("x", "alpha")},
			top:     5,
			want:    []Count{{Key: "alpha", N: 1}, {Key: "zebra", N: 1}},
		},
		{
			name:    "top n truncates",
			entries: []Entry{traversal("x", "a"), traversal("x", "a"), traversal("y", "b")},
			top:     1,
			want:    []Count{{Key: "a", N: 2}},
		},
		{name: "nothing at all", entries: nil, top: 5, want: []Count{}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := TopConcepts(c.entries, c.top)
			if len(got) != len(c.want) {
				t.Fatalf("got %d rows %v, want %d %v", len(got), got, len(c.want), c.want)
			}
			for i := range got {
				if got[i] != c.want[i] {
					t.Errorf("row %d = %+v, want %+v", i, got[i], c.want[i])
				}
			}
		})
	}
}

/**
 * The graph as the live run's six traversals actually stand (#426): three pairs
 * are connected, three are not. Checked against content/nodes when the issue
 * was filed, and used here so the test describes the real corpus rather than a
 * convenient one.
 */
func liveEdges(from, to string) (store.EdgeType, bool) {
	declared := map[[2]string]store.EdgeType{
		{"attention", "graph-neural-network"}:                store.EdgeAdjacent,
		{"positional-encoding", "rotary-position-embedding"}: store.EdgeUnlocks,
		{"transformer-block", "feed-forward-network"}:        store.EdgeRequires,
	}
	t, ok := declared[[2]string{from, to}]
	return t, ok
}

func TestTraversals(t *testing.T) {
	cases := []struct {
		name      string
		entries   []Entry
		edges     EdgeLookup
		wantAlong []Edge
		wantJumps []Edge
		// wantMoves counts MOVES, not rows — a pair walked twice counts twice.
		wantMoves int
	}{
		{
			name:      "a reader following a declared edge",
			entries:   []Entry{traversal("transformer-block", "feed-forward-network")},
			edges:     liveEdges,
			wantAlong: []Edge{{From: "transformer-block", To: "feed-forward-network", Type: store.EdgeRequires, N: 1}},
			wantJumps: []Edge{},
			wantMoves: 1,
		},
		{
			// THE DEFECT #426 IS ABOUT. This pair was reported under "EDGES
			// PULLED" and nothing connects it.
			name:      "a jump with no edge is not an edge",
			entries:   []Entry{traversal("backpropagation", "query-key-value")},
			edges:     liveEdges,
			wantAlong: []Edge{},
			wantJumps: []Edge{{From: "backpropagation", To: "query-key-value", N: 1}},
			wantMoves: 1,
		},
		{
			name: "the live run, split",
			entries: []Entry{
				traversal("attention", "graph-neural-network"),
				traversal("attention", "graph-neural-network"),
				traversal("backpropagation", "query-key-value"),
				traversal("neural-audio-codec", "backpropagation"),
			},
			edges:     liveEdges,
			wantAlong: []Edge{{From: "attention", To: "graph-neural-network", Type: store.EdgeAdjacent, N: 2}},
			wantJumps: []Edge{
				{From: "backpropagation", To: "query-key-value", N: 1},
				{From: "neural-audio-codec", To: "backpropagation", N: 1},
			},
			// FOUR, not three: attention → graph-neural-network was walked
			// twice and the denominator counts moves, not distinct pairs.
			wantMoves: 4,
		},
		{
			// Without a corpus nothing can be classified, and calling every move
			// an edge would be the #426 bug restored by another route.
			name:      "with no graph, everything is a jump",
			entries:   []Entry{traversal("transformer-block", "feed-forward-network")},
			edges:     NoEdges,
			wantAlong: []Edge{},
			wantJumps: []Edge{{From: "transformer-block", To: "feed-forward-network", N: 1}},
			wantMoves: 1,
		},
		{
			name:      "a page's own mini-map fetch is not a traversal",
			entries:   []Entry{miniMapReader, miniMap},
			edges:     liveEdges,
			wantAlong: []Edge{},
			wantJumps: []Edge{},
		},
		{
			name:      "a reload is not a traversal",
			entries:   []Entry{traversal("attention", "attention")},
			edges:     liveEdges,
			wantAlong: []Edge{},
			wantJumps: []Edge{},
		},
		{
			// The referer path is shaped like ours on purpose. With a path the
			// parser cannot read as a concept, this case passes whether or not
			// hosts are compared, which planting showed it was doing.
			name: "an inbound link from elsewhere is not a traversal of our graph",
			entries: []Entry{{
				URL:       "https://theinfinity.ai/c/attention",
				Referer:   "https://scraped-mirror.example.com/c/softmax",
				UserAgent: reader.UserAgent,
			}},
			edges:     liveEdges,
			wantAlong: []Edge{},
			wantJumps: []Edge{},
		},
		{
			name:      "a crawler enumerating is not a reader exploring",
			entries:   []Entry{{URL: "https://theinfinity.ai/c/b", Referer: "https://theinfinity.ai/c/a", UserAgent: ahrefs.UserAgent}},
			edges:     liveEdges,
			wantAlong: []Edge{},
			wantJumps: []Edge{},
		},
		{
			name:      "no referer at all",
			entries:   []Entry{reader, ahrefs},
			edges:     liveEdges,
			wantAlong: []Edge{},
			wantJumps: []Edge{},
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			along, jumps, moves := Traversals(c.entries, 10, c.edges)
			assertEdges(t, "along", along, c.wantAlong)
			assertEdges(t, "jumps", jumps, c.wantJumps)
			// The denominator is the point of #482: it must count MOVES, not
			// rows, so a pair walked twice counts twice.
			if got, want := moves.Total(), c.wantMoves; got != want {
				t.Errorf("moves.Total() = %d, want %d", got, want)
			}
		})
	}
}

func assertEdges(t *testing.T, what string, got, want []Edge) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("%s: got %d rows %+v, want %d %+v", what, len(got), got, len(want), want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Errorf("%s row %d = %+v, want %+v", what, i, got[i], want[i])
		}
	}
}

func TestSameSiteAcrossSchemes(t *testing.T) {
	// The live log carries an http:// referer for an https:// request, because
	// the domain redirects. Comparing scheme too would drop a real reader.
	if !sameSite(schemeHop.Referer, schemeHop.URL) {
		t.Error("http referer on an https request should count as the same site")
	}
}

/** A request for a hashed asset, which is cached immutable for a year. */
func asset(hit bool) Entry {
	return Entry{
		URL:       "https://theinfinity.ai/_astro/Base.DCmENVSl.css",
		UserAgent: reader.UserAgent,
		Status:    200,
		CacheHit:  hit,
	}
}

func TestClassify(t *testing.T) {
	cases := []struct {
		name string
		url  string
		want Kind
	}{
		{"the landing page", "https://theinfinity.ai/", KindPage},
		{"a concept page", "https://theinfinity.ai/c/attention", KindPage},
		{"a trail", "https://theinfinity.ai/t/abc", KindPage},
		{"the concepts index", "https://theinfinity.ai/concepts", KindPage},
		{"a hashed stylesheet", "https://theinfinity.ai/_astro/Base.DCmENVSl.css", KindAsset},
		{"a hashed island", "https://theinfinity.ai/_astro/SearchPanel.IX860QLM.js", KindAsset},
		{"the api", "https://theinfinity.ai/api/v1/concepts/attention/neighborhood", KindAPI},
		// search-index.json is not under /_astro/ and is not hashed; it is a
		// page-ish fetch and counted with the pages.
		{"the search index", "https://theinfinity.ai/search-index.json", KindPage},
		{"nonsense", "://", KindPage},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := classify(c.url); got != c.want {
				t.Errorf("classify(%q) = %v, want %v", c.url, got, c.want)
			}
		})
	}
}

func TestBotsAndCache(t *testing.T) {
	cases := []struct {
		name       string
		entries    []Entry
		wantBots   Share
		wantPages  Share
		wantAssets Share
	}{
		{
			// THE POINT OF THE SPLIT (#427). One blended figure over these four
			// reads 50%, which describes neither population: the assets are
			// perfect and the pages are structurally poor, on purpose.
			name:       "pages and assets are counted apart",
			entries:    []Entry{reader, traversal("a", "b"), asset(true), asset(true)},
			wantBots:   Share{N: 0, Total: 4},
			wantPages:  Share{N: 1, Total: 2},
			wantAssets: Share{N: 2, Total: 2},
		},
		{
			name:       "a crawler and a reader, both on cached pages",
			entries:    []Entry{ahrefs, reader},
			wantBots:   Share{N: 1, Total: 2},
			wantPages:  Share{N: 2, Total: 2},
			wantAssets: Share{},
		},
		{
			// /api/** is a Cloud Run call and is never cached. Counting it
			// would report static-first as weaker for an unrelated reason.
			name:       "the api is neither a page nor an asset",
			entries:    []Entry{reader, miniMap},
			wantBots:   Share{N: 1, Total: 2},
			wantPages:  Share{N: 1, Total: 1},
			wantAssets: Share{},
		},
		{
			name:       "a miss",
			entries:    []Entry{traversal("a", "b")},
			wantBots:   Share{N: 0, Total: 1},
			wantPages:  Share{N: 0, Total: 1},
			wantAssets: Share{},
		},
		{name: "nothing measured", entries: nil, wantBots: Share{}, wantPages: Share{}, wantAssets: Share{}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := Bots(c.entries); got != c.wantBots {
				t.Errorf("Bots = %+v, want %+v", got, c.wantBots)
			}
			if got := Cache(c.entries, KindPage); got != c.wantPages {
				t.Errorf("Cache(pages) = %+v, want %+v", got, c.wantPages)
			}
			if got := Cache(c.entries, KindAsset); got != c.wantAssets {
				t.Errorf("Cache(assets) = %+v, want %+v", got, c.wantAssets)
			}
		})
	}
}

func TestSharePercent(t *testing.T) {
	cases := []struct {
		name string
		s    Share
		want float64
	}{
		{"half", Share{N: 1, Total: 2}, 50},
		{"none measured is not a division by zero", Share{}, 0},
		{"all", Share{N: 3, Total: 3}, 100},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.s.Percent(); got != c.want {
				t.Errorf("Percent() = %v, want %v", got, c.want)
			}
		})
	}
}

type fake struct {
	entries []Entry
	err     error
	since   time.Time
	limit   int
}

func (f *fake) Requests(_ context.Context, since time.Time, limit int) ([]Entry, error) {
	f.since, f.limit = since, limit
	return f.entries, f.err
}

func TestCollect(t *testing.T) {
	now := time.Date(2026, 9, 11, 6, 0, 0, 0, time.UTC)
	since := now.Add(-7 * 24 * time.Hour)

	t.Run("answers every question from one read", func(t *testing.T) {
		f := &fake{entries: []Entry{traversal("attention", "graph-neural-network"), ahrefs, reader, miniMap}}
		got, err := Collect(context.Background(), f, since, 500, 10, now, liveEdges)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got.Total != 4 {
			t.Errorf("Total = %d, want 4", got.Total)
		}
		if len(got.Traversals) != 1 || got.Traversals[0].To != "graph-neural-network" {
			t.Errorf("Traversals = %+v, want one edge to graph-neural-network", got.Traversals)
		}
		if len(got.Jumps) != 0 {
			t.Errorf("Jumps = %+v, want none", got.Jumps)
		}
		if got.Bots != (Share{N: 2, Total: 4}) {
			t.Errorf("Bots = %+v, want 2 of 4", got.Bots)
		}
		if got.CachePages != (Share{N: 2, Total: 3}) {
			t.Errorf("CachePages = %+v, want 2 of 3", got.CachePages)
		}
		if !f.since.Equal(since) || f.limit != 500 {
			t.Errorf("read window = (%v, %d), want (%v, 500)", f.since, f.limit, since)
		}
	})

	t.Run("a failed read is returned, not reported as an empty week", func(t *testing.T) {
		want := errors.New("permission denied")
		if _, err := Collect(context.Background(), &fake{err: want}, since, 500, 10, now, liveEdges); !errors.Is(err, want) {
			t.Errorf("err = %v, want %v", err, want)
		}
	})
}

func TestRender(t *testing.T) {
	now := time.Date(2026, 9, 11, 6, 0, 0, 0, time.UTC)
	full := &Report{
		Now:         now,
		Total:       4,
		Concepts:    []Count{{Key: "attention", N: 3}},
		Traversals:  []Edge{{From: "attention", To: "softmax", Type: store.EdgeAdjacent, N: 2}},
		Jumps:       []Edge{{From: "backpropagation", To: "query-key-value", N: 1}},
		Bots:        Share{N: 1, Total: 4},
		CachePages:  Share{N: 2, Total: 3},
		CacheAssets: Share{N: 5, Total: 5},
	}

	cases := []struct {
		name   string
		report *Report
		limit  int
		want   []string
		absent []string
	}{
		{
			name:   "the numbers, each with its denominator",
			report: full,
			limit:  10000,
			want: []string{
				"4 request(s) read",
				"2 of 3",
				"must-revalidate",
				"5 of 5",
				"immutable",
				"1 of 4",
				"attention",
				"attention → softmax",
				"adjacent",
				"JUMPED, NO EDGE",
				"backpropagation → query-key-value",
				"filter: logName=…",
			},
			absent: []string{"-limit"},
		},
		{
			// A truncated window that does not say so is a wrong answer with a
			// confident face.
			name:   "says so when the limit was reached",
			report: full,
			limit:  4,
			want:   []string{"! the -limit of 4 was reached", "NOT the whole window"},
		},
		{
			name:   "an empty window says it looked",
			report: &Report{Now: now, Concepts: []Count{}, Traversals: []Edge{}, Jumps: []Edge{}},
			limit:  10000,
			want: []string{
				"nothing — no reader opened a concept page",
				// No moves at all is said in words. "0 of 0 moves" reads like a
				// measurement and is the absence of one (#482).
				"no concept-to-concept moves in this window",
				"0 of 0",
			},
			absent: []string{
				// The heading must not assert what an empty list means.
				"candidate edges the readership is asking for",
			},
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var b strings.Builder
			if err := c.report.Render(&b, 7, c.limit, "logName=…"); err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			got := b.String()
			for _, want := range c.want {
				if !strings.Contains(got, want) {
					t.Errorf("report is missing %q:\n%s", want, got)
				}
			}
			for _, absent := range c.absent {
				if strings.Contains(got, absent) {
					t.Errorf("report should not mention %q:\n%s", absent, got)
				}
			}
		})
	}

	t.Run("a broken pipe is an error, not half a report", func(t *testing.T) {
		if err := full.Render(brokenPipe{}, 7, 10, "f"); err == nil {
			t.Error("want an error when the writer fails")
		}
	})
}

type brokenPipe struct{}

func (brokenPipe) Write([]byte) (int, error) { return 0, errors.New("broken pipe") }

// The whole of #482: an empty jump list is a claim about the graph, and until
// the denominator shipped it was rendered identically whether it summarised
// forty moves or four thousand.
//
// THIS TEST FAILS IF THE DENOMINATOR LINE IS DELETED, which the assertions in
// TestRender above do not — they check for substrings that survive the removal.
func TestTraversalDenominator(t *testing.T) {
	now := time.Date(2026, 9, 13, 2, 23, 0, 0, time.UTC)

	cases := []struct {
		name   string
		report *Report
		want   []string
		absent []string
	}{
		{
			// The shape of the run that prompted the issue: every move followed
			// an edge, and the report used to say only "nothing".
			name: "no jumps, said against the number of moves",
			report: &Report{
				Now:        now,
				Concepts:   []Count{},
				Traversals: []Edge{{From: "attention", To: "softmax", Type: store.EdgeAdjacent, N: 40}},
				Jumps:      []Edge{},
				Moves:      Moves{Along: 40},
			},
			want:   []string{"40 of 40 concept-to-concept moves", "0 of 40 concept-to-concept moves"},
			absent: []string{"every concept-to-concept move followed an edge"},
		},
		{
			name: "a jump is counted against the same total",
			report: &Report{
				Now:        now,
				Concepts:   []Count{},
				Traversals: []Edge{{From: "attention", To: "softmax", Type: store.EdgeAdjacent, N: 3}},
				Jumps:      []Edge{{From: "backpropagation", To: "query-key-value", N: 1}},
				Moves:      Moves{Along: 3, Jumped: 1},
			},
			want: []string{"3 of 4 concept-to-concept moves", "1 of 4 concept-to-concept moves"},
		},
		{
			// Rows are capped at -top; the counts are not. Saying "5 of 9" over
			// two printed rows without admitting the truncation would be the
			// -limit defect one section further down.
			name: "says when rows were dropped",
			report: &Report{
				Now:        now,
				Concepts:   []Count{},
				Traversals: []Edge{{From: "a", To: "b", N: 3}, {From: "c", To: "d", N: 2}},
				Jumps:      []Edge{},
				Moves:      Moves{Along: 9},
			},
			want: []string{"9 of 9 concept-to-concept moves; showing the top 2 pair(s)"},
		},
		{
			name: "one move per pair does not claim to be showing a top",
			report: &Report{
				Now:        now,
				Concepts:   []Count{},
				Traversals: []Edge{{From: "a", To: "b", N: 1}},
				Jumps:      []Edge{},
				Moves:      Moves{Along: 1},
			},
			absent: []string{"showing the top"},
		},
		{
			// Zero moves is the absence of a measurement, not a measurement of
			// zero. "0 of 0" invites a reader to treat it as a finding.
			name:   "no moves at all is said in words",
			report: &Report{Now: now, Concepts: []Count{}, Traversals: []Edge{}, Jumps: []Edge{}},
			want:   []string{"no concept-to-concept moves in this window"},
			absent: []string{"0 of 0 concept-to-concept moves"},
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var b strings.Builder
			if err := c.report.Render(&b, 7, 10000, "logName=…"); err != nil {
				t.Fatalf("Render: %v", err)
			}
			for _, want := range c.want {
				if !strings.Contains(b.String(), want) {
					t.Errorf("missing %q in:\n%s", want, b.String())
				}
			}
			for _, absent := range c.absent {
				if strings.Contains(b.String(), absent) {
					t.Errorf("unexpected %q in:\n%s", absent, b.String())
				}
			}
		})
	}
}
