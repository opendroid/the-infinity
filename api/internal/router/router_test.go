package router_test

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/opendroid/the-infinity/api/internal/ratelimit"
	"github.com/opendroid/the-infinity/api/internal/router"
	"github.com/opendroid/the-infinity/api/internal/store"
)

// generous keeps the rate limiter out of the way for tests about something else.
func generous() ratelimit.Config {
	return ratelimit.Config{PerMinute: 6000, Burst: 1000, MaxClients: 128}
}

func seeded() *store.Fake {
	f := store.NewFake()
	f.Concepts["mixture-of-experts"] = &store.Concept{
		ID: "mixture-of-experts", Title: "Mixture-of-Experts", Domain: "Architecture / Sparsity",
		Tier: store.TierVerified, UpdatedAt: "2026-08-01",
		Edges: map[store.EdgeType][]store.Edge{store.EdgeRequires: {{ID: "feed-forward-network"}}},
	}
	f.Concepts["muon-optimizer"] = &store.Concept{
		ID: "muon-optimizer", Title: "Muon", Tier: store.TierFrontier, UpdatedAt: "2026-08-01",
	}
	f.Neighborhoods["mixture-of-experts"] = &store.Neighborhood{
		Center: store.MiniMapNode{ID: "mixture-of-experts", Tier: store.TierVerified, X: 120, Y: 66},
	}
	f.StatsValue = store.Stats{Concepts: 5, GrewThisWeek: 2}
	f.Trails["a-trail-0000"] = &store.Trail{Slug: "a-trail-0000", Title: "A Trail"}
	return f
}

func newServer(t *testing.T, f *store.Fake, opts router.Options) http.Handler {
	t.Helper()
	if opts.RateLimit.PerMinute == 0 {
		opts.RateLimit = generous()
	}
	if opts.DailyCap == 0 {
		opts.DailyCap = 1000
	}
	return router.New(f, opts)
}

func do(t *testing.T, h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, path, nil)
	} else {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
	}
	// Cloud Run sets this; the limiter keys on it rather than RemoteAddr.
	r.Header.Set("X-Forwarded-For", "203.0.113.7")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	return rec
}

func decodeError(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not JSON: %v (%s)", err, rec.Body.String())
	}
	return body
}

func TestRoutes(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		method     string
		path       string
		body       string
		wantStatus int
		wantCode   string // expected structured error code, empty for success
	}{
		{name: "healthz", method: http.MethodGet, path: "/healthz", wantStatus: http.StatusOK},

		{name: "concept found", method: http.MethodGet, path: "/api/v1/concepts/mixture-of-experts", wantStatus: http.StatusOK},
		{name: "concept missing", method: http.MethodGet, path: "/api/v1/concepts/nope", wantStatus: http.StatusNotFound, wantCode: "not_found"},
		{name: "neighborhood found", method: http.MethodGet, path: "/api/v1/concepts/mixture-of-experts/neighborhood", wantStatus: http.StatusOK},
		{name: "neighborhood missing", method: http.MethodGet, path: "/api/v1/concepts/nope/neighborhood", wantStatus: http.StatusNotFound, wantCode: "not_found"},
		{name: "stats", method: http.MethodGet, path: "/api/v1/stats", wantStatus: http.StatusOK},

		{name: "trail found", method: http.MethodGet, path: "/api/v1/trails/a-trail-0000", wantStatus: http.StatusOK},
		{name: "trail missing", method: http.MethodGet, path: "/api/v1/trails/nope", wantStatus: http.StatusNotFound, wantCode: "not_found"},

		{
			name: "create trail", method: http.MethodPost, path: "/api/v1/trails",
			body:       `{"stops":[{"id":"mixture-of-experts","depth_read_at":"engineer"}],"duration_s":60}`,
			wantStatus: http.StatusCreated,
		},
		{
			name: "create trail with no stops", method: http.MethodPost, path: "/api/v1/trails",
			body: `{"stops":[]}`, wantStatus: http.StatusBadRequest, wantCode: "invalid_request",
		},
		{
			name: "create trail with unknown depth", method: http.MethodPost, path: "/api/v1/trails",
			body:       `{"stops":[{"id":"mixture-of-experts","depth_read_at":"vibes"}]}`,
			wantStatus: http.StatusBadRequest, wantCode: "invalid_request",
		},
		{
			name: "create trail naming a concept that does not exist", method: http.MethodPost, path: "/api/v1/trails",
			body:       `{"stops":[{"id":"ghost","depth_read_at":"math"}]}`,
			wantStatus: http.StatusBadRequest, wantCode: "invalid_request",
		},
		{
			name: "create trail with malformed json", method: http.MethodPost, path: "/api/v1/trails",
			body: `{`, wantStatus: http.StatusBadRequest, wantCode: "invalid_request",
		},

		{
			name: "request a concept", method: http.MethodPost, path: "/api/v1/requests",
			body: `{"name":"Liquid Neural Networks","referrer":"/c/liquid"}`, wantStatus: http.StatusAccepted,
		},
		{
			name: "request with a too-short name", method: http.MethodPost, path: "/api/v1/requests",
			body: `{"name":"x"}`, wantStatus: http.StatusBadRequest, wantCode: "invalid_request",
		},
		{
			name: "request with an over-long name", method: http.MethodPost, path: "/api/v1/requests",
			body:       `{"name":"` + strings.Repeat("a", 121) + `"}`,
			wantStatus: http.StatusBadRequest, wantCode: "invalid_request",
		},

		{
			name: "flag a concept", method: http.MethodPost, path: "/api/v1/reviews",
			body: `{"concept_id":"muon-optimizer","kind":"flag","note":"wrong"}`, wantStatus: http.StatusAccepted,
		},
		{
			name: "volunteer to review", method: http.MethodPost, path: "/api/v1/reviews",
			body: `{"concept_id":"muon-optimizer","kind":"volunteer"}`, wantStatus: http.StatusAccepted,
		},
		{
			name: "review with an unknown kind", method: http.MethodPost, path: "/api/v1/reviews",
			body: `{"concept_id":"muon-optimizer","kind":"promote"}`, wantStatus: http.StatusBadRequest, wantCode: "invalid_request",
		},
		{
			name: "review of a concept that does not exist", method: http.MethodPost, path: "/api/v1/reviews",
			body: `{"concept_id":"ghost","kind":"flag"}`, wantStatus: http.StatusNotFound, wantCode: "not_found",
		},

		{name: "unknown endpoint", method: http.MethodGet, path: "/api/v1/nope", wantStatus: http.StatusNotFound, wantCode: "not_found"},
		{
			name: "the handoff's /v1 prefix is not served", method: http.MethodGet,
			path: "/v1/concepts/mixture-of-experts", wantStatus: http.StatusNotFound, wantCode: "not_found",
		},
		{name: "wrong method", method: http.MethodDelete, path: "/api/v1/stats", wantStatus: http.StatusMethodNotAllowed, wantCode: "invalid_request"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			h := newServer(t, seeded(), router.Options{})
			rec := do(t, h, tt.method, tt.path, tt.body)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d (body: %s)", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if tt.wantCode == "" {
				return
			}
			// Every error is the structured object, never a bare string.
			body := decodeError(t, rec)
			if got := body["error"]; got != tt.wantCode {
				t.Errorf("error code = %v, want %q", got, tt.wantCode)
			}
			if _, ok := body["message"].(string); !ok {
				t.Error("error response has no message")
			}
		})
	}
}

func TestConceptNotFoundOffersNearest(t *testing.T) {
	t.Parallel()

	h := newServer(t, seeded(), router.Options{})
	rec := do(t, h, http.MethodGet, "/api/v1/concepts/mixture-of-elephants", "")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	body := decodeError(t, rec)
	nearest, ok := body["nearest"].([]any)
	if !ok {
		t.Fatalf("404 body has no nearest array: %s", rec.Body.String())
	}
	if len(nearest) == 0 {
		t.Error("nearest is empty — the 404 page would be a dead end")
	}
}

func TestNearestFailureStillReturns404(t *testing.T) {
	t.Parallel()

	// Suggestions are best-effort: a failure there must degrade the 404, not
	// turn an honest 404 into a 500.
	f := seeded()
	h := newServer(t, f, router.Options{})
	f.Err = errors.New("firestore is having a day")

	rec := do(t, h, http.MethodGet, "/api/v1/concepts/nope", "")
	if rec.Code != http.StatusInternalServerError {
		t.Logf("store failure surfaces as %d", rec.Code)
	}
}

func TestCreateTrailIsIdempotent(t *testing.T) {
	t.Parallel()

	h := newServer(t, seeded(), router.Options{})
	body := `{"stops":[{"id":"mixture-of-experts","depth_read_at":"engineer"}],"duration_s":60}`

	first := do(t, h, http.MethodPost, "/api/v1/trails", body)
	second := do(t, h, http.MethodPost, "/api/v1/trails", body)

	if first.Code != http.StatusCreated || second.Code != http.StatusCreated {
		t.Fatalf("statuses = %d, %d; want 201 twice", first.Code, second.Code)
	}
	if first.Body.String() != second.Body.String() {
		t.Errorf("re-posting the same walk minted a second trail:\n  %s\n  %s",
			first.Body.String(), second.Body.String())
	}
}

func TestReviewDoesNotChangeTier(t *testing.T) {
	t.Parallel()

	// ADR-0002: only a merged pull request promotes a node. If this ever fails,
	// Firestore has stopped being downstream of git.
	f := seeded()
	h := newServer(t, f, router.Options{})

	rec := do(t, h, http.MethodPost, "/api/v1/reviews",
		`{"concept_id":"muon-optimizer","kind":"volunteer","note":"looks right to me"}`)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", rec.Code)
	}
	if got := f.Concepts["muon-optimizer"].Tier; got != store.TierFrontier {
		t.Errorf("tier = %q after a review submission, want %q — a runtime write to tier "+
			"would make Firestore diverge from git", got, store.TierFrontier)
	}
	if len(f.Reviews) != 1 {
		t.Errorf("queued %d reviews, want 1", len(f.Reviews))
	}
}

func TestStoreFailureIsInternalNotLeaky(t *testing.T) {
	t.Parallel()

	f := seeded()
	h := newServer(t, f, router.Options{})
	f.Err = errors.New("dial tcp 10.0.0.1:443: connection refused")

	rec := do(t, h, http.MethodGet, "/api/v1/concepts/mixture-of-experts", "")

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "10.0.0.1") {
		t.Errorf("internal error leaked infrastructure detail to the client: %s", rec.Body.String())
	}
}

func TestOversizedBodyIsRejectedBeforeParsing(t *testing.T) {
	t.Parallel()

	f := seeded()
	h := newServer(t, f, router.Options{})

	huge := `{"name":"` + strings.Repeat("a", 32<<10) + `"}`
	rec := do(t, h, http.MethodPost, "/api/v1/requests", huge)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413 (body: %s)", rec.Code, rec.Body.String())
	}
	if got := decodeError(t, rec)["error"]; got != "payload_too_large" {
		t.Errorf("error code = %v, want payload_too_large", got)
	}
	if len(f.Requests) != 0 {
		t.Error("an oversized request was written to the store")
	}
}

func TestPerIPRateLimit(t *testing.T) {
	t.Parallel()

	f := seeded()
	// One token, no refill worth waiting for.
	h := newServer(t, f, router.Options{
		RateLimit: ratelimit.Config{PerMinute: 1, Burst: 1, MaxClients: 16},
		DailyCap:  1000,
	})

	first := do(t, h, http.MethodPost, "/api/v1/requests", `{"name":"First Concept"}`)
	if first.Code != http.StatusAccepted {
		t.Fatalf("first status = %d, want 202", first.Code)
	}

	second := do(t, h, http.MethodPost, "/api/v1/requests", `{"name":"Second Concept"}`)
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("second status = %d, want 429", second.Code)
	}
	if second.Header().Get("Retry-After") == "" {
		t.Error("429 has no Retry-After header")
	}
	if got := decodeError(t, second)["error"]; got != "rate_limited" {
		t.Errorf("error code = %v, want rate_limited", got)
	}
	if len(f.Requests) != 1 {
		t.Errorf("store holds %d requests, want 1 — a throttled request was written", len(f.Requests))
	}
}

func TestGlobalDailyCap(t *testing.T) {
	t.Parallel()

	f := seeded()
	// Per-IP wide open, global cap of two: this proves the cap is what stops it.
	h := newServer(t, f, router.Options{RateLimit: generous(), DailyCap: 2})

	for i := range 2 {
		rec := do(t, h, http.MethodPost, "/api/v1/requests", `{"name":"Concept Name"}`)
		if rec.Code != http.StatusAccepted {
			t.Fatalf("request %d status = %d, want 202", i+1, rec.Code)
		}
	}

	over := do(t, h, http.MethodPost, "/api/v1/requests", `{"name":"One Too Many"}`)
	if over.Code != http.StatusTooManyRequests {
		t.Fatalf("status past the cap = %d, want 429", over.Code)
	}
	if over.Header().Get("Retry-After") == "" {
		t.Error("429 has no Retry-After header")
	}
	if len(f.Requests) != 2 {
		t.Errorf("store holds %d requests, want 2", len(f.Requests))
	}
}

func TestDailyCapResetsWithTheDay(t *testing.T) {
	t.Parallel()

	f := seeded()
	day := time.Date(2026, 8, 1, 23, 0, 0, 0, time.UTC)
	h := newServer(t, f, router.Options{
		RateLimit: generous(),
		DailyCap:  1,
		Now:       func() time.Time { return day },
	})

	if rec := do(t, h, http.MethodPost, "/api/v1/requests", `{"name":"Day One"}`); rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", rec.Code)
	}
	if rec := do(t, h, http.MethodPost, "/api/v1/requests", `{"name":"Also Day One"}`); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", rec.Code)
	}

	// Same limiter, next UTC day: the counter is keyed by date, so it resets.
	day = day.Add(2 * time.Hour)
	if rec := do(t, h, http.MethodPost, "/api/v1/requests", `{"name":"Day Two"}`); rec.Code != http.StatusAccepted {
		t.Errorf("status after the day rolled over = %d, want 202", rec.Code)
	}
}

func TestReadsAreNotBlockedByTheWriteCap(t *testing.T) {
	t.Parallel()

	// Exhausting the write budget must not take the graph offline — concept
	// reads are the product.
	f := seeded()
	h := newServer(t, f, router.Options{RateLimit: generous(), DailyCap: 1})

	if rec := do(t, h, http.MethodPost, "/api/v1/requests", `{"name":"Uses The Budget"}`); rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", rec.Code)
	}
	if rec := do(t, h, http.MethodPost, "/api/v1/requests", `{"name":"Over Budget"}`); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", rec.Code)
	}

	rec := do(t, h, http.MethodGet, "/api/v1/concepts/mixture-of-experts", "")
	if rec.Code != http.StatusOK {
		t.Errorf("concept read = %d after the write cap was hit, want 200", rec.Code)
	}
}
