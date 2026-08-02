package apihttp

import (
	"log/slog"
	"net/http"
	"sync/atomic"

	"github.com/opendroid/the-infinity/api/internal/ratelimit"
)

// TEMPORARY. Delete this file when #29 closes.
//
// ratelimit.ClientIP takes the LAST X-Forwarded-For entry, on the reasoning that
// a proxy appends the peer it received from, so the trailing entry is the only
// one a client cannot forge. That holds for exactly one appending hop. Production
// is Firebase Hosting → Cloud Run, and if Google's edge appends after the client,
// the entry we trust is infrastructure and every visitor on earth shares one
// rate-limit bucket — roughly the fourth request per minute across all users gets
// a 429, site-wide.
//
// The question cannot be answered by reasoning or reproduced against the
// *.run.app URL, because the whole point is what Hosting adds. It needs one real
// request through the domain, which is what this logs.
//
// It is deliberately not gated behind an environment variable. A flag that has to
// be set is a flag that gets forgotten, and the cost of forgetting is another
// deploy to answer a question we could have answered on this one.

// probeLimit bounds the probe to the first requests an instance serves.
//
// Unbounded logging of client addresses is a privacy and volume problem waiting
// for its first crawler. A few dozen samples is far more than the question needs,
// and a cold start yields a fresh batch if the first ones turn out to be bots.
const probeLimit = 50

// XFFProbe logs the raw forwarding chain alongside the address the limiter would
// key on, so the two can be compared directly rather than inferred from each
// other.
func XFFProbe(next http.Handler) http.Handler {
	var seen atomic.Int64

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if n := seen.Add(1); n <= probeLimit {
			slog.Info("xff probe",
				slog.String("xff", r.Header.Get("X-Forwarded-For")),
				slog.String("remote_addr", r.RemoteAddr),
				// What ratelimit.ClientIP returns today. If this is Google's edge
				// rather than the caller, every visitor keys into one bucket.
				slog.String("client_ip", ratelimit.ClientIP(r)),
				slog.String("path", r.URL.Path),
				slog.Int64("n", n))
		}
		next.ServeHTTP(w, r)
	})
}
