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

	budget := apihttp.NewWriteLimiter(s, opts.DailyCap, opts.Now)
	c := concepts.New(s)
	t := trails.New(s, budget)
	q := queues.New(s, budget)

	// Reads and writes get separate buckets. Sharing one meant a visitor's own
	// page views drained the allowance tuned for form submissions.
	reads := apihttp.NewPerIPLimiter(opts.RateLimit)
	writeShaping := apihttp.NewPerIPLimiter(opts.RateLimit)

	r := chi.NewRouter()
	// XFFProbe is TEMPORARY and comes out with #29. It is first so it observes
	// the chain as it arrived, before anything downstream can touch it.
	r.Use(apihttp.XFFProbe, apihttp.Recoverer, apihttp.Timeout)

	r.Get("/healthz", healthz)

	r.Route("/api/v1", func(v1 chi.Router) {
		// Every read is an unauthenticated Firestore read and a Cloud Run
		// invocation, so shaping applies to the group rather than to whichever
		// route someone remembered. /neighborhood in particular fires on every
		// concept-page hydration and is a deeper read than /stats.
		v1.Group(func(rd chi.Router) {
			rd.Use(reads.Middleware)
			rd.Get("/concepts/{id}", c.Get)
			rd.Get("/concepts/{id}/neighborhood", c.Neighborhood)
			rd.Get("/stats", c.Stats)
			rd.Get("/trails/{slug}", t.Get)
		})

		// Writes get the body cap plus their own per-IP bucket. The daily budget
		// is charged by the handlers after validation, so a rejected request
		// costs nothing.
		v1.Group(func(wr chi.Router) {
			wr.Use(apihttp.LimitBody, writeShaping.Middleware)
			wr.Post("/trails", t.Create)
			wr.Post("/requests", q.CreateRequest)
			wr.Post("/reviews", q.CreateReview)
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
