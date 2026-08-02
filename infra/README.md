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

Run once, when trails start existing (M2). Re-runnable. Creates a regional bucket with
90-day lifecycle, a dedicated service account, and a Cloud Scheduler job that calls the
Firestore Admin API directly every Sunday — no Cloud Function, nothing to keep patched.
Scheduler's free tier is 3 jobs/month, so it costs nothing to run.

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

# restore — destructive, overwrites live documents
gcloud firestore import gs://the-infinity-ai-firestore-backups/<TIMESTAMP> --project=the-infinity-ai
```

An export of empty collections still writes a metadata object, so an empty listing after a
run means the job **failed** — not that there was nothing to save.

Delete protection on the database is handled by `setup.sh`, not here. Re-running `setup.sh`
enables it on a database that already exists.

## What it does not do

- **DNS.** Cutover is a launch task (M3). The domain stays at GoDaddy, unpointed.
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

## CI/CD identity

```zsh
./infra/cicd.sh
```

Creates the workload identity federation `.github/workflows/deploy.yml` authenticates
through, plus a `deployer` service account, and prints the two repository variables to set.
Re-runnable.

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
