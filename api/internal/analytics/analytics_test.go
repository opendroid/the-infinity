package analytics

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
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

func TestTraversals(t *testing.T) {
	cases := []struct {
		name    string
		entries []Entry
		want    []Edge
	}{
		{
			name:    "a reader pulling the thread",
			entries: []Entry{traversal("attention", "softmax")},
			want:    []Edge{{From: "attention", To: "softmax", N: 1}},
		},
		{
			// The defect this fixture exists for: the mini-map fetch carries its
			// own page as referer on EVERY concept read.
			name:    "a page's own mini-map fetch is not a traversal",
			entries: []Entry{miniMapReader, miniMap},
			want:    []Edge{},
		},
		{
			name:    "a reload is not a traversal",
			entries: []Entry{traversal("attention", "attention")},
			want:    []Edge{},
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
			want: []Edge{},
		},
		{
			name:    "a crawler enumerating is not a reader exploring",
			entries: []Entry{{URL: "https://theinfinity.ai/c/b", Referer: "https://theinfinity.ai/c/a", UserAgent: ahrefs.UserAgent}},
			want:    []Edge{},
		},
		{
			name:    "no referer at all",
			entries: []Entry{reader, ahrefs},
			want:    []Edge{},
		},
		{
			name:    "counted and ranked",
			entries: []Entry{traversal("a", "b"), traversal("a", "b"), traversal("c", "d")},
			want:    []Edge{{From: "a", To: "b", N: 2}, {From: "c", To: "d", N: 1}},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := Traversals(c.entries, 10)
			if len(got) != len(c.want) {
				t.Fatalf("got %d edges %v, want %d %v", len(got), got, len(c.want), c.want)
			}
			for i := range got {
				if got[i] != c.want[i] {
					t.Errorf("edge %d = %+v, want %+v", i, got[i], c.want[i])
				}
			}
		})
	}
}

func TestSameSiteAcrossSchemes(t *testing.T) {
	// The live log carries an http:// referer for an https:// request, because
	// the domain redirects. Comparing scheme too would drop a real reader.
	if !sameSite(schemeHop.Referer, schemeHop.URL) {
		t.Error("http referer on an https request should count as the same site")
	}
}

func TestBotsAndCache(t *testing.T) {
	cases := []struct {
		name      string
		entries   []Entry
		wantBots  Share
		wantCache Share
	}{
		{
			name:      "a crawler and a reader, both cached",
			entries:   []Entry{ahrefs, reader},
			wantBots:  Share{N: 1, Total: 2},
			wantCache: Share{N: 2, Total: 2},
		},
		{
			// /api/** is a Cloud Run call and is never cached. Counting it would
			// report static-first as weaker than it is, for an unrelated reason.
			name:      "the api is not a page and does not dilute the cache ratio",
			entries:   []Entry{reader, miniMap},
			wantBots:  Share{N: 1, Total: 2},
			wantCache: Share{N: 1, Total: 1},
		},
		{
			name:      "a miss",
			entries:   []Entry{traversal("a", "b")},
			wantBots:  Share{N: 0, Total: 1},
			wantCache: Share{N: 0, Total: 1},
		},
		{
			name:      "nothing measured",
			entries:   nil,
			wantBots:  Share{},
			wantCache: Share{},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := Bots(c.entries); got != c.wantBots {
				t.Errorf("Bots = %+v, want %+v", got, c.wantBots)
			}
			if got := Cache(c.entries); got != c.wantCache {
				t.Errorf("Cache = %+v, want %+v", got, c.wantCache)
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
		f := &fake{entries: []Entry{traversal("attention", "softmax"), ahrefs, reader, miniMap}}
		got, err := Collect(context.Background(), f, since, 500, 10, now)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got.Total != 4 {
			t.Errorf("Total = %d, want 4", got.Total)
		}
		if len(got.Traversals) != 1 || got.Traversals[0].To != "softmax" {
			t.Errorf("Traversals = %+v, want one edge to softmax", got.Traversals)
		}
		if got.Bots != (Share{N: 2, Total: 4}) {
			t.Errorf("Bots = %+v, want 2 of 4", got.Bots)
		}
		if got.Cache != (Share{N: 2, Total: 3}) {
			t.Errorf("Cache = %+v, want 2 of 3", got.Cache)
		}
		if !f.since.Equal(since) || f.limit != 500 {
			t.Errorf("read window = (%v, %d), want (%v, 500)", f.since, f.limit, since)
		}
	})

	t.Run("a failed read is returned, not reported as an empty week", func(t *testing.T) {
		want := errors.New("permission denied")
		if _, err := Collect(context.Background(), &fake{err: want}, since, 500, 10, now); !errors.Is(err, want) {
			t.Errorf("err = %v, want %v", err, want)
		}
	})
}

func TestRender(t *testing.T) {
	now := time.Date(2026, 9, 11, 6, 0, 0, 0, time.UTC)
	full := &Report{
		Now:        now,
		Total:      4,
		Concepts:   []Count{{Key: "attention", N: 3}},
		Traversals: []Edge{{From: "attention", To: "softmax", N: 2}},
		Bots:       Share{N: 1, Total: 4},
		Cache:      Share{N: 2, Total: 3},
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
				"2 of 3 page request(s)",
				"1 of 4 request(s)",
				"attention",
				"attention → softmax",
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
			report: &Report{Now: now, Concepts: []Count{}, Traversals: []Edge{}},
			limit:  10000,
			want: []string{
				"nothing — no reader opened a concept page",
				"nothing — no reader followed an edge",
				"0 of 0 page request(s)",
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
