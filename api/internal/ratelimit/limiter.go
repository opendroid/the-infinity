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
}

// DefaultConfig is deliberately generous for a human and useless for a script:
// nobody fills the request form six times a minute, and a loop hits the wall
// immediately.
func DefaultConfig() Config {
	return Config{PerMinute: 6, Burst: 3, MaxClients: 4096}
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
	if cfg.MaxClients <= 0 {
		cfg.MaxClients = DefaultConfig().MaxClients
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

// ClientIP extracts the caller's address.
//
// Behind Firebase Hosting and Cloud Run, RemoteAddr is the load balancer, so
// limiting on it would throttle every client on the planet as one. Cloud Run
// appends the real caller to X-Forwarded-For; the LAST entry is the one it
// added, and earlier entries are attacker-controlled.
func ClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		for i := len(parts) - 1; i >= 0; i-- {
			if ip := strings.TrimSpace(parts[i]); ip != "" {
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
