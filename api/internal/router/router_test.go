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
		Edges: store.Edges{Requires: []store.Edge{{ID: "feed-forward-network", Title: "Feed-Forward Network"}}},
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
	if opts.ReadLimit.PerMinute == 0 {
		opts.ReadLimit = generous()
	}
	if opts.WriteLimit.PerMinute == 0 {
		opts.WriteLimit = generous()
	}
	if opts.DailyCap == 0 {
		opts.DailyCap = 1000
	}
	return router.New(f, opts)
}

func do(t *testing.T, h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	// The request carries the test's context, so one that outlives its test is
	// cancelled rather than left running against a handler nothing is reading.
	var r *http.Request
	if body == "" {
		r = httptest.NewRequestWithContext(t.Context(), method, path, nil)
	} else {
		r = httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(body))
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

func TestNearestFailureStillDegradesTo404(t *testing.T) {
	t.Parallel()

	// Suggestions are best-effort: a failure there must degrade the 404, not
	// replace an honest 404 with a 500.
	//
	// The previous version of this test asserted with t.Logf, so it could never
	// fail — and it set the fake's shared Err, which makes Concept() fail first,
	// so the branch it named was never reached either.
	f := seeded()
	f.NearestErr = errors.New("suggestion lookup is having a day")
	h := newServer(t, f, router.Options{})

	rec := do(t, h, http.MethodGet, "/api/v1/concepts/nope", "")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 — a failed suggestion lookup must not "+
			"turn an honest 404 into a 500", rec.Code)
	}
	body := decodeError(t, rec)
	if got, ok := body["nearest"].([]any); !ok || len(got) != 0 {
		t.Errorf("nearest = %v, want an empty array", body["nearest"])
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
		ReadLimit:  ratelimit.Config{PerMinute: 1, Burst: 1, MaxClients: 16},
		WriteLimit: ratelimit.Config{PerMinute: 1, Burst: 1, MaxClients: 16},
		DailyCap:   1000,
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
	h := newServer(t, f, router.Options{ReadLimit: generous(), WriteLimit: generous(), DailyCap: 2})

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
		ReadLimit: generous(), WriteLimit: generous(),
		DailyCap: 1,
		Now:      func() time.Time { return day },
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
	h := newServer(t, f, router.Options{ReadLimit: generous(), WriteLimit: generous(), DailyCap: 1})

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

// Regression: GET /stats must not spend the daily WRITE budget.
//
// It briefly did. At the default cap, roughly 500 visitors a day would have
// silently disabled concept requests and reviews for everyone — ordinary
// traffic taking out the contribution path.
func TestStatsDoesNotConsumeTheWriteBudget(t *testing.T) {
	t.Parallel()

	f := seeded()
	h := newServer(t, f, router.Options{ReadLimit: generous(), WriteLimit: generous(), DailyCap: 3})

	for i := range 5 {
		if rec := do(t, h, http.MethodGet, "/api/v1/stats", ""); rec.Code != http.StatusOK {
			t.Fatalf("stats view %d = %d, want 200", i+1, rec.Code)
		}
	}

	rec := do(t, h, http.MethodPost, "/api/v1/requests", `{"name":"A Real Request"}`)
	if rec.Code != http.StatusAccepted {
		t.Errorf("a genuine write after 5 page views = %d, want 202 — reads are "+
			"spending the write budget", rec.Code)
	}
}

// Regression: openapi.yaml marks requires, unlocks and adjacent all required.
// A map omitted absent groups, so a client doing edges.adjacent.map(...) would
// crash on exactly the nodes the empty-state design exists for.
func TestConceptAlwaysSerialisesAllThreeEdgeGroups(t *testing.T) {
	t.Parallel()

	f := store.NewFake()
	f.Concepts["lonely"] = &store.Concept{ID: "lonely", Title: "Lonely", Tier: store.TierFrontier}
	h := newServer(t, f, router.Options{})

	rec := do(t, h, http.MethodGet, "/api/v1/concepts/lonely", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var body struct {
		Edges map[string]json.RawMessage `json:"edges"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not JSON: %v", err)
	}
	for _, group := range []string{"requires", "unlocks", "adjacent"} {
		raw, ok := body.Edges[group]
		if !ok {
			t.Errorf("edges.%s is missing — openapi marks it required", group)
			continue
		}
		if string(raw) != "[]" {
			t.Errorf("edges.%s = %s, want [] — a nil slice marshals as null", group, raw)
		}
	}
}

// Regression: the fake and Firestore must agree on what "the same walk" means.
//
// They did not: the fake keyed on the stop sequence while Firestore appended a
// random nonce to the document id, so the idempotency openapi.yaml promises held
// in tests and would have failed in production. Both now derive the slug from
// store.TrailSlug, so a divergence would have to be introduced deliberately.
func TestTrailSlugIsDeterministicAndShared(t *testing.T) {
	t.Parallel()

	walk := []store.NewTrailStop{
		{ID: "feed-forward-network", DepthReadAt: store.DepthIntuition},
		{ID: "mixture-of-experts", DepthReadAt: store.DepthEngineer},
	}
	other := []store.NewTrailStop{
		{ID: "feed-forward-network", DepthReadAt: store.DepthEngineer},
		{ID: "mixture-of-experts", DepthReadAt: store.DepthEngineer},
	}

	if a, b := store.TrailSlug(walk), store.TrailSlug(walk); a != b {
		t.Errorf("the same walk produced two slugs: %q and %q", a, b)
	}
	if a, b := store.TrailSlug(walk), store.TrailSlug(other); a == b {
		t.Errorf("walks differing only in depth collided on %q", a)
	}
	if got := store.TrailSlug(walk); !strings.Contains(got, "feed-forward-network") {
		t.Errorf("slug %q is not human-readable", got)
	}
}

// Regression: reads and writes must not share a per-IP bucket.
//
// The first fix separated only the daily counter and claimed the problem
// solved. At production defaults three landing-page views still 429'd a genuine
// submission — and the regression test passed because it used generous().
func TestReadsAndWritesHaveSeparatePerIPBuckets(t *testing.T) {
	t.Parallel()

	f := seeded()
	h := newServer(t, f, router.Options{
		ReadLimit:  ratelimit.DefaultReadConfig(),
		WriteLimit: ratelimit.DefaultConfig(),
		DailyCap:   1000,
	})

	// Drain the read allowance the way a visitor browsing the site would.
	for i := range 3 {
		if rec := do(t, h, http.MethodGet, "/api/v1/stats", ""); rec.Code != http.StatusOK {
			t.Fatalf("page view %d = %d, want 200", i+1, rec.Code)
		}
	}

	rec := do(t, h, http.MethodPost, "/api/v1/requests", `{"name":"A Real Request"}`)
	if rec.Code != http.StatusAccepted {
		t.Errorf("a submission after 3 page views = %d, want 202 — reading is "+
			"draining the allowance tuned for writing", rec.Code)
	}
}

// Regression: a request the handler rejects must not spend the daily budget.
//
// Reserving in middleware meant 500 malformed bodies could exhaust the day's
// cap while writing nothing — the outage the cap exists to prevent, caused by
// the cap, plus 500 billed Firestore transactions.
func TestRejectedRequestsDoNotSpendTheWriteBudget(t *testing.T) {
	t.Parallel()

	f := seeded()
	h := newServer(t, f, router.Options{ReadLimit: generous(), WriteLimit: generous(), DailyCap: 2})

	for i := range 5 {
		rec := do(t, h, http.MethodPost, "/api/v1/requests", `{"name":"x"}`)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("malformed request %d = %d, want 400", i+1, rec.Code)
		}
	}

	if spent := f.Writes; len(spent) != 0 {
		t.Errorf("rejected requests spent budget: %v", spent)
	}
	if rec := do(t, h, http.MethodPost, "/api/v1/requests", `{"name":"A Real Request"}`); rec.Code != http.StatusAccepted {
		t.Errorf("a valid request after 5 rejections = %d, want 202", rec.Code)
	}
}

// Regression: every array the contract marks required must serialise as [].
//
// Edges was fixed with a bespoke MarshalJSON; citations, viz params, mini-map
// nodes and links, and trail stops all still emitted null.
func TestRequiredArraysNeverSerialiseAsNull(t *testing.T) {
	t.Parallel()

	f := store.NewFake()
	f.Concepts["sparse"] = &store.Concept{ID: "sparse", Title: "Sparse", Tier: store.TierFrontier}
	f.Neighborhoods["sparse"] = &store.Neighborhood{Center: store.MiniMapNode{ID: "sparse"}}
	f.Trails["empty-trail"] = &store.Trail{Slug: "empty-trail", Title: "Empty"}
	h := newServer(t, f, router.Options{})

	cases := []struct {
		path   string
		fields []string
	}{
		{"/api/v1/concepts/sparse", []string{"citations"}},
		{"/api/v1/concepts/sparse/neighborhood", []string{"nodes", "links"}},
		{"/api/v1/trails/empty-trail", []string{"stops"}},
	}

	for _, c := range cases {
		t.Run(c.path, func(t *testing.T) {
			rec := do(t, h, http.MethodGet, c.path, "")
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", rec.Code)
			}
			var body map[string]json.RawMessage
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("not JSON: %v", err)
			}
			for _, f := range c.fields {
				if got := string(body[f]); got != "[]" {
					t.Errorf("%s = %s, want [] — a nil slice marshals as null", f, got)
				}
			}
		})
	}
}

// Regression: a partially-filled Config must not deny everything.
//
// rate.NewLimiter(r, 0) allows nothing, ever, so omitting Burst silently 429'd
// the entire surface with a clean startup and nothing in the logs.
func TestPartialRateLimitConfigStillServes(t *testing.T) {
	t.Parallel()

	h := router.New(seeded(), router.Options{
		// Burst and MaxClients omitted on both.
		ReadLimit:  ratelimit.Config{PerMinute: 60},
		WriteLimit: ratelimit.Config{PerMinute: 60},
		DailyCap:   1000,
	})

	if rec := do(t, h, http.MethodGet, "/api/v1/stats", ""); rec.Code != http.StatusOK {
		t.Errorf("stats = %d, want 200 — an omitted Burst denied every request", rec.Code)
	}
}

// Regression: an id that is not a slug is the client's error, not a 500.
func TestMalformedConceptIDsAreRejectedAsBadRequests(t *testing.T) {
	t.Parallel()

	h := newServer(t, seeded(), router.Options{})

	cases := []struct{ name, body string }{
		{"path separator in a review", `{"concept_id":"a/b","kind":"flag"}`},
		{"uppercase in a review", `{"concept_id":"Not-Kebab","kind":"flag"}`},
		{"over-long id in a review", `{"concept_id":"` + strings.Repeat("a", 200) + `","kind":"flag"}`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := do(t, h, http.MethodPost, "/api/v1/reviews", c.body)
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400 (body: %s)", rec.Code, rec.Body.String())
			}
		})
	}
}

// Regression: the contract counts characters, not bytes.
func TestLengthLimitsCountCharactersNotBytes(t *testing.T) {
	t.Parallel()

	f := seeded()
	h := newServer(t, f, router.Options{ReadLimit: generous(), WriteLimit: generous(), DailyCap: 1000})

	// 40 CJK characters — 120 bytes, well inside the documented 120-character cap.
	name := strings.Repeat("混合専門家", 8)
	rec := do(t, h, http.MethodPost, "/api/v1/requests", `{"name":"`+name+`"}`)
	if rec.Code != http.StatusAccepted {
		t.Errorf("a 40-character name = %d, want 202 — byte counting rejects "+
			"non-Latin text far below the documented limit", rec.Code)
	}
}

// A visitor browsing the graph must never throttle themselves.
//
// This is the failure that survived the first fix: reads and writes were given
// separate buckets but the SAME config. DefaultConfig is 6/min burst 3, tuned
// for "nobody fills the request form six times a minute". Applied to reads that
// is three requests and then one every ten seconds — landing page, open a
// concept, open another, and the fourth navigation 429s while the mini-map
// silently hides.
//
// Deliberately run against the PRODUCTION defaults rather than generous(),
// because the defaults are the thing under test. The previous regression test
// for this used generous() and therefore could not fail.
func TestOrdinaryBrowsingIsNotThrottled(t *testing.T) {
	t.Parallel()

	h := newServer(t, seeded(), router.Options{
		ReadLimit:  ratelimit.DefaultReadConfig(),
		WriteLimit: ratelimit.DefaultConfig(),
		DailyCap:   1000,
	})

	// Landing page, then nine concepts opened in quick succession, each firing a
	// neighborhood call after hydration. Brisk, but nothing unusual.
	paths := []string{"/api/v1/stats"}
	for range 9 {
		paths = append(paths,
			"/api/v1/concepts/mixture-of-experts",
			"/api/v1/concepts/mixture-of-experts/neighborhood")
	}

	for i, p := range paths {
		if rec := do(t, h, http.MethodGet, p, ""); rec.Code == http.StatusTooManyRequests {
			t.Fatalf("request %d of %d (%s) was throttled — a reader is being punished for browsing",
				i+1, len(paths), p)
		}
	}
}

// The write allowance must stay tight even though reads are loose: it is what
// makes a scripted POST loop hit a wall immediately.
func TestWritesStayTightWhileReadsAreLoose(t *testing.T) {
	t.Parallel()

	h := newServer(t, seeded(), router.Options{
		ReadLimit:  ratelimit.DefaultReadConfig(),
		WriteLimit: ratelimit.DefaultConfig(),
		DailyCap:   1000,
	})

	body := `{"name":"Liquid Neural Networks"}`
	throttled := false
	for range 10 {
		if do(t, h, http.MethodPost, "/api/v1/requests", body).Code == http.StatusTooManyRequests {
			throttled = true
			break
		}
	}
	if !throttled {
		t.Error("ten rapid writes were all accepted — the write allowance is not shaping anything")
	}
}

// Reads and writes must not draw on each other. A visitor who has been reading
// still gets to submit the form — at a read volume the old shared config could
// not have survived.
func TestReadsDoNotDrainTheWriteAllowance(t *testing.T) {
	t.Parallel()

	h := newServer(t, seeded(), router.Options{
		ReadLimit:  ratelimit.DefaultReadConfig(),
		WriteLimit: ratelimit.DefaultConfig(),
		DailyCap:   1000,
	})

	for range 15 {
		do(t, h, http.MethodGet, "/api/v1/stats", "")
	}

	rec := do(t, h, http.MethodPost, "/api/v1/requests", `{"name":"Liquid Neural Networks"}`)
	if rec.Code == http.StatusTooManyRequests {
		t.Error("reading drained the write allowance — the buckets are shared again")
	}
}

// Every read carries a Cache-Control, and every non-read does not.
//
// Until this landed nothing set the header at all, so Firebase Hosting cached
// nothing and every mini-map refetch woke Cloud Run — static-first undercut from
// the other side: the pages sit on a CDN and the calls they make did not.
func TestReadsAreCacheableAndEverythingElseIsNot(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		method string
		path   string
		body   string
		want   string
	}{
		{
			name: "concept", method: http.MethodGet, path: "/api/v1/concepts/mixture-of-experts",
			want: "public, max-age=60, s-maxage=300",
		},
		{
			name: "neighborhood", method: http.MethodGet, path: "/api/v1/concepts/mixture-of-experts/neighborhood",
			want: "public, max-age=60, s-maxage=300",
		},
		{
			name: "stats", method: http.MethodGet, path: "/api/v1/stats",
			want: "public, max-age=60, s-maxage=300",
		},
		{
			// A trail is written once and never updated, so it can be held far
			// longer than anything derived from the graph.
			name: "trail", method: http.MethodGet, path: "/api/v1/trails/a-trail-0000",
			want: "public, max-age=600, s-maxage=3600",
		},
		{
			// A concept that does not exist today may exist after the next
			// publish. A cached 404 would outlive its own truth.
			name: "missing concept", method: http.MethodGet, path: "/api/v1/concepts/nope",
			want: "no-store",
		},
		{
			name: "missing trail", method: http.MethodGet, path: "/api/v1/trails/nope",
			want: "no-store",
		},
		{
			name: "unknown endpoint", method: http.MethodGet, path: "/api/v1/nope",
			want: "no-store",
		},
		{
			name: "rejected body", method: http.MethodPost, path: "/api/v1/requests",
			body: `{"name":"x"}`, want: "no-store",
		},
		{
			// An acknowledgement of a side effect. Cached, a repeat submission
			// would look accepted while never reaching the queue.
			name: "accepted request", method: http.MethodPost, path: "/api/v1/requests",
			body: `{"name":"Liquid Neural Networks"}`, want: "no-store",
		},
		{
			name: "created trail", method: http.MethodPost, path: "/api/v1/trails",
			body: `{"stops":[{"id":"mixture-of-experts","depth_read_at":"engineer"}]}`,
			want: "no-store",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			h := newServer(t, seeded(), router.Options{})
			rec := do(t, h, tt.method, tt.path, tt.body)

			if got := rec.Header().Get("Cache-Control"); got != tt.want {
				t.Errorf("Cache-Control = %q, want %q (status %d)", got, tt.want, rec.Code)
			}
		})
	}
}

// A 429 must never be cached. The CDN would go on serving the rejection to
// everyone behind that edge long after the burst that caused it had passed,
// turning a momentary limit into an outage with no way to purge it.
func TestRateLimitedResponsesAreNotCached(t *testing.T) {
	t.Parallel()

	h := newServer(t, seeded(), router.Options{
		ReadLimit:  ratelimit.Config{PerMinute: 1, Burst: 1, MaxClients: 8},
		WriteLimit: generous(),
		DailyCap:   1000,
	})

	do(t, h, http.MethodGet, "/api/v1/stats", "")
	rec := do(t, h, http.MethodGet, "/api/v1/stats", "")

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("second request = %d, want 429", rec.Code)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control on a 429 = %q, want no-store", got)
	}
}

// A 500 must never be cached either — it is by definition the transient case.
func TestInternalErrorsAreNotCached(t *testing.T) {
	t.Parallel()

	f := seeded()
	f.Err = errors.New("firestore is unhappy")
	h := newServer(t, f, router.Options{})

	rec := do(t, h, http.MethodGet, "/api/v1/concepts/mixture-of-experts", "")
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control on a 500 = %q, want no-store", got)
	}
}
