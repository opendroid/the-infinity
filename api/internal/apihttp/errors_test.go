package apihttp_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/opendroid/the-infinity/api/internal/apihttp"
)

// quiet silences the package logger for tests that deliberately trigger an
// error path, so a passing run does not look like a failing one.
// NOT SAFE ALONGSIDE t.Parallel(), and every caller here is sequential for
// that reason. This swaps the PROCESS-WIDE default logger and hands back a
// bytes.Buffer that is not safe for concurrent writes, so two parallel tests
// holding it at once race on both — one test's line lands in another's buffer,
// and the two writes collide. It was latent for as long as more than one
// parallel test used this, and surfaced under -race in CI rather than locally,
// which is what an intermittent race does.
//
// A test that replaces a global cannot be parallel. These are microseconds
// each; the parallelism bought nothing.
func quiet(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return &buf
}

func body(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("response is not JSON: %v (%q)", err, rec.Body.String())
	}
	return m
}

// Every error is the structured object openapi.yaml declares. A client that has
// to parse prose is a client that breaks when the prose changes.
func TestErrorWritersProduceTheContractShape(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		write      func(w http.ResponseWriter)
		wantStatus int
		wantCode   string
	}{
		{
			name:       "not found",
			write:      func(w http.ResponseWriter) { apihttp.WriteError(w, 404, apihttp.CodeNotFound, "gone") },
			wantStatus: 404, wantCode: "not_found",
		},
		{
			name:       "field error",
			write:      func(w http.ResponseWriter) { apihttp.WriteFieldError(w, "name", "too short") },
			wantStatus: 400, wantCode: "invalid_request",
		},
		{
			name:       "rate limited",
			write:      func(w http.ResponseWriter) { apihttp.WriteRateLimited(w, 10) },
			wantStatus: 429, wantCode: "rate_limited",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			rec := httptest.NewRecorder()
			tt.write(rec)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
				t.Errorf("Content-Type = %q, want JSON", ct)
			}
			b := body(t, rec)
			if b["error"] != tt.wantCode {
				t.Errorf("error = %v, want %q", b["error"], tt.wantCode)
			}
			if msg, ok := b["message"].(string); !ok || msg == "" {
				t.Error("error has no human-readable message")
			}
			// Every error path is uncacheable — a cached rejection outlives its
			// cause with no way to purge it.
			if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
				t.Errorf("Cache-Control = %q, want no-store", cc)
			}
		})
	}
}

// WriteFieldError exists so a client can point at the input rather than
// re-reading the whole body. If the field is not in the response it is just
// WriteError with extra steps.
func TestWriteFieldErrorNamesTheField(t *testing.T) {
	t.Parallel()

	rec := httptest.NewRecorder()
	apihttp.WriteFieldError(rec, "stops[0].depth_read_at", "not a depth")

	details, ok := body(t, rec)["details"].(map[string]any)
	if !ok {
		t.Fatal("no details object in the response")
	}
	if details["field"] != "stops[0].depth_read_at" {
		t.Errorf("details.field = %v, want the offending field", details["field"])
	}
}

// The internal error must never reach the client: it names collections, ids and
// query shapes, none of which a caller needs and some of which help an attacker.
// It must still reach the log, or a 500 becomes unattributable.
func TestWriteInternalHidesTheCauseButLogsIt(t *testing.T) {
	logs := quiet(t)
	rec := httptest.NewRecorder()
	secret := "firestore: collection concepts doc mixture-of-experts permission denied"
	apihttp.WriteInternal(context.Background(), rec, errors.New(secret), "fetching concept")

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "firestore") || strings.Contains(rec.Body.String(), "concepts") {
		t.Errorf("the internal error leaked to the client: %s", rec.Body.String())
	}
	if !strings.Contains(logs.String(), secret) {
		t.Error("the cause was hidden from the client AND from the log — a 500 nobody can explain")
	}
}

// A Retry-After of 0 tells a client to retry immediately, which turns shaping
// into a tight loop against the endpoint that just asked it to stop.
func TestWriteRateLimitedNeverSaysRetryImmediately(t *testing.T) {
	t.Parallel()

	for _, in := range []int{-5, 0, 1, 30} {
		t.Run(strconv.Itoa(in), func(t *testing.T) {
			t.Parallel()
			rec := httptest.NewRecorder()
			apihttp.WriteRateLimited(rec, in)

			got, err := strconv.Atoi(rec.Header().Get("Retry-After"))
			if err != nil {
				t.Fatalf("Retry-After is not a number: %q", rec.Header().Get("Retry-After"))
			}
			if got < 1 {
				t.Errorf("Retry-After = %d, want at least 1", got)
			}
			if in >= 1 && got != in {
				t.Errorf("Retry-After = %d, want the requested %d", got, in)
			}
		})
	}
}

func TestDecodeJSON(t *testing.T) {
	t.Parallel()

	type target struct {
		Name string `json:"name"`
	}

	tests := []struct {
		name       string
		body       string
		limit      bool // route the body through LimitBody first
		wantOK     bool
		wantStatus int
		wantCode   string
	}{
		{name: "a valid body", body: `{"name":"ok"}`, wantOK: true},
		{
			// Deliberately NOT reported as "not valid JSON": the body is often
			// valid JSON that simply does not match this endpoint's shape, and
			// saying otherwise sends the caller hunting a syntax error that is
			// not there.
			name: "malformed json", body: `{`,
			wantStatus: http.StatusBadRequest, wantCode: "invalid_request",
		},
		{
			name: "an unknown field", body: `{"name":"ok","extra":1}`,
			wantStatus: http.StatusBadRequest, wantCode: "invalid_request",
		},
		{
			// The distinction that justifies this function existing: an oversized
			// body is a different mistake from a malformed one, and a client can
			// only act on the difference if we report it.
			name: "an oversized body", body: `{"name":"` + strings.Repeat("a", int(apihttp.MaxBodyBytes)+1) + `"}`,
			limit: true, wantStatus: http.StatusRequestEntityTooLarge, wantCode: "payload_too_large",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			rec := httptest.NewRecorder()
			var dst target
			var ok bool

			h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				ok = apihttp.DecodeJSON(w, r, &dst)
			})
			if tt.limit {
				h = apihttp.LimitBody(h).ServeHTTP
			}
			req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/", strings.NewReader(tt.body))
			h.ServeHTTP(rec, req)

			if ok != tt.wantOK {
				t.Fatalf("DecodeJSON = %v, want %v (body: %s)", ok, tt.wantOK, rec.Body.String())
			}
			if tt.wantOK {
				return
			}
			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if got := body(t, rec)["error"]; got != tt.wantCode {
				t.Errorf("error = %v, want %q", got, tt.wantCode)
			}
		})
	}
}

func TestCacheHeaders(t *testing.T) {
	t.Parallel()

	rec := httptest.NewRecorder()
	apihttp.CacheFor(rec, apihttp.ConceptBrowserTTL, apihttp.ConceptEdgeTTL)
	if got, want := rec.Header().Get("Cache-Control"), "public, max-age=60, s-maxage=300"; got != want {
		t.Errorf("CacheFor set %q, want %q", got, want)
	}

	rec = httptest.NewRecorder()
	apihttp.NoStore(rec)
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("NoStore set %q, want no-store", got)
	}
}

// CLAUDE.md forbids panicking in a handler; this exists for the code we did not
// write. A panic must become a 500, not a dropped connection.
func TestRecovererTurnsAPanicIntoA500(t *testing.T) {
	quiet(t)
	h := apihttp.Recoverer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("a nil map deep in a dependency")
	}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "nil map") {
		t.Errorf("the panic value leaked to the client: %s", rec.Body.String())
	}
}

// A panic AFTER the response has started is the case the 500 path cannot serve.
// The status line is already spent — net/http logs the duplicate WriteHeader and
// drops it — so writing the error anyway lands the error object in the body
// beside the one already there, and the client receives `{...}{...}`, which
// parses as neither. Truncated is the only honest ending.
func TestRecovererDoesNotAppendToAResponseAlreadyStarted(t *testing.T) {
	quiet(t)
	h := apihttp.Recoverer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		apihttp.WriteJSON(w, http.StatusOK, map[string]string{"id": "attention"})
		panic("a nil map, one line after the write")
	}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil))

	// httptest.ResponseRecorder keeps the first status and ignores the second,
	// exactly as net/http does, so the status alone cannot tell these apart.
	// The body can: it must still be one JSON document.
	body := rec.Body.String()
	if got := strings.Count(body, "{"); got != 1 {
		t.Errorf("body contains %d JSON objects, want 1: %s", got, body)
	}
	if strings.Contains(body, string(apihttp.CodeInternal)) {
		t.Errorf("an error object was appended to a response already sent: %s", body)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want the 200 the handler already sent", rec.Code)
	}
}

// The wrapper Recoverer puts around the ResponseWriter must not cost a handler
// the controls net/http gives it. http.ResponseController reaches through
// Unwrap; without that method it fails with ErrNotSupported on a writer that
// supports flushing perfectly well.
func TestRecovererLeavesTheResponseControllerReachable(t *testing.T) {
	t.Parallel()

	var flushErr error
	h := apihttp.Recoverer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		flushErr = http.NewResponseController(w).Flush()
	}))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil))

	if flushErr != nil {
		t.Errorf("Flush through the wrapper: %v", flushErr)
	}
}

// http.ErrAbortHandler is Go's documented way for a handler to abandon a
// response deliberately. Swallowing it would convert an intentional abort into
// a logged crash and a second write onto a response already in flight.
func TestRecovererLetsErrAbortHandlerThrough(t *testing.T) {
	quiet(t)
	h := apihttp.Recoverer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic(http.ErrAbortHandler)
	}))

	defer func() {
		if r := recover(); r == nil {
			t.Error("Recoverer swallowed http.ErrAbortHandler")
		} else if !errors.Is(r.(error), http.ErrAbortHandler) { //nolint:errcheck,forcetypeassert // the recover value is the error we panicked with
			t.Errorf("re-panicked with %v, want http.ErrAbortHandler", r)
		}
	}()

	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil))
}
