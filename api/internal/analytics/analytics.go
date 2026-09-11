// Package analytics answers four questions from request logs, and ships no
// JavaScript to answer any of them.
//
// ADR-0011 chose against GA4 and Plausible both: analytics are read from the
// `webrequests` log Firebase Hosting already writes, so no analytics script
// reaches a reader and `/` keeps its zero-JavaScript budget. This package is
// the reading half (#64).
//
// It is READ-ONLY BY CONSTRUCTION, like internal/inbox: Reader has one method
// and it fetches. There is nothing here that could write a counter back.
//
// THE FIELD LAYOUT WAS CONFIRMED AGAINST THE LIVE LOG on 2026-09-11, not read
// from documentation. Both fields the ADR leans on are OMITTED rather than
// zeroed when they do not apply — over 200 consecutive entries, `referer`
// appeared on 29 and `cacheHit` on 31 — so "absent" means "this request had no
// referrer" and "this request missed the cache", never "Firebase does not
// record it". Reading a small sample and concluding the field does not exist is
// the mistake this comment is here to stop.
package analytics

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/opendroid/the-infinity/api/internal/store"
)

// Entry is one request, reduced to the fields the four questions need.
//
// Referer is empty for a request that carried no `Referer` header — a direct
// hit, a crawler, or a fresh tab — which is the common case and not an error.
type Entry struct {
	URL       string
	Referer   string
	UserAgent string
	Status    int
	CacheHit  bool
}

// Reader is the whole data surface: one read, no writes.
type Reader interface {
	Requests(ctx context.Context, since time.Time, limit int) ([]Entry, error)
}

// Count is one row of a ranking.
type Count struct {
	Key string
	N   int
}

// Edge is a reader moving from one concept to another.
//
// Type is the declared edge that was followed, empty when none connects the
// pair — which is the whole reason this type carries it (#426).
type Edge struct {
	From string
	To   string
	Type store.EdgeType
	N    int
}

// Share is a ratio reported with its numerator and denominator, never as a bare
// percentage — "12%" of eleven requests is not a finding.
type Share struct {
	N     int
	Total int
}

// Percent is the share as a percentage, or 0 when nothing was measured.
func (s Share) Percent() float64 {
	if s.Total == 0 {
		return 0
	}
	return float64(s.N) / float64(s.Total) * 100
}

// Report is every answer at one moment.
type Report struct {
	Since    time.Time
	Now      time.Time
	Total    int
	Concepts []Count
	// Traversals followed a declared edge. Jumps did not.
	Traversals []Edge
	Jumps      []Edge
	Bots       Share
	Cache      Share
}

// conceptID returns the slug of a /c/<slug> URL, or "" for anything else.
//
// Anything else includes /api/v1/**, which reaches this log too: Firebase
// rewrites /api/** to Cloud Run and the CDN logs the request on its way past.
// That matters for traversals — a concept page's own mini-map fetch carries
// that page as its referer, and counting it would report every reader as having
// traversed an edge to nowhere.
func conceptID(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	const prefix = "/c/"
	if !strings.HasPrefix(u.Path, prefix) {
		return ""
	}
	id := strings.Trim(strings.TrimPrefix(u.Path, prefix), "/")
	if id == "" || strings.Contains(id, "/") {
		return ""
	}
	return id
}

// sameSite reports whether two URLs share a host, so an inbound link from
// elsewhere is not counted as a traversal of our own graph. Compared on host
// alone: a referer arriving as http:// on a site that redirects to https is the
// same reader, and the live log carries exactly that.
func sameSite(a, b string) bool {
	ua, err := url.Parse(a)
	if err != nil {
		return false
	}
	ub, err := url.Parse(b)
	if err != nil {
		return false
	}
	return ua.Host != "" && ua.Host == ub.Host
}

// botTokens are substrings that appear in the user agent of something that is
// not a reader. Deliberately a small, boring list: the point is to state bot
// share honestly, and a clever heuristic that silently reclassifies traffic is
// worse than an obvious one whose misses you can see.
var botTokens = []string{
	"bot", "crawler", "spider", "slurp", "crawling",
	"ahrefs", "semrush", "bingpreview", "facebookexternalhit",
	"headlesschrome", "python-requests", "curl/", "wget/",
	"go-http-client", "scrapy", "phantomjs",
}

// IsBot reports whether a user agent names a crawler rather than a reader.
func IsBot(ua string) bool {
	l := strings.ToLower(ua)
	if l == "" {
		return true // no user agent at all is not a browser
	}
	for _, t := range botTokens {
		if strings.Contains(l, t) {
			return true
		}
	}
	return false
}

// isPage reports whether an entry is a request for a page rather than for the
// API. The cache ratio is the static-first claim measured, and /api/** is a
// Cloud Run call that is never cached — including it would report the claim as
// weaker than it is for reasons that have nothing to do with the claim.
func isPage(e Entry) bool {
	u, err := url.Parse(e.URL)
	if err != nil {
		return false
	}
	return !strings.HasPrefix(u.Path, "/api/")
}

// ranked turns a tally into the top n rows, largest first, ties broken by key
// so the output of two identical runs is identical.
func ranked(tally map[string]int, n int) []Count {
	out := make([]Count, 0, len(tally))
	for k, v := range tally {
		out = append(out, Count{Key: k, N: v})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].N != out[j].N {
			return out[i].N > out[j].N
		}
		return out[i].Key < out[j].Key
	})
	if n > 0 && len(out) > n {
		out = out[:n]
	}
	return out
}

// TopConcepts counts requests per concept page, excluding bots — "what are
// people reading" is not answered by what Ahrefs crawled.
func TopConcepts(entries []Entry, n int) []Count {
	tally := map[string]int{}
	for _, e := range entries {
		if IsBot(e.UserAgent) {
			continue
		}
		if id := conceptID(e.URL); id != "" {
			tally[id]++
		}
	}
	return ranked(tally, n)
}

// Traversals splits concept-to-concept navigation into readers who followed a
// declared edge and readers who did not.
//
// BOTH HALVES ARE FINDINGS, AND THE SECOND IS THE MORE INTERESTING ONE (#426).
// The first shipped version of this reported every /c/A → /c/B navigation under
// the heading "EDGES PULLED", and on the first real run half the rows were
// pairs with no edge between them at all — a reader on one concept opening
// search with `/` and jumping somewhere else. The heading asserted something
// the data did not support.
//
// The fix is not to filter those out. A reader going from `backpropagation` to
// `query-key-value` where nothing connects them is the readership saying the
// graph is missing a link, which for a product whose thesis IS the graph is
// worth more than another confirmation that a drawn edge gets used. So they are
// counted separately and labelled for what they are.
//
// Self-referrals are dropped — a reload, or the page's own mini-map fetch — and
// so are bots, which do not follow edges so much as enumerate them.
func Traversals(entries []Entry, n int, edge EdgeLookup) (along, jumps []Edge) {
	type move struct {
		from, to string
	}
	tally := map[move]int{}
	for _, e := range entries {
		if e.Referer == "" || IsBot(e.UserAgent) {
			continue
		}
		if !sameSite(e.Referer, e.URL) {
			continue
		}
		from, to := conceptID(e.Referer), conceptID(e.URL)
		if from == "" || to == "" || from == to {
			continue
		}
		tally[move{from, to}]++
	}

	for m, count := range tally {
		kind, ok := edge(m.from, m.to)
		row := Edge{From: m.from, To: m.to, Type: kind, N: count}
		if ok {
			along = append(along, row)
		} else {
			jumps = append(jumps, row)
		}
	}
	return rankEdges(along, n), rankEdges(jumps, n)
}

// rankEdges orders by count, ties broken by name so two runs of the same window
// print the same thing.
func rankEdges(rows []Edge, n int) []Edge {
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].N != rows[j].N {
			return rows[i].N > rows[j].N
		}
		if rows[i].From != rows[j].From {
			return rows[i].From < rows[j].From
		}
		return rows[i].To < rows[j].To
	})
	if n > 0 && len(rows) > n {
		rows = rows[:n]
	}
	if rows == nil {
		return []Edge{}
	}
	return rows
}

// Bots is the share of all requests that came from a crawler.
func Bots(entries []Entry) Share {
	s := Share{Total: len(entries)}
	for _, e := range entries {
		if IsBot(e.UserAgent) {
			s.N++
		}
	}
	return s
}

// Cache is the share of PAGE requests the CDN served without reaching an
// origin — static-first, measured.
func Cache(entries []Entry) Share {
	var s Share
	for _, e := range entries {
		if !isPage(e) {
			continue
		}
		s.Total++
		if e.CacheHit {
			s.N++
		}
	}
	return s
}

// Collect reads the window once and answers all four questions from it.
//
// One read, not four: the questions are different views of the same requests,
// and four reads would be four different windows, four bills, and four chances
// for the numbers on one screen to disagree with each other.
func Collect(ctx context.Context, r Reader, since time.Time, limit, top int, now time.Time, edge EdgeLookup) (*Report, error) {
	entries, err := r.Requests(ctx, since, limit)
	if err != nil {
		return nil, err
	}
	along, jumps := Traversals(entries, top, edge)
	return &Report{
		Since:      since,
		Now:        now,
		Total:      len(entries),
		Concepts:   TopConcepts(entries, top),
		Traversals: along,
		Jumps:      jumps,
		Bots:       Bots(entries),
		Cache:      Cache(entries),
	}, nil
}

// Render writes the whole report, or nothing. Built in memory and written once,
// as internal/inbox does, so a broken pipe cannot leave half a measurement on
// screen looking like all of it.
//
// Every ratio carries its denominator. "12% crawlers" over eleven requests is a
// number that reads like a finding and is not one, and the weeks this tool
// exists for — just after a Search Console submission — are exactly the weeks
// somebody would quote it.
func (r *Report) Render(w io.Writer, days, limit int, filter string) error {
	var b strings.Builder

	fmt.Fprintf(&b, "theinfinity.ai — %d day(s) to %s UTC\n", days, r.Now.Format("2006-01-02 15:04"))
	fmt.Fprintf(&b, "%d request(s) read\n", r.Total)
	if r.Total >= limit {
		// A truncated window that does not say so is a wrong answer with a
		// confident face: every ranking below would be of the most recent
		// requests only, and nothing on screen would hint at it.
		fmt.Fprintf(&b, "\n  ! the -limit of %d was reached, so this is the most recent %d\n"+
			"    request(s) in the window and NOT the whole window.\n"+
			"    Raise -limit or narrow -days.\n", limit, limit)
	}

	fmt.Fprintf(&b, "\nREAD — the static-first claim, measured\n")
	fmt.Fprintf(&b, "  cache hits  %d of %d page request(s)  %.1f%%\n", r.Cache.N, r.Cache.Total, r.Cache.Percent())
	fmt.Fprintf(&b, "  crawlers    %d of %d request(s)  %.1f%%\n", r.Bots.N, r.Bots.Total, r.Bots.Percent())

	fmt.Fprintf(&b, "\nTOP CONCEPTS — crawlers excluded\n")
	if len(r.Concepts) == 0 {
		// Said out loud, as in internal/inbox: printing nothing reads exactly
		// like a tool that failed to look.
		b.WriteString("  nothing — no reader opened a concept page in this window\n")
	}
	for _, c := range r.Concepts {
		fmt.Fprintf(&b, "  %-40s %d\n", c.Key, c.N)
	}

	// The question a page-view counter cannot answer, and the reason ADR-0011
	// reads referrers rather than installing a counter at all.
	fmt.Fprintf(&b, "\nEDGES PULLED — a reader followed a declared edge\n")
	if len(r.Traversals) == 0 {
		b.WriteString("  nothing — no reader followed an edge in this window\n")
	}
	for _, e := range r.Traversals {
		fmt.Fprintf(&b, "  %-44s %-9s %d\n", e.From+" → "+e.To, e.Type, e.N)
	}

	// The half that was being reported as edges until #426, and the half worth
	// reading closely: these are pairs the readership connected and the graph
	// does not.
	fmt.Fprintf(&b, "\nJUMPED, NO EDGE — candidate edges the readership is asking for\n")
	if len(r.Jumps) == 0 {
		b.WriteString("  nothing — every concept-to-concept move followed an edge\n")
	}
	for _, e := range r.Jumps {
		fmt.Fprintf(&b, "  %-44s %-9s %d\n", e.From+" → "+e.To, "", e.N)
	}

	// Printed so the number can be reproduced by hand. A measurement nobody
	// else can run again is an assertion.
	fmt.Fprintf(&b, "\nfilter: %s\n", filter)

	if _, err := io.WriteString(w, b.String()); err != nil {
		return fmt.Errorf("writing report: %w", err)
	}
	return nil
}
