package apihttp_test

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/opendroid/the-infinity/api/internal/apihttp"
)

func TestParseTraceContext(t *testing.T) {
	t.Parallel()

	const id = "105445aa7843bc8bf206b12000100000"

	cases := []struct {
		name    string
		header  string
		want    apihttp.TraceContext
		wantOK  bool
		because string
	}{
		{
			name:   "well-formed and sampled",
			header: id + "/1;o=1",
			want:   apihttp.TraceContext{TraceID: id, SpanID: "1", Sampled: true},
			wantOK: true,
		},
		{
			name:    "well-formed and not sampled",
			header:  id + "/1;o=0",
			want:    apihttp.TraceContext{TraceID: id, SpanID: "1", Sampled: false},
			wantOK:  true,
			because: "o=0 is the common case — Cloud Run samples at most 0.1 req/s per instance",
		},
		{
			name:    "no options segment",
			header:  id + "/9876543210",
			want:    apihttp.TraceContext{TraceID: id, SpanID: "9876543210", Sampled: false},
			wantOK:  true,
			because: "the flag is optional; its absence is not a malformed header",
		},
		{
			name:    "uppercase trace id",
			header:  strings.ToUpper(id) + "/1;o=1",
			want:    apihttp.TraceContext{TraceID: strings.ToUpper(id), SpanID: "1", Sampled: true},
			wantOK:  true,
			because: "hex is case-insensitive and the id is passed through verbatim",
		},
		{
			name:    "garbage after o=",
			header:  id + "/1;o=banana",
			want:    apihttp.TraceContext{TraceID: id, SpanID: "1", Sampled: false},
			wantOK:  true,
			because: "the flag defaults to false and the usable trace survives — discarding it would throw away the correlation over one optional field",
		},
		{
			name:    "empty options after the semicolon",
			header:  id + "/1;",
			want:    apihttp.TraceContext{TraceID: id, SpanID: "1", Sampled: false},
			wantOK:  true,
			because: "same reasoning: not sampled, still correlatable",
		},

		{name: "missing", header: "", wantOK: false},
		{
			name:    "no slash",
			header:  id,
			wantOK:  false,
			because: "Cloud Run always sends a span; a value without one did not come from Cloud Run",
		},
		{
			name:    "empty trace id",
			header:  "/1;o=1",
			wantOK:  false,
			because: "projects/P/traces/ is a field that looks populated and resolves to nothing",
		},
		{name: "empty span id", header: id + "/;o=1", wantOK: false},
		{
			name:    "trace id is not hex",
			header:  "not-a-trace-id/1;o=1",
			wantOK:  false,
			because: "a junk id produces a link to a trace that cannot exist",
		},
		{name: "only a slash", header: "/", wantOK: false},
		{name: "only a semicolon", header: ";o=1", wantOK: false},
		{name: "options but nothing else", header: ";", wantOK: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, ok := apihttp.ParseTraceContext(tc.header)
			if ok != tc.wantOK {
				t.Fatalf("ParseTraceContext(%q) ok = %v, want %v (%s)", tc.header, ok, tc.wantOK, tc.because)
			}
			if ok && got != tc.want {
				t.Errorf("ParseTraceContext(%q) = %+v, want %+v (%s)", tc.header, got, tc.want, tc.because)
			}
		})
	}
}

// capture swaps the process-wide default logger for a JSON one writing to a
// buffer, and puts it back afterwards.
//
// NOT PARALLEL, and neither is anything calling it: slog.SetDefault is global
// state, and running these alongside each other is a data race the detector
// catches. The same trap `quiet` documents in errors_test.go.
func capture(t *testing.T) *bytes.Buffer {
	t.Helper()
	buf := &bytes.Buffer{}
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return buf
}

// logging is a handler that emits one line through the request's logger, which
// is how every caller is expected to reach it.
func logging(msg string) http.Handler {
	return http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		apihttp.Logger(r.Context()).Info(msg)
	})
}

func fields(t *testing.T, buf *bytes.Buffer) map[string]any {
	t.Helper()
	line := strings.TrimSpace(buf.String())
	if line == "" {
		t.Fatal("nothing was logged — a request must never lose its line to this middleware")
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(line), &m); err != nil {
		t.Fatalf("log line is not JSON: %v\n%s", err, line)
	}
	return m
}

func TestTraceMiddlewareAddsTheCloudLoggingFields(t *testing.T) {
	buf := capture(t)
	const id = "105445aa7843bc8bf206b12000100000"

	req := httptest.NewRequest(http.MethodGet, "/api/v1/stats", nil)
	req.Header.Set("X-Cloud-Trace-Context", id+"/7;o=1")
	apihttp.Trace("the-infinity-ai")(logging("served")).ServeHTTP(httptest.NewRecorder(), req)

	got := fields(t, buf)
	// Fully qualified by project id — a bare trace id does not resolve.
	if want := "projects/the-infinity-ai/traces/" + id; got["logging.googleapis.com/trace"] != want {
		t.Errorf("trace = %v, want %v", got["logging.googleapis.com/trace"], want)
	}
	if got["logging.googleapis.com/spanId"] != "7" {
		t.Errorf("spanId = %v, want 7", got["logging.googleapis.com/spanId"])
	}
	if got["logging.googleapis.com/trace_sampled"] != true {
		t.Errorf("trace_sampled = %v, want true", got["logging.googleapis.com/trace_sampled"])
	}
}

func TestTraceMiddlewareSampledFalse(t *testing.T) {
	buf := capture(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/stats", nil)
	req.Header.Set("X-Cloud-Trace-Context", "105445aa7843bc8bf206b12000100000/7;o=0")
	apihttp.Trace("p")(logging("served")).ServeHTTP(httptest.NewRecorder(), req)

	if got := fields(t, buf)["logging.googleapis.com/trace_sampled"]; got != false {
		t.Errorf("trace_sampled = %v, want false", got)
	}
}

func TestTraceMiddlewareWithoutTheHeader(t *testing.T) {
	buf := capture(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/stats", nil)
	rec := httptest.NewRecorder()
	apihttp.Trace("the-infinity-ai")(logging("served")).ServeHTTP(rec, req)

	got := fields(t, buf)
	// The line still exists — that is the point of the criterion. What must not
	// exist is a half-built field.
	if got["msg"] != "served" {
		t.Errorf("msg = %v, want served", got["msg"])
	}
	for _, f := range []string{
		"logging.googleapis.com/trace",
		"logging.googleapis.com/spanId",
		"logging.googleapis.com/trace_sampled",
	} {
		if _, present := got[f]; present {
			t.Errorf("%s is present with no header; an unqualified field is worse than none", f)
		}
	}
}

func TestTraceMiddlewareWithoutAProjectID(t *testing.T) {
	buf := capture(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/stats", nil)
	req.Header.Set("X-Cloud-Trace-Context", "105445aa7843bc8bf206b12000100000/7;o=1")
	apihttp.Trace("")(logging("served")).ServeHTTP(httptest.NewRecorder(), req)

	got := fields(t, buf)
	// `projects//traces/ID` is the specific string the issue forbids.
	if v, present := got["logging.googleapis.com/trace"]; present {
		t.Errorf("trace = %v with no project id; want the field omitted entirely", v)
	}
	if s, _ := got["logging.googleapis.com/trace"].(string); strings.Contains(s, "projects//") {
		t.Errorf("emitted the empty-project form: %q", s)
	}
}

func TestTraceMiddlewareMalformedHeaderIsIgnoredNotFatal(t *testing.T) {
	for _, header := range []string{"garbage", "/1;o=1", "not-hex/1", "", ";"} {
		t.Run(header, func(t *testing.T) {
			buf := capture(t)
			req := httptest.NewRequest(http.MethodGet, "/api/v1/stats", nil)
			req.Header.Set("X-Cloud-Trace-Context", header)
			rec := httptest.NewRecorder()

			// No panic, no dropped line, no trace field.
			apihttp.Trace("p")(logging("served")).ServeHTTP(rec, req)

			got := fields(t, buf)
			if got["msg"] != "served" {
				t.Errorf("msg = %v, want served", got["msg"])
			}
			if _, present := got["logging.googleapis.com/trace"]; present {
				t.Errorf("malformed header %q produced a trace field", header)
			}
		})
	}
}

func TestLoggerFallsBackToTheDefault(t *testing.T) {
	buf := capture(t)
	// A handler reached with no middleware — every handler test in this repo.
	apihttp.Logger(context.Background()).Info("served")
	if got := fields(t, buf)["msg"]; got != "served" {
		t.Errorf("msg = %v, want served — Logger must never return nil", got)
	}
}
