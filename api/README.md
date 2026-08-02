# `/api` — Go service for Cloud Run

**Status: Phase 0 stub.** Serves `GET /healthz` and nothing else, so the deploy path
(Artifact Registry → Cloud Run → Firebase Hosting `/api/**` rewrite) can be proven before
any real handler exists.

## Run it

```bash
go run ./cmd/server        # listens on :8080, or $PORT
curl localhost:8080/healthz
go test ./...
```

## `GET /healthz`

Served at the **service root**, not under `/api`. Firebase Hosting rewrites `/api/**` and
nothing else, so this is reachable on the Cloud Run URL and *not* through the public
domain — the right exposure for an operational endpoint.

That is also why it is absent from [`/docs/openapi.yaml`](../docs/openapi.yaml): it is not
part of the v1 surface.

```
GET /healthz  →  200  {"status":"ok"}
```

It answers "is the process up", not "is the whole system well" — it deliberately does not
touch Firestore, so a database outage does not pull instances out of rotation.

## What lands here (Phase 3)

Layout per [`/docs/PLAN.md`](../docs/PLAN.md):

```
cmd/server/main.go
internal/
  concepts/    GET /v1/concepts/{id}, /v1/concepts/{id}/neighborhood, /v1/search
  trails/      POST /v1/trails, GET /v1/trails/{slug}
  requests/    POST /v1/requests — missing-concept queue
  store/       Firestore client behind an interface, so handlers test against a fake
```

Plus: a chi router implementing [`/docs/openapi.yaml`](../docs/openapi.yaml) exactly —
**mounted at `/api/v1`**, because Hosting preserves the full request path (ADR-0001) — a multi-stage
distroless nonroot `Dockerfile`, a `Makefile` (`run` / `test` / `lint` / `docker-build`),
and a `golangci-lint` config matching the standards in [`/CLAUDE.md`](../CLAUDE.md).

## Non-negotiables

- Table-driven tests for every handler.
- Wrapped errors (`%w`), context as the first parameter of anything doing I/O.
- Structured error responses matching the OpenAPI contract — never a bare string.
- Scale-to-zero. No background workers, no warm-instance assumptions.
- **No paid LLM API calls, ever.** There is no inference in the request path.
