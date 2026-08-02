# `/api` — Go service for Cloud Run

Implements [`/docs/openapi.yaml`](../docs/openapi.yaml). Scale-to-zero, distroless,
no authentication.

```zsh
make run          # :8080 — needs GOOGLE_CLOUD_PROJECT and application-default credentials
make test         # table-driven, with the race detector
make test-emulator# the same, plus the Firestore round-trip suite
make lint         # go vet, gofmt, golangci-lint
make check        # both — what CI runs
make docker-build # multi-stage distroless nonroot image
make publish      # sync /content/nodes → Firestore
make golden       # regenerate content/derived.golden.json
```

## Layout

```
cmd/server/       wiring, graceful SIGTERM shutdown
cmd/publish/      git → Firestore, on merge to main
internal/
  router/         the surface — mounts everything, owns nothing
  apihttp/        structured errors, body cap, recoverer, write limiter
  concepts/       GET concept · neighborhood · stats
  trails/         POST trail · GET trail
  queues/         POST requests · POST reviews — both 202, neither mutates the graph
  ratelimit/      per-IP buckets, client IP extraction, the day key
  publish/        load · derive · sync — the only writer of `concepts`
  store/          interface, Fake, Firestore
```

**`make check` is meant to be exactly what CI runs**, which means the `golangci-lint`
version in [`ci.yml`](../.github/workflows/ci.yml) tracks a recent release rather than
freezing. A pin far behind what `brew install golangci-lint` gives you today makes `make
check` fail locally on code CI calls clean, and the gap only widens with each release.
Bumping it is routine: run the new version, fix what it finds, move the pin.

The two versions are coupled in one direction that is easy to trip over:

```
can't load config: the Go language version (go1.25) used to build golangci-lint
is lower than the targeted Go version (1.26.0)
```

**`golangci-lint` must be built with a Go at least as new as the `go` directive in
`go.mod`** — not merely able to run, built with. Official release binaries and Homebrew
both track the current Go closely, so this is invisible until you install golangci-lint
with `go install` on an older toolchain, which builds it with whatever you have. If you
see that error, reinstall from a release rather than downgrading `go.mod`.

## Layout notes

`router` is a separate package from `apihttp` so the dependency arrow points one way:
handlers import `apihttp` for the error helpers, and `router` imports both. Putting the
router inside `apihttp` would make it import the handlers that import it.

`requests` and `reviews` share the `queues` package because they are the same shape —
validate, append, return `202`, touch nothing else.

## The `/api/v1` prefix is load-bearing

Routes mount at **`/api/v1`**, not `/v1`. Firebase Hosting rewrites `/api/**` to Cloud Run
**preserving the full path**, so the prefix arrives with the request. Serving `/v1` would
work perfectly against the Cloud Run URL and 404 through the domain — a failure that only
appears after the first Hosting deploy. See [ADR-0001](../docs/adr/0001-infrastructure.md).

`GET /healthz` sits at the service root, outside the mount. Since only `/api/**` is
rewritten it is unreachable through the public domain — the right exposure for an
operational endpoint, and why it is absent from the OpenAPI spec. It answers "is the
process up", not "is the whole system well": it deliberately does not touch Firestore, so
a database outage does not pull instances out of rotation.

**It does not currently work.** On the Cloud Run URL it returns Google's 404 page, and the
Cloud Run request log has no entry for it — the request never reaches the container, while
`/nope` from the same session does and returns this service's structured 404. Tracked in
#75.

## Rate limiting

`POST /requests` and `POST /reviews` are unauthenticated public writes, and every read is an
unauthenticated Firestore read plus a Cloud Run invocation. Two layers, because neither is
enough alone:

| Layer | Bounds | What it covers for |
|---|---|---|
| Per-IP token bucket | Immediate, free, no I/O | — resets on cold start, per-instance only |
| Store-backed daily cap | Survives restarts and scale-out | — costs one counter write per accepted request |

The per-IP check runs first so it absorbs the cheap rejections. **A rejected request
performs no writes at all.**

**Reads and writes have separate buckets AND separate rates.** Separating the buckets alone
is half a fix, and shipped as one: both drew on `DefaultConfig` — 6/min, burst 3, sized for
"nobody fills the request form six times a minute". Applied to reads that is three requests
and then one every ten seconds, so a visitor who opened the landing page and two concepts
got a 429 on their next click and watched the mini-map silently vanish. The product
punishing someone for using it.

| | Rate | Why |
|---|---|---|
| Reads | 60/min, burst 20 | A read is something a browser does on a visitor's behalf, not something they chose. Covers brisk clicking with room to spare; one address still tops out near 86k Firestore reads a day, a few cents. |
| Writes | 6/min, burst 3 | A write is deliberate. A script hits the wall immediately. |

Scraping the *content* never reaches here — the pages are pre-rendered on the CDN — so the
read limit shapes mini-map refetches and island calls, not the graph itself.

Client IP comes from `X-Forwarded-For`, counting back **`TRUSTED_PROXY_HOPS` entries from
the right** — one by default. Measured, not assumed. A real request through the domain
arrives as:

```
X-Forwarded-For: 2600:6c52:…:702e, 74.125.209.39
RemoteAddr:      169.254.169.126:55758
```

The caller is first; `74.125.209.39` is Google's edge, appended last; `RemoteAddr` is a
link-local sandbox address identical on every request. Taking the last entry — as this
service originally did — keyed every visitor onto Google's edge, which at `DefaultConfig()`
means roughly the fourth request per minute *across all users* returns 429. Site-wide, from
a rate limiter working exactly as written. See #29.

Counting from the right is still what makes it unforgeable: each hop appends the peer it
received from, so a client's own header is prepended and cannot reach the trusted position.
Only the count was wrong.

The IP map is LRU-bounded. Without that, a spray of distinct source addresses would make
the rate limiter the memory exhaustion it exists to prevent.

Tunable by environment variable: `DAILY_WRITE_CAP`, `RATE_LIMIT_PER_MINUTE`,
`READ_RATE_LIMIT_PER_MINUTE`, `TRUSTED_PROXY_HOPS`.

## Storage

Handlers depend on `store.Store`, never on Firestore, and test against `store.Fake`. That
covers the branching, and it cannot cover serialisation: the fake hands back the same Go
value it was given, so no field name ever crosses a wire. `internal/publish` carries the
tests that do — see below.

**`POST /reviews` never changes a concept's tier.** It appends to a queue. Promotion
happens by editing the node's JSON in a pull request and merging it — the merge is the act
of verification. A runtime write to `tier` would make Firestore diverge from git, and git
is the only writer of concept state. See
[ADR-0002](../docs/adr/0002-content-as-code-and-trust-tiers.md).

## Publishing

`cmd/publish` is the only writer of the `concepts` collection. It reads `/content/nodes`,
derives what ADR-0002 refuses to store — `tier` from the presence of a reviewer, `unlocks`
inverted from other nodes' `requires`, adjacency symmetrised, edges denormalised with the
target's title and tier, mini-map coordinates — and re-syncs the whole graph.

A full re-sync every run, not a diff. A few hundred nodes is a few hundred writes, a
fraction of a cent; an incremental publish would need to know which documents changed,
which is the same derivation problem again with a cache in front of it, and the cache is
where the bugs would live. Concepts git no longer has are deleted, mini-map included.

**It shares the `store` types rather than describing the documents itself.** Publish and the
API therefore cannot disagree about a field name — but they can be wrong together, which is
what `TestPublishedDocumentsUseTheDocumentedFieldNames` checks: it reads the raw documents
back and asserts the stored keys are the ones `/docs/openapi.yaml` promises. A dropped
`firestore` tag renames `grew_this_week` to `GrewThisWeek`, every round-trip still passes,
and every consumer that is not this binary breaks.

Those tests need the emulator and skip without `FIRESTORE_EMULATOR_HOST`, so `make test`
stays one command with no daemon to start. CI always sets it.

`content/derived.golden.json` is the fixture this package shares with
`web/src/lib/graph.ts`, which does the same derivation for the pre-rendered pages. Change
one and the other's test fails.

## Deploying

See [`/infra/README.md`](../infra/README.md). Two flags carry more weight than they look:
`--service-account`, without which Cloud Run silently falls back to an Editor-privileged
default identity, and `--max-instances`, which is what actually bounds the bill.

## Deployed, as of the first M1 deploy

The service is live and answering through the Hosting domain — `/api/v1/stats` and
`/api/v1/concepts/{id}` both verified against `https://the-infinity-ai.web.app`, which is
the check ADR-0001 exists for.

Two things the first deploy turned up:

- **`GET /healthz` returns Google's 404 page on the Cloud Run URL**, while an unmatched
  path like `/nope` correctly returns this service's structured `not_found`. So the request
  is not reaching the process — `/healthz` is registered on the same router whose
  `NotFound` handler answers `/nope`. Under investigation; it does not affect the API.
- **The `X-Forwarded-For` chain was measured and the rate limiter was wrong.** It keyed on
  Google's edge, so every visitor shared one bucket. Fixed and confirmed live — see #29 and
  the rate-limiting section above.
