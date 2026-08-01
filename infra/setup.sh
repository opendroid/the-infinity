#!/usr/bin/env zsh
#
# theinfinity.ai — GCP + Firebase foundations (Phase 0).
#
# Run this once, from your own machine, signed in as a user with project-create
# and billing-admin rights. It is re-runnable: every step checks before it
# creates, so a partial run can be resumed.
#
#   ./infra/setup.sh          # zsh, per the shebang
#   bash infra/setup.sh       # also fine — the body is compatible with both
#
# Two steps need the web console and cannot be scripted. The script stops at
# each, tells you exactly what to click, and waits.
#
# It does NOT touch DNS. Domain cutover happens at launch (M3), not here.
#
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-the-infinity-ai}"
PROJECT_NAME="theinfinity.ai"
REGION="us-west1"                 # Cloud Run + Firestore + Artifact Registry
AR_REPO="containers"              # Artifact Registry repository
SA_NAME="api-runtime"             # least-privilege runtime identity
RUN_SERVICE="api"                 # Cloud Run service name — must match firebase.json
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
skip() { printf '  \033[90m·\033[0m %s (already exists)\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }

# Substring test against already-captured output.
#
# Do NOT rewrite this as `some-command | grep -q PATTERN`. Under `set -o
# pipefail` that construct returns non-zero *when grep succeeds*: grep exits
# the instant it matches, the writer is still producing output, takes SIGPIPE
# and exits 141, and pipefail takes the rightmost non-zero status. The guard
# then reads "not found" precisely because the value was found — so the check
# is correct only while the thing it looks for is absent, and breaks on the
# second run. Capture into a variable first; no pipe, no SIGPIPE, no race.
contains() {  # contains <haystack> <needle>
  [[ "$1" == *"$2"* ]]
}

# Prompt for input, into REPLY.
#
# `read -rp PROMPT VAR` is bash-only — zsh spells it `read -r "VAR?PROMPT"`,
# with the prompt attached to the variable rather than passed as a flag. Rather
# than branch on $ZSH_VERSION, print the prompt ourselves and use a bare read:
# that form is POSIX and behaves identically in zsh, bash, and sh.
#
# The prompt goes to stderr so it never lands in a captured stdout. REPLY is a
# fixed target on purpose — taking a variable *name* would need ${!name} in
# bash and ${(P)name} in zsh, reintroducing the same divergence one layer down.
ask() {  # ask <prompt>  → sets REPLY
  printf '%s' "$1" >&2
  IFS= read -r REPLY
}

pause_for_console() {
  printf '\n\033[33m▸ CONSOLE STEP\033[0m\n%s\n' "$1"
  ask $'\nPress Enter once done (Ctrl-C to stop)… '
}

command -v gcloud >/dev/null || { echo "gcloud not found: https://cloud.google.com/sdk/docs/install"; exit 1; }
command -v firebase >/dev/null || { echo "firebase not found: npm i -g firebase-tools"; exit 1; }

# ── 1. Project ───────────────────────────────────────────────────────────────
bold "1. Project"
if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  skip "project $PROJECT_ID"
else
  # Project ids are globally unique across all of GCP, not just your account.
  # If this fails as taken, re-run with: PROJECT_ID=the-infinity-ai-<suffix> ./infra/setup.sh
  # and update web/.firebaserc to match.
  gcloud projects create "$PROJECT_ID" --name="$PROJECT_NAME"
  ok "created $PROJECT_ID"
fi
gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
ok "project number $PROJECT_NUMBER"

# ── 2. Billing ───────────────────────────────────────────────────────────────
bold "2. Billing"
if [[ "$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' 2>/dev/null)" == "True" ]]; then
  skip "billing linked"
else
  echo "  Available billing accounts:"
  gcloud billing accounts list
  ask "  Billing account ID (XXXXXX-XXXXXX-XXXXXX): "
  BILLING_ACCOUNT="$REPLY"
  gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"
  ok "billing linked"
fi
BILLING_ACCOUNT="$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingAccountName)' | sed 's|billingAccounts/||')"

# ── 3. APIs ──────────────────────────────────────────────────────────────────
bold "3. APIs"
gcloud services enable \
  run.googleapis.com \
  firestore.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  billingbudgets.googleapis.com \
  --project="$PROJECT_ID"
ok "Cloud Run, Firestore, Artifact Registry, Secret Manager, Billing Budgets"
echo "  (workload identity federation APIs are enabled in Phase 4, with CI)"

# ── 4. Budget alerts ─────────────────────────────────────────────────────────
# These ALERT. They do not cap spending — nothing here stops a runaway bill.
# Bounding actual spend is max-instances (below) and rate limiting (issue #5).
bold "4. Budget alerts"
# Fetched once, into a variable rather than through a pipe. See `contains`.
EXISTING_BUDGETS="$(gcloud billing budgets list --billing-account="$BILLING_ACCOUNT" \
                      --format='value(displayName)' 2>/dev/null || true)"
for AMOUNT in 10 25; do
  NAME="theinfinity \$${AMOUNT}"
  if contains "$EXISTING_BUDGETS" "$NAME"; then
    skip "budget $NAME"
  else
    gcloud billing budgets create \
      --billing-account="$BILLING_ACCOUNT" \
      --display-name="$NAME" \
      --budget-amount="${AMOUNT}USD" \
      --threshold-rule=percent=0.5 \
      --threshold-rule=percent=0.9 \
      --threshold-rule=percent=1.0 \
      --filter-projects="projects/${PROJECT_NUMBER}"
    ok "budget at \$${AMOUNT} (alerts at 50/90/100%)"
  fi
done

# ── 5. Firestore ─────────────────────────────────────────────────────────────
# The location is PERMANENT. It cannot be changed without creating a new
# database and migrating. us-west1 is chosen to match Cloud Run — cross-region
# reads would add latency to every request for no benefit.
bold "5. Firestore (Native mode, $REGION)"
if gcloud firestore databases describe --database='(default)' --project="$PROJECT_ID" >/dev/null 2>&1; then
  skip "Firestore database"
else
  gcloud firestore databases create \
    --database='(default)' \
    --location="$REGION" \
    --type=firestore-native \
    --project="$PROJECT_ID"
  ok "Firestore Native in $REGION — this location is permanent"
fi

# Delete protection, outside the branch above so a re-run enables it on a
# database that already exists. The location is permanent, and the database
# holding that decision should not be one command away from deletion.
# Removing the database later means clearing this flag first — deliberately.
if [[ "$(gcloud firestore databases describe --database='(default)' --project="$PROJECT_ID" \
         --format='value(deleteProtectionState)' 2>/dev/null)" == "DELETE_PROTECTION_ENABLED" ]]; then
  skip "delete protection"
else
  gcloud firestore databases update \
    --database='(default)' \
    --delete-protection \
    --project="$PROJECT_ID" >/dev/null
  ok "delete protection enabled"
fi

# ── 6. Artifact Registry ─────────────────────────────────────────────────────
bold "6. Artifact Registry"
if gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  skip "repository $AR_REPO"
else
  gcloud artifacts repositories create "$AR_REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --description="Container images for theinfinity.ai" \
    --project="$PROJECT_ID"
  ok "$REGION-docker.pkg.dev/$PROJECT_ID/$AR_REPO"
fi

# ── 7. Runtime service account ───────────────────────────────────────────────
# roles/datastore.user grants document read/write and nothing else — no index
# management, no database admin, no access to any other service.
#
# This must be passed to `gcloud run deploy --service-account`. Cloud Run
# otherwise defaults to the Compute Engine default service account, which holds
# project Editor. That default is the single most common way least privilege is
# quietly lost.
bold "7. Runtime service account"
if gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
  skip "$SA_EMAIL"
else
  gcloud iam service-accounts create "$SA_NAME" \
    --display-name="theinfinity API runtime" \
    --description="Least-privilege identity for the Cloud Run api service" \
    --project="$PROJECT_ID"
  ok "created $SA_EMAIL"
fi
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/datastore.user" \
  --condition=None >/dev/null
ok "granted roles/datastore.user (Firestore documents only)"

# ── 8. Firebase ──────────────────────────────────────────────────────────────
bold "8. Firebase"
FB_PROJECTS="$(firebase projects:list 2>/dev/null || true)"
if contains "$FB_PROJECTS" "$PROJECT_ID"; then
  skip "Firebase enabled on $PROJECT_ID"
else
  # Not fatal. addfirebase rejects a project that already has Firebase, and the
  # CLI reports it as "An unexpected error has occurred" with no detail — so a
  # stale or empty listing above would otherwise abort a re-runnable script on
  # a step that was already done. Try, then check the end state either way.
  if firebase projects:addfirebase "$PROJECT_ID"; then
    ok "Firebase added to $PROJECT_ID"
  else
    warn "addfirebase failed — checking whether Firebase is already enabled"
    FB_PROJECTS="$(firebase projects:list 2>/dev/null || true)"
    if contains "$FB_PROJECTS" "$PROJECT_ID"; then
      ok "Firebase is enabled on $PROJECT_ID — the failure was already-exists"
    else
      echo "  Firebase is NOT enabled and could not be added. Check 'firebase login',"
      echo "  then add it manually: firebase projects:addfirebase $PROJECT_ID"
      exit 1
    fi
  fi
fi

pause_for_console "Upgrade to the Blaze plan — required for Hosting to rewrite to Cloud Run.

  1. Open  https://console.firebase.google.com/project/${PROJECT_ID}/usage/details
  2. Click 'Modify plan' → select 'Blaze (pay as you go)'
  3. Confirm the billing account you linked above
  4. Do NOT set a Firebase-level budget here — the two gcloud budgets already cover it"

# Hosting config is committed at web/firebase.json and web/.firebaserc, so
# `firebase init hosting` is deliberately not run — it would overwrite them and
# scaffold a placeholder public/ directory that Astro is going to replace.
bold "9. Verify"
echo "  Hosting config is already committed at web/firebase.json."
echo "  Nothing to deploy until Astro exists (Phase 1) and the API image is"
echo "  pushed (Phase 3). First real deploy is the M1 walking skeleton."

bold "Done — record these in docs/adr/0001-infrastructure.md"
cat <<EOF
  PROJECT_ID       ${PROJECT_ID}
  PROJECT_NUMBER   ${PROJECT_NUMBER}
  BILLING_ACCOUNT  ${BILLING_ACCOUNT}
  REGION           ${REGION}
  FIRESTORE        (default), Native mode, ${REGION}  [permanent]
  ARTIFACT_REPO    ${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}
  RUNTIME_SA       ${SA_EMAIL}
  RUN_SERVICE      ${RUN_SERVICE} (${REGION}) — not yet deployed
EOF

bold "Not done here, on purpose"
cat <<'EOF'
  · DNS — cutover at launch (M3), not before
  · Cloud Run service — deployed in Phase 3 with --service-account and
    --max-instances; see infra/README.md for the exact flags
  · Workload identity federation for CI — Phase 4
EOF
