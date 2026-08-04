package apihttp_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/opendroid/the-infinity/api/internal/apihttp"
)

// The line exists so a measurement that has gone stale is visible. #29 asked
// whether the forwarding chain through a custom domain differs from the
// `web.app` one, and nothing anywhere could answer it: Cloud Run's request log
// carries no headers, and what ClientIP resolved was never written down.
//
// Both ways of being wrong are silent, which is why this is a permanent line
// rather than a probe someone remembers to run.
func send(t *testing.T, h http.Handler, xff string) {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
	if xff != "" {
		req.Header.Set("X-Forwarded-For", xff)
	}
	req.Host = "api-u4glkclwqq-uw.a.run.app"
	h.ServeHTTP(httptest.NewRecorder(), req)
}

func lines(buf interface{ String() string }) []map[string]any {
	var out []map[string]any
	for _, l := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		if l == "" {
			continue
		}
		var m map[string]any
		if json.Unmarshal([]byte(l), &m) == nil {
			out = append(out, m)
		}
	}
	return out
}

func TestForwardedChainIsLoggedOnce(t *testing.T) {
	buf := quiet(t)
	h := apihttp.LogForwarded(1)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))

	for range 5 {
		send(t, h, "2600:6c52::702e, 74.125.209.39")
	}

	got := lines(buf)
	if len(got) != 1 {
		t.Fatalf("logged %d times, want 1 — this is per process, not per request", len(got))
	}
	for _, c := range []struct{ key, want string }{
		{"msg", "forwarding chain"},
		{"x_forwarded_for", "2600:6c52::702e, 74.125.209.39"},
		{"client_ip", "2600:6c52::702e"},
		{"host", "api-u4glkclwqq-uw.a.run.app"},
	} {
		if got[0][c.key] != c.want {
			t.Errorf("%s = %v, want %q", c.key, got[0][c.key], c.want)
		}
	}
	if got[0]["entries"] != float64(2) || got[0]["trusted_hops"] != float64(1) {
		t.Errorf("entries/hops = %v/%v, want 2/1", got[0]["entries"], got[0]["trusted_hops"])
	}
}

// A health probe arrives with no chain. Logging it would spend the one line
// this has on a request that says nothing about the path a reader takes.
func TestARequestWithNoChainDoesNotSpendTheLine(t *testing.T) {
	buf := quiet(t)
	h := apihttp.LogForwarded(1)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))

	send(t, h, "")
	send(t, h, "")
	if n := len(lines(buf)); n != 0 {
		t.Fatalf("logged %d times for requests with no X-Forwarded-For, want 0", n)
	}

	send(t, h, "203.0.113.7, 74.125.209.39")
	got := lines(buf)
	if len(got) != 1 {
		t.Fatalf("logged %d times, want 1 once a chain finally arrived", len(got))
	}
	if got[0]["client_ip"] != "203.0.113.7" {
		t.Errorf("client_ip = %v, want 203.0.113.7", got[0]["client_ip"])
	}
}

// The whole point is that the logged client_ip is what the RATE LIMITER will
// key on, not a second opinion computed nearby. If these ever diverge the line
// is worse than useless: it would report a healthy chain while the limiter
// keyed on something else.
func TestTheLoggedAddressIsTheOneTheLimiterUses(t *testing.T) {
	for _, c := range []struct {
		name, xff string
		hops      int
		want      string
	}{
		{"one trailing hop, as measured through Hosting", "203.0.113.7, 74.125.209.39", 1, "203.0.113.7"},
		{"no trailing hop keys on the last entry", "203.0.113.7, 74.125.209.39", 0, "74.125.209.39"},
		{"two hops walks one further left", "203.0.113.7, 10.0.0.1, 74.125.209.39", 2, "203.0.113.7"},
		{"a chain shorter than the hop count falls back leftmost", "203.0.113.7", 3, "203.0.113.7"},
	} {
		t.Run(c.name, func(t *testing.T) {
			buf := quiet(t)
			h := apihttp.LogForwarded(c.hops)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
			send(t, h, c.xff)

			got := lines(buf)
			if len(got) != 1 {
				t.Fatalf("logged %d times, want 1", len(got))
			}
			if got[0]["client_ip"] != c.want {
				t.Errorf("client_ip = %v, want %q", got[0]["client_ip"], c.want)
			}
		})
	}
}
