# CI/CD workflows

## `ci.yml` — every pull request, and every push to `main`

Four jobs, **all four required in the `protect-main` ruleset**. A red pull request
cannot be merged.

They were added to the ruleset only after running on `main`, because a required check
that has never run blocks every merge — including the one that would introduce it.

Two things about that configuration are easy to get wrong:

- **`deploy` must not be required.** It appears in the checks list, but it runs on push
  to `main` rather than on pull requests, and is skipped until the federation exists.
  Requiring it would block every pull request.
- **"Require branches to be up to date before merging" is deliberately off.** It costs a
  rebase on every pull request whenever `main` moves, and protects against semantic
  conflicts that serial work rarely produces. Worth turning on if two worktrees are ever
  in flight at once.

| Job | Steps |
|---|---|
| `web` | `npm ci` → `validate:content` → lint → typecheck → test → build |
| `api` | `go vet` + `gofmt` → `golangci-lint` → `go test -race` (with the Firestore emulator) → `go build` → `docker build` |
| `contracts` | `redocly lint docs/openapi.yaml` |
| `pr title` | Conventional Commits, on the title that becomes the squash commit |

Two of those deserve a note.

**The emulator.** `internal/publish`'s round-trip tests skip when
`FIRESTORE_EMULATOR_HOST` is unset, so `go test ./...` stays one command on a
laptop. This job sets it, which means CI is the only place they run — and they
are the only tests that touch real serialisation. The jar is downloaded straight
from `firebase-preview-drop` rather than through `gcloud components install`, so
the job needs neither the SDK nor a credential.

**`docker build`.** It is here because the daemon is unreachable where the code is
written. Before this workflow existed, `api/Dockerfile` had never been built by
anything.

## `deploy.yml` — merge to `main`

1. `go run ./cmd/publish` — `/content/nodes` → Firestore, full re-sync
2. `docker build` + push → `gcloud run deploy`
3. `astro build` → `firebase deploy --only hosting`

Publish runs first so the API and the CDN never describe different graphs for
longer than one deploy takes.

**It is inert until two repository variables are set**, and does nothing on a
merge before then — deliberately, so landing this workflow does not turn `main`
red for want of an identity that does not exist yet.

```
./infra/cicd.sh     # creates the federation, prints the two values
```

| Variable | What it is |
|---|---|
| `WIF_PROVIDER` | `projects/<number>/locations/global/workloadIdentityPools/github/providers/github-oidc` |
| `DEPLOY_SERVICE_ACCOUNT` | `deployer@the-infinity-ai.iam.gserviceaccount.com` |

Variables, not secrets. **There are no JSON service-account keys and no
long-lived credentials in this repository's settings** — GitHub mints an OIDC
token per run, bound to `opendroid/the-infinity`, and Google exchanges it for a
short-lived one. Neither value above is a secret; the identity they name is
unusable without a token only this repository can cause to be issued.

The deployer is a separate identity from `api-runtime`, which holds
`datastore.user` and nothing else. If the runtime identity could also deploy, a
bug in a request handler would be a bug that can deploy.
