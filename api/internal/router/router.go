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
//
// Reads and writes are named separately rather than sharing one RateLimit field.
// One field made it possible — and then actual — to shape reads with the
// allowance tuned for form submissions, which is not a mistake a reviewer can
// see: the call sites looked identical because they were.
type Options struct {
	ReadLimit  ratelimit.Config
	WriteLimit ratelimit.Config
	DailyCap   int64
	Now        func() time.Time
	// ProjectID qualifies the Cloud Logging trace field (#2). Empty disables
	// correlation rather than emitting `projects//traces/ID`, so tests and local
	// runs need not set it.
	ProjectID string
}

// New builds the whole surface.
//
// Routes mount at /api/v1, NOT /v1. Firebase Hosting rewrites /api/** to Cloud
// Run and preserves the full path, so the prefix arrives with the request.
// Serving /v1 would work against the Cloud Run URL and 404 through the domain —
// a failure that appears only after the first Hosting deploy. See ADR-0001.
//
// The health endpoint stays at the root, outside the mount. Only /api/** is
// rewritten, so it is reachable on the Cloud Run URL but not through the public
// domain, which is the right exposure for an operational endpoint.
//
// It is `/-/health` and not `/healthz` because Google Frontend answered
// /healthz itself and never forwarded it: the request returned Google's branded
// 404 and appeared nowhere in the Cloud Run request log, while /nope — an
// unmatched path on this same router, seconds later — returned our structured
// not_found (#75). The `/-/` prefix is the Prometheus convention for exactly
// this: a namespace chosen to collide with nothing. /livez was the other
// candidate and was rejected as too close to /healthz — if the interception
// matches well-known health paths, it would be caught by the same rule.
func New(s store.Store, opts Options) http.Handler {
	if opts.ReadLimit.PerMinute == 0 {
		opts.ReadLimit = ratelimit.DefaultReadConfig()
	}
	if opts.WriteLimit.PerMinute == 0 {
		opts.WriteLimit = ratelimit.DefaultConfig()
	}

	budget := apihttp.NewWriteLimiter(s, opts.DailyCap, opts.Now)
	c := concepts.New(s)
	t := trails.New(s, budget)
	q := queues.New(s, budget)

	// Separate buckets AND separate rates. Separating the buckets alone — as an
	// earlier fix did — left every read shaped by the write allowance, so a
	// visitor's own page views still throttled them: three requests, then one
	// every ten seconds.
	reads := apihttp.NewPerIPLimiter(opts.ReadLimit)
	writeShaping := apihttp.NewPerIPLimiter(opts.WriteLimit)

	r := chi.NewRouter()
	r.Use(apihttp.Recoverer, apihttp.Timeout)

	// GET and HEAD. chi answers 405 for a method it has no route for, and `curl
	// -I` — the first thing anyone types at a health endpoint, and what most
	// probes send — is a HEAD. Answering the obvious question with "not allowed"
	// on the one endpoint whose whole job is to be asked is a poor showing.
	// net/http discards the body for a HEAD, so one handler serves both.
	r.Get("/-/health", health)
	r.Head("/-/health", health)

	r.Route("/api/v1", func(v1 chi.Router) {
		// Trace correlation is mounted HERE and not globally, which is the
		// /-/health exemption the issue asks for. Cloud Run probes that endpoint
		// continuously; giving each probe a trace-tagged logger would generate
		// log volume and trace noise proportional to uptime rather than to use.
		// Trace first, then LogForwarded, and the order is load-bearing:
		// LogForwarded now logs through the request's logger, which Trace is
		// what puts there.
		//
		// LogForwarded moved here from the global chain. It fires once per
		// process, and while it was mounted ahead of Trace that one line could
		// never carry a trace field — leaving a healthy revision with nothing
		// correlated in Cloud Logging at all, since every other line this
		// service writes needs a panic or a 500 first. It takes the read
		// limiter's hop count because both limiters share it; a divergence
		// there would be a different bug, and NewPerIPLimiter normalises from
		// the same default.
		v1.Use(apihttp.Trace(opts.ProjectID), apihttp.LogForwarded(opts.ReadLimit.TrustedProxyHops))

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

// health answers "is the process up", not "is the whole system well" — it
// deliberately does not touch Firestore, so a database outage does not pull
// instances out of rotation.
func health(w http.ResponseWriter, _ *http.Request) {
	apihttp.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
