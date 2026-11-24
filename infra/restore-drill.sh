#!/usr/bin/env bash
#
# theinfinity.ai — restore drill: prove the newest Firestore export restores,
# without touching live data (#557).
#
#   ./infra/restore-drill.sh              # in Cloud Shell, quarterly: Feb, May, Aug, Nov
#   ./infra/restore-drill.sh --dry-run    # print every gcloud and curl command, run none
#   ./infra/restore-drill.sh --keep       # leave the scratch database behind for a look
#
# AN EXPORT THAT HAS NEVER BEEN RESTORED IS A BELIEF, NOT A BACKUP (LAUNCH.md
# §4). backups.sh exports trails, concept_requests and concept_reviews every
# Sunday. This is the other half, in six steps:
#
#   1. trigger the weekly export job and wait for its new prefix to land
#   2. create restore-drill-<yyyymmdd>, a named database beside (default)
#   3. import the new export into it, those three collections only
#   4. count each collection in both databases
#   5. compare the first document by id in each, field for field
#   6. delete the scratch database. A trap does it on any exit, unless --keep
#
# Exit 0 only when every count and every sampled document match; otherwise 1,
# naming the collection that differs. A pass ends with one markdown row for the
# Restore drill log in infra/README.md.
#
# IT NEVER WRITES TO (default). Left without --database, `gcloud firestore
# import` imports into (default) and overwrites every live document that shares
# an id with the export. So each line here that creates, imports or deletes
# spells the flag out as --database=restore-drill-…, rather than taking the
# name from a variable: infra/restore-drill.test.sh reads those lines and fails
# on one that lacks it, and a test that has to trust a variable's value is a
# test of the variable. Reads go to both databases; that is the comparison.
#
# --dry-run IS THE SAME CODE PATH with execution switched off. Every gcloud and
# curl command goes through show() on its way to running, so what --dry-run
# prints, and the test compares with infra/testdata/restore-drill.dry-run.golden,
# is what a real run executes rather than a second copy of it that could drift.
# jq and sleep are local and not printed.
#
# bash 3.2, as #557 asks: no associative arrays, no mapfile, no `date -d`, no
# `timeout`. curl needs --fail-with-body, which is 7.76 or later; Cloud Shell
# has it.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-the-infinity-ai}"

# backups.sh's names. The drill restores what that job exports, so these follow
# it; restore-drill.test.sh fails if COLLECTIONS drifts from backups.sh's list.
BUCKET="${PROJECT_ID}-firestore-backups"
JOB_NAME="firestore-weekly-export"
JOB_REGION="us-west1"
COLLECTIONS="trails concept_requests concept_reviews"

# For the test. A drill leaves these alone.
DRILL_DATE="${DRILL_DATE:-$(date -u +%Y%m%d)}"   # names the scratch database
EXPORT_TIMEOUT="${EXPORT_TIMEOUT:-600}"          # seconds to wait for the export
POLL_SECONDS="${POLL_SECONDS:-15}"
CREATE_TIMEOUT=300                               # seconds to wait for the database

FIRESTORE="https://firestore.googleapis.com/v1/projects/${PROJECT_ID}"
NL='
'
TAB=$(printf '\t')
HINT=''

usage() {
  cat <<'EOF'
usage: infra/restore-drill.sh [--dry-run] [--keep]

  --dry-run  print every gcloud and curl command a drill runs, and run none
  --keep     leave restore-drill-<yyyymmdd> behind instead of deleting it

Restores the newest weekly export into a throwaway database and compares it
with live. Never writes to (default). See the top of this file, and
"Restore drill log" in infra/README.md.
EOF
}

DRY_RUN=0
KEEP=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --keep) KEEP=1 ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

case "$DRILL_DATE" in
  [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) ;;
  *) echo "restore-drill: DRILL_DATE must be yyyymmdd, not '${DRILL_DATE}'" >&2; exit 2 ;;
esac
case "${EXPORT_TIMEOUT}${POLL_SECONDS}" in
  '' | *[!0-9]*) echo "restore-drill: EXPORT_TIMEOUT and POLL_SECONDS are whole seconds" >&2; exit 2 ;;
esac

step() { printf '\n%s\n' "$*"; }
ok()   { printf '  ok    %s\n' "$*"; }
note() { printf '  note  %s\n' "$*"; }
bad()  { printf '  FAIL  %s\n' "$*"; }
die()  { printf 'restore-drill: %s\n' "$*" >&2; exit 1; }

# show CMD... — print CMD as a shell would read it back. Quoted by hand, with
# prefix and suffix removal: printf %q, and the replacement half of
# ${var//pat/rep}, both behave differently in bash 3.2, and the golden file has
# to match under every bash.
show() {
  local line='+' arg rest quoted
  for arg in "$@"; do
    case "$arg" in
      '' | *[![:alnum:]_./:=,@%+-]*)
        quoted='' rest=$arg
        while :; do
          case "$rest" in
            *"'"*) quoted="${quoted}${rest%%"'"*}'\\''"; rest=${rest#*"'"} ;;
            *) quoted="${quoted}${rest}"; break ;;
          esac
        done
        line="$line '${quoted}'"
        ;;
      *) line="$line $arg" ;;
    esac
  done
  printf '%s\n' "$line"
}

# run CMD... — show CMD, then run it, unless --dry-run.
run() {
  show "$@"
  if [ "$DRY_RUN" = 1 ]; then
    return 0
  fi
  "$@"
}

# capture VAR STAND_IN CMD... — show CMD, run it, and keep what it prints in
# VAR. Under --dry-run nothing runs and VAR gets STAND_IN, chosen to walk the
# rest of the dry run down the path a passing drill takes. On a failure, HINT,
# if set, follows the error.
capture() {
  local var=$1 stand_in=$2 out
  shift 2
  show "$@"
  if [ "$DRY_RUN" = 1 ]; then
    out=$stand_in
  elif ! out=$("$@"); then
    if [ -n "$out" ]; then
      printf '%s\n' "$out" >&2
    fi
    die "this failed: $(show "$@")${HINT:+$NL$HINT}"
  fi
  printf -v "$var" '%s' "$out"
}

# new_lines OLD NEW — the lines of NEW that are not lines of OLD. A set
# difference by hand, because bash 3.2 has no associative arrays.
new_lines() {
  local line
  while IFS= read -r line; do
    case "${NL}$1${NL}" in
      *"${NL}${line}${NL}"*) ;;
      *) printf '%s\n' "$line" ;;
    esac
  done <<EOF
$2
EOF
}

# count VAR DATABASE COLLECTION — an aggregation COUNT, over REST because
# gcloud has no command for one. The token goes in on stdin (-H @-), so it is
# in neither argv nor anything this prints.
count() {
  capture "$1" '' curl -sS --fail-with-body -H @- -H 'Content-Type: application/json' \
    --data '{"structuredAggregationQuery":{"structuredQuery":{"from":[{"collectionId":"'"$3"'"}]},"aggregations":[{"alias":"n","count":{}}]}}' \
    "${FIRESTORE}/databases/$2/documents:runAggregationQuery" <<<"$AUTH_HEADER"
}

# first VAR DATABASE COLLECTION — the collection's first document by id.
first() {
  capture "$1" '' curl -sS --fail-with-body -H @- \
    "${FIRESTORE}/databases/$2/documents/$3?orderBy=__name__&pageSize=1" <<<"$AUTH_HEADER"
}

# number_in ANSWER — the count in a runAggregationQuery answer. Anything but a
# whole number is a failure, never a zero.
number_in() {
  local n
  n=$(printf '%s' "$1" | jq -r '[.[] | .result.aggregateFields.n.integerValue // empty][0] // empty')
  case "$n" in
    '' | *[!0-9]*) die "runAggregationQuery answered without a count: $1" ;;
  esac
  printf '%s' "$n"
}

# Set by capture, through printf -v, which shellcheck cannot follow.
before='' now='' contents='' location='' operation='' state='' token=''
live_answer='' scratch_answer='' live_page='' scratch_page=''

failed=''
add_failure() {
  case " $failed " in
    *" $1 "*) ;;
    *) failed="${failed:+$failed }$1" ;;
  esac
}

# The scratch database is deleted by step 6 or by this trap, whichever comes
# first — so a drill that fails halfway does not leave a database billing for
# storage. Only one this run created: if create fails because an earlier drill
# left one, that one is the person's to look at, not this run's to delete.
SCRATCH_CREATED=0
release_scratch() {
  if [ "$KEEP" = 1 ]; then
    note "kept restore-drill-${DRILL_DATE} (--keep). It bills for storage until it is deleted:"
    note "gcloud firestore databases delete --database=restore-drill-${DRILL_DATE} --project=${PROJECT_ID}"
  else
    run gcloud firestore databases delete --database=restore-drill-"$DRILL_DATE" --project="$PROJECT_ID" --quiet || return 1
  fi
  SCRATCH_CREATED=0
}
on_exit() {
  local status=$?
  if [ "$SCRATCH_CREATED" = 1 ] && ! release_scratch; then
    printf 'restore-drill: could not delete restore-drill-%s. If it exists, it bills for storage until it is deleted:\n' "$DRILL_DATE" >&2
    printf '  gcloud firestore databases delete --database=restore-drill-%s --project=%s\n' "$DRILL_DATE" "$PROJECT_ID" >&2
    if [ "$status" = 0 ]; then
      status=1
    fi
  fi
  exit "$status"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$DRY_RUN" = 0 ]; then
  for tool in gcloud curl jq; do
    command -v "$tool" >/dev/null || die "$tool not found"
  done
fi

echo "restore-drill: project ${PROJECT_ID}, scratch database restore-drill-${DRILL_DATE}"
if [ "$DRY_RUN" = 1 ]; then
  echo "restore-drill: --dry-run, so every gcloud and curl command is printed and none is run"
fi

# ── 1. A new export ──────────────────────────────────────────────────────────
# `jobs run` returns once the job is triggered, before the export exists, so
# this polls. Landed means a new prefix holds <prefix>.overall_export_metadata:
# Firestore writes that file last and an import reads it first, so a new
# prefix without it is an export still running, or one that failed.
step "1. Trigger ${JOB_NAME}, and wait up to ${EXPORT_TIMEOUT}s for a new export to land"
capture before '' gcloud storage ls "gs://${BUCKET}/"
run gcloud scheduler jobs run "$JOB_NAME" --location="$JOB_REGION" --project="$PROJECT_ID"

export_uri=''
deadline=$((SECONDS + EXPORT_TIMEOUT))
while [ -z "$export_uri" ]; do
  capture now "gs://${BUCKET}/<new-export>/" gcloud storage ls "gs://${BUCKET}/"
  while IFS= read -r prefix <&4; do
    case "$prefix" in
      */) ;;
      *) continue ;;
    esac
    capture contents "${prefix}<new-export>.overall_export_metadata" gcloud storage ls "$prefix"
    case "$contents" in
      *.overall_export_metadata*) export_uri=${prefix%/}; break ;;
    esac
  done 4<<EOF
$(new_lines "$before" "$now")
EOF
  if [ -n "$export_uri" ]; then
    break
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    die "export never landed: no new prefix in gs://${BUCKET} holds an .overall_export_metadata after ${EXPORT_TIMEOUT}s. Read the export operation, as infra/README.md shows under Backups."
  fi
  sleep "$POLL_SECONDS"
done
export_name=${export_uri##*/}
ok "landed: ${export_name}"

# ── 2. The scratch database ──────────────────────────────────────────────────
# `databases create` returns its operation without waiting for it: in the SDK,
# its Run returns CreateDatabase's Operation, and of the commands here only
# `import` calls WaitForOperation. An import into a database still being
# created would fail, so this waits on the operation.
step "2. Create restore-drill-${DRILL_DATE} in the location of (default)"
capture location '<location-of-(default)>' \
  gcloud firestore databases describe --database='(default)' --project="$PROJECT_ID" --format='value(locationId)'
HINT="If an earlier drill left restore-drill-${DRILL_DATE}, delete it, then wait about five minutes, which is how long Firestore holds a deleted database's id: gcloud firestore databases delete --database=restore-drill-${DRILL_DATE} --project=${PROJECT_ID}"
capture operation '<create-operation>' gcloud firestore databases create --database=restore-drill-"$DRILL_DATE" \
  --location="$location" --type=firestore-native --project="$PROJECT_ID" --format='value(name)'
HINT=''
SCRATCH_CREATED=1
ready_by=$((SECONDS + CREATE_TIMEOUT))
while :; do
  capture state 'True' gcloud firestore operations describe "$operation" --database=restore-drill-"$DRILL_DATE" \
    --project="$PROJECT_ID" --format='value(done,error.message)'
  case "$state" in
    True | "True${TAB}") break ;;
    "True${TAB}"*) die "creating restore-drill-${DRILL_DATE} failed: ${state#"True${TAB}"}" ;;
  esac
  if [ "$SECONDS" -ge "$ready_by" ]; then
    die "restore-drill-${DRILL_DATE} was still being created after ${CREATE_TIMEOUT}s"
  fi
  sleep "$POLL_SECONDS"
done
ok "created restore-drill-${DRILL_DATE}"

# ── 3. The import ────────────────────────────────────────────────────────────
# Without --async, gcloud waits for the import to finish.
step "3. Import ${export_name} into restore-drill-${DRILL_DATE}"
run gcloud firestore import "$export_uri" --database=restore-drill-"$DRILL_DATE" \
  --collection-ids="${COLLECTIONS// /,}" --project="$PROJECT_ID"

# ── 4. Counts ────────────────────────────────────────────────────────────────
# Live is counted after the export, so a reader who writes in between fails
# this without the backup being wrong. Run it again before believing that.
step "4. Count each collection in (default) and in restore-drill-${DRILL_DATE}"
note "each curl reads its Authorization header on stdin (-H @-): a bearer token from the command before it"
capture token '<access-token>' gcloud auth print-access-token
AUTH_HEADER="Authorization: Bearer ${token}"
counts=''
counted=''
for collection in $COLLECTIONS; do
  count live_answer '(default)' "$collection"
  count scratch_answer "restore-drill-${DRILL_DATE}" "$collection"
  if [ "$DRY_RUN" = 1 ]; then
    continue
  fi
  live_n=$(number_in "$live_answer")
  scratch_n=$(number_in "$scratch_answer")
  if [ "$live_n" = "$scratch_n" ]; then
    ok "${collection}: ${live_n} in each"
  else
    bad "${collection}: ${live_n} in (default), ${scratch_n} restored"
    add_failure "$collection"
  fi
  counts="${counts} ${live_n} |"
  counted="${counted} ${collection}=${live_n}"
done

# ── 5. One document per collection ───────────────────────────────────────────
# `fields` only: createTime and updateTime belong to the write, not the data.
# jq -S sorts keys, so two encodings of one map compare equal. A collection
# step 4 counted documents in, whose listing then returns none, is a failure:
# otherwise a read that quietly returned nothing would pass as "empty".
step "5. Compare the first document by id in each collection, field for field"
sampled=0
for collection in $COLLECTIONS; do
  first live_page '(default)' "$collection"
  first scratch_page "restore-drill-${DRILL_DATE}" "$collection"
  if [ "$DRY_RUN" = 1 ]; then
    continue
  fi
  live_id=$(printf '%s' "$live_page" | jq -r '.documents[0].name // empty | sub("^.*/documents/"; "")')
  scratch_id=$(printf '%s' "$scratch_page" | jq -r '.documents[0].name // empty | sub("^.*/documents/"; "")')
  live_fields=$(printf '%s' "$live_page" | jq -S '.documents[0].fields // {}')
  scratch_fields=$(printf '%s' "$scratch_page" | jq -S '.documents[0].fields // {}')
  live_n=${counted#*" ${collection}="}
  live_n=${live_n%% *}
  if [ -z "$live_id" ] && [ -z "$scratch_id" ] && [ "$live_n" != 0 ]; then
    bad "${collection}: ${live_n} counted in (default), but listing it returned no document to sample"
    add_failure "$collection"
  elif [ -z "$live_id" ] && [ -z "$scratch_id" ]; then
    note "${collection}: empty in both, so there is no document to sample and the count is the only evidence"
  elif [ "$live_id" != "$scratch_id" ]; then
    bad "${collection}: the first document is ${live_id:-none} in (default) and ${scratch_id:-none} restored"
    add_failure "$collection"
  elif [ "$live_fields" = "$scratch_fields" ]; then
    ok "${live_id}: every field matches"
    sampled=$((sampled + 1))
  else
    bad "${live_id}: fields differ. Run with --keep to read both"
    add_failure "$collection"
  fi
done

# ── 6. Clean up ──────────────────────────────────────────────────────────────
# A delete that fails here is tried once more by the trap on the way out, so
# the verdict below still prints; the exit status says if both failed.
step "6. Delete restore-drill-${DRILL_DATE}"
if ! release_scratch; then
  note "the delete failed. It is tried once more on the way out"
fi

if [ "$DRY_RUN" = 1 ]; then
  step "restore-drill: --dry-run, so nothing ran and nothing was compared"
  exit 0
fi
if [ -n "$failed" ]; then
  die "FAILED. These differ between (default) and the restore: ${failed}"
fi

step "restore-drill: PASS. Every count and every sampled document matched. For the Restore drill log in infra/README.md:"
if [ "$sampled" = 0 ]; then
  note "no document was sampled: every collection is empty, so this proves only that empty restores to empty"
fi
# shellcheck disable=SC2016 # the backticks are markdown, not a command
printf '| %s-%s-%s | `%s` |%s %dm %02ds |\n' \
  "${DRILL_DATE:0:4}" "${DRILL_DATE:4:2}" "${DRILL_DATE:6:2}" "$export_name" "$counts" \
  $((SECONDS / 60)) $((SECONDS % 60))
