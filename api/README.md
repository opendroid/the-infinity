# `/api` — Go service for Cloud Run

Implements [`/docs/openapi.yaml`](../docs/openapi.yaml). Scale-to-zero, distroless,
no authentication.

```zsh
make run          # :8080 — needs GOOGLE_CLOUD_PROJECT and application-default credentials
make test         # table-driven, with the race detector
make lint         # go vet, gofmt, golangci-lint
make check        # both — what CI runs
make docker-build # multi-stage distroless nonroot image
```

## Layout

```
cmd/server/       wiring, graceful SIGTERM shutdown
internal/
  router/         the surface — mounts everything, owns nothing
  apihttp/        structured errors, body cap, recoverer, write limiter
  concepts/       GET concept · neighborhood · stats
  trails/         POST trail · GET trail
  queues/         POST requests · POST reviews — both 202, neither mutates the graph
  ratelimit/      per-IP buckets, client IP extraction, the day key
  store/          interface, Fake, Firestore
```

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
rewritten it is reachable on the Cloud Run URL but **not** through the public domain —
the right exposure for an operational endpoint, and why it is absent from the OpenAPI spec.

```
GET /healthz  →  200  {"status":"ok"}
```

It answers "is the process up", not "is the whole system well": it deliberately does not
touch Firestore, so a database outage does not pull instances out of rotation.

## Rate limiting

`POST /requests` and `POST /reviews` are unauthenticated public writes, and `GET /stats` is
called on every landing-page view. Two layers, because neither is enough alone:

| Layer | Bounds | What it covers for |
|---|---|---|
| Per-IP token bucket | Immediate, free, no I/O | — resets on cold start, per-instance only |
| Store-backed daily cap | Survives restarts and scale-out | — costs one counter write per accepted request |

The per-IP check runs first so it absorbs the cheap rejections. **A rejected request
performs no writes at all.**

Client IP comes from `X-Forwarded-For`, specifically its **last** entry — Cloud Run appends
the real caller, so earlier entries are attacker-controlled. `RemoteAddr` behind Hosting is
the load balancer, so limiting on it would throttle every client as one.

The IP map is LRU-bounded. Without that, a spray of distinct source addresses would make
the rate limiter the memory exhaustion it exists to prevent.

Tunable by environment variable: `DAILY_WRITE_CAP`, `RATE_LIMIT_PER_MINUTE`.

## Storage

Handlers depend on `store.Store`, never on Firestore, and test against `store.Fake`. An
emulator would mostly test Google's client library, which is not the part that breaks.

**`POST /reviews` never changes a concept's tier.** It appends to a queue. Promotion
happens by editing the node's JSON in a pull request and merging it — the merge is the act
of verification. A runtime write to `tier` would make Firestore diverge from git, and git
is the only writer of concept state. See
[ADR-0002](../docs/adr/0002-content-as-code-and-trust-tiers.md).

## Deploying

See [`/infra/README.md`](../infra/README.md). Two flags carry more weight than they look:
`--service-account`, without which Cloud Run silently falls back to an Editor-privileged
default identity, and `--max-instances`, which is what actually bounds the bill.

## Not built yet

`cmd/publish` — the merge-to-main sync (Phase 4) — CI, and any Firestore integration test.
The emulator arrives with CI.
