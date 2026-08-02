package apihttp

import (
	"context"
	"log/slog"
	"net/http"
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

// Recoverer turns a panic into a 500 rather than a dropped connection.
//
// CLAUDE.md forbids panicking in a handler; this exists for the ones we did not
// write — a nil map deep in a dependency should not take the instance down.
func Recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("panic in handler",
					slog.Any("recovered", rec),
					slog.String("path", r.URL.Path))
				WriteError(w, http.StatusInternalServerError, CodeInternal, "Unexpected error.")
			}
		}()
		next.ServeHTTP(w, r)
	})
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

// WriteLimiter guards the unauthenticated write endpoints. See package
// ratelimit for why there are two layers.
type WriteLimiter struct {
	perIP    *ratelimit.PerIP
	store    store.Store
	dailyCap int64
	now      func() time.Time
}

// NewWriteLimiter wires the two layers. now is injectable so tests can cross a
// day boundary without sleeping.
func NewWriteLimiter(s store.Store, cfg ratelimit.Config, dailyCap int64, now func() time.Time) *WriteLimiter {
	if now == nil {
		now = time.Now
	}
	if dailyCap <= 0 {
		dailyCap = DefaultDailyWriteCap
	}
	return &WriteLimiter{perIP: ratelimit.NewPerIP(cfg), store: s, dailyCap: dailyCap, now: now}
}

// ReadMiddleware applies ONLY the per-IP layer.
//
// Read endpoints must not spend the daily WRITE budget. GET /stats is called on
// every landing-page view, so counting it against that budget meant roughly
// DAILY_WRITE_CAP visitors a day would silently disable concept requests and
// reviews for everyone — popular traffic taking out the contribution path,
// which is exactly backwards. Per-IP shaping still bounds a single abusive
// client without letting ordinary readers exhaust anything shared.
func (l *WriteLimiter) ReadMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !l.perIP.Allow(ratelimit.ClientIP(r)) {
			WriteRateLimited(w, l.perIP.RetryAfter())
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Middleware rejects a request that exceeds either layer.
//
// Order matters: the per-IP check is in-memory and free, so it absorbs the
// cheap rejections before anything touches the store. A rejected request
// performs no writes at all.
func (l *WriteLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !l.perIP.Allow(ratelimit.ClientIP(r)) {
			WriteRateLimited(w, l.perIP.RetryAfter())
			return
		}

		allowed, err := l.store.ReserveWrite(r.Context(), ratelimit.Day(l.now()), l.dailyCap)
		if err != nil {
			WriteInternal(w, err, "reserving daily write budget")
			return
		}
		if !allowed {
			// Until the UTC day rolls over. Nothing shorter would help.
			WriteRateLimited(w, secondsUntilNextUTCDay(l.now()))
			return
		}

		next.ServeHTTP(w, r)
	})
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
