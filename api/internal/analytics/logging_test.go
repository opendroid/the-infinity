package analytics

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"cloud.google.com/go/logging"
	"google.golang.org/api/iterator"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

/**
 * The real refusal, as the first live run produced it (#424).
 *
 * Reproduced as a gRPC status rather than a string, because that is what the
 * classification actually reads — a test against the message text would pass
 * with the code checked for the wrong value.
 */
func quotaErr() error {
	return status.Error(codes.ResourceExhausted,
		"Quota exceeded for quota metric 'Read requests' and limit 'Read requests per minute'")
}

/** One log entry shaped like the live webrequests log. */
func entry(url, referer, ua string, cacheHit bool) *logging.Entry {
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, url, nil)
	if err != nil {
		panic(err)
	}
	if referer != "" {
		req.Header.Set("Referer", referer)
	}
	if ua != "" {
		req.Header.Set("User-Agent", ua)
	}
	return &logging.Entry{
		HTTPRequest: &logging.HTTPRequest{Request: req, Status: 200, CacheHit: cacheHit},
	}
}

/** A next() that replays a script of results, then reports Done. */
func script(steps ...any) func() (*logging.Entry, error) {
	i := 0
	return func() (*logging.Entry, error) {
		if i >= len(steps) {
			return nil, iterator.Done
		}
		s := steps[i]
		i++
		switch v := s.(type) {
		case *logging.Entry:
			return v, nil
		case error:
			return nil, v
		}
		panic("script takes entries and errors")
	}
}

func TestDrain(t *testing.T) {
	cases := []struct {
		name      string
		steps     []any
		limit     int
		wantLen   int
		wantWaits int
		wantErr   error
	}{
		{
			name:    "reads what is there",
			steps:   []any{entry("https://theinfinity.ai/c/a", "", "Firefox", true)},
			limit:   10,
			wantLen: 1,
		},
		{
			name:    "stops at the limit without draining the rest",
			steps:   []any{entry("https://theinfinity.ai/1", "", "b", false), entry("https://theinfinity.ai/2", "", "b", false)},
			limit:   1,
			wantLen: 1,
		},
		{
			// An entry with no HTTP request is skipped, not counted and not fatal.
			name:    "an entry without a request is skipped",
			steps:   []any{&logging.Entry{}, entry("https://theinfinity.ai/c/a", "", "b", false)},
			limit:   10,
			wantLen: 1,
		},
		{
			// The bug in #424: this used to be fatal on the first occurrence.
			name:      "waits out a rate-limit refusal and carries on",
			steps:     []any{quotaErr(), entry("https://theinfinity.ai/c/a", "", "b", false)},
			limit:     10,
			wantLen:   1,
			wantWaits: 1,
		},
		{
			name:      "gives up after the budget, naming the quota",
			steps:     []any{quotaErr(), quotaErr(), quotaErr(), quotaErr()},
			limit:     10,
			wantWaits: retryAttempts - 1,
			wantErr:   errQuota,
		},
		{
			name:    "a real error is not retried",
			steps:   []any{status.Error(codes.PermissionDenied, "nope")},
			limit:   10,
			wantErr: nil, // checked separately: must not be errQuota, must be non-nil
		},
		{name: "nothing at all", steps: nil, limit: 10, wantLen: 0},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			waits := 0
			got, err := drain(script(c.steps...), c.limit, func(time.Duration) { waits++ })

			if c.name == "a real error is not retried" {
				if err == nil {
					t.Fatal("want an error")
				}
				if errors.Is(err, errQuota) {
					t.Error("a permission failure must not be reported as a quota problem")
				}
				if waits != 0 {
					t.Errorf("waited %d time(s) on an error that will never clear", waits)
				}
				return
			}

			if c.wantErr != nil {
				if !errors.Is(err, c.wantErr) {
					t.Fatalf("err = %v, want %v", err, c.wantErr)
				}
				// The underlying refusal survives alongside the advice, so the
				// operator sees both what happened and what to do. Asserted
				// through errors.As traversal, which is what callers would use.
				if !rateLimited(err) {
					t.Error("the original refusal should survive in the wrapped error")
				}
			} else {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				if len(got) != c.wantLen {
					t.Errorf("read %d entries, want %d", len(got), c.wantLen)
				}
			}
			if waits != c.wantWaits {
				t.Errorf("waited %d time(s), want %d", waits, c.wantWaits)
			}
		})
	}
}

func TestRateLimited(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"the real refusal", quotaErr(), true},
		{"permission denied", status.Error(codes.PermissionDenied, "nope"), false},
		{"iterator done", iterator.Done, false},
		{"a plain error", errors.New("boom"), false},
		{"no error", nil, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := rateLimited(c.err); got != c.want {
				t.Errorf("rateLimited(%v) = %v, want %v", c.err, got, c.want)
			}
		})
	}
}

func TestDrainReadsEveryField(t *testing.T) {
	got, err := drain(script(entry(
		"https://theinfinity.ai/c/softmax",
		"https://theinfinity.ai/c/attention",
		"Mozilla/5.0 Chrome/124.0.0.0",
		true,
	)), 10, func(time.Duration) {})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := Entry{
		URL:       "https://theinfinity.ai/c/softmax",
		Referer:   "https://theinfinity.ai/c/attention",
		UserAgent: "Mozilla/5.0 Chrome/124.0.0.0",
		Status:    200,
		CacheHit:  true,
	}
	if got[0] != want {
		t.Errorf("entry = %+v, want %+v", got[0], want)
	}
}

func TestFilterNamesTheEncodedLog(t *testing.T) {
	s := &LogSource{project: "the-infinity-ai"}
	f := s.Filter(time.Date(2026, 9, 4, 6, 0, 0, 0, time.UTC))
	// The %2F is load-bearing: written as a slash the filter matches nothing
	// and the tool reports a confident zero.
	want := `logName="projects/the-infinity-ai/logs/firebasehosting.googleapis.com%2Fwebrequests" AND timestamp>="2026-09-04T06:00:00Z"`
	if f != want {
		t.Errorf("filter =\n  %s\nwant\n  %s", f, want)
	}
}
