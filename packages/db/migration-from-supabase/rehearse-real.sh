#!/usr/bin/env bash
# Rehearsal of the cut-over against a REAL Supabase project (runbook section 1).
#
#   SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
#     pnpm db:rehearse-real
#
# Same steps as the cut-over (export.sh -> copy-storage.ts -> import.sh ->
# verify.sh) with real data, but the destination is always throwaway: a local
# postgres:16 with scripts/roles.sql and every packages/db migration, and a
# local MinIO bucket. There is no TARGET_DATABASE_URL input on purpose, so this
# script can never write to a Coolify or production database. The source is
# only read (export.sh runs every session read-only; copy-storage.ts only GETs
# public URLs).
#
# Optional:
#   SUPABASE_PUBLIC_STORAGE_URL  default https://<ref>.supabase.co/storage/v1/object/public,
#                                with <ref> taken from the pooler user postgres.<ref>
#   REHEARSAL_PORT_BASE          default 55500 (target +2, MinIO +3)
#   REHEARSAL_LOG                default /tmp/vipe-rehearse-real-<id>.log; written only
#                                when no credential appears in it
#   REHEARSAL_KEEP=1             keep the target and MinIO containers for inspection
#                                (they hold real password hashes: docker rm -f them after)
#
# The export directory (real bcrypt hashes) is always deleted on exit.
set -euo pipefail
TOOL_NAME=rehearse-real
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
repo_root="$(cd "$TOOLKIT_DIR/../../.." && pwd)"

require_pg_url SUPABASE_DB_URL
[ -z "${TARGET_DATABASE_URL:-}" ] || die "TARGET_DATABASE_URL is set; this rehearsal only writes to its own throwaway target, unset it"

# Pinned like docker-compose.yml and rehearse.sh.
MINIO_IMAGE="cgr.dev/chainguard/minio@sha256:3c60a2a8c4d33409a9bc7a623a7fcbfb4605adc3d89422d2f53b3f673a6e5597"
MC_IMAGE="cgr.dev/chainguard/minio-client@sha256:39768db4c3fa811bc8f2e2a3e0add8ea391648b1c980de179985e1c353dc1805"
TARGET_IMAGE="postgres:16"
# pg_dump 17 (lib.sh default) reads Supabase projects on Postgres 15 and 17.

src_user="$(bash -c 'source "$1"; parse_pg_url "$SUPABASE_DB_URL"; printf %s "$pg_user"' _ "$TOOLKIT_DIR/lib.sh")"
src_password="$(bash -c 'source "$1"; parse_pg_url "$SUPABASE_DB_URL"; printf %s "$pg_password"' _ "$TOOLKIT_DIR/lib.sh")"
# The password as written in the URL (percent-encoded), checked in the log too.
src_userinfo="${SUPABASE_DB_URL#*://}" src_password_raw=""
if [[ "$src_userinfo" == *@* ]]; then
  src_userinfo="${src_userinfo%@*}"
  [[ "$src_userinfo" == *:* ]] && src_password_raw="${src_userinfo#*:}"
fi
if [ -z "${SUPABASE_PUBLIC_STORAGE_URL:-}" ]; then
  ref="${src_user#postgres.}"
  [ "$ref" != "$src_user" ] && [ -n "$ref" ] \
    || die "cannot derive the project ref from the pooler user; set SUPABASE_PUBLIC_STORAGE_URL"
  export SUPABASE_PUBLIC_STORAGE_URL="https://$ref.supabase.co/storage/v1/object/public"
fi

base="${REHEARSAL_PORT_BASE:-55500}"
tgt_port=$((base + 2)) minio_port=$((base + 3))
id="$$-$(date +%s)"
tgt_c="vipe-rehearse-real-target-$id" minio_c="vipe-rehearse-real-minio-$id"
work="$(mktemp -d)"
chmod 700 "$work"
out_log="${REHEARSAL_LOG:-/tmp/vipe-rehearse-real-$id.log}"
hex="$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
password="rehearse-real-$hex"
export POSTGRES_PASSWORD="$password"
minio_user="rehearsal" minio_password="rehearsal-$hex"
bucket="vipe-rehearse-real"

# Original stderr: cleanup writes here, because Ctrl-C also kills the tee below.
exec 3>&2
# A signal to the process group also kills the tee; bash then reports the dead
# child ("Terminated") into that broken pipe, and a default SIGPIPE would kill the
# shell before its INT/TERM trap runs, leaving the export behind. Ignore it here.
trap '' PIPE
export PG_TOOL_TRACE="$work/pg-tool-argv.log"

# Runs on every exit, including Ctrl-C: the real hashes go first, before any
# output (stdout may be a dead pipe), and nothing here may stop it half-way.
cleanup() {
  local status=$?
  trap '' INT TERM HUP PIPE
  set +e
  rm -rf "$work/export"
  exec >&3 2>&3
  clog() {
    printf '%s: %s\n' "$TOOL_NAME" "$*" 2>/dev/null
    [ -f "$work/rehearsal.log" ] && printf '%s: %s\n' "$TOOL_NAME" "$*" >> "$work/rehearsal.log"
  }
  sleep 1 # let tee flush what it already read
  if [ "${REHEARSAL_KEEP:-}" = 1 ]; then
    clog "kept $tgt_c (127.0.0.1:$tgt_port, postgres/$password) and $minio_c; remove them with: docker rm -f $tgt_c $minio_c"
  else
    docker rm -f "$tgt_c" "$minio_c" >/dev/null 2>&1
  fi
  if [ "$status" -eq 0 ]; then clog "PASS"; else clog "FAIL (exit $status)"; fi
  local files=() secrets=()
  for f in "$work/rehearsal.log" "$PG_TOOL_TRACE"; do [ -f "$f" ] && files+=("$f"); done
  for s in "$src_password" "$src_password_raw"; do [ -n "$s" ] && secrets+=("$s"); done
  # Patterns through a file descriptor (printf is a builtin): never in a process argument.
  if [ "${#secrets[@]}" -gt 0 ] && [ "${#files[@]}" -gt 0 ] && grep -qF -f <(printf '%s\n' "${secrets[@]}") "${files[@]}"; then
    clog "ERROR: the source credential appears in the log or a client command line; no log was kept"
    status=1
  elif [ -f "$work/rehearsal.log" ]; then
    cp "$work/rehearsal.log" "$out_log" && clog "log: $out_log"
  fi
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT
exec > >(tee "$work/rehearsal.log") 2>&1
: > "$PG_TOOL_TRACE"
trap 'exit 130' INT TERM
trap 'exit 129' HUP

wait_pg() {
  for _ in $(seq 1 60); do
    if docker exec "$1" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 \
      && docker exec "$1" psql -U postgres -Atc 'select 1' >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  die "$1 did not become ready"
}
su_exec() { local c="$1"; shift; docker exec -i -e PGOPTIONS=-cclient_min_messages=warning "$c" psql -U postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
step() { log "---- $*"; }

log "source: $(redact_url "$SUPABASE_DB_URL") (read-only), storage: $SUPABASE_PUBLIC_STORAGE_URL"
step "starting throwaway target ($tgt_c :$tgt_port) and MinIO ($minio_c :$minio_port)"
docker run -d --name "$tgt_c" -p "127.0.0.1:$tgt_port:5432" -e POSTGRES_PASSWORD -e POSTGRES_DB=vipe_pos "$TARGET_IMAGE" >/dev/null
docker run -d --name "$minio_c" -p "127.0.0.1:$minio_port:9000" -e MINIO_ROOT_USER="$minio_user" -e MINIO_ROOT_PASSWORD="$minio_password" \
  "$MINIO_IMAGE" server /data >/dev/null
wait_pg "$tgt_c"

step "target: roles.sql and every packages/db migration"
su_exec "$tgt_c" -d postgres -v migrator_password="$password" -v api_password="$password" -v db_name=vipe_pos \
  < "$repo_root/packages/db/scripts/roles.sql"
(cd "$repo_root" && DATABASE_URL="postgres://vipe_migrator:$password@127.0.0.1:$tgt_port/vipe_pos" pnpm --silent db:migrate)

step "MinIO: public-read bucket $bucket"
mc() { docker run --rm --network host -e MC_HOST_local="http://$minio_user:$minio_password@127.0.0.1:$minio_port" --entrypoint /bin/sh "$MC_IMAGE" -c "$1"; }
minio_ready=0
for _ in $(seq 1 30); do if mc 'mc ready local' >/dev/null 2>&1; then minio_ready=1; break; fi; sleep 1; done
[ "$minio_ready" = 1 ] || die "MinIO ($minio_c) did not become ready after 30 tries"
mc "mc mb --ignore-existing local/$bucket >/dev/null && mc anonymous set download local/$bucket >/dev/null"

export TARGET_DATABASE_URL="postgres://postgres:$password@127.0.0.1:$tgt_port/vipe_pos"
export S3_ENDPOINT="http://127.0.0.1:$minio_port" S3_REGION=us-east-1 S3_BUCKET="$bucket" S3_FORCE_PATH_STYLE=true
export S3_ACCESS_KEY_ID="$minio_user" S3_SECRET_ACCESS_KEY="$minio_password"
export S3_PUBLIC_BASE_URL="http://127.0.0.1:$minio_port/$bucket"
exp="$work/export"
tsx="$repo_root/packages/db/node_modules/.bin/tsx"

step "export.sh (read-only snapshot of the source)"
bash "$TOOLKIT_DIR/export.sh" "$exp"
log "source row counts:"
column -t -s, "$exp/source-counts.csv" >&2 || cat "$exp/source-counts.csv" >&2

step "copy-storage.ts (retried while copies fail: the script is resumable)"
for attempt in 1 2 3; do
  if "$tsx" "$TOOLKIT_DIR/copy-storage.ts" "$exp"; then break; fi
  [ "$attempt" -lt 3 ] || die "copy-storage.ts still has failed copies after 3 runs; see the lines above"
  log "copy-storage.ts attempt $attempt had failed copies, retrying"
done
log "storage report by status:"
tail -n +2 "$exp/storage-report.csv" | cut -d, -f1 | tr -d '"' | sort | uniq -c >&2 || true

step "import.sh into the empty throwaway target"
bash "$TOOLKIT_DIR/import.sh" "$exp"

step "verify.sh"
bash "$TOOLKIT_DIR/verify.sh"

step "target summary"
su_exec "$tgt_c" -d vipe_pos -c "SELECT r.name AS restaurant,
    (SELECT count(*) FROM public.profiles p WHERE p.restaurant_id = r.id) AS profiles,
    (SELECT count(*) FROM public.dishes d WHERE d.restaurant_id = r.id) AS dishes,
    (SELECT count(*) FROM public.orders o WHERE o.restaurant_id = r.id) AS orders
  FROM public.restaurants r ORDER BY r.name"
