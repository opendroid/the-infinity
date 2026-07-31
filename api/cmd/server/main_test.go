package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRoutes(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		method      string
		target      string
		wantStatus  int
		wantBody    string
		wantContent string
	}{
		{
			name:        "healthz reports ok",
			method:      http.MethodGet,
			target:      "/healthz",
			wantStatus:  http.StatusOK,
			wantBody:    `{"status":"ok"}`,
			wantContent: "application/json",
		},
		{
			name:       "healthz rejects non-GET",
			method:     http.MethodPost,
			target:     "/healthz",
			wantStatus: http.StatusMethodNotAllowed,
		},
		{
			name:       "unknown path is not found",
			method:     http.MethodGet,
			target:     "/v1/concepts/attention",
			wantStatus: http.StatusNotFound,
		},
	}

	mux := newMux()

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, httptest.NewRequest(tt.method, tt.target, nil))

			res := rec.Result()
			defer res.Body.Close()

			if got := res.StatusCode; got != tt.wantStatus {
				t.Errorf("status = %d, want %d", got, tt.wantStatus)
			}

			if tt.wantBody != "" {
				if got := rec.Body.String(); got != tt.wantBody {
					t.Errorf("body = %q, want %q", got, tt.wantBody)
				}
			}

			if tt.wantContent != "" {
				if got := res.Header.Get("Content-Type"); got != tt.wantContent {
					t.Errorf("Content-Type = %q, want %q", got, tt.wantContent)
				}
			}
		})
	}
}
