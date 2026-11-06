#!/usr/bin/env bash
# Regression test for rehearse-real.sh (not in CI; needs Docker).
#
#   pnpm db:test-rehearse-real
#
# Builds a "real" source from the fixtures (postgres:16 restored from
# fixtures/source-schema.sql + source-data.sql, a password with @ : /, and
# rehearsal/fake-storage-server.mjs serving the fixture objects), then checks:
#   (a) TARGET_DATABASE_URL and a non-pooler user without SUPABASE_PUBLIC_STORAGE_URL are refused
#   (b) a full run passes, keeps a log without the password, leaves no container or export directory
#   (c) no command run by the script (PATH shims) gets the password as an argument
#   (d) Ctrl-C to the process group during import.sh exits 130 and leaves no export or container
#   (d2) SIGTERM to the process group during import.sh: same as (d)
#   (e) hostile inherited S3_*, DATABASE_URL and PG* variables do not change the result
# REHEARSAL_PORT_BASE default 55600 (source +1, script target +2 and MinIO +3, storage +4).
set -euo pipefail
TOOL_NAME=rehearse-real-test
source "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"
script="$TOOLKIT_DIR/rehearse-real.sh"

PG_IMAGE="postgres:16"
base="${REHEARSAL_PORT_BASE:-55600}"
src_port=$((base + 1)) storage_port=$((base + 4))
id="$$-$(date +%s)"
src_c="vipe-rrtest-source-$id"
scratch="$(mktemp -d)"
pids=()
hex="$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
password="re@h:ear/sal-$hex"
pw_enc="re%40h%3Aear%2Fsal-$hex"
passed=0
failures=()
ok() { log "ok: $*"; passed=$((passed + 1)); }
check_failed() { log "FAIL: $*"; failures+=("$*"); }

cleanup() {
  local status=$?
  set +e
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null; done
  docker rm -f "$src_c" >/dev/null 2>&1
  docker ps -aq --filter name=vipe-rehearse-real- | xargs -r docker rm -f >/dev/null 2>&1
  rm -rf "$scratch"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# The password patterns go through a file descriptor, never an argument.
has_secret() { grep -qF -f <(printf '%s\n' "$password" "$pw_enc") "$@"; }
rr_containers() { docker ps -aq --filter name=vipe-rehearse-real- | wc -l; }
# Directories under a run's TMPDIR still holding export files (real hashes in a real run).
leftover_exports() { find "$1" -name auth-users.csv -o -name source-counts.csv 2>/dev/null | wc -l; }

log "starting fixture source ($src_c :$src_port) and fake storage (:$storage_port)"
docker run -d --name "$src_c" -p "127.0.0.1:$src_port:5432" -e POSTGRES_PASSWORD="$password" "$PG_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$src_c" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 \
    && docker exec "$src_c" psql -U postgres -Atc 'select 1' >/dev/null 2>&1 && break
  sleep 1
done
docker exec -i "$src_c" psql -U postgres -X -q -v ON_ERROR_STOP=1 -d postgres < "$TOOLKIT_DIR/fixtures/source-schema.sql" >/dev/null 2>&1
docker exec -i "$src_c" psql -U postgres -X -q -v ON_ERROR_STOP=1 -d postgres < "$TOOLKIT_DIR/fixtures/source-data.sql" >/dev/null
mkdir -p "$scratch/storage/dishes/menu"
for name in burger.png pizza.jpg "menu/sopa del dia.webp" orphan.png logo.svg; do
  printf 'fake image bytes for %s\n' "$name" > "$scratch/storage/dishes/$name"
done
node "$TOOLKIT_DIR/rehearsal/fake-storage-server.mjs" "$scratch/storage" "$storage_port" >/dev/null 2>&1 &
pids+=($!)
for _ in $(seq 1 30); do curl -sf -o /dev/null "http://127.0.0.1:$storage_port/storage/v1/object/public/dishes/burger.png" && break; sleep 0.2; done

src_url="postgres://postgres:$pw_enc@127.0.0.1:$src_port/postgres"
storage_url="http://127.0.0.1:$storage_port/storage/v1/object/public"
# run_script <name> [env assignments...]: runs rehearse-real.sh with its own TMPDIR
# and log path; sets rc, out (combined output) and run_tmp.
run_script() {
  local name="$1"; shift
  run_tmp="$scratch/$name-tmp" out="$scratch/$name.out"
  mkdir -p "$run_tmp"
  set +e
  env "$@" TMPDIR="$run_tmp" REHEARSAL_LOG="$scratch/$name.log" REHEARSAL_PORT_BASE="$base" bash "$script" >"$out" 2>&1
  rc=$?
  set -e
}

log "(a) refusals"
run_script refuse-target SUPABASE_DB_URL="$src_url" SUPABASE_PUBLIC_STORAGE_URL="$storage_url" TARGET_DATABASE_URL="postgres://x:y@127.0.0.1:1/z"
if [ "$rc" -eq 1 ] && grep -q 'TARGET_DATABASE_URL is set; this rehearsal only writes to its own throwaway target' "$out"; then
  ok "TARGET_DATABASE_URL refused"; else check_failed "TARGET_DATABASE_URL: exit $rc, $(tail -1 "$out")"; fi
run_script refuse-ref -u SUPABASE_PUBLIC_STORAGE_URL SUPABASE_DB_URL="$src_url"
if [ "$rc" -eq 1 ] && grep -q 'cannot derive the project ref from the pooler user; set SUPABASE_PUBLIC_STORAGE_URL' "$out"; then
  ok "non-pooler user without SUPABASE_PUBLIC_STORAGE_URL refused"; else check_failed "no storage URL: exit $rc, $(tail -1 "$out")"; fi

log "(b)+(c) full run with argv-logging PATH shims"
shims="$scratch/shims" argv_log="$scratch/argv.log"
mkdir -p "$shims"
: > "$argv_log"
for cmd in grep sed awk cat tee cp mv cut sort uniq tr column head tail od env printf echo xargs find docker curl; do
  real="$(command -v "$cmd")" || continue
  printf '#!/bin/sh\nprintf "%%s\\n" "$*" >> "%s"\nexec "%s" "$@"\n' "$argv_log" "$real" > "$shims/$cmd"
  chmod +x "$shims/$cmd"
done
run_script full PATH="$shims:$PATH" SUPABASE_DB_URL="$src_url" SUPABASE_PUBLIC_STORAGE_URL="$storage_url"
if [ "$rc" -eq 0 ] && grep -q 'verify: all 94 checks passed' "$out" && grep -q 'rehearse-real: PASS' "$out"; then
  ok "full run passes"; else check_failed "full run: exit $rc, $(tail -3 "$out" | tr '\n' ' ')"; fi
if [ -s "$scratch/full.log" ] && ! has_secret "$scratch/full.log"; then
  ok "kept log has no password"; else check_failed "kept log missing or holds the password"; fi
[ "$(rr_containers)" -eq 0 ] && ok "no container left after the full run" || check_failed "containers left after the full run"
[ "$(leftover_exports "$run_tmp")" -eq 0 ] && ok "no export directory left after the full run" || check_failed "export directory left after the full run"
if [ "$(grep -c '' "$argv_log")" -gt 0 ] && ! has_secret "$argv_log"; then
  ok "no shimmed command got the password ($(grep -c '' "$argv_log") calls)"; else check_failed "a command line held the password (or no call was logged)"; fi

log "(d) SIGINT to the process group during import.sh"
set -m
mkdir -p "$scratch/int-tmp"
TMPDIR="$scratch/int-tmp" REHEARSAL_LOG="$scratch/int.log" REHEARSAL_PORT_BASE="$base" \
  SUPABASE_DB_URL="$src_url" SUPABASE_PUBLIC_STORAGE_URL="$storage_url" bash "$script" >"$scratch/int.out" 2>&1 &
int_pid=$!
set +m
for _ in $(seq 1 600); do grep -q -- '---- import.sh' "$scratch/int.out" && break; sleep 0.5; done
kill -INT -- "-$int_pid"
set +e
wait "$int_pid"
rc=$?
set -e
[ "$rc" -eq 130 ] && ok "interrupt exits 130" || check_failed "interrupt exited $rc, expected 130"
[ "$(leftover_exports "$scratch/int-tmp")" -eq 0 ] && ok "no export directory left after the interrupt" || check_failed "export directory (auth-users.csv) left after the interrupt"
[ "$(rr_containers)" -eq 0 ] && ok "no container left after the interrupt" || check_failed "containers left after the interrupt"

# SIGTERM to the group (`kill %1`): bash prints "Terminated" into the dead tee, so
# without an ignored SIGPIPE the shell dies before its trap and cleanup never runs.
log "(d2) SIGTERM to the process group during import.sh"
set -m
mkdir -p "$scratch/term-tmp"
TMPDIR="$scratch/term-tmp" REHEARSAL_LOG="$scratch/term.log" REHEARSAL_PORT_BASE="$base" \
  SUPABASE_DB_URL="$src_url" SUPABASE_PUBLIC_STORAGE_URL="$storage_url" bash "$script" >"$scratch/term.out" 2>&1 &
term_pid=$!
set +m
for _ in $(seq 1 600); do grep -q -- '---- import.sh' "$scratch/term.out" && break; sleep 0.5; done
kill -TERM -- "-$term_pid"
set +e
wait "$term_pid"
rc=$?
set -e
[ "$rc" -eq 130 ] && ok "SIGTERM exits 130" || check_failed "SIGTERM exited $rc, expected 130"
[ "$(leftover_exports "$scratch/term-tmp")" -eq 0 ] && ok "no export directory left after SIGTERM" || check_failed "export directory (auth-users.csv) left after SIGTERM"
[ "$(rr_containers)" -eq 0 ] && ok "no container left after SIGTERM" || check_failed "containers left after SIGTERM"

log "(e) hostile inherited environment"
run_script hostile SUPABASE_DB_URL="$src_url" SUPABASE_PUBLIC_STORAGE_URL="$storage_url" \
  S3_ENDPOINT=http://invalid.invalid:1 S3_BUCKET=hostile S3_ACCESS_KEY_ID=hostile S3_SECRET_ACCESS_KEY=hostile \
  S3_PUBLIC_BASE_URL=http://invalid.invalid:1/hostile DATABASE_URL=postgres://h:h@invalid.invalid:1/h \
  PGHOST=invalid.invalid PGPASSWORD=hostile
if [ "$rc" -eq 0 ] && grep -q 'rehearse-real: PASS' "$out"; then
  ok "hostile environment still passes"; else check_failed "hostile environment: exit $rc, $(tail -3 "$out" | tr '\n' ' ')"; fi
[ "$(rr_containers)" -eq 0 ] || check_failed "containers left after the hostile run"

log "$passed passed, ${#failures[@]} failed"
if [ "${#failures[@]}" -gt 0 ]; then die "${failures[*]}"; fi
