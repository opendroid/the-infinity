package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthz(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		method     string
		target     string
		wantStatus int
		wantBody   string
	}{
		{
			name:       "get returns ok",
			method:     http.MethodGet,
			target:     "/healthz",
			wantStatus: http.StatusOK,
			wantBody:   `{"status":"ok"}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			rec := httptest.NewRecorder()
			healthz(rec, httptest.NewRequest(tt.method, tt.target, nil))

			res := rec.Result()
			defer res.Body.Close()

			if got := res.StatusCode; got != tt.wantStatus {
				t.Errorf("status = %d, want %d", got, tt.wantStatus)
			}

			if got := rec.Body.String(); got != tt.wantBody {
				t.Errorf("body = %q, want %q", got, tt.wantBody)
			}

			if got, want := res.Header.Get("Content-Type"), "application/json"; got != want {
				t.Errorf("Content-Type = %q, want %q", got, want)
			}
		})
	}
}
