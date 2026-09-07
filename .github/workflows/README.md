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
| `web` | `npm ci` → `validate:content` → lint → typecheck → test → build → perf budget → browser smoke |
| `api` | `go vet` + `gofmt` → `golangci-lint` → `govulncheck` → `go test -race` (with the Firestore emulator) → `go build` → `docker build` → the image runs |
| `contracts` | `redocly lint docs/openapi.yaml` |
| `pr title` | Conventional Commits, on the title that becomes the squash commit |

Four of those deserve a note.

**The emulator.** `internal/publish`'s round-trip tests skip when
`FIRESTORE_EMULATOR_HOST` is unset, so `go test ./...` stays one command on a
laptop. This job sets it, which means CI is the only place they run — and they
are the only tests that touch real serialisation. The jar is downloaded straight
from `firebase-preview-drop` rather than through `gcloud components install`, so
the job needs neither the SDK nor a credential.

**`docker build`.** It is here because the daemon is unreachable where the code is
written. Before this workflow existed, `api/Dockerfile` had never been built by
anything.

**The browser smoke test.** Six assertions, and the only ones in the repository that
can see whether an island hydrated — jsdom mounts components, `astro build` proves
they compile, and the perf budget weighs the bundles, none of which observes a handler
firing. It drives `astro preview` over `web/dist` with every `/api/v1` call stubbed,
including one stubbed 500 so the mini-map's degradation is exercised rather than
assumed. Chromium is installed as the headless shell alone, since that is what
`chromium.launch()` starts. See [ADR-0016](../../docs/adr/0016-a-browser-smoke-test.md)
for why this is a plain script on `playwright-core` rather than a second test runner.

**`govulncheck`, and why the web job has no counterpart.** It reports a
vulnerability only when this service actually *calls* the affected path. On its
first run that mattered: 0 reachable against **4 vulnerabilities in required
modules** — a scanner without reachability analysis would have blocked every
merge on four things nothing here can trigger. `npm audit` is that kind of
scanner, so the web job does not gate on it; and scoping it quiet enough to gate
on (`--omit=dev --audit-level=high`) would have missed the `nanoid` advisory that
prompted the question, since that one was dev-only (#337, #339).

Both versions are pinned in files — `api/.golangci-version` and
`api/.govulncheck-version` — and both steps refuse an empty value rather than
falling back. The golangci pin was silently ignored for a long while, because
the step read a path that did not exist and the action treats an empty version
as `latest` (#341).

## `deploy.yml` — merge to `main`

1. `go run ./cmd/publish` — `/content/nodes` → Firestore, full re-sync
2. `docker build` + push → `gcloud run deploy`
3. `astro build` → `firebase deploy --only hosting`
4. the deployed `search-index.json` is fetched and its entry count compared
   against the published node count — cache-busted, so it cannot pass against a
   stale edge copy (#322)

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
