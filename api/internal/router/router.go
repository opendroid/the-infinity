// Package router assembles the HTTP surface.
//
// Separate from apihttp to keep the dependency arrow pointing one way: handlers
// import apihttp for the error helpers, and this package imports both. Putting
// the router in apihttp would make it import the handlers that import it.
package router

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/opendroid/the-infinity/api/internal/apihttp"
	"github.com/opendroid/the-infinity/api/internal/concepts"
	"github.com/opendroid/the-infinity/api/internal/queues"
	"github.com/opendroid/the-infinity/api/internal/ratelimit"
	"github.com/opendroid/the-infinity/api/internal/store"
	"github.com/opendroid/the-infinity/api/internal/trails"
)

// Options configures the router. The zero value is production-shaped; tests
// override Now and the limits.
type Options struct {
	RateLimit ratelimit.Config
	DailyCap  int64
	Now       func() time.Time
}

// New builds the whole surface.
//
// Routes mount at /api/v1, NOT /v1. Firebase Hosting rewrites /api/** to Cloud
// Run and preserves the full path, so the prefix arrives with the request.
// Serving /v1 would work against the Cloud Run URL and 404 through the domain —
// a failure that appears only after the first Hosting deploy. See ADR-0001.
//
// /healthz stays at the root, outside the mount. Only /api/** is rewritten, so
// it is reachable on the Cloud Run URL but not through the public domain, which
// is the right exposure for an operational endpoint.
func New(s store.Store, opts Options) http.Handler {
	if opts.RateLimit.PerMinute == 0 {
		opts.RateLimit = ratelimit.DefaultConfig()
	}

	c := concepts.New(s)
	t := trails.New(s)
	q := queues.New(s)
	writes := apihttp.NewWriteLimiter(s, opts.RateLimit, opts.DailyCap, opts.Now)

	r := chi.NewRouter()
	r.Use(apihttp.Recoverer, apihttp.Timeout)

	r.Get("/healthz", healthz)

	r.Route("/api/v1", func(v1 chi.Router) {
		v1.Get("/concepts/{id}", c.Get)
		v1.Get("/concepts/{id}/neighborhood", c.Neighborhood)

		// Stats is called on every landing-page view, which makes it the
		// highest-volume path here and one Cloud Run invocation per visitor —
		// so it is shaped per-IP. It deliberately does NOT go through the write
		// limiter: spending the daily write budget on page views would let
		// ordinary traffic disable the contribution endpoints.
		v1.With(writes.ReadMiddleware).Get("/stats", c.Stats)

		v1.Get("/trails/{slug}", t.Get)

		// Every unauthenticated write goes through both the body cap and the
		// two-layer limiter. See package ratelimit.
		v1.Group(func(w chi.Router) {
			w.Use(apihttp.LimitBody, writes.Middleware)
			w.Post("/trails", t.Create)
			w.Post("/requests", q.CreateRequest)
			w.Post("/reviews", q.CreateReview)
		})
	})

	r.NotFound(func(w http.ResponseWriter, _ *http.Request) {
		apihttp.WriteError(w, http.StatusNotFound, apihttp.CodeNotFound, "No such endpoint.")
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, _ *http.Request) {
		apihttp.WriteError(w, http.StatusMethodNotAllowed, apihttp.CodeInvalidRequest,
			"That method is not allowed on this endpoint.")
	})

	return r
}

// healthz answers "is the process up", not "is the whole system well" — it
// deliberately does not touch Firestore, so a database outage does not pull
// instances out of rotation.
func healthz(w http.ResponseWriter, _ *http.Request) {
	apihttp.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
