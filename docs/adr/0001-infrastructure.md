# 0001 — Infrastructure

- **Status:** accepted — infrastructure created 2026-08-01, see *Recorded values*
- **Date:** 2026-08-01

## Context

Phase 0 stands up the GCP and Firebase foundations: one project, Firestore, Artifact
Registry, a runtime identity, budget alerts, and Firebase Hosting configured to rewrite
`/api/**` to Cloud Run. `/docs/PLAN.md` fixes the shape — Cloud Run, Firestore Native,
Firebase Hosting on Blaze, `us-west1`, no GCLB — but not the specific names, roles, or the
seams where those pieces meet.

Two of those seams are decided here because they are expensive to change later: the
Firestore location is permanent once set, and the URL prefix the API serves under is
baked into the OpenAPI contract, the Go router, and every client call.

Budget discipline is a stated product principle, not an afterthought: idle cost should be
~$0/month, with alerts at $10 and $25 from day one.

## Decision

### Resources

| Resource | Value | Notes |
|---|---|---|
| Project ID | `the-infinity-ai` | Globally unique across GCP; if taken, suffix it and update `web/.firebaserc` |
| Region | `us-west1` | Cloud Run, Firestore, and Artifact Registry all colocated |
| Firestore | `(default)`, Native mode, `us-west1` | **Location is permanent**; delete protection enabled |
| Firestore backups | `gs://the-infinity-ai-firestore-backups`, `us-west1` | Weekly export of interaction collections only, 90-day retention |
| Artifact Registry | `us-west1-docker.pkg.dev/the-infinity-ai/containers` | Docker format |
| Runtime identity | `api-runtime@the-infinity-ai.iam.gserviceaccount.com` | `roles/datastore.user` only |
| Cloud Run service | `api`, `us-west1` | Name must match `web/firebase.json` |
| Budgets | $10 and $25 | Alerts at 50 / 90 / 100% of each |

Everything above is created by [`infra/setup.sh`](../../infra/setup.sh), which is
re-runnable and stops at the two steps that require the console.

### One region, colocated

Firestore sits in the same region as Cloud Run. A cross-region database would add a
round-trip to every read on a service whose entire job is reading concept documents, for
no benefit — there is no second region and no failover story in v1. The Firestore location
cannot be changed afterwards without creating a new database and migrating, so this is the
one decision here that is genuinely irreversible.

### Least privilege means passing the service account explicitly

The runtime identity holds `roles/datastore.user` — document read and write, nothing else.
Not `datastore.owner`, which also grants index and database administration.

This only takes effect if `gcloud run deploy` is passed `--service-account`. Cloud Run
otherwise defaults to the Compute Engine default service account, which holds project
**Editor**. Omitting that one flag silently discards least privilege while everything
still works, so it is recorded here and repeated in `infra/README.md`.

### The API serves under `/api/v1`, not `/v1`

Firebase Hosting rewrites **preserve the full request path**. A request to
`theinfinity.ai/api/v1/concepts/attention` arrives at the Cloud Run service as
`/api/v1/concepts/attention` — the `/api` prefix is not stripped, and Hosting offers no
option to strip it.

`/docs/design/handoff-v1/API.md` states `Base: /v1`. Taken literally with an `/api/**`
rewrite, every request would 404 in production while working fine against the Cloud Run
URL directly — a failure that appears only after the first Hosting deploy.

The router therefore mounts at `/api/v1`, so one path works everywhere: through Hosting,
against the raw Cloud Run URL, and in local development. The alternative —
`http.StripPrefix` — gives the service two different paths for the same route depending on
how it is reached, which is worse to debug for no gain.

The health endpoint stays at the service root. Since only `/api/**` is rewritten, it is
reachable on the Cloud Run URL but **not** through the public domain, which is the right
exposure for an operational endpoint.

> Amended after the first deploy: the path is `/-/health`, not `/healthz` as originally
> written. Google Frontend answered `/healthz` before it reached the container (#75). The
> decision — an operational endpoint at the service root, outside the mount — is unchanged;
> only its spelling is.

### Cloud Run is publicly invokable

Hosting proxies to Cloud Run anonymously, so the service is deployed
`--allow-unauthenticated`. The consequence is that the `*.run.app` URL is reachable
directly, bypassing Hosting's headers and caching. The alternative — granting
`run.invoker` only to the Firebase Hosting service agent — is stricter but adds a moving
part to every deploy.

Accepted as-is for v1: the API is a public read API, and the endpoints that write are
being rate-limited regardless of entry point (#5).

### Budget alerts detect; they do not prevent

A budget alert is an email after the fact. Nothing in this ADR caps spending. Actual
bounds come from `--max-instances` on the Cloud Run service and from rate limiting the
public write endpoints (#5). This is stated explicitly because "we have billing alerts" is
easy to mistake for a spending limit.

### DNS is not touched

The domain stays at GoDaddy with no records pointing here. Cutover is a launch task (M3).
Pointing DNS early would serve an unfinished site under the real domain and start the
certificate clock for no reason.

## Consequences

**Easier.** Idle cost is genuinely ~$0: Cloud Run scales to zero, Firestore and Artifact
Registry have free tiers this project will not exhaust, and Hosting's CDN is free on
Blaze. One region means no cross-region egress and one place to look. `setup.sh` is
re-runnable, so a failed run resumes rather than requiring cleanup.

**Harder.** The `/api/v1` prefix has to be respected by the Go router, `openapi.yaml`, and
every client call — it is a cross-cutting convention that is easy to get wrong once and
then wrong everywhere. Blaze means a real card is attached to a project with public write
endpoints, so #5 stops being optional. Any future need for a second region means a new
Firestore database and a migration.

**Accepted costs.** The raw Cloud Run URL is publicly reachable and always will be under
this design. `setup.sh` is imperative shell, not declarative infrastructure — fine at this
size, and the reason `/infra` exists as a directory is so Terraform has somewhere to go if
that changes. Budget alerts arrive after spend, not before.

## Recorded values

`infra/setup.sh` was run against the real project on **2026-08-01**. Every step
succeeded, which also promotes the script's `gcloud` invocations from written-but-untested
to executed.

| Field | Value |
|---|---|
| Project ID | `the-infinity-ai` — pre-existing, so the script skipped creation |
| Project number | `113077672604` |
| Billing account | `0034A7-…-1ABB96` — masked, see below |
| Firestore | `(default)` · `FIRESTORE_NATIVE` · `us-west1` · free tier · created `2026-08-01T23:24:51Z` |
| Firestore uid | `05d87d8a-5705-4022-8cbd-d42d35ff92dd` |
| Artifact Registry | `us-west1-docker.pkg.dev/the-infinity-ai/containers` |
| Runtime SA | `api-runtime@the-infinity-ai.iam.gserviceaccount.com` · `roles/datastore.user` |
| Budgets | `$10` and `$25`, alerts at 50 / 90 / 100% |
| Firebase | added to the project |
| Blaze | operator-confirmed — see below |
| Cloud Run `api` | not deployed; Phase 3 |

**The billing account ID is masked on purpose.** It is not a credential and grants nothing
on its own, but it is a financial identifier that no reader of this repo needs, and this
repo is meant to be read by strangers. Retrieve the real value with:

```
gcloud billing projects describe the-infinity-ai --format='value(billingAccountName)'
```

**Blaze is recorded as operator-confirmed, not verified.** The script pauses for the
console upgrade and continues when the operator presses Enter; no CLI reports a Firebase
project's plan, so nothing checked it. Corroborating evidence: billing was already linked
at the GCP level before Firebase was added, and Blaze *is* a Cloud Billing account linked
to the Firebase project — so the console step was likely confirming an already-satisfied
condition. The real proof is the first `firebase deploy --only hosting` carrying a Cloud
Run rewrite, which Spark rejects outright.

### Follow-ups opened from this run

Reading the Firestore creation response turned up two gaps, both tracked in #13 and neither
resolved here:

- `deleteProtectionState: DELETE_PROTECTION_DISABLED` — the database holding this ADR's one
  irreversible decision can be deleted by a single command.
- `pointInTimeRecoveryEnablement: POINT_IN_TIME_RECOVERY_DISABLED`, with a 1-hour version
  retention window. Concept data is rebuildable from git, so this is harmless for the
  graph — but per ADR-0002 the interaction state (trails, requests, reviews) exists in
  Firestore alone. Losing it would break every shared trail URL permanently.
