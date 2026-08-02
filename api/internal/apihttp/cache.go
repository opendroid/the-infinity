package apihttp

import (
	"net/http"
	"strconv"
	"time"
)

// Cache lifetimes for the read surface.
//
// Every uncached read is a Cloud Run invocation plus a Firestore read, and the
// CDN in front is free. Until now nothing set Cache-Control, so Firebase Hosting
// cached nothing and every mini-map refetch woke the service — which undercuts
// static-first from the other side: the pages are on a CDN and the calls they
// make are not.
//
// Two knobs, because browser and CDN want different answers. `max-age` is one
// visitor's tab; `s-maxage` is the shared edge, where a hit costs nothing and
// serves everyone.
//
// The ceiling on all of these is staleness after a publish. A Hosting deploy
// does not purge entries cached from a Cloud Run rewrite — they expire on their
// own terms — so an s-maxage of N minutes means up to N minutes where the API
// serves the previous graph. ADR-0003 already accepts staleness of exactly this
// shape; these numbers keep it to one coffee rather than one afternoon.
const (
	// Concepts and neighbourhoods change only when a merge to main publishes
	// them, which is rare and deliberate.
	ConceptBrowserTTL = 1 * time.Minute
	ConceptEdgeTTL    = 5 * time.Minute

	// Stats is the highest-volume path — every landing-page view — and the
	// cheapest thing to be slightly wrong about. The page ships build-time
	// values inlined, so this never gates a render; it refreshes a number.
	StatsBrowserTTL = 1 * time.Minute
	StatsEdgeTTL    = 5 * time.Minute

	// A trail document is written once and never updated: CreateTrail is
	// idempotent and returns the existing record rather than rewriting it. So
	// this can be long. The denormalised stop titles can drift from their
	// concepts, but that is a property of the denormalisation, not of caching —
	// an uncached read would return the same stale titles.
	TrailBrowserTTL = 10 * time.Minute
	TrailEdgeTTL    = 1 * time.Hour
)

// CacheFor marks a successful response cacheable.
//
// Must be called before the body is written, since headers set after WriteHeader
// are discarded — silently, which is why every caller here sits on the success
// branch immediately before its WriteJSON.
func CacheFor(w http.ResponseWriter, browser, edge time.Duration) {
	w.Header().Set("Cache-Control",
		"public, max-age="+strconv.Itoa(int(browser.Seconds()))+
			", s-maxage="+strconv.Itoa(int(edge.Seconds())))
}

// NoStore forbids caching. Applied to every error, because the alternative is a
// CDN serving a rate-limit rejection or a transient 500 to everyone who follows
// — turning a momentary failure into a persistent one, for as long as the entry
// lives and with no way to purge it.
func NoStore(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
}
