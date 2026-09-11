package analytics

import (
	"context"
	"errors"
	"fmt"
	"time"

	"cloud.google.com/go/logging"
	"cloud.google.com/go/logging/logadmin"
	"google.golang.org/api/iterator"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// LogName is the Firebase Hosting request log, as Cloud Logging names it.
//
// The %2F IS PART OF THE NAME, not an escaping accident of this source file:
// the log id is `firebasehosting.googleapis.com/webrequests` and Cloud Logging
// percent-encodes the slash. Written raw, the filter matches nothing and the
// tool reports a silent, confident zero.
const logID = "firebasehosting.googleapis.com%2Fwebrequests"

// pageSize is entries per read request, and Cloud Logging's maximum.
//
// THE NUMBER THAT MATTERS HERE IS REQUESTS, NOT ENTRIES (#424). A project may
// make 60 READ REQUESTS PER MINUTE, and every page is one of them. The first
// real run of this tool left this unset, took the server's much smaller default
// page, and spent hundreds of requests draining a 10,000-entry limit — dying on
// ResourceExhausted within seconds, on a project with no other log traffic at
// all. At 1000, the same limit costs ten requests.
const pageSize = 1000

// A rate-limit refusal is a request to wait, not an error — the same
// distinction fetch-pool.mjs draws for 429 and 503 (#408). The quota window is
// a minute wide, so the waits are long enough to outlast one.
const (
	retryAttempts = 3
	retryBackoff  = 20 * time.Second
)

// LogSource reads the Hosting request log. It is the only thing in this package
// that talks to Google, and it has no write path.
type LogSource struct {
	client  *logadmin.Client
	project string
	// sleep is injected so the retry can be tested without waiting a minute.
	sleep func(time.Duration)
}

// NewLogSource opens a read-only client against the project's logs.
func NewLogSource(ctx context.Context, project string) (*LogSource, error) {
	c, err := logadmin.NewClient(ctx, project)
	if err != nil {
		return nil, fmt.Errorf("opening cloud logging for %s: %w", project, err)
	}
	return &LogSource{client: c, project: project, sleep: time.Sleep}, nil
}

// Close releases the client.
func (s *LogSource) Close() error {
	if err := s.client.Close(); err != nil {
		return fmt.Errorf("closing cloud logging client: %w", err)
	}
	return nil
}

// Filter is the advanced-filter string this source reads with, exported so the
// command can print it — a number nobody can reproduce is not a measurement.
func (s *LogSource) Filter(since time.Time) string {
	return fmt.Sprintf(
		"logName=%q AND timestamp>=%q",
		fmt.Sprintf("projects/%s/logs/%s", s.project, logID),
		since.UTC().Format(time.RFC3339),
	)
}

// Requests reads up to limit entries logged since the given time.
//
// Bounded on purpose. A month of a crawled site is a lot of entries, and this
// is a command someone runs on a laptop: a tool that pages until it finishes is
// one that hangs on the week it matters most.
func (s *LogSource) Requests(ctx context.Context, since time.Time, limit int) ([]Entry, error) {
	it := s.client.Entries(ctx,
		logadmin.Filter(s.Filter(since)),
		logadmin.NewestFirst(),
		logadmin.PageSize(pageSize),
	)
	out, err := drain(it.Next, limit, s.sleep)
	if err != nil {
		return nil, fmt.Errorf("reading request logs since %s: %w", since.Format(time.RFC3339), err)
	}
	return out, nil
}

// rateLimited reports whether the API refused because the read quota is spent.
func rateLimited(err error) bool {
	return status.Code(err) == codes.ResourceExhausted
}

// errQuota is returned when the read quota stayed exhausted across every
// attempt. Named so the command can say something useful rather than relay a
// wall of gRPC metadata.
var errQuota = errors.New(
	"cloud logging's read quota (60 requests/minute for this project) stayed exhausted; " +
		"narrow the window with -days, or read fewer entries with -limit")

// drain pulls entries from next until limit or exhaustion, waiting out a
// rate-limit refusal rather than failing on it.
//
// next is a function rather than the iterator so the retry can be tested
// against a fake, with no credentials and no emulator — CLAUDE.md §4.
func drain(next func() (*logging.Entry, error), limit int, sleep func(time.Duration)) ([]Entry, error) {
	out := make([]Entry, 0, min(limit, 1024))
	waits := 0
	for len(out) < limit {
		e, err := next()
		switch {
		case errors.Is(err, iterator.Done):
			return out, nil
		case rateLimited(err):
			if waits >= retryAttempts-1 {
				return nil, fmt.Errorf("%w: %w", errQuota, err)
			}
			// Linear, not exponential: the window is a fixed minute, so the
			// question is only whether enough of it has passed.
			waits++
			sleep(time.Duration(waits) * retryBackoff)
			continue
		case err != nil:
			return nil, err
		}
		if e.HTTPRequest == nil || e.HTTPRequest.Request == nil {
			continue
		}
		req := e.HTTPRequest.Request
		url := ""
		if req.URL != nil {
			url = req.URL.String()
		}
		out = append(out, Entry{
			URL:       url,
			Referer:   req.Referer(),
			UserAgent: req.UserAgent(),
			Status:    e.HTTPRequest.Status,
			CacheHit:  e.HTTPRequest.CacheHit,
		})
	}
	return out, nil
}
