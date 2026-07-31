# CI/CD workflows

**Status: empty.** Workflows land in Phase 4. Branch protection on `main` requires PRs
today; the "required status checks" rule is added once these checks exist and have run
at least once.

## Planned

### `ci.yml` — every PR

Three jobs, all required:

| Job | Steps |
|---|---|
| `web` | install → lint → typecheck → build |
| `api` | `golangci-lint` → `go test ./...` → `go build ./...` |
| `content` | validate every node in `/content/nodes` against `node.schema.json` |

Plus commitlint, enforcing Conventional Commits on the PR title.

### `deploy.yml` — merge to `main`

1. Sync `/content/nodes` → Firestore (via a small Go tool at `/api/cmd/publish`)
2. Build Astro → `firebase deploy`
3. Build + push the API image → `gcloud run deploy`

Authentication uses **workload identity federation**, not JSON service-account keys. No
long-lived credentials in repository secrets.
