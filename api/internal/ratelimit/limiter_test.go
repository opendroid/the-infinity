package ratelimit_test

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/opendroid/the-infinity/api/internal/ratelimit"
)

// The chain observed on a real request through https://the-infinity-ai.web.app.
// Every expectation below is anchored to this rather than to a belief about what
// Cloud Run does — the previous version of this test asserted the belief, so the
// suite confirmed the assumption instead of checking it, and stayed green while
// the limiter keyed on Google's edge.
const (
	observedClient = "2600:6c52:5f3f:e425:e0c1:8ca3:eb9a:702e"
	observedEdge   = "74.125.209.39"
	// Identical on every request: a link-local sandbox address, not a caller.
	observedRemoteAddr = "169.254.169.126:55758"
)

func TestClientIP(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		xff        string
		remoteAddr string
		hops       int
		want       string
	}{
		{
			// THE case. Reproduces the exact header from production.
			name:       "through Hosting, the caller is second-to-last",
			xff:        observedClient + "," + observedEdge,
			remoteAddr: observedRemoteAddr,
			hops:       ratelimit.DefaultTrustedProxyHops,
			want:       observedClient,
		},
		{
			// What shipped before: the trailing entry is infrastructure, so every
			// visitor keyed onto one bucket. Kept as a named case so the bug is
			// documented by a test rather than by a comment.
			name:       "hops=0 keys on Google's edge, which is the outage",
			xff:        observedClient + "," + observedEdge,
			remoteAddr: observedRemoteAddr,
			hops:       0,
			want:       observedEdge,
		},
		{
			// Each hop appends the peer it received from, so a client's own header
			// is PREPENDED. It cannot push itself into the trusted position.
			name:       "a client-supplied header cannot displace the real caller",
			xff:        "203.0.113.99," + observedClient + "," + observedEdge,
			remoteAddr: observedRemoteAddr,
			hops:       ratelimit.DefaultTrustedProxyHops,
			want:       observedClient,
		},
		{
			name:       "whitespace around entries is trimmed",
			xff:        " " + observedClient + " , " + observedEdge + " ",
			remoteAddr: observedRemoteAddr,
			hops:       1,
			want:       observedClient,
		},
		{
			// A stray comma must not shift the window by one, which would key on
			// the proxy again.
			name:       "empty entries are skipped rather than counted",
			xff:        observedClient + ", ," + observedEdge,
			remoteAddr: observedRemoteAddr,
			hops:       1,
			want:       observedClient,
		},
		{
			// A direct hit on the Cloud Run URL: one entry, and the hop count
			// wants to skip it. Falling back to the proxy would restore the bug,
			// so it falls back to the leftmost entry instead.
			name:       "a chain shorter than the hop count falls back left, not right",
			xff:        "203.0.113.7",
			remoteAddr: observedRemoteAddr,
			hops:       1,
			want:       "203.0.113.7",
		},
		{
			name:       "a negative hop count is clamped rather than indexing past the end",
			xff:        observedClient + "," + observedEdge,
			remoteAddr: observedRemoteAddr,
			hops:       -3,
			want:       observedEdge,
		},
		{
			name:       "two proxies in front means two hops",
			xff:        observedClient + ",10.0.0.1," + observedEdge,
			remoteAddr: observedRemoteAddr,
			hops:       2,
			want:       observedClient,
		},
		{
			name:       "no forwarding header falls back to the socket",
			remoteAddr: "192.0.2.10:54321",
			hops:       1,
			want:       "192.0.2.10",
		},
		{
			name:       "a bare RemoteAddr with no port is returned as-is",
			remoteAddr: "192.0.2.10",
			hops:       1,
			want:       "192.0.2.10",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
			r.RemoteAddr = tt.remoteAddr
			if tt.xff != "" {
				r.Header.Set("X-Forwarded-For", tt.xff)
			}
			if got := ratelimit.ClientIP(r, tt.hops); got != tt.want {
				t.Errorf("ClientIP = %q, want %q", got, tt.want)
			}
		})
	}
}

// The failure this whole change exists to prevent: two different visitors
// arriving through Hosting must not drain each other's allowance.
func TestTwoVisitorsThroughHostingGetSeparateBuckets(t *testing.T) {
	t.Parallel()

	p := ratelimit.NewPerIP(ratelimit.Config{PerMinute: 1, Burst: 1, MaxClients: 8})
	hops := ratelimit.DefaultTrustedProxyHops

	ipFor := func(client string) string {
		r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
		r.RemoteAddr = observedRemoteAddr
		r.Header.Set("X-Forwarded-For", client+","+observedEdge)
		return ratelimit.ClientIP(r, hops)
	}

	if !p.Allow(ipFor(observedClient)) {
		t.Fatal("the first visitor was throttled immediately")
	}
	if !p.Allow(ipFor("198.51.100.42")) {
		t.Error("a second visitor was throttled by the first visitor's request — " +
			"they are sharing a bucket, which is the site-wide outage")
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
