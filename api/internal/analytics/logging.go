package analytics

import (
	"context"
	"errors"
	"fmt"
	"time"

	"cloud.google.com/go/logging/logadmin"
	"google.golang.org/api/iterator"
)

// LogName is the Firebase Hosting request log, as Cloud Logging names it.
//
// The %2F IS PART OF THE NAME, not an escaping accident of this source file:
// the log id is `firebasehosting.googleapis.com/webrequests` and Cloud Logging
// percent-encodes the slash. Written raw, the filter matches nothing and the
// tool reports a silent, confident zero.
const logID = "firebasehosting.googleapis.com%2Fwebrequests"

// LogSource reads the Hosting request log. It is the only thing in this package
// that talks to Google, and it has no write path.
type LogSource struct {
	client  *logadmin.Client
	project string
}

// NewLogSource opens a read-only client against the project's logs.
func NewLogSource(ctx context.Context, project string) (*LogSource, error) {
	c, err := logadmin.NewClient(ctx, project)
	if err != nil {
		return nil, fmt.Errorf("opening cloud logging for %s: %w", project, err)
	}
	return &LogSource{client: c, project: project}, nil
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
	it := s.client.Entries(ctx, logadmin.Filter(s.Filter(since)), logadmin.NewestFirst())
	out := make([]Entry, 0, min(limit, 1024))
	for len(out) < limit {
		e, err := it.Next()
		if errors.Is(err, iterator.Done) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("reading request logs since %s: %w", since.Format(time.RFC3339), err)
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
