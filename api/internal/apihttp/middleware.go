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
		WriteInternal(w, err, "reserving daily write budget")
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
