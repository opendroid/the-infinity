// Command analytics answers four questions from the Firebase Hosting request
// log, and ships no JavaScript to anybody to do it.
//
// ADR-0011 chose against GA4 and Plausible: 14 KB of SDK against 2.4–3 KB of
// headroom on six routes and a seventh budgeted at zero, plus a cookie banner
// on a landing page that is one search field. The log is already written, the
// reader is already paid for, and `/` keeps its zero.
//
//	cd api
//	make analytics                                  # the last 7 days
//	go run ./cmd/analytics -days 30 -top 20
//	go run ./cmd/analytics -project the-infinity-ai -limit 20000
//
// It reads and never writes — internal/analytics has no write path to have.
//
// Needs Cloud Logging linked for the Hosting site (#64, a console step) and
// application-default credentials, the same two things `make queues` needs.
//
// Exit status is 0 when the window was read, whether or not anything is in it:
// a quiet week is an answer.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/opendroid/the-infinity/api/internal/analytics"
	"github.com/opendroid/the-infinity/api/internal/publish"
)

// lookup derives the graph so the report can tell an edge from a jump.
//
// now is the clock only because Derive takes one for Stats.GrewThisWeek, which
// this does not read.
func lookup(dir string) (analytics.EdgeLookup, error) {
	authored, err := publish.Load(dir)
	if err != nil {
		return nil, fmt.Errorf("reading concept nodes from %s (pass -nodes): %w", dir, err)
	}
	g, err := publish.Derive(authored, time.Now())
	if err != nil {
		return nil, fmt.Errorf("deriving the graph from %s: %w", dir, err)
	}
	return analytics.EdgesFrom(g), nil
}

// Bounded so a hung read fails with a deadline rather than sitting on a
// terminal indefinitely, as in cmd/queues.
const readTimeout = 2 * time.Minute

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "analytics: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	var (
		project = flag.String("project", os.Getenv("GOOGLE_CLOUD_PROJECT"), "GCP project id")
		days    = flag.Int("days", 7, "how many days back to read")
		top     = flag.Int("top", 15, "how many rows per ranking")
		limit   = flag.Int("limit", 10000, "most log entries to read")
		nodes   = flag.String("nodes", "../content/nodes", "concept node JSON, for telling an edge from a jump")
	)
	flag.Parse()

	if *project == "" {
		return fmt.Errorf("no project: pass -project or set GOOGLE_CLOUD_PROJECT")
	}
	if *days < 1 {
		return fmt.Errorf("-days must be at least 1, got %d", *days)
	}
	// Cloud Logging keeps 30 days by default and we do not pay to keep more
	// (#64). Asking for 90 would return 30 and say nothing about the other 60.
	if *days > 30 {
		return fmt.Errorf("-days is capped at 30: the default log bucket retains 30 days, got %d", *days)
	}
	if *top < 1 {
		return fmt.Errorf("-top must be at least 1, got %d", *top)
	}
	if *limit < 1 {
		return fmt.Errorf("-limit must be at least 1, got %d", *limit)
	}

	// Whether a move followed an edge is a question about the graph, so the
	// graph has to be read — from the SAME derivation the API publishes and the
	// pages render (#426, CLAUDE.md §7). Loaded before the network call: being
	// told the content directory is wrong should not cost a log read.
	edges, err := lookup(*nodes)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), readTimeout)
	defer cancel()

	source, err := analytics.NewLogSource(ctx, *project)
	if err != nil {
		return err
	}
	defer func() {
		if err := source.Close(); err != nil {
			fmt.Fprintf(os.Stderr, "analytics: %v\n", err)
		}
	}()

	now := time.Now().UTC()
	since := now.AddDate(0, 0, -*days)
	report, err := analytics.Collect(ctx, source, since, *limit, *top, now, edges)
	if err != nil {
		return err
	}

	return report.Render(os.Stdout, *days, *limit, source.Filter(since))
}
