# `/infra`

Infrastructure setup for theinfinity.ai. Decisions and resource names are recorded in
[ADR-0001](../docs/adr/0001-infrastructure.md); this directory holds the commands that
create them.

## First-time setup

```zsh
gcloud auth login
npm i -g firebase-tools && firebase login

./infra/setup.sh          # zsh, per the shebang
bash infra/setup.sh       # also fine — the body works under either shell
```

Re-runnable — every step checks before it creates, so a partial run resumes. Two steps
need the web console (billing account selection, Blaze upgrade); the script stops at each
and tells you what to click.

The script is written to run under **zsh or bash**. The one construct that differs
between them is prompting for input — `read -rp` is bash-only — so it prints prompts
itself and uses a bare POSIX `read`. Verified with `zsh -n` and `bash -n`, and by
exercising the prompt under both.

If `the-infinity-ai` is taken — project IDs are unique across all of GCP, not just your
account — re-run with a suffix and update `web/.firebaserc` to match:

```zsh
PROJECT_ID=the-infinity-ai-2 ./infra/setup.sh
```

## Backups — `./infra/backups.sh`

**Applied and verified 2026-08-02**, including a restore. Re-runnable. Creates a regional
bucket with 90-day lifecycle, a dedicated service account, and a Cloud Scheduler job that
calls the Firestore Admin API directly every Sunday — no Cloud Function, nothing to keep
patched.

**It backs up `trails`, `concept_requests`, and `concept_reviews` — not the concept
graph.** Per ADR-0002 the graph lives in git and a re-publish restores it, while those
three collections exist in Firestore alone. Firestore export is billed at *document read
rates*, so exporting the graph weekly would be a standing charge to duplicate what git
already stores for free.

```zsh
./infra/backups.sh

# trigger one immediately and confirm it lands
gcloud scheduler jobs run firestore-weekly-export --location=us-west1 --project=the-infinity-ai
gcloud storage ls gs://the-infinity-ai-firestore-backups
```

`jobs run` returns as soon as it *triggers* the job, not when the export finishes, so an
`ls` on the next line can come back empty from a run that is about to succeed. Read the
operation, not the bucket:

```zsh
gcloud firestore operations list --project=the-infinity-ai \
  --format='table(metadata.operationState, metadata.startTime, metadata.progressDocuments.completedWork, metadata.outputUriPrefix)'
```

`COMPLETED_WORK` is the count of documents actually exported, and it is the only field that
distinguishes a real backup from a successful export of nothing. Note that `--limit=1` does
**not** return the newest operation — it returned the oldest here, which is a good way to
convince yourself a run failed when it did not.

An export of empty collections still writes a metadata object, so an empty listing after a
run means the job **failed** — not that there was nothing to save.

### Schedule: automated, not a reminder

Sundays 09:00 `America/Los_Angeles`, via Cloud Scheduler. This was a choice between a cron
job and a calendar reminder, and the deciding argument is that a reminder is a backup
strategy that stops working the week you are busy — which correlates with the weeks worth
backing up. Scheduler's free tier is 3 jobs per billing account per month, so the automated
version is also the free one.

### Restoring — rehearse into a scratch database, never into production

`gcloud firestore import` restores a collection under **its original name**. There is no
rename-on-import, so pointing it at `(default)` overwrites live documents. What makes a
rehearsal safe is a separate database, not a separate collection:

```zsh
gcloud firestore databases create --database=restore-drill \
  --location=us-west1 --type=firestore-native --project=the-infinity-ai

gcloud firestore import gs://the-infinity-ai-firestore-backups/<TIMESTAMP> \
  --database=restore-drill --project=the-infinity-ai

# import is async — wait for SUCCESSFUL, then read the documents back
gcloud firestore operations list --database=restore-drill --project=the-infinity-ai \
  --format='table(metadata.operationState, metadata.progressDocuments.completedWork)'
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://firestore.googleapis.com/v1/projects/the-infinity-ai/databases/restore-drill/documents/trails"

gcloud firestore databases delete --database=restore-drill --project=the-infinity-ai
```

Delete the scratch database afterwards: it reports `freeTier: false`, because the Firestore
free tier applies to `(default)` only. A forgotten rehearsal database bills for its storage
indefinitely.

The real restore, when it is ever needed, is the same import without `--database`.

### What the 2026-08-02 drill proved, and what it cost

Three throwaway documents were written to `trails`, exported through the real scheduler job
and the real `firestore-backup` identity, imported into a scratch database, and read back
with their contents intact — then the documents, the scratch database, and both test
exports were deleted. The test exports were removed rather than left to age out because an
export containing `_drill-*` documents is a backup that quietly reintroduces junk the day
someone uses it.

That is the criterion worth caring about: an export that exists is not the same claim as an
export that restores. The first attempt exported **zero** documents — the collections are
empty until trails ship in M2 — and would have "passed" a restore test while proving
nothing.

**Cost of one run: $0.00.** An export is billed at document read rates plus GCS storage for
what it writes; at three documents and a few KB it lands below the smallest billable unit
and does not appear as a distinguishable line in the billing report. Scheduler is free at
this volume. The number that will eventually matter is the document count, since one run
costs one read per document in the three collections — so at 10,000 trails a weekly export
is ~10,000 reads/week, still cents per year. Re-check this when trails reach five figures,
not before.

Delete protection on the database is handled by `setup.sh`, not here. Re-running `setup.sh`
enables it on a database that already exists.

### Restore drill log

`./infra/restore-drill.sh` proves the newest export restores, **without touching live data**
([#557](https://github.com/opendroid/the-infinity/issues/557)). Run it **quarterly — Feb,
May, Aug, Nov** — in Cloud Shell, from a clone:

```bash
./infra/restore-drill.sh --dry-run   # every gcloud and curl command it would run; runs none
./infra/restore-drill.sh             # the drill: paste the row it ends with into the table below
./infra/restore-drill.sh --keep      # the same, leaving the scratch database for a look
```

It triggers `firestore-weekly-export`, waits up to ten minutes for a new prefix to land,
creates `restore-drill-<yyyymmdd>` in the location of `(default)`, imports the export into it
(`trails`, `concept_requests` and `concept_reviews` only), and compares each collection's
document count, and its first document by id field for field, with live. Then it deletes the
scratch database; a `trap` does that on any exit, unless `--keep` is given. It exits 0 only
when every count and every sampled document match, and otherwise names the collection that
differs. `gcloud firestore databases create` returns before the database exists, so the
script waits on the create operation before importing.

`gcloud firestore import` without `--database` imports into `(default)`, so every line in the
script that creates, imports or deletes names `--database=restore-drill-…`, and
`bash infra/restore-drill.test.sh` fails if one does not. The same test compares `--dry-run`
with [`testdata/restore-drill.dry-run.golden`](testdata/restore-drill.dry-run.golden) and runs
the pass and fail paths against a fake `gcloud` and `curl`. None of it needs GCP.

Two things fail a drill without the backup being bad: a reader writing between the export and
the count, which a second run settles; and a second drill within about five minutes of the
first on the same day, because Firestore holds a deleted database's id that long.

| Date | Export | `trails` | `concept_requests` | `concept_reviews` | Run time |
|---|---|---|---|---|---|

## What it does not do

- **DNS.** The registrar is GoDaddy and the A records point at Firebase Hosting, changed
  by hand at the cutover (#65) — `setup.sh` does not touch them, and neither does CI. The
  site is reachable at both `theinfinity.ai` and `the-infinity-ai.web.app`; every page
  names the first as canonical.
- **Deploy anything.** There is nothing to deploy until Astro exists (Phase 1) and the API
  image is pushed (Phase 3).
- **CI credentials.** Workload identity federation is Phase 4. No JSON service-account
  keys, ever.

## Deploying the API (Phase 3, recorded here so the flags aren't rediscovered)

```bash
REGION=us-west1
PROJECT=the-infinity-ai
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/containers/api:$(git rev-parse --short HEAD)"

docker build -t "$IMAGE" ./api
docker push "$IMAGE"

gcloud run deploy api \
  --image="$IMAGE" \
  --region="$REGION" \
  --service-account="api-runtime@${PROJECT}.iam.gserviceaccount.com" \
  --min-instances=0 \
  --max-instances=4 \
  --concurrency=80 \
  --cpu=1 --memory=512Mi \
  --allow-unauthenticated \
  --project="$PROJECT"
```

Two flags carry more weight than they look:

- **`--service-account`** — omit it and Cloud Run falls back to the Compute Engine default
  service account, which holds project **Editor**. Everything still works, and least
  privilege is silently gone.
- **`--max-instances`** — `--min-instances=0` bounds *idle* cost. It does nothing about a
  burst. This is the flag that bounds the bill, and it is why it is not left at the
  default.

## Verifying a deploy — `./infra/verify-deploy.sh`

`deploy.yml` ships the graph, the API and the site. Nothing used to check afterwards that
the live site matched, which is why LAUNCH 1.5, 3.2, 3.3 and 3.4 were things a person
confirmed by hand with a handful of `curl` commands. This script is those commands, with
the expected answers written down (#542). A `verify` job runs it after every deploy.

```bash
./infra/verify-deploy.sh                 # the live site, everything
./infra/verify-deploy.sh --http-only     # no gcloud credentials to hand
SITE=https://the-infinity-ai.web.app ./infra/verify-deploy.sh --http-only
```

It asserts the apex serves 200 over HTTPS with a valid certificate; that `www` answers
**301** to the apex; that `/api/v1/stats` returns JSON **through the domain**, which is the
one that catches Hosting's `/api/**` rewrite being wrong rather than the service being
down; that `/` carries no `X-Robots-Tag` and `robots.txt` still says `Allow: /` with a
`Sitemap:` line; that `/t/**` still carries `noindex`; that `sitemap.xml` lists one `<url>`
per node, per domain and per fixed route; and, from the Cloud Run service itself, the two
load-bearing flags above plus the write cap and the two per-IP rate limits.

Three things about it are deliberate and easy to undo by accident:

- **It runs against the apex**, unlike the search-index check in the same workflow, which
  uses `.web.app` so that a DNS problem cannot masquerade as a bad build. Four of these
  assertions are *about* the domain, so pointing them at `.web.app` would let them pass
  while `theinfinity.ai` was dark.
- **Every expected value is an environment variable, and each reaches exactly one check.**
  That is not tidiness. The script fails on the first miss, so a knob shared between two
  checks could never be used to watch the second one fail, and an assertion nobody has
  seen fail is a claim rather than a check.
- **The three rate-limit defaults are read out of the Go source**, never written down
  here or in the script. Two copies of a number is how they drift, and the drift would be
  silent — the service shaped one way and the check asserting the other. A non-numeric
  match is a failure, not a skip, because renaming the constant to another identifier
  still *matches* and would otherwise be compared against itself and pass.

The rate-limit checks assert **agreement with the source**, not merely non-zero. Non-zero
cannot fail: every helper in `api/cmd/server/main.go` rejects a value `<= 0` and falls back
to a positive compiled default, so there is no deployment in which it is false. What can
go wrong is an override set on the service by hand while the repository still says
something else, and that is what is caught.

The shebang is `bash`, not `zsh` like the scripts above, because this one runs unattended
on a CI runner where bash is guaranteed. The body is clean under both, same as the others.

## Hosting

Config is committed at [`web/firebase.json`](../web/firebase.json) — do **not** run
`firebase init hosting`, which overwrites it and scaffolds a placeholder `public/`
directory that Astro replaces.

```bash
cd web && npm run build && firebase deploy --only hosting
```

The `/api/**` rewrite sends matching requests to the Cloud Run service named `api` in
`us-west1`. **Hosting does not strip the prefix** — the service receives the full
`/api/v1/...` path, which is why the router mounts there. See ADR-0001.

## Cache policy, and why the page hit-rate is low on purpose

`make analytics` reports a cache-hit ratio because ADR-0011 calls it *the static-first
claim measured*. The first real run read **26.2%**, which looks alarming and is not. The
policy is set deliberately in [`web/firebase.json`](../web/firebase.json), and measured
from the live CDN on 2026-09-12:

| path | `Cache-Control` | set by |
|---|---|---|
| `/_astro/**` | `public, max-age=31536000, immutable` | `firebase.json` |
| `/` · `/c/**` · `/t/**` · `**/*.html` | `public, max-age=0, must-revalidate` | `firebase.json` |
| `/concepts` · `/search-index.json` | `max-age=3600` | **Firebase's default — not configured** |

**`must-revalidate` is the answer.** The edge holds the HTML but may not serve it without
checking the origin first, so a page request is logged as a miss even when the bytes never
travel — the revalidation returns `304` with an `ETag` and no body. That is the correct
trade for this site: content is published on merge to `main`, and a reader must not be
served last week's page for an hour because an edge decided to keep it.

So **a low page figure is the design working, and a low asset figure would be a real
defect.** One blended number over both says nothing, which is why the report prints them
apart with the policy beside each ([#427](https://github.com/opendroid/the-infinity/issues/427)).

Two things this measurement did *not* settle, recorded so nobody assumes they were:

- **`/concepts` and `/search-index.json` are on Firebase's default hour, not a chosen one.**
  Nothing in `firebase.json` names them. An hour is defensible for both and neither is a
  concept page, but it is a default rather than a decision, and it is inconsistent with the
  `must-revalidate` the other routes get.
- **Whether Firebase logs a `304` revalidation as `cacheHit`** is unknown. If it does, the
  page figure is already measuring something useful; if it does not, the page figure can
  only ever be near zero and the honest move is to stop reporting it as a ratio. Settling
  it needs a controlled request against a warm edge, which is a deliberate experiment
  rather than a reading of the logs.

## Analytics — cost, and the ceiling that matters

Analytics are read from request logs the project already has ([ADR-0011](../docs/adr/0011-analytics-from-request-logs.md)).
No analytics JavaScript ships on any route, so there is no vendor, no cookie banner, and
no third-party request to fund.

**Zero recurring cost.** Cloud Logging's free tier is **50 GiB of ingestion per project
per month**, and logs kept for the default **30-day retention** incur no storage charge on
top of that. We do not request longer retention, so the storage line stays at zero by
construction.

**The ceiling matters more than the price, the same way it does for `--max-instances`
above.** Nothing here creeps upward month by month; the failure mode is a step change. A
bot storm, a scraper, or a Search Console submission that goes well all raise *ingestion*,
and 50 GiB is the number that would be crossed — not a bill that grows 10% at a time. The
budget alerts `setup.sh` creates cover the account, but they report a charge after it
happens; the useful habit is watching the ingestion figure in the Logs Explorer's usage
panel during the weeks after a traffic change.

For scale: a `webrequests` entry is roughly 1 KB, so 50 GiB is on the order of fifty
million requests a month. This site will not approach that from readers. It could from a
misbehaving crawler, which is the case the ceiling is there for.

**Retention is a decision, not a default to accept quietly.** Thirty days answers "what
happened this month", which is what ADR-0011 asks of it. Anything longer is a paid
question, and it should be asked deliberately rather than reached by leaving a setting
alone.

## CI/CD identity

```zsh
./infra/cicd.sh
```

Creates the workload identity federation `.github/workflows/deploy.yml` authenticates
through, plus a `deployer` service account, and prints the two repository variables to set.
Re-runnable. The read-only `.github/workflows/ops.yml` uses the same identity and needs two
viewer roles beyond the deploy ones, `run.viewer` and `logging.viewer`; the script grants
both and says which command each serves (#545).

**No JSON service-account keys, ever.** A key is a permanent credential in a settings page:
it does not expire, it is copied wherever it is pasted, and nothing tells you when it leaks.
Federation issues GitHub a token that lives for the length of one job and is bound to
`opendroid/the-infinity`, so what the repository actually stores is a *name* — which is why
the two values go in Variables rather than Secrets.

The deployer is a separate identity from `api-runtime`. The runtime holds `datastore.user`
and nothing else; if it also held `run.admin`, a bug in a request handler would be a bug
that can deploy.

Two locks on who may use it, because the second one is free: the provider carries
`--attribute-condition="assertion.repository == 'opendroid/the-infinity'"`, and the
impersonation binding is scoped to `attribute.repository/...` rather than to the whole pool.
Either alone would do; conditions are easier to widen by accident than bindings are.

Everything in `deploy.yml` is idempotent, so re-running a half-finished deploy from the
Actions tab is the normal fix.
