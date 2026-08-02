#!/usr/bin/env zsh
#
# theinfinity.ai — weekly Firestore export to Cloud Storage.
#
#   ./infra/backups.sh          # zsh, per the shebang
#   bash infra/backups.sh       # also fine — the body works under either shell
#
# WHY THIS EXISTS, AND WHY IT ONLY BACKS UP THREE COLLECTIONS
#
# ADR-0002 splits state in two. Authored state — the concept graph — lives in
# git and is synced *to* Firestore on merge, so losing it costs one re-publish.
# Interaction state is written at runtime and never syncs back, which means
# `trails`, `concept_requests`, and `concept_reviews` exist in exactly one
# place.
#
# Trails are the sharp edge: a shared trail is a public URL someone posted.
# Losing that collection turns every link anyone has shared into a permanent
# 404, and shared trails are the growth loop.
#
# So this exports the interaction collections only. That is not tidiness —
# Firestore's managed export is **billed at document read rates**, so exporting
# the concept graph every week would pay reads, forever, to duplicate something
# git already stores for free.
#
# Run this once. It is re-runnable. Nothing here is needed until trails exist
# (M2), but the bucket and schedule cost nothing while the collections are
# empty.
#
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-the-infinity-ai}"
REGION="us-west1"                      # same as the database — exports should not cross regions
BUCKET="${PROJECT_ID}-firestore-backups"
SA_NAME="firestore-backup"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
JOB_NAME="firestore-weekly-export"
SCHEDULE="0 9 * * SUN"                 # Sundays 09:00
TIMEZONE="America/Los_Angeles"
RETENTION_DAYS=90

# Interaction state only. See the note above before adding `concepts` here.
COLLECTIONS='["trails","concept_requests","concept_reviews"]'

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
skip() { printf '  \033[90m·\033[0m %s (already exists)\n' "$*"; }

# A service account is not usable in an IAM policy the moment it is created.
# `service-accounts create` returns once the account exists in the IAM API; the
# policy API learns about it seconds later, and until it does, the binding
# that follows fails with
#
#   INVALID_ARGUMENT: Service account <sa> does not exist
#
# — which reads like the create silently failed, and did not.
#
# There is nothing useful to poll: `service-accounts describe` already succeeds
# while the policy API is still rejecting the same address, so waiting on the
# account proves nothing about the API that is actually behind. The only honest
# response is to retry the binding itself and stay quiet until it settles.
# Output is captured so six attempts do not print six gcloud error blocks; the
# last one is printed if it never settles.
settle() {   # settle <cmd...>
  local attempt=1 delay=2 err
  while true; do
    if err="$("$@" 2>&1)"; then
      return 0
    fi
    if (( attempt >= 6 )); then
      printf '%s\n' "$err" >&2
      return 1
    fi
    printf '  \033[90m·\033[0m IAM has not caught up yet; retrying in %ss\n' "$delay"
    sleep "$delay"
    attempt=$(( attempt + 1 ))
    delay=$(( delay * 2 ))
  done
}

command -v gcloud >/dev/null || { echo "gcloud not found: https://cloud.google.com/sdk/docs/install"; exit 1; }

# ── 1. API ───────────────────────────────────────────────────────────────────
bold "1. Cloud Scheduler API"
gcloud services enable cloudscheduler.googleapis.com --project="$PROJECT_ID"
ok "enabled"

# ── 2. Bucket ────────────────────────────────────────────────────────────────
# Same region as the database. A multi-region or cross-region bucket would add
# egress cost to every export for no resilience this project needs.
bold "2. Bucket"
if gcloud storage buckets describe "gs://${BUCKET}" --project="$PROJECT_ID" >/dev/null 2>&1; then
  skip "gs://${BUCKET}"
else
  gcloud storage buckets create "gs://${BUCKET}" \
    --location="$REGION" \
    --uniform-bucket-level-access \
    --project="$PROJECT_ID"
  ok "gs://${BUCKET} in $REGION"
fi

# Lifecycle: without this, exports accumulate forever and the storage line on
# the bill grows without anyone deciding that it should.
LIFECYCLE_FILE="$(mktemp)"
trap 'rm -f "$LIFECYCLE_FILE"' EXIT
cat > "$LIFECYCLE_FILE" <<EOF
{"lifecycle":{"rule":[{"action":{"type":"Delete"},"condition":{"age":${RETENTION_DAYS}}}]}}
EOF
gcloud storage buckets update "gs://${BUCKET}" --lifecycle-file="$LIFECYCLE_FILE" --project="$PROJECT_ID" >/dev/null
ok "lifecycle: delete exports older than ${RETENTION_DAYS} days"

# ── 3. Service account ───────────────────────────────────────────────────────
# Separate from api-runtime on purpose. The API's identity should never be able
# to read the whole database out to a bucket; that is a different job with a
# different blast radius.
bold "3. Service account"
if gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
  skip "$SA_EMAIL"
else
  gcloud iam service-accounts create "$SA_NAME" \
    --display-name="Firestore scheduled export" \
    --description="Runs the weekly Firestore export to GCS" \
    --project="$PROJECT_ID"
  ok "created $SA_EMAIL"
fi

# datastore.importExportAdmin is project-scoped — there is no narrower role for
# triggering an export.
settle gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/datastore.importExportAdmin" \
  --condition=None
ok "granted roles/datastore.importExportAdmin"

# Storage access is granted on THE BUCKET, not the project, so this identity
# cannot touch any other bucket.
settle gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.admin" \
  --project="$PROJECT_ID"
ok "granted roles/storage.admin on gs://${BUCKET} only"

# ── 4. Schedule ──────────────────────────────────────────────────────────────
# Cloud Scheduler's free tier is 3 jobs per billing account per month, so this
# one is free. It calls the Firestore Admin API directly — no Cloud Function,
# no container, nothing else to keep alive or patch.
bold "4. Weekly export job"
URI="https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default):exportDocuments"
BODY="{\"outputUriPrefix\":\"gs://${BUCKET}\",\"collectionIds\":${COLLECTIONS}}"

if gcloud scheduler jobs describe "$JOB_NAME" --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$JOB_NAME" \
    --location="$REGION" \
    --schedule="$SCHEDULE" \
    --time-zone="$TIMEZONE" \
    --uri="$URI" \
    --http-method=POST \
    --oauth-service-account-email="$SA_EMAIL" \
    --headers="Content-Type=application/json" \
    --message-body="$BODY" \
    --project="$PROJECT_ID" >/dev/null
  ok "updated $JOB_NAME"
else
  gcloud scheduler jobs create http "$JOB_NAME" \
    --location="$REGION" \
    --schedule="$SCHEDULE" \
    --time-zone="$TIMEZONE" \
    --uri="$URI" \
    --http-method=POST \
    --oauth-service-account-email="$SA_EMAIL" \
    --headers="Content-Type=application/json" \
    --message-body="$BODY" \
    --project="$PROJECT_ID" >/dev/null
  ok "created $JOB_NAME — ${SCHEDULE} ${TIMEZONE}"
fi

bold "Verify"
cat <<EOF
  Trigger one now and watch it land:

    gcloud scheduler jobs run ${JOB_NAME} --location=${REGION} --project=${PROJECT_ID}
    gcloud storage ls gs://${BUCKET}

  Restore from an export (destructive — it overwrites live documents):

    gcloud firestore import gs://${BUCKET}/<TIMESTAMP> --project=${PROJECT_ID}

  An export of empty collections still writes a metadata object, so an empty
  listing after a run means the job failed, not that there was nothing to save.
EOF

bold "Backing up interaction state only, on purpose"
cat <<'EOF'
  The concept graph is NOT exported. It lives in git and is rebuilt by the
  publish step, and Firestore export is billed at document read rates — paying
  reads weekly to duplicate what git already stores would be a standing cost
  for no recovery benefit. See ADR-0002.
EOF
