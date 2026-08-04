package apihttp

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
)

// Correlating a log line with the Cloud Trace entry for the request that
// emitted it (#2).
//
// Cloud Run samples incoming requests into Cloud Trace with no instrumentation
// and does not bill the auto-generated traces, so the traces already exist. What
// does not exist is the link: in the console you can find a slow request and
// cannot pivot from it to "what did the service log while serving *that* one".
//
// Closing that needs no dependency. Cloud Run sets X-Cloud-Trace-Context on
// every incoming request, and Cloud Logging groups an entry under a trace when
// the entry carries the right fields. This parses the one and writes the other.
//
// Deliberately NOT OpenTelemetry. The review on #1 concluded Cloud Run covers
// logs, request metrics and sampled traces natively; the OTel collector runs as
// a sidecar whose CPU and memory bill on every warm instance, which cuts against
// scale-to-zero, and custom spans move traces off the free auto-generated tier
// into billed ingestion. If OTel ever goes in, CLAUDE.md §8 says it needs an ADR
// first.

// The special fields Cloud Logging reads. Names are Google's, not ours.
const (
	fieldTrace   = "logging.googleapis.com/trace"
	fieldSpanID  = "logging.googleapis.com/spanId"
	fieldSampled = "logging.googleapis.com/trace_sampled"
)

type traceCtxKey struct{}

type holderKey struct{}

// holder is how a logger reaches middleware mounted OUTSIDE the one that built
// it.
//
// Recoverer is global — a panic anywhere must become a 500 — while Trace is
// mounted on /api/v1 so health probes stay untagged. That puts Recoverer on the
// outside, and `Trace` publishes its logger by calling next with
// `r.WithContext(...)`, which is a NEW *http.Request. The outer Recoverer still
// holds the old one, so reading the context there finds nothing, and the panic
// line — the log most worth correlating — loses its trace.
//
// A pointer seeded on the way in and filled on the way past is the fix that
// keeps the mount-based exemption. One holder per request, written once before
// the handler runs and read once after it returns, so the ordering is the call
// stack and needs no synchronisation.
//
// Found by a test asserting the panic line carries the field. Without it this
// looked correct in review and did nothing at runtime.
type holder struct{ logger *slog.Logger }

// WithLoggerHolder seeds the slot. Called by Recoverer, which is the outermost
// middleware and therefore the only one that can.
func WithLoggerHolder(r *http.Request) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), holderKey{}, &holder{}))
}

// HeldLogger reads whatever Trace deposited, or the default.
func HeldLogger(ctx context.Context) *slog.Logger {
	if h, ok := ctx.Value(holderKey{}).(*holder); ok && h.logger != nil {
		return h.logger
	}
	return slog.Default()
}

// TraceContext is what one X-Cloud-Trace-Context header carries.
type TraceContext struct {
	TraceID string
	SpanID  string
	Sampled bool
}

// ParseTraceContext reads `TRACE_ID/SPAN_ID;o=TRACE_TRUE`, or reports that it
// could not.
//
// Pure, and separate from the middleware, because the header is the part with
// edge cases and a table test should not need a server to reach them.
//
// WHAT COUNTS AS UNUSABLE, and why each one:
//
//   - No `/`. Cloud Run always sends the span, so a value without one did not
//     come from Cloud Run and guessing at it would invent a correlation.
//   - Empty trace id. `projects/PROJECT/traces/` is a field that looks
//     populated and resolves to nothing — worse than an absent field, because
//     it costs someone a click to discover it is empty.
//   - A trace id that is not hex. Length is deliberately not checked: today it
//     is 32 characters, and rejecting on length would silently stop correlating
//     the day that changes, which is exactly the failure nobody would notice.
//
// GARBAGE AFTER `;o=` DOES NOT DISCARD THE TRACE. The flag defaults to false
// and the trace and span survive. The rule the issue sets is that malformed
// input must not be propagated or fatal, and defaulting satisfies both — while
// throwing away a usable trace id over one optional flag would discard the
// correlation this whole file exists to create.
func ParseTraceContext(header string) (TraceContext, bool) {
	if header == "" {
		return TraceContext{}, false
	}

	// The options segment is optional and always last.
	rest, opts, hasOpts := strings.Cut(header, ";")

	traceID, spanID, hasSpan := strings.Cut(rest, "/")
	if !hasSpan || traceID == "" || spanID == "" || !isHex(traceID) {
		return TraceContext{}, false
	}

	tc := TraceContext{TraceID: traceID, SpanID: spanID}
	if hasOpts {
		// Only `o=1` is true. `o=0`, `o=`, `o=banana` and a missing `o=` are all
		// false, which is the safe direction: claiming a request was sampled
		// when it was not sends someone looking for a trace that is not there.
		if v, ok := strings.CutPrefix(opts, "o="); ok {
			tc.Sampled = v == "1"
		}
	}
	return tc, true
}

func isHex(s string) bool {
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9', r >= 'a' && r <= 'f', r >= 'A' && r <= 'F':
		default:
			return false
		}
	}
	return true
}

// Trace puts a request-scoped logger on the context, carrying the fields that
// make Cloud Logging file the line under the request's trace.
//
// projectID is taken once, at construction, rather than read per request: it
// cannot change while the process runs, and the metadata server is a network
// call nobody should make on the request path.
//
// A REQUEST WITHOUT THE HEADER STILL GETS A LOGGER — the default one, unadorned.
// Handlers then never branch on whether tracing is available, and the no-header
// case degrades to exactly the logging that existed before this middleware.
func Trace(projectID string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tc, ok := ParseTraceContext(r.Header.Get("X-Cloud-Trace-Context"))
			if !ok || projectID == "" {
				// No qualified trace is possible, so add nothing. An empty
				// project id would produce `projects//traces/ID`, which is the
				// "looks populated, resolves to nothing" field again.
				next.ServeHTTP(w, r)
				return
			}

			logger := slog.Default().With(
				slog.String(fieldTrace, "projects/"+projectID+"/traces/"+tc.TraceID),
				slog.String(fieldSpanID, tc.SpanID),
				slog.Bool(fieldSampled, tc.Sampled),
			)
			// Outward, for Recoverer and anything else mounted above this.
			if h, ok := r.Context().Value(holderKey{}).(*holder); ok {
				h.logger = logger
			}
			// Inward, for the handlers.
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), traceCtxKey{}, logger)))
		})
	}
}

// Logger returns the request's logger, or the default one.
//
// Never nil, so a caller writes `apihttp.Logger(ctx).Error(...)` without a
// guard, and a handler reached in a test with no middleware still logs.
func Logger(ctx context.Context) *slog.Logger {
	if l, ok := ctx.Value(traceCtxKey{}).(*slog.Logger); ok {
		return l
	}
	return slog.Default()
}
