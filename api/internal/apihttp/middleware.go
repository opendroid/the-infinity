package apihttp

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/opendroid/the-infinity/api/internal/ratelimit"
	"github.com/opendroid/the-infinity/api/internal/store"
)

// MaxBodyBytes caps a request body. A concept request or a review note has no
// business being large, and rejecting before parsing means a hostile body never
// reaches the decoder.
const MaxBodyBytes int64 = 16 << 10 // 16 KiB

// DefaultDailyWriteCap bounds accepted writes per UTC day across all instances.
// This is the layer that actually bounds the bill — the per-IP limiter resets on
// cold start and does not coordinate across instances.
const DefaultDailyWriteCap int64 = 500

// started wraps a ResponseWriter to record whether anything has reached the
// client yet. Recoverer is the only user: once a status line is out, a 500 is
// no longer available, and writing one anyway appends a second JSON object to a
// body that already has one.
//
// Unwrap is what http.ResponseController uses to reach the real writer, so
// wrapping here does not cost a handler its flush or deadline controls.
type started struct {
	http.ResponseWriter
	wrote bool
}

func (s *started) WriteHeader(code int) {
	s.wrote = true
	s.ResponseWriter.WriteHeader(code)
}

func (s *started) Write(b []byte) (int, error) {
	s.wrote = true
	return s.ResponseWriter.Write(b)
}

func (s *started) Unwrap() http.ResponseWriter { return s.ResponseWriter }

// Recoverer turns a panic into a 500 rather than a dropped connection.
//
// CLAUDE.md forbids panicking in a handler; this exists for the ones we did not
// write — a nil map deep in a dependency should not take the instance down.
func Recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sw := &started{ResponseWriter: w}
		w = sw
		// Seeded here because Recoverer is the outermost middleware. Trace fills
		// it in further down the chain; see the note on `holder` in trace.go for
		// why the context alone cannot carry it upward.
		r = WithLoggerHolder(r)

		// The context is a PARAMETER of the deferred closure, not something it
		// reaches for. contextcheck asks for that and it reads better anyway:
		// the holder is a pointer, so capturing the context at registration
		// time still sees whatever Trace deposits later.
		defer func(ctx context.Context) {
			rec := recover()
			if rec == nil {
				return
			}

			// http.ErrAbortHandler is not a crash. It is Go's documented way for
			// a handler to abandon a response on purpose, and net/http expects to
			// receive it: swallowing it logs a crash that did not happen and then
			// writes a second status onto a response already in flight.
			if err, ok := rec.(error); ok && errors.Is(err, http.ErrAbortHandler) {
				panic(rec)
			}

			// The request's logger, not the package one: a panic is the line
			// someone is most likely to be hunting from a trace, and it was the
			// only per-request log the service emitted before #2.
			HeldLogger(ctx).Error("panic in handler",
				slog.Any("recovered", rec),
				slog.String("path", r.URL.Path),
				slog.Bool("response_started", sw.wrote))

			// A response already on the wire cannot be turned into a 500. The
			// status is spent, and WriteError would append a second JSON object
			// to a body that already has one — handing the client `{...}{...}`,
			// which parses as neither. net/http logs the duplicate WriteHeader
			// and drops it, so the corruption is in the body alone and looks
			// like a serialisation bug rather than a panic. Truncated is worse
			// for the reader than complete and better than wrong: the transport
			// reports a short read, which is the truth.
			if sw.wrote {
				return
			}
			WriteError(w, http.StatusInternalServerError, CodeInternal, "Unexpected error.")
		}(r.Context())
		next.ServeHTTP(w, r)
	})
}

// LogForwarded records the forwarding chain ONCE PER PROCESS, the first time a
// request arrives carrying one.
//
// `ratelimit.DefaultTrustedProxyHops` is a measurement — one trailing entry
// belongs to Google's edge — and measurements go stale. #29 asked whether the
// chain through a custom domain differs from the `web.app` one, and the answer
// was not visible anywhere: Cloud Run's request log carries no headers, and
// nothing here logged what `ClientIP` resolved. The constant could have been
// wrong for a week without a single symptom, because both failure modes are
// silent — too few hops keys every visitor onto the proxy and throttles the
// world as one, too many keys onto an entry the caller controls and shapes
// nobody.
//
// Once per process, not per request. Cloud Run already logs every request, a
// second copy would be waste, and this is a visitor's address — the smallest
// number of times that answers the question is the right number. Instances
// recycle often enough that a change in the path shows up within a deploy.
//
// It waits for a request that HAS the header, so the line is never a health
// probe that arrived with nothing to say.
func LogForwarded(hops int) func(http.Handler) http.Handler {
	var once sync.Once
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
				once.Do(func() {
					slog.Info("forwarding chain",
						slog.String("x_forwarded_for", xff),
						slog.Int("entries", len(strings.Split(xff, ","))),
						slog.Int("trusted_hops", hops),
						slog.String("client_ip", ratelimit.ClientIP(r, hops)),
						// Which door the request came in by: Hosting proxies to
						// the run.app host, so this says whether the chain being
						// described is the rewritten path or a direct hit.
						slog.String("host", r.Host))
				})
			}
			next.ServeHTTP(w, r)
		})
	}
}

// LimitBody caps the body and converts an overrun into a structured 413.
//
// http.MaxBytesReader alone surfaces as a read error inside the handler, which
// is easy to mistake for malformed JSON; this makes the distinction explicit.
func LimitBody(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, MaxBodyBytes)
		next.ServeHTTP(w, r)
	})
}

// PerIPLimiter shapes any route by client address. Reads and writes get their
// OWN instance: sharing one bucket meant a visitor's landing-page views drained
// the allowance tuned for form submissions, so three page views 429'd their own
// contribution. Separating only the daily counter — as an earlier fix did — left
// exactly that failure in place.
type PerIPLimiter struct {
	perIP *ratelimit.PerIP
	// hops is carried per limiter rather than read from a package-level global,
	// so a test can construct one that keys on a different position without
	// mutating state every other test shares.
	hops int
}

func NewPerIPLimiter(cfg ratelimit.Config) *PerIPLimiter {
	return &PerIPLimiter{perIP: ratelimit.NewPerIP(cfg), hops: cfg.TrustedProxyHops}
}

func (l *PerIPLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !l.perIP.Allow(ratelimit.ClientIP(r, l.hops)) {
			WriteRateLimited(w, l.perIP.RetryAfter())
			return
		}
		next.ServeHTTP(w, r)
	})
}

// WriteLimiter is the global daily budget — the layer that actually bounds the
// bill, since the per-IP layer resets on cold start and does not coordinate
// across instances.
//
// It is NOT middleware. Reserving in middleware spent budget on requests the
// handler then rejected, so 500 malformed bodies could exhaust the day's cap
// while writing nothing — the outage the cap exists to prevent, produced by the
// cap. Handlers call Reserve after validation, immediately before their write.
type WriteLimiter struct {
	store    store.Store
	dailyCap int64
	now      func() time.Time
}

// NewWriteLimiter wires the two layers. now is injectable so tests can cross a
// day boundary without sleeping.
func NewWriteLimiter(s store.Store, dailyCap int64, now func() time.Time) *WriteLimiter {
	if now == nil {
		now = time.Now
	}
	if dailyCap <= 0 {
		dailyCap = DefaultDailyWriteCap
	}
	return &WriteLimiter{store: s, dailyCap: dailyCap, now: now}
}

// Reserve counts one write against the day's budget, answering false when the
// cap is spent. Call it AFTER validation and immediately before the store
// write, so a rejected request costs nothing.
//
// Returns handled=true when it has already written a response.
func (l *WriteLimiter) Reserve(w http.ResponseWriter, r *http.Request) (handled bool) {
	allowed, err := l.store.ReserveWrite(r.Context(), ratelimit.Day(l.now()), l.dailyCap)
	if err != nil {
		WriteInternal(r.Context(), w, err, "reserving daily write budget")
		return true
	}
	if !allowed {
		// Until the UTC day rolls over. Nothing shorter would help.
		WriteRateLimited(w, secondsUntilNextUTCDay(l.now()))
		return true
	}
	return false
}

func secondsUntilNextUTCDay(t time.Time) int {
	u := t.UTC()
	next := time.Date(u.Year(), u.Month(), u.Day(), 0, 0, 0, 0, time.UTC).Add(24 * time.Hour)
	if s := int(next.Sub(u).Seconds()); s > 0 {
		return s
	}
	return 1
}

// requestTimeout bounds how long any handler may spend, so a slow store cannot
// hold a Cloud Run instance open indefinitely.
const requestTimeout = 10 * time.Second

// Timeout attaches a deadline to the request context, which every store call
// inherits.
func Timeout(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), requestTimeout)
		defer cancel()
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
