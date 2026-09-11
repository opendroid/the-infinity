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
| `web` | `npm ci` → `validate:content` → lint → typecheck → test → build → perf budget → browser smoke → `check:explainers --fast` |
| `api` | `go vet` + `gofmt` → `golangci-lint` → `govulncheck` → `go test -race` (with the Firestore emulator) → `go build` → `docker build` → the image runs |
| `contracts` | `redocly lint docs/openapi.yaml` |
| `pr title` | Conventional Commits, on the title that becomes the squash commit |

Five of those deserve a note.

**The emulator.** `internal/publish`'s round-trip tests skip when
`FIRESTORE_EMULATOR_HOST` is unset, so `go test ./...` stays one command on a
laptop. This job sets it, which means CI is the only place they run — and they
are the only tests that touch real serialisation. The jar is downloaded straight
from `firebase-preview-drop` rather than through `gcloud components install`, so
the job needs neither the SDK nor a credential.

**`check:explainers --fast`.** The only gate here that talks to a third party, and **last on purpose** ([#423](https://github.com/opendroid/the-infinity/issues/423)): it used to run sixth of thirteen, so when `en.wikipedia.org` failed to answer on 2026-09-11 the job went red and skipped lint, typecheck, the tests, the build, the perf budget and every smoke assertion. Running it last cannot stop `main` going red for a reason nobody caused — only moving the network half to `links.yml` would, and that is a separate argument (ADR-0020 made it for citations). It makes the red honest: everything else has reported first. A
`video` entry is verified through YouTube's oEmbed endpoint, which 404s for a video that
is gone and returns the real title and channel for one that is live — so the check
asserts the recorded attribution is *right*, not merely that a URL answers.
`check:citations` cannot do that, and does not run here at all — see `links.yml` below.

It fetches **pages, not entries**: 482 explainers are 126 distinct URLs, because a
domain fallback is one page shared across a whole domain. Deduplicating and then
running four requests per host took the step from 99 seconds to 3 — the same change
takes `check:citations` from 134 to 22 — and it is why a dead page now reports once
with the concepts it affects rather than sixteen times (#373).

**`--fast` skips hosts that publish a `Crawl-delay`, and says which** — with the number
of entries it left unchecked, so a gate covering a subset cannot print the success line
of a full run. Today it skips nothing: none of the seven hosts the explainer allowlist
admits states a delay, and the step stays at about two seconds. The flag is here for the
first host added that does (ADR-0020, #375).

A failure that got **no response at all** is reported separately from one the server
answered, and only the first kind can produce exit 2. A 404 is the host answering
clearly; three 404s on one host are three dead pages, not a blocked host.
See [ADR-0017](../../docs/adr/0017-teaching-resources-are-not-citations.md).

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

## `links.yml` — weekly, Sundays 04:17 UTC

The slow half of link checking, and **not a required check**
([ADR-0020](../../docs/adr/0020-link-checking-is-two-jobs.md), #375). It runs both link
checks in full, honouring every stated crawl-delay.

The whole reason it exists is arxiv.org:

```
# Indiscriminate automated downloads from this site are not permitted
User-agent: *
Crawl-delay: 15
```

Every citation in the corpus is an arxiv.org URL, and 485 distinct papers at fifteen
seconds apart is **just over two hours**. That price cannot sit on a pull request, so it
sits here — which is also how #361 is closed: "every citation resolves" had been ticked
in LAUNCH.md since the corpus was thirteen nodes, with nothing enforcing it.

Weekly rather than nightly because link rot is slow. A citation that was never real is
still caught immediately, on the pull request, by the structural checks — a fabricated
arXiv id, a `ref` and `url` naming different papers, a date in the future — none of which
need the network. What moves here is detecting rot in citations that were real when they
merged.

**No `issues: write`.** A failed scheduled run already emails the owner; a bot that opens
an issue per dead link is a bot someone mutes.

`workflow_dispatch` is enabled so the sweep can be started by hand after a large content
merge rather than waiting up to a week.

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
