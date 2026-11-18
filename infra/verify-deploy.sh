#!/usr/bin/env bash
# What the live site must be true of after a deploy (#542).
#
# deploy.yml already checks that the deployed search index describes the
# deployed corpus. This is the rest of it: the things LAUNCH 1.5, 3.2, 3.3 and
# 3.4 ask a person to confirm by hand, asserted instead.
#
# IT RUNS AGAINST THE APEX, NOT .web.app. That is the opposite choice to the
# search-index check above it, and deliberately: that check is about the build,
# so it uses the origin a DNS problem cannot reach, and four of these are about
# the DOMAIN — the certificate, the www redirect, and whether Hosting's
# `/api/**` rewrite actually reaches Cloud Run. Pointing them at .web.app would
# pass while theinfinity.ai was dark.
#
# EVERY EXPECTED VALUE IS AN ENVIRONMENT VARIABLE, AND EACH REACHES EXACTLY ONE
# CHECK. A check nobody has seen fail is a claim, not a check (PLAN.md §8), and
# this file exists because several things here have shipped green while broken.
# The one-knob-per-check part is load-bearing rather than tidy: this fails on
# the first miss, so a knob shared between two checks could never be used to
# watch the second one fail — everything after the first would be unreachable
# and unproven.
#
# The three rate-limit expectations are READ OUT OF THE GO SOURCE rather than
# written down here. Two copies of a number is how they drift, and the drift
# would be silent: the service would be shaped one way and this would assert
# the other. If the source moves so that they cannot be found, that is a
# failure and not a skip.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)

SITE=${SITE:-https://theinfinity.ai}
WWW=${WWW:-https://www.theinfinity.ai}
PROJECT_ID=${PROJECT_ID:-the-infinity-ai}
REGION=${REGION:-us-west1}
SERVICE=${SERVICE:-api}
EXPECT_SERVICE_ACCOUNT=${EXPECT_SERVICE_ACCOUNT:-api-runtime@${PROJECT_ID}.iam.gserviceaccount.com}
EXPECT_MAX_SCALE=${EXPECT_MAX_SCALE:-4}
EXPECT_APEX_CODE=${EXPECT_APEX_CODE:-200}
EXPECT_REDIRECT=${EXPECT_REDIRECT:-${SITE}/}
EXPECT_REDIRECT_CODE=${EXPECT_REDIRECT_CODE:-301}
EXPECT_STATS_SHAPE=${EXPECT_STATS_SHAPE:-json}
# Empty is the point: a tag on `/` is the crawler block coming back.
EXPECT_ROBOTS_TAG=${EXPECT_ROBOTS_TAG:-}
EXPECT_ROBOTS_ALLOW=${EXPECT_ROBOTS_ALLOW:-1}
EXPECT_ROBOTS_SITEMAP=${EXPECT_ROBOTS_SITEMAP:-1}
EXPECT_TRAIL_TAG=${EXPECT_TRAIL_TAG:-noindex, nofollow}
# `/` and `/concepts` are the hand-written pair in lib/siteindex's
# `indexedRoutes`. The domain routes are NOT fixed — they are derived from the
# nodes, which is why they are counted below rather than added here.
EXPECT_FIXED_ROUTES=${EXPECT_FIXED_ROUTES:-2}
NODES_DIR=${NODES_DIR:-$ROOT/content/nodes}

HTTP_ONLY=0
if [ "${1:-}" = "--http-only" ]; then
  HTTP_ONLY=1
fi

failures=0

pass() {
  printf '  ok    %s\n' "$1"
}

# Fails the run on the first miss, as #542 asks. The message says what was
# expected and what arrived, because "assertion failed" in a deploy log at
# 2am is not worth having.
fail() {
  printf '  FAIL  %s\n' "$1" >&2
  printf '        expected: %s\n' "$2" >&2
  printf '        actual:   %s\n' "$3" >&2
  failures=$((failures + 1))
  exit 1
}

check() {
  if [ "$2" = "$3" ]; then
    pass "$1 — $3"
  else
    fail "$1" "$2" "$3"
  fi
}

# curl's own exit code carries the certificate: --fail-with-body is not used
# because a redirect is not a failure here, but TLS verification stays on and
# an invalid certificate aborts before any assertion reads a status.
head_code() {
  curl -sS -o /dev/null -w '%{http_code}' --retry 5 --retry-delay 4 --retry-all-errors "$1"
}

header_of() {
  curl -sSI --retry 5 --retry-delay 4 --retry-all-errors "$1" \
    | tr -d '\r' | awk -v k="$(printf '%s' "$2" | tr 'A-Z' 'a-z')" \
        'BEGIN{IGNORECASE=1} tolower($1) == k":" {sub(/^[^:]*: */, ""); print; exit}'
}

echo "verify-deploy: ${SITE}"

# ── 1. LAUNCH 1.2 — the apex serves over HTTPS with a valid certificate ──────
check "apex returns 200 over HTTPS" "$EXPECT_APEX_CODE" "$(head_code "${SITE}/")"

# ── 2. LAUNCH 1.3 — www redirects to the apex, 301 and not a certificate error
www_code=$(curl -sS -o /dev/null -w '%{http_code}' --retry 5 --retry-delay 4 --retry-all-errors "${WWW}/")
www_to=$(curl -sS -o /dev/null -w '%{redirect_url}' --retry 5 --retry-delay 4 --retry-all-errors "${WWW}/")
check "www redirects to the apex" "$EXPECT_REDIRECT_CODE" "$www_code"
check "www redirect target" "$EXPECT_REDIRECT" "$www_to"

# ── 3. LAUNCH 1.5 — the API answers THROUGH THE DOMAIN, not just Cloud Run ───
# Hosting rewrites /api/** and preserves the full path, which is why the
# service mounts at /api/v1 and not /v1 (ADR-0001). That mistake only shows up
# after a Hosting deploy, which is exactly what this is.
stats=$(curl -sS --retry 5 --retry-delay 4 --retry-all-errors "${SITE}/api/v1/stats")
stats_concepts=$(printf '%s' "$stats" | jq -r 'if type == "object" and (.concepts | type) == "number" then "json" else "not-json" end' 2>/dev/null || echo "not-json")
check "/api/v1/stats answers JSON through the domain" "$EXPECT_STATS_SHAPE" "$stats_concepts"

# ── 4. LAUNCH 2 — the crawler block is gone. The one that fails silently. ────
robots_tag=$(header_of "${SITE}/" "X-Robots-Tag")
check "no X-Robots-Tag on /" "$EXPECT_ROBOTS_TAG" "$robots_tag"

robots=$(curl -sS --retry 5 --retry-delay 4 --retry-all-errors "${SITE}/robots.txt")
check "robots.txt allows everything" "$EXPECT_ROBOTS_ALLOW" "$(printf '%s\n' "$robots" | grep -cE '^Allow: /$' || true)"
check "robots.txt names the sitemap" "$EXPECT_ROBOTS_SITEMAP" "$(printf '%s\n' "$robots" | grep -cE '^Sitemap: https?://' || true)"

# A trail is reader-created and duplicates concepts in a different order, so it
# is kept out of the index by a HEADER rather than a Disallow line — a page
# linked from elsewhere can be indexed without being crawled, so disallowing
# /t/ would stop a crawler ever SEEING the noindex (ADR-0008, robots.txt).
trail_tag=$(header_of "${SITE}/t/x" "X-Robots-Tag")
check "/t/x carries noindex" "$EXPECT_TRAIL_TAG" "$trail_tag"

# ── 5. The sitemap lists the whole graph ────────────────────────────────────
# Counted, not recomputed: a second implementation of the derivation in
# lib/siteindex is the thing CLAUDE.md warns about. Domains are counted as
# DISTINCT domain[0] values, which equals the number of domain routes because
# `domainRoutes` throws on a slug collision rather than letting one vanish.
nodes=$(find "$NODES_DIR" -name '*.json' | wc -l | tr -d ' ')
domains=$(jq -r '.domain[0]' "$NODES_DIR"/*.json | sort -u | wc -l | tr -d ' ')
expected_urls=$((nodes + domains + EXPECT_FIXED_ROUTES))
actual_urls=$(curl -sS --retry 5 --retry-delay 4 --retry-all-errors "${SITE}/sitemap.xml" | grep -c '<url>' || true)
echo "  note  ${nodes} nodes + ${domains} domains + ${EXPECT_FIXED_ROUTES} fixed routes"
check "sitemap.xml lists every page" "$expected_urls" "$actual_urls"

if [ "$HTTP_ONLY" = "1" ]; then
  echo
  echo "verify-deploy: --http-only — the Cloud Run assertions were NOT run."
  echo "The service account, max-instances and rate-limit checks need gcloud"
  echo "credentials. Nothing below this line was verified."
  exit 0
fi

# ── 6-8. The Cloud Run service ──────────────────────────────────────────────
# ONE describe, parsed with jq, rather than four `--format=value(...)` calls.
# Not for the round trip: `value[delimiter=","]` on the env list prints the
# repr of each entry, and splitting that on commas cuts `{'name': 'X', 'value':
# 'Y'}` in half — so a naive field grab returns the NAME where the value was
# wanted, and every rate-limit check then compares a string against a number
# and fails for a reason that has nothing to do with the service. jq reads the
# structure instead of its printed form.
svc_json=$(gcloud run services describe "$SERVICE" \
  --region "$REGION" --project "$PROJECT_ID" --format=json)

svc() {
  printf '%s' "$svc_json" | jq -r "$1"
}

# LAUNCH 3.3 — --service-account is set. Without it Cloud Run falls back to an
# Editor-privileged default identity, silently. infra/README.md calls this one
# of the two load-bearing deploy flags.
check "the service runs as its own identity" \
  "$EXPECT_SERVICE_ACCOUNT" \
  "$(svc '.spec.template.spec.serviceAccountName // ""')"

# LAUNCH 3.2 — --max-instances is the one that actually bounds the bill.
# --min-instances=0 bounds IDLE cost and does nothing about a traffic spike.
check "max-instances bounds the bill" \
  "$EXPECT_MAX_SCALE" \
  "$(svc '.spec.template.metadata.annotations["autoscaling.knative.dev/maxScale"] // ""')"

# LAUNCH 3.4 — the write cap and the two per-IP rate limits.
#
# THIS ASSERTS AGREEMENT, NOT NON-ZERO. The three values cannot be zero: every
# helper in cmd/server/main.go rejects a value <= 0 and falls back to a
# positive compiled default, so "non-zero" holds in every deployment that could
# ever exist — a check that passes for the wrong reason, which is this
# project's recurring failure (PLAN.md §8).
#
# What CAN go wrong is an override set out of band: someone widening
# RATE_LIMIT_PER_MINUTE on the service while the repository still says 6. So
# the effective value is printed, and an override that disagrees with the
# source fails.
#
# The defaults are READ OUT OF THE GO SOURCE rather than written down here.
# Two copies of a number is how they drift, and the drift would be silent. If
# the source moves so they cannot be found, that is a failure, not a skip.
# The NUMERIC test is the point, not the emptiness test. Renaming the constant
# to `DefaultDailyWriteCap int64 = writeCapDefault` still matches the pattern
# and still returns a non-empty token, so an emptiness test alone reports the
# literal string "writeCapDefault" as the default, compares it against itself,
# and passes. That is the shape of bug this whole file exists to catch, found
# here by sabotaging this function rather than by reading it.
from_source() {
  value=$(awk "$1" "$2")
  case "$value" in
    '' ) fail "reading $3 from the Go source" "a number" "nothing matched in $2" ;;
    *[!0-9]* ) fail "reading $3 from the Go source" "a number" "matched \"$value\" in $2" ;;
  esac
  printf '%s' "$value"
}

cap_default=$(from_source \
  '/DefaultDailyWriteCap int64 =/ {print $NF; exit}' \
  "$ROOT/api/internal/apihttp/middleware.go" "DAILY_WRITE_CAP")
write_default=$(from_source \
  '/^func DefaultConfig\(\)/,/^}/ {if (match($0, /PerMinute: [0-9]+/)) {print substr($0, RSTART+11, RLENGTH-11); exit}}' \
  "$ROOT/api/internal/ratelimit/limiter.go" "RATE_LIMIT_PER_MINUTE")
read_default=$(from_source \
  '/^func DefaultReadConfig\(\)/,/^}/ {if (match($0, /PerMinute: [0-9]+/)) {print substr($0, RSTART+11, RLENGTH-11); exit}}' \
  "$ROOT/api/internal/ratelimit/limiter.go" "READ_RATE_LIMIT_PER_MINUTE")

override_of() {
  svc ".spec.template.spec.containers[0].env // [] | map(select(.name == \"$1\")) | .[0].value // \"\""
}

effective() {
  value=$(override_of "$1")
  if [ -z "$value" ]; then printf '%s' "$2"; else printf '%s' "$value"; fi
}

source_of() {
  if [ -z "$(override_of "$1")" ]; then
    printf 'compiled default, no override on the service'
  else
    printf 'override set on the service'
  fi
}

echo "  note  rate limits in effect:"
echo "          DAILY_WRITE_CAP            = $(effective DAILY_WRITE_CAP "$cap_default") ($(source_of DAILY_WRITE_CAP))"
echo "          RATE_LIMIT_PER_MINUTE      = $(effective RATE_LIMIT_PER_MINUTE "$write_default") ($(source_of RATE_LIMIT_PER_MINUTE))"
echo "          READ_RATE_LIMIT_PER_MINUTE = $(effective READ_RATE_LIMIT_PER_MINUTE "$read_default") ($(source_of READ_RATE_LIMIT_PER_MINUTE))"

# Two assertions per value, because they catch different things. "Positive" is
# what LAUNCH 3.4 asks for and is the only one with teeth when nothing is
# overridden — with no override the agreement test compares the compiled
# default against itself. "Agrees" is what catches an override set out of band.
positive() {
  case "$1" in
    '' | *[!0-9.]* | 0 | 0.0 ) fail "$2 is a positive number" "> 0" "\"$1\"" ;;
  esac
  pass "$2 is positive — $1"
}

positive "$(effective DAILY_WRITE_CAP "$cap_default")" "DAILY_WRITE_CAP"
positive "$(effective RATE_LIMIT_PER_MINUTE "$write_default")" "RATE_LIMIT_PER_MINUTE"
positive "$(effective READ_RATE_LIMIT_PER_MINUTE "$read_default")" "READ_RATE_LIMIT_PER_MINUTE"

check "DAILY_WRITE_CAP agrees with the source" \
  "${EXPECT_DAILY_WRITE_CAP:-$cap_default}" "$(effective DAILY_WRITE_CAP "$cap_default")"
check "RATE_LIMIT_PER_MINUTE agrees with the source" \
  "${EXPECT_RATE_LIMIT_PER_MINUTE:-$write_default}" "$(effective RATE_LIMIT_PER_MINUTE "$write_default")"
check "READ_RATE_LIMIT_PER_MINUTE agrees with the source" \
  "${EXPECT_READ_RATE_LIMIT_PER_MINUTE:-$read_default}" "$(effective READ_RATE_LIMIT_PER_MINUTE "$read_default")"

echo
echo "verify-deploy: all checks passed against ${SITE}"
