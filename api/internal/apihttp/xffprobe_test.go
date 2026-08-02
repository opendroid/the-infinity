package apihttp_test

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/opendroid/the-infinity/api/internal/apihttp"
)

// capture swaps the default logger for one writing to a buffer, since XFFProbe
// logs through slog's default the way the rest of the service does.
func capture(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return &buf
}

func lines(buf *bytes.Buffer) []map[string]any {
	var out []map[string]any
	for _, l := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		if l == "" {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(l), &m); err == nil {
			out = append(out, m)
		}
	}
	return out
}

func serve(t *testing.T, h http.Handler, xff string) {
	t.Helper()
	r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/stats", nil)
	r.RemoteAddr = "10.0.0.1:443"
	if xff != "" {
		r.Header.Set("X-Forwarded-For", xff)
	}
	h.ServeHTTP(httptest.NewRecorder(), r)
}

func ok() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
}

// The probe exists to make the chain and the address we key on comparable in one
// line. Logging only the header would leave the actual question — which entry
// does ClientIP pick — to be re-derived by whoever reads the log.
func TestProbeLogsTheChainAndTheDerivedAddress(t *testing.T) {
	buf := capture(t)
	// The chain shape observed through Firebase Hosting: caller first, Google's
	// edge appended last.
	serve(t, apihttp.XFFProbe(ok()), "203.0.113.7, 74.125.209.39")

	got := lines(buf)
	if len(got) != 1 {
		t.Fatalf("got %d log lines, want 1", len(got))
	}
	for field, want := range map[string]string{
		"xff":         "203.0.113.7, 74.125.209.39",
		"remote_addr": "10.0.0.1:443",
		// The caller, not the edge — the probe reports what the limiter keys on,
		// so this tracks ClientIP's semantics rather than restating them.
		"client_ip": "203.0.113.7",
		"path":      "/api/v1/stats",
	} {
		if got[0][field] != want {
			t.Errorf("%s = %v, want %q", field, got[0][field], want)
		}
	}
}

// A request with no forwarding header must still log rather than being skipped:
// its absence is itself an answer about what Hosting does.
func TestProbeLogsAnAbsentHeader(t *testing.T) {
	buf := capture(t)
	serve(t, apihttp.XFFProbe(ok()), "")

	got := lines(buf)
	if len(got) != 1 {
		t.Fatalf("got %d log lines, want 1", len(got))
	}
	if got[0]["xff"] != "" {
		t.Errorf("xff = %v, want empty", got[0]["xff"])
	}
	if got[0]["client_ip"] != "10.0.0.1" {
		t.Errorf("client_ip = %v, want the socket address", got[0]["client_ip"])
	}
}

// Unbounded logging of client addresses is a privacy and volume problem waiting
// for its first crawler. The bound is what makes shipping this to production
// acceptable, so it is asserted rather than assumed.
func TestProbeStopsAfterItsBound(t *testing.T) {
	buf := capture(t)
	h := apihttp.XFFProbe(ok())

	const requests = 60
	for range requests {
		serve(t, h, "203.0.113.7")
	}

	got := len(lines(buf))
	if got >= requests {
		t.Fatalf("logged %d lines for %d requests — the probe is unbounded", got, requests)
	}
	if got == 0 {
		t.Fatal("logged nothing at all")
	}
	t.Logf("bounded at %d lines over %d requests", got, requests)
}

// The probe must never change what the caller sees. It is a diagnostic bolted
// onto a live service, and a diagnostic that alters behaviour answers a question
// about a system that no longer exists.
func TestProbeIsTransparent(t *testing.T) {
	capture(t)

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Test", r.Header.Get("X-Forwarded-For"))
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("body"))
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
	req.Header.Set("X-Forwarded-For", "203.0.113.7")
	apihttp.XFFProbe(inner).ServeHTTP(rec, req)

	if rec.Code != http.StatusTeapot {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusTeapot)
	}
	if rec.Body.String() != "body" {
		t.Errorf("body = %q, want %q", rec.Body.String(), "body")
	}
	if rec.Header().Get("X-Test") != "203.0.113.7" {
		t.Error("the probe altered the request the handler saw")
	}
}
