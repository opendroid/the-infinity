// Package ratelimit bounds the unauthenticated write endpoints.
//
// There is no authentication in v1 and there should not be — anonymous
// contribution is the point. That makes POST /requests and POST /reviews a
// cost-availability surface: a loop costs Firestore writes, keeps Cloud Run
// instances warm so scale-to-zero stops being true, and fills the queues a
// human has to sort. Against billing alerts at $10 and $25 that is not
// theoretical, and an alert tells you it already happened rather than
// preventing it.
//
// Two layers, because neither is sufficient alone:
//
//   - Per-IP buckets are immediate and free, but they live in memory. They
//     reset on cold start and do not coordinate across instances, so under
//     scale-out they bound each instance rather than the system.
//   - The store-backed daily cap survives both, and is what actually bounds
//     the bill. It costs one counter operation per accepted write, so the
//     per-IP layer runs first and absorbs the cheap rejections.
package ratelimit

import (
	"container/list"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// Config tunes the per-IP layer.
type Config struct {
	// PerMinute is the sustained rate allowed from one client.
	PerMinute float64
	// Burst is how many requests may arrive at once before shaping applies.
	Burst int
	// MaxClients bounds the tracked-IP map. Without it, a spray of distinct
	// source addresses grows the map without limit — the rate limiter becomes
	// the memory exhaustion it was added to prevent.
	MaxClients int
	// TrustedProxyHops is how many trailing X-Forwarded-For entries belong to
	// infrastructure. Getting this wrong in either direction is severe: too few
	// keys every visitor onto the proxy and throttles the world as one, too many
	// keys onto an entry the caller controls and shapes nobody.
	TrustedProxyHops int
}

// DefaultConfig is deliberately generous for a human and useless for a script:
// nobody fills the request form six times a minute, and a loop hits the wall
// immediately.
func DefaultConfig() Config {
	return Config{PerMinute: 6, Burst: 3, MaxClients: 4096, TrustedProxyHops: DefaultTrustedProxyHops}
}

type entry struct {
	ip      string
	limiter *rate.Limiter
}

// PerIP is an LRU-bounded set of token buckets keyed by client address.
type PerIP struct {
	cfg Config

	mu    sync.Mutex
	order *list.List               // front = most recently used
	index map[string]*list.Element // ip -> element holding *entry
}

func NewPerIP(cfg Config) *PerIP {
	// Every field is normalized, not just this one: rate.NewLimiter(r, 0) denies
	// every request forever, so a partially-filled Config would silently 429 the
	// entire surface with a clean startup and nothing in the logs.
	def := DefaultConfig()
	if cfg.MaxClients <= 0 {
		cfg.MaxClients = def.MaxClients
	}
	if cfg.Burst <= 0 {
		cfg.Burst = def.Burst
	}
	if cfg.PerMinute <= 0 {
		cfg.PerMinute = def.PerMinute
	}
	return &PerIP{
		cfg:   cfg,
		order: list.New(),
		index: make(map[string]*list.Element, cfg.MaxClients),
	}
}

// Allow consumes one token for ip, evicting the least recently seen client
// when the map is full.
func (p *PerIP) Allow(ip string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()

	if el, ok := p.index[ip]; ok {
		p.order.MoveToFront(el)
		if e, ok := el.Value.(*entry); ok {
			return e.limiter.Allow()
		}
		// Unreachable: only *entry is ever stored. Dropping the corrupt element
		// and falling through rebuilds it, rather than panicking inside the
		// component whose job is keeping the instance up.
		p.order.Remove(el)
		delete(p.index, ip)
	}

	for p.order.Len() >= p.cfg.MaxClients {
		oldest := p.order.Back()
		if oldest == nil {
			break
		}
		p.order.Remove(oldest)
		if e, ok := oldest.Value.(*entry); ok {
			delete(p.index, e.ip)
		}
	}

	lim := rate.NewLimiter(rate.Limit(p.cfg.PerMinute/60.0), p.cfg.Burst)
	el := p.order.PushFront(&entry{ip: ip, limiter: lim})
	p.index[ip] = el
	return lim.Allow()
}

// Tracked reports how many clients are held. Exported for the test that proves
// the map stays bounded.
func (p *PerIP) Tracked() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.order.Len()
}

// RetryAfter is the seconds a throttled client should wait — one token's worth,
// rounded up, so backing off by it actually succeeds.
func (p *PerIP) RetryAfter() int {
	if p.cfg.PerMinute <= 0 {
		return 60
	}
	return int(60.0/p.cfg.PerMinute) + 1
}

// DefaultTrustedProxyHops is how many trailing X-Forwarded-For entries belong to
// infrastructure rather than to a caller, measured rather than assumed.
//
// A real request through https://the-infinity-ai.web.app arrives as:
//
//	X-Forwarded-For: 2600:6c52:…:702e, 74.125.209.39
//	RemoteAddr:      169.254.169.126:55758
//
// The caller is FIRST; 74.125.209.39 is Google's edge, appended last. So exactly
// one trailing entry is ours to discard. Override with TRUSTED_PROXY_HOPS if the
// path ever changes — a load balancer in front of Hosting would add another.
const DefaultTrustedProxyHops = 1

// ClientIP extracts the caller's address, skipping hops trailing proxy entries.
//
// RemoteAddr is useless here: behind Cloud Run it is a link-local sandbox address
// (169.254.169.126), identical for every request, so limiting on it would throttle
// the world as one.
//
// Counting from the RIGHT is what makes this unforgeable, and that part of the
// original reasoning was sound — each hop appends the peer it received from, so a
// client that sends its own X-Forwarded-For gets it PREPENDED and cannot push
// itself into a trusted position. What the original got wrong was the count: it
// took the last entry, which through Hosting is Google's edge, collapsing every
// visitor into one bucket. At DefaultConfig that is roughly the fourth request
// per minute across all users returning 429 — site-wide, from a rate limiter
// working exactly as written.
//
// hops below zero is treated as zero. A negative value would index past the end
// and silently key on nothing.
func ClientIP(r *http.Request, hops int) string {
	if hops < 0 {
		hops = 0
	}

	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")

		// Walk left from the first untrusted position. Empty entries are skipped
		// rather than counted, so a stray comma cannot shift the window.
		for i := len(parts) - 1 - hops; i >= 0; i-- {
			if ip := strings.TrimSpace(parts[i]); ip != "" {
				return ip
			}
		}

		// The chain is shorter than the hop count — a direct hit on the Cloud Run
		// URL rather than a request through Hosting. Fall back to the leftmost
		// entry: it is client-controlled and therefore weak, but weak beats
		// keying on the proxy, which is the outage this function exists to avoid.
		for _, p := range parts {
			if ip := strings.TrimSpace(p); ip != "" {
				return ip
			}
		}
	}

	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

// Day is the UTC date key the global cap counts against. UTC rather than local
// so the window does not shift under a deploy in a different zone.
func Day(t time.Time) string {
	return t.UTC().Format("2006-01-02")
}
