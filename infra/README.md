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

If `theinfinity-prod` is taken — project IDs are unique across all of GCP, not just your
account — re-run with a suffix and update `web/.firebaserc` to match:

```bash
PROJECT_ID=theinfinity-prod-2 ./infra/setup.sh
```

## What it does not do

- **DNS.** Cutover is a launch task (M3). The domain stays at GoDaddy, unpointed.
- **Deploy anything.** There is nothing to deploy until Astro exists (Phase 1) and the API
  image is pushed (Phase 3).
- **CI credentials.** Workload identity federation is Phase 4. No JSON service-account
  keys, ever.

## Deploying the API (Phase 3, recorded here so the flags aren't rediscovered)

```bash
REGION=us-west1
PROJECT=theinfinity-prod
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
