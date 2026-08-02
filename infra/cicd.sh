#!/usr/bin/env zsh
#
# theinfinity.ai — CI/CD identity (Phase 4).
#
# Creates the workload identity federation that lets .github/workflows/deploy.yml
# authenticate to GCP, and the deployer service account it impersonates.
#
#   ./infra/cicd.sh          # zsh, per the shebang
#   bash infra/cicd.sh       # also fine — the body is compatible with both
#
# Re-runnable: every step checks before it creates.
#
# Run infra/setup.sh first — this assumes the project, Firestore, Artifact
# Registry, and the api-runtime service account already exist.
#
# WHY FEDERATION AND NOT A KEY. A JSON service-account key is a permanent
# credential in a settings page: it does not expire, it is copied wherever it is
# pasted, and nothing tells you when it leaks. Federation issues GitHub a token
# that lives for the length of one job and is bound to this repository, so the
# credential this repo holds is a *name*, not a secret. Nothing here prints
# anything that must be kept private, which is the point.
#
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-the-infinity-ai}"
REGION="us-west1"
REPO="opendroid/the-infinity"     # the only repository allowed to use this identity
POOL="github"
PROVIDER="github-oidc"
SA_NAME="deployer"                # CI's identity, distinct from api-runtime
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_SA="api-runtime@${PROJECT_ID}.iam.gserviceaccount.com"

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
skip() { printf '  \033[90m·\033[0m %s (already exists)\n' "$*"; }

# See the note in setup.sh: `cmd | grep -q` under `set -o pipefail` returns
# non-zero when grep matches. Capture first, test the variable.
contains() {  # contains <haystack> <needle>
  [[ "$1" == *"$2"* ]]
}

command -v gcloud >/dev/null || { echo "gcloud not found: https://cloud.google.com/sdk/docs/install"; exit 1; }

gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

# ── 1. APIs ──────────────────────────────────────────────────────────────────
bold "1. APIs"
for api in iamcredentials.googleapis.com sts.googleapis.com cloudbuild.googleapis.com; do
  ENABLED="$(gcloud services list --enabled --filter="config.name=$api" --format='value(config.name)')"
  if contains "$ENABLED" "$api"; then
    skip "$api"
  else
    gcloud services enable "$api"
    ok "enabled $api"
  fi
done

# ── 2. Deployer service account ──────────────────────────────────────────────
bold "2. Deployer service account"
if gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1; then
  skip "$SA_EMAIL"
else
  gcloud iam service-accounts create "$SA_NAME" \
    --display-name="CI deployer (GitHub Actions)"
  ok "created $SA_EMAIL"
fi

# Deliberately separate from api-runtime. The runtime identity holds
# datastore.user and nothing else; if it also held run.admin, a bug in a request
# handler would be a bug that can deploy.
bold "3. Roles"
for role in \
  roles/run.admin \
  roles/artifactregistry.writer \
  roles/datastore.user \
  roles/firebasehosting.admin \
  roles/serviceusage.serviceUsageConsumer
do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="$role" \
    --condition=None >/dev/null
  ok "$role"
done

# `gcloud run deploy --service-account=api-runtime` is an act of impersonation:
# without this the deploy fails with a permission error naming a service account
# it never asked for, which is a genuinely confusing half hour.
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/iam.serviceAccountUser" >/dev/null
ok "may act as ${RUNTIME_SA}"

# ── 4. Workload identity pool ────────────────────────────────────────────────
bold "4. Workload identity federation"
if gcloud iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1; then
  skip "pool $POOL"
else
  gcloud iam workload-identity-pools create "$POOL" \
    --location=global --display-name="GitHub Actions"
  ok "created pool $POOL"
fi

if gcloud iam workload-identity-pools providers describe "$PROVIDER" \
     --location=global --workload-identity-pool="$POOL" >/dev/null 2>&1; then
  skip "provider $PROVIDER"
else
  # --attribute-condition is not optional in practice. Without it the provider
  # trusts every GitHub Actions token on the internet, and the binding in step 5
  # is the only thing standing between this project and any repository that
  # cares to guess the audience. Two locks, because the second one is free.
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --location=global \
    --workload-identity-pool="$POOL" \
    --display-name="GitHub OIDC" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository == '${REPO}'"
  ok "created provider $PROVIDER"
fi

POOL_ID="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}"

# Scoped to the repository, not to the pool: any principal in the pool would
# mean any GitHub repository the provider's condition lets in, and conditions
# are easier to widen by accident than a binding is.
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${POOL_ID}/attribute.repository/${REPO}" >/dev/null
ok "${REPO} may impersonate ${SA_NAME}"

# ── 5. What to put in GitHub ─────────────────────────────────────────────────
bold "5. Set these two repository variables"
cat <<EOF

  Settings → Secrets and variables → Actions → Variables → New repository variable

  WIF_PROVIDER
    ${POOL_ID}/providers/${PROVIDER}

  DEPLOY_SERVICE_ACCOUNT
    ${SA_EMAIL}

  Variables, not secrets: neither value is one. They are names — the identity
  they point at is only usable by a token minted for ${REPO}, which nobody else
  can cause GitHub to issue. Storing them as secrets would only hide them from
  the logs of the workflow that needs them in its logs.

  deploy.yml is inert until both are set, so a merge to main before this point
  is a no-op rather than a red build.
EOF
