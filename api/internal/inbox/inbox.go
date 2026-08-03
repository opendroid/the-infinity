// Package inbox recieves the two submission queues back for a maintainer.
//
// `concept_reviews` and `concept_requests` were append-only with no reader
// anywhere in the repo: one Add, no Query, no job, no notification (#115). The
// provenance buttons tell the reader their flag "joins the queue for a human to
// look at", which was true only if someone opened the Firestore console and
// remembered to. This is the cheapest thing that makes the sentence true.
//
// It is READ-ONLY BY CONSTRUCTION. Reader has no write method, so touching the
// concepts collection is unrepresentable here rather than merely untested — git
// is the only writer of concept state (ADR-0002), and a queue tool that could
// promote a node would be exactly the runtime tier write that ADR forbids.
//
// Acknowledgement is deliberately absent. A flag names a concept and a problem;
// the fix is a pull request editing content/nodes/<id>.json, and merging it is
// the acknowledgement. A --ack flag would put queue state somewhere other than
// git and make this CLI the only interface to it.
package inbox

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/opendroid/the-infinity/api/internal/store"
)

// Reader is the whole data surface this package needs: two reads, no writes.
type Reader interface {
	PendingReviews(ctx context.Context, limit int) ([]store.PendingReview, error)
	PendingRequests(ctx context.Context, limit int) ([]store.PendingRequest, error)
}

// Report is both queues at one moment, plus what it took to read them.
type Report struct {
	Now      time.Time
	Limit    int
	Reviews  []store.PendingReview
	Requests []store.PendingRequest
}

// Collect reads both queues. It reads them independently: an error on one is
// returned rather than swallowed, because a half-report that looks complete is
// how a queue gets ignored for another month.
func Collect(ctx context.Context, r Reader, limit int, now time.Time) (*Report, error) {
	reviews, err := r.PendingReviews(ctx, limit)
	if err != nil {
		return nil, fmt.Errorf("collecting reviews: %w", err)
	}
	requests, err := r.PendingRequests(ctx, limit)
	if err != nil {
		return nil, fmt.Errorf("collecting concept requests: %w", err)
	}
	return &Report{Now: now, Limit: limit, Reviews: reviews, Requests: requests}, nil
}

// Pending is how many submissions are waiting across both queues.
func (r *Report) Pending() int { return len(r.Reviews) + len(r.Requests) }

// Render writes the whole report, or nothing. Built in memory and written once
// so a broken pipe cannot leave half a queue on screen looking like all of it.
func (r *Report) Render(w io.Writer) error {
	var b strings.Builder

	r.renderReviews(&b)
	b.WriteString("\n")
	r.renderRequests(&b)

	_, err := io.WriteString(w, b.String())
	if err != nil {
		return fmt.Errorf("writing report: %w", err)
	}
	return nil
}

func (r *Report) renderReviews(b *strings.Builder) {
	if len(r.Reviews) == 0 {
		// Said out loud. Printing nothing reads identically to a tool that
		// failed to look, which is the state this whole thing exists to end.
		fmt.Fprintf(b, "%s — nothing pending\n", store.CollReviews)
		return
	}

	fmt.Fprintf(b, "%s — %d pending\n\n", store.CollReviews, len(r.Reviews))

	kindW := 0
	idW := 0
	for _, v := range r.Reviews {
		kindW = max(kindW, len(v.Kind))
		idW = max(idW, len(v.ConceptID))
	}

	for _, v := range r.Reviews {
		fmt.Fprintf(b, "  %-12s %-*s %-*s %s\n",
			r.age(v.CreatedAt), kindW, v.Kind, idW, v.ConceptID, nodePath(v.ConceptID))
		// The note is the content of a flag. Never truncated: a report that
		// makes you open the console anyway has not saved the trip.
		for _, line := range noteLines(v.Note) {
			fmt.Fprintf(b, "      %s\n", line)
		}
	}
	r.renderCap(b, len(r.Reviews))
}

func (r *Report) renderRequests(b *strings.Builder) {
	if len(r.Requests) == 0 {
		fmt.Fprintf(b, "%s — nothing pending\n", store.CollRequests)
		return
	}

	fmt.Fprintf(b, "%s — %d pending\n\n", store.CollRequests, len(r.Requests))

	for _, v := range r.Requests {
		// Quoted, and never interpolated into a path: this is free text typed
		// by a stranger into a public form.
		fmt.Fprintf(b, "  %-12s %q\n", r.age(v.CreatedAt), v.Name)
		if v.Referrer != "" {
			fmt.Fprintf(b, "      from %s\n", v.Referrer)
		}
	}
	r.renderCap(b, len(r.Requests))
}

// renderCap says so when a queue filled the limit exactly, because a silent cap
// reads as "that is all of them".
func (r *Report) renderCap(b *strings.Builder, n int) {
	if r.Limit > 0 && n >= r.Limit {
		fmt.Fprintf(b, "\n  (showing the oldest %d — there may be more; raise -limit)\n", r.Limit)
	}
}

// age is the date plus how long it has been waiting, which is the number that
// makes a backlog visible. A date alone needs arithmetic to act on.
func (r *Report) age(t time.Time) string {
	if t.IsZero() {
		// A queued document with no timestamp is a real possibility (a bad tag,
		// a hand-written doc). Saying so beats printing the Go zero year.
		return "undated"
	}
	days := int(r.Now.UTC().Sub(t.UTC()).Hours() / 24)
	switch {
	case days < 0:
		return t.UTC().Format("2006-01-02")
	case days == 0:
		return "today"
	case days == 1:
		return "1 day"
	default:
		return fmt.Sprintf("%d days", days)
	}
}

// nodePath is the file to edit to act on a flag — the whole fix is a PR against
// it. Empty when the id is not a slug, so a malformed document can never print
// a path that looks copy-pasteable and is not.
func nodePath(conceptID string) string {
	if !store.ValidConceptID(conceptID) {
		return "(not a valid concept id)"
	}
	return "content/nodes/" + conceptID + ".json"
}

// noteLines splits a note for indented display and drops a blank one, so an
// empty note prints no line at all rather than an orphaned indent.
func noteLines(note string) []string {
	note = strings.TrimSpace(note)
	if note == "" {
		return nil
	}
	out := make([]string, 0, 1)
	for _, line := range strings.Split(note, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			out = append(out, line)
		}
	}
	return out
}
