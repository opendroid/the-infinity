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

Plus: a chi router implementing [`/docs/openapi.yaml`](../docs/) exactly, a multi-stage
distroless nonroot `Dockerfile`, a `Makefile` (`run` / `test` / `lint` / `docker-build`),
and a `golangci-lint` config matching the standards in [`/CLAUDE.md`](../CLAUDE.md).

## Non-negotiables

- Table-driven tests for every handler.
- Wrapped errors (`%w`), context as the first parameter of anything doing I/O.
- Structured error responses matching the OpenAPI contract — never a bare string.
- Scale-to-zero. No background workers, no warm-instance assumptions.
- **No paid LLM API calls, ever.** There is no inference in the request path.
