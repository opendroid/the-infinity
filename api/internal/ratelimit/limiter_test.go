package ratelimit_test

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/opendroid/the-infinity/api/internal/ratelimit"
)

func TestClientIP(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		xff        string
		remoteAddr string
		want       string
	}{
		{
			name:       "no forwarding header falls back to the socket",
			remoteAddr: "192.0.2.10:54321",
			want:       "192.0.2.10",
		},
		{
			name:       "a single forwarded address is used",
			xff:        "203.0.113.7",
			remoteAddr: "10.0.0.1:443",
			want:       "203.0.113.7",
		},
		{
			// Cloud Run APPENDS the real caller, so the last entry is the one
			// we can trust. Taking the first would let a client pick its own
			// rate-limit bucket by sending a header.
			name:       "the last forwarded address wins, not the first",
			xff:        "1.1.1.1, 2.2.2.2, 203.0.113.7",
			remoteAddr: "10.0.0.1:443",
			want:       "203.0.113.7",
		},
		{
			name:       "spoofed leading entries are ignored",
			xff:        "evil, 203.0.113.7",
			remoteAddr: "10.0.0.1:443",
			want:       "203.0.113.7",
		},
		{
			name:       "trailing whitespace and empties are skipped",
			xff:        "1.1.1.1, 203.0.113.7 ,",
			remoteAddr: "10.0.0.1:443",
			want:       "203.0.113.7",
		},
		{
			name:       "a bare RemoteAddr with no port is returned as-is",
			remoteAddr: "192.0.2.10",
			want:       "192.0.2.10",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			r.RemoteAddr = tt.remoteAddr
			if tt.xff != "" {
				r.Header.Set("X-Forwarded-For", tt.xff)
			}
			if got := ratelimit.ClientIP(r); got != tt.want {
				t.Errorf("ClientIP = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestPerIPAllowsThenThrottles(t *testing.T) {
	t.Parallel()

	p := ratelimit.NewPerIP(ratelimit.Config{PerMinute: 1, Burst: 2, MaxClients: 8})

	for i := range 2 {
		if !p.Allow("203.0.113.7") {
			t.Fatalf("request %d was throttled inside the burst", i+1)
		}
	}
	if p.Allow("203.0.113.7") {
		t.Error("a request past the burst was allowed")
	}
}

func TestPerIPIsolatesClients(t *testing.T) {
	t.Parallel()

	p := ratelimit.NewPerIP(ratelimit.Config{PerMinute: 1, Burst: 1, MaxClients: 8})

	if !p.Allow("198.51.100.1") {
		t.Fatal("first client throttled immediately")
	}
	if !p.Allow("198.51.100.2") {
		t.Error("a second client was throttled by the first client's usage")
	}
}

// The limiter must not become the memory exhaustion it was added to prevent:
// a spray of distinct source addresses is exactly what an attacker sends.
func TestPerIPMapStaysBounded(t *testing.T) {
	t.Parallel()

	const max = 64
	p := ratelimit.NewPerIP(ratelimit.Config{PerMinute: 60, Burst: 10, MaxClients: max})

	for i := range 10_000 {
		p.Allow(fmt.Sprintf("198.51.100.%d:%d", i%256, i))
	}

	if tracked := p.Tracked(); tracked > max {
		t.Errorf("tracking %d clients, want at most %d — the map grew without bound", tracked, max)
	}
}

func TestPerIPEvictsLeastRecentlyUsed(t *testing.T) {
	t.Parallel()

	p := ratelimit.NewPerIP(ratelimit.Config{PerMinute: 60, Burst: 1, MaxClients: 2})

	p.Allow("a") // a: token spent
	p.Allow("b") // b: token spent
	p.Allow("a") // a touched again, so b is now least recent
	p.Allow("c") // evicts b

	// b was evicted, so it gets a fresh bucket and its first request succeeds.
	if !p.Allow("b") {
		t.Error("an evicted client did not get a fresh bucket")
	}
}

func TestRetryAfterIsAtLeastOneSecond(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		perMinute float64
		wantMin   int
	}{
		{name: "a generous limit still waits a second", perMinute: 6000, wantMin: 1},
		{name: "six per minute waits about ten seconds", perMinute: 6, wantMin: 10},
		{name: "a zero limit does not divide by zero", perMinute: 0, wantMin: 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			p := ratelimit.NewPerIP(ratelimit.Config{PerMinute: tt.perMinute, Burst: 1, MaxClients: 4})
			if got := p.RetryAfter(); got < tt.wantMin {
				t.Errorf("RetryAfter = %d, want at least %d", got, tt.wantMin)
			}
		})
	}
}

func TestDayIsUTC(t *testing.T) {
	t.Parallel()

	// A local-time key would shift the window under a deploy in another zone,
	// silently handing out a second day's budget.
	plusFourteen := time.FixedZone("UTC+14", 14*60*60)
	local := time.Date(2026, 8, 2, 10, 0, 0, 0, plusFourteen)

	if got, want := ratelimit.Day(local), "2026-08-01"; got != want {
		t.Errorf("Day = %q, want %q — the key is not UTC", got, want)
	}
}
