#!/usr/bin/env bash
#
# Tests for infra/restore-drill.sh (#557). No GCP, no network, no credentials:
# the drill's commands are read as text, printed by --dry-run, or answered by a
# fake gcloud and a fake curl that log every call they get.
#
#   bash infra/restore-drill.test.sh
#
#   never touches (default)  every line that runs a firestore command other
#                            than `databases describe` names
#                            --database=restore-drill-… exactly once, and every
#                            curl is a read unless it names the scratch database
#   bash 3.2                 none of the four constructs #557 rules out
#   collections              the drill restores what backups.sh exports
#   --dry-run                prints exactly testdata/restore-drill.dry-run.golden,
#                            and calls nothing
#   the drill, faked         a pass, each way a comparison fails, an export that
#                            never lands, a failed create or import, and --keep:
#                            the exit status, what is named, and whether the
#                            scratch database was deleted. The fakes answer in
#                            the shapes the gcloud and Firestore REST reference
#                            pages give; they are not Google, and the first
#                            real drill is the test of that
#
# When the dry-run output changes on purpose, a mismatch prints the command
# that regenerates the golden file. Read the diff before committing it: the
# diff is the review.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SCRIPT="$ROOT/infra/restore-drill.sh"
BACKUPS="$ROOT/infra/backups.sh"
GOLDEN="$ROOT/infra/testdata/restore-drill.dry-run.golden"
BUCKET=gs://the-infinity-ai-firestore-backups
SCRATCH=restore-drill-20261123
NEW_EXPORT=2026-11-23T10:00:00_42
TOKEN=fake-token-5d1e
NL='
'

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

failures=0
pass() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n' "$1" >&2
  shift
  if [ $# -gt 0 ]; then
    printf '%s\n' "$@" | sed 's/^/        /' >&2
  fi
  failures=$((failures + 1))
}

# The script as commands: continuation lines joined, comment lines dropped.
logical_lines() {
  awk '
    buf == "" && /^[[:space:]]*#/ { next }
    { line = buf $0 }
    line ~ /\\$/ { sub(/\\$/, "", line); buf = line; next }
    { buf = ""; print line }
  ' "$1"
}

# ── Never touches (default) ─────────────────────────────────────────────────
# An allowlist, not a denylist: the one firestore read is named, and anything
# else a line runs under `firestore` must carry the scratch database's flag,
# once. A second --database would win over the first. The counts at the end
# are what stop this passing by reading nothing.
never_touches_live() {
  local line rest problems='' imports=0 creates=0 deletes=0 counts=0 gets=0
  while IFS= read -r line; do
    case "$line" in
      *'firestore databases describe'*) ;;
      *'firestore '*)
        case "$line" in *'firestore import '*) imports=$((imports + 1)) ;; esac
        case "$line" in *'firestore databases create '*) creates=$((creates + 1)) ;; esac
        case "$line" in *'firestore databases delete '*) deletes=$((deletes + 1)) ;; esac
        rest=${line#*--database}
        case "$line" in
          *'--database=restore-drill-'*)
            case "$rest" in
              *--database*) problems="${problems}${NL}two --database flags: ${line}" ;;
            esac
            ;;
          *) problems="${problems}${NL}no --database=restore-drill-: ${line}" ;;
        esac
        ;;
    esac
    case "$line" in
      *'curl '*)
        case "$line" in
          *':runAggregationQuery'*) counts=$((counts + 1)) ;;
          *' -X'* | *' --request'* | *' -d'* | *' --data'* | *' -F'* | *' --form'* | *' -T'* | *' --upload-file'* | *' --json'*)
            case "$line" in
              *'databases/restore-drill-'*) ;;
              *) problems="${problems}${NL}a curl that sends, to something other than restore-drill-: ${line}" ;;
            esac
            ;;
          *) gets=$((gets + 1)) ;;
        esac
        ;;
    esac
  done < <(logical_lines "$SCRIPT")
  if [ "$imports" -lt 1 ] || [ "$creates" -lt 1 ] || [ "$deletes" -lt 1 ] || [ "$counts" -lt 1 ] || [ "$gets" -lt 1 ]; then
    problems="${problems}${NL}read ${imports} import, ${creates} create, ${deletes} delete, ${counts} count and ${gets} GET lines; each should be at least one"
  fi
  if [ -z "$problems" ]; then
    pass "never touches (default): ${imports} import, ${creates} create and ${deletes} delete lines all name --database=restore-drill-"
  else
    fail "never touches (default)" "${problems#"$NL"}"
  fi
}

# ── bash 3.2 ────────────────────────────────────────────────────────────────
# The four #557 names. bash 3.2 is what a Mac runs as /bin/bash.
bash32() {
  local first hits
  first=$(head -n 1 "$SCRIPT")
  hits=$(logical_lines "$SCRIPT" | grep -E \
    '(^|[^[:alnum:]_-])(mapfile|readarray|timeout)([^[:alnum:]_-]|$)|(declare|local|typeset)[[:space:]]+-[[:alpha:]]*A|(^|[^[:alnum:]_])date[[:space:]]+(-[[:alpha:]]*d|--date)' ||
    true)
  if [ "$first" = '#!/usr/bin/env bash' ] && [ -z "$hits" ]; then
    pass "bash 3.2: #!/usr/bin/env bash, and no associative array, mapfile, date -d or timeout"
  else
    fail "bash 3.2" "first line: ${first}" "${hits:-no forbidden construct}"
  fi
}

# ── Collections ─────────────────────────────────────────────────────────────
collections() {
  local exported drilled
  exported=$(sed -n "s/^COLLECTIONS='\[\(.*\)\]'\$/\1/p" "$BACKUPS" | tr -d '"' | tr ',' ' ')
  drilled=$(sed -n 's/^COLLECTIONS="\(.*\)"$/\1/p' "$SCRIPT")
  if [ -n "$exported" ] && [ "$exported" = "$drilled" ]; then
    pass "collections: the drill restores what backups.sh exports (${drilled})"
  else
    fail "collections: the drill restores what backups.sh exports" \
      "backups.sh exports: ${exported:-nothing found}" "the drill restores: ${drilled:-nothing found}"
  fi
}

# ── The fakes ───────────────────────────────────────────────────────────────
mkdir -p "$WORK/bin"
cat >"$WORK/bin/gcloud" <<'FAKE_GCLOUD'
#!/usr/bin/env bash
# A fake gcloud: answers the drill's commands from $FAKE and logs each call.
set -euo pipefail
printf 'gcloud %s\n' "$*" >>"$FAKE/calls"
bucket=gs://the-infinity-ai-firestore-backups
case "$*" in
  "storage ls $bucket/")
    cat "$FAKE/prefixes" ;;
  "storage ls $bucket/"*/)
    folder=${3%/}
    printf '%s\n' "${3}${folder##*/}.overall_export_metadata" "${3}all_namespaces/" ;;
  "scheduler jobs run firestore-weekly-export --location=us-west1 --project=the-infinity-ai")
    if [ -e "$FAKE/export-lands" ]; then
      printf '%s\n' "$bucket/2026-11-23T10:00:00_42/" >>"$FAKE/prefixes"
    fi ;;
  "firestore databases describe --database=(default) --project=the-infinity-ai --format=value(locationId)")
    echo us-west1 ;;
  "firestore databases create "*)
    if [ -e "$FAKE/create-fails" ]; then
      echo "ERROR: (gcloud.firestore.databases.create) ALREADY_EXISTS: fake" >&2
      exit 1
    fi ;;
  "firestore import "*)
    if [ -e "$FAKE/import-fails" ]; then
      echo "ERROR: (gcloud.firestore.import) fake failure" >&2
      exit 1
    fi ;;
  "firestore databases delete "*) ;;
  "auth print-access-token")
    echo fake-token-5d1e ;;
  *)
    echo "fake gcloud: no answer for: $*" >&2
    exit 99 ;;
esac
FAKE_GCLOUD
cat >"$WORK/bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
# A fake curl: answers the drill's two Firestore reads from $FAKE, logs each
# call, and keeps what arrived on stdin, which is where -H @- reads the token.
set -euo pipefail
printf 'curl %s\n' "$*" >>"$FAKE/calls"
cat >>"$FAKE/stdin"
url='' data=''
while [ $# -gt 0 ]; do
  case "$1" in
    --data) data=$2; shift ;;
    https://*) url=$1 ;;
  esac
  shift
done
db=${url#*/databases/}
db=${db%%/*}
case "$url" in
  *:runAggregationQuery)
    collection=${data#*'"collectionId":"'}
    collection=${collection%%'"'*}
    printf '[{"result":{"aggregateFields":{"n":{"integerValue":"%s"}}},"readTime":"2026-11-23T10:05:00Z"}]\n' \
      "$(cat "$FAKE/count.$db.$collection")" ;;
  *'?orderBy=__name__&pageSize=1')
    collection=${url%%\?*}
    collection=${collection##*/}
    cat "$FAKE/page.$db.$collection" ;;
  *)
    echo "fake curl: no answer for: $url" >&2
    exit 99 ;;
esac
FAKE_CURL
chmod +x "$WORK/bin/gcloud" "$WORK/bin/curl"

# page DATABASE COLLECTION ID FIELDS — a documents.list answer of one document.
# The restored copy is written later than live, as an import's would be.
page() {
  local time=2026-11-20T08:00:00Z
  if [ "$1" != '(default)' ]; then
    time=2026-11-23T10:03:00Z
  fi
  printf '{"documents":[{"name":"projects/the-infinity-ai/databases/%s/documents/%s/%s","fields":%s,"createTime":"%s","updateTime":"%s"}],"nextPageToken":"n"}\n' \
    "$1" "$2" "$3" "$4" "$time" "$time" >"$FAKE/page.$1.$2"
}

# new_fake — a project in which the drill passes: one old export, a new one
# that lands, and two databases that agree. concept_reviews is empty in both.
new_fake() {
  local db
  FAKE=$(mktemp -d "$WORK/fake.XXXXXX")
  printf '%s\n' "$BUCKET/2026-11-16T17:00:05_7/" >"$FAKE/prefixes"
  touch "$FAKE/export-lands" "$FAKE/calls" "$FAKE/stdin"
  for db in '(default)' "$SCRATCH"; do
    echo 3 >"$FAKE/count.$db.trails"
    echo 2 >"$FAKE/count.$db.concept_requests"
    echo 0 >"$FAKE/count.$db.concept_reviews"
    echo '{}' >"$FAKE/page.$db.concept_reviews"
    page "$db" concept_requests req-1 '{"title":{"stringValue":"Mixture of depths"},"votes":{"integerValue":"2"}}'
  done
  # The same map with its keys in another order. Only jq -S makes them equal.
  page '(default)' trails a-trail '{"stops":{"arrayValue":{"values":[{"stringValue":"attention"},{"stringValue":"kv-cache"}]}},"created":{"timestampValue":"2026-11-20T08:00:00Z"}}'
  page "$SCRATCH" trails a-trail '{"created":{"timestampValue":"2026-11-20T08:00:00Z"},"stops":{"arrayValue":{"values":[{"stringValue":"attention"},{"stringValue":"kv-cache"}]}}}'
}

TIMEOUT=0
POLL=0
# drill ARGS... — run the drill against the fakes. Sets STATUS and OUT.
drill() {
  STATUS=0
  OUT=$(env PATH="$WORK/bin:$PATH" FAKE="$FAKE" PROJECT_ID=the-infinity-ai DRILL_DATE=20261123 \
    EXPORT_TIMEOUT="$TIMEOUT" POLL_SECONDS="$POLL" bash "$SCRIPT" "$@" 2>&1) || STATUS=$?
}

expect_status() {
  [ "$STATUS" = "$1" ] || { REASON="exit ${STATUS}, expected $1"; return 1; }
}
expect_out() {
  case "$OUT" in
    *"$1"*) ;;
    *) REASON="the output lacks: $1"; return 1 ;;
  esac
}
refute_out() {
  case "$OUT" in
    *"$1"*) REASON="the output has: $1"; return 1 ;;
  esac
}
called() { grep -qF -- "$1" "$FAKE/calls"; }
expect_deleted() {
  called "gcloud firestore databases delete --database=${SCRATCH} " || { REASON="${SCRATCH} was not deleted"; return 1; }
}
expect_not_deleted() {
  if called 'firestore databases delete'; then
    REASON="a database was deleted: $(grep -F 'databases delete' "$FAKE/calls")"
    return 1
  fi
}
# What was actually run, as opposed to what the script says: the same rule as
# never_touches_live, over the fake's call log.
expect_writes_named_scratch() {
  local line
  while IFS= read -r line; do
    case "$line" in
      'gcloud firestore databases describe '*) ;;
      'gcloud firestore '*)
        case "$line" in
          *" --database=${SCRATCH} "*) ;;
          *) REASON="ran without --database=${SCRATCH}: ${line}"; return 1 ;;
        esac
        ;;
    esac
  done <"$FAKE/calls"
}
expect_token_hidden() {
  refute_out "$TOKEN" || { REASON="the access token was printed"; return 1; }
  if called "$TOKEN"; then
    REASON="the access token was in a command line"
    return 1
  fi
  grep -qxF -- "Authorization: Bearer ${TOKEN}" "$FAKE/stdin" || { REASON="the token never reached curl's stdin"; return 1; }
}

# check NAME SCENARIO — run one scenario and report it.
check() {
  REASON=''
  OUT=''
  if "$2"; then
    pass "$1"
  else
    fail "$1" "$REASON" "the drill printed:" "$OUT"
  fi
}

# ── --dry-run ───────────────────────────────────────────────────────────────
# With the defaults a real run prints, and the fakes on PATH to catch a call.
dry_run() {
  local diffs
  new_fake
  TIMEOUT=600 POLL=15
  drill --dry-run
  TIMEOUT=0 POLL=0
  if [ "$STATUS" = 0 ] && [ ! -s "$FAKE/calls" ]; then
    pass "--dry-run calls nothing: no gcloud and no curl ran"
  else
    fail "--dry-run calls nothing" "exit ${STATUS}" "$(cat "$FAKE/calls")"
  fi
  if diffs=$(diff -u "$GOLDEN" - <<<"$OUT"); then
    pass "--dry-run prints exactly testdata/restore-drill.dry-run.golden"
  else
    fail "--dry-run prints exactly testdata/restore-drill.dry-run.golden" "$diffs" \
      "If the change is meant, regenerate it and read the diff:" \
      "  PROJECT_ID=the-infinity-ai DRILL_DATE=20261123 EXPORT_TIMEOUT=600 POLL_SECONDS=15 \\" \
      "    bash infra/restore-drill.sh --dry-run > infra/testdata/restore-drill.dry-run.golden"
  fi
}

# ── The drill, faked ────────────────────────────────────────────────────────
passes() {
  new_fake
  drill
  expect_status 0 && expect_out 'restore-drill: PASS' &&
    expect_out "| 2026-11-23 | \`${NEW_EXPORT}\` | 3 | 2 | 0 | " &&
    expect_out 'note  concept_reviews: empty in both' && expect_out 'ok    trails/a-trail: every field matches' &&
    expect_deleted && expect_writes_named_scratch && expect_token_hidden
}
count_differs() {
  new_fake
  echo 1 >"$FAKE/count.$SCRATCH.concept_requests"
  drill
  expect_status 1 && expect_out 'FAIL  concept_requests: 2 in (default), 1 restored' &&
    expect_out 'differ between (default) and the restore: concept_requests' && refute_out 'PASS' && expect_deleted
}
fields_differ() {
  new_fake
  page "$SCRATCH" trails a-trail '{"stops":{"arrayValue":{"values":[{"stringValue":"attention"}]}},"created":{"timestampValue":"2026-11-20T08:00:00Z"}}'
  drill
  expect_status 1 && expect_out 'FAIL  trails/a-trail: fields differ' &&
    expect_out 'differ between (default) and the restore: trails' && refute_out 'PASS' && expect_deleted
}
# Same fields, different id: only the id comparison can fail this one.
first_differs() {
  new_fake
  page "$SCRATCH" trails b-trail '{"stops":{"arrayValue":{"values":[{"stringValue":"attention"},{"stringValue":"kv-cache"}]}},"created":{"timestampValue":"2026-11-20T08:00:00Z"}}'
  drill
  expect_status 1 && expect_out 'FAIL  trails: the first document is trails/a-trail in (default) and trails/b-trail restored' &&
    expect_out 'differ between (default) and the restore: trails' && expect_deleted
}
counted_but_unlisted() {
  new_fake
  echo '{}' >"$FAKE/page.(default).concept_requests"
  echo '{}' >"$FAKE/page.$SCRATCH.concept_requests"
  drill
  expect_status 1 &&
    expect_out 'FAIL  concept_requests: 2 counted in (default), but listing it returned no document to sample' &&
    expect_out 'differ between (default) and the restore: concept_requests' && expect_deleted
}
never_lands() {
  new_fake
  rm "$FAKE/export-lands"
  drill
  expect_status 1 && expect_out 'export never landed' && expect_not_deleted &&
    { if called 'databases create'; then REASON='a database was created'; return 1; fi; }
}
create_fails() {
  new_fake
  touch "$FAKE/create-fails"
  drill
  expect_status 1 && expect_out "could not create ${SCRATCH}" && expect_not_deleted
}
import_fails() {
  new_fake
  touch "$FAKE/import-fails"
  drill
  expect_status 1 && expect_deleted
}
keep() {
  new_fake
  drill --keep
  expect_status 0 && expect_out "kept ${SCRATCH} (--keep)" && expect_not_deleted
}
keep_on_failure() {
  new_fake
  touch "$FAKE/import-fails"
  drill --keep
  expect_status 1 && expect_out "kept ${SCRATCH} (--keep)" && expect_not_deleted
}

echo "restore-drill.test: ${SCRIPT#"$ROOT"/}"
never_touches_live
bash32
collections
dry_run
check "a drill that matches exits 0 and prints the log row" passes
check "a count that differs exits 1 and names the collection" count_differs
check "a field that differs exits 1 and names the collection" fields_differ
check "a different first document exits 1 and names the collection" first_differs
check "documents counted but none listed exits 1, rather than passing as empty" counted_but_unlisted
check "an export that never lands exits 1, 'export never landed', and creates nothing" never_lands
check "a create that fails exits 1 and deletes nothing it did not create" create_fails
check "a failed import exits 1, and the trap deletes the scratch database" import_fails
check "--keep leaves the scratch database" keep
check "--keep leaves it on a failure too" keep_on_failure

echo
if [ "$failures" -gt 0 ]; then
  echo "restore-drill.test: ${failures} failed" >&2
  exit 1
fi
echo "restore-drill.test: all passed"
