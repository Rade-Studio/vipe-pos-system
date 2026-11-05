#!/usr/bin/env bash
# Automated rehearsal of the Supabase -> plain Postgres cut-over (T14 step 6).
#
#   pnpm db:rehearse-migration
#
# Throwaway containers with unique names and ports (REHEARSAL_PORT_BASE,
# default 55400: source +1, target +2, MinIO +3, fake storage +4, API +5), so
# it runs next to the dev stack:
#   source   postgres:16 restored from fixtures/source-schema.sql + source-data.sql
#   target   postgres:16 + scripts/roles.sql + every packages/db migration
#   minio    the Chainguard MinIO pinned in docker-compose.yml, public-read bucket
#   storage  rehearsal/fake-storage-server.mjs serving the fixture objects at the
#            Supabase public URL layout
# then export.sh -> copy-storage.ts (twice: the second run must copy nothing)
# -> import.sh -> verify.sh -> rehearsal/assertions.sql, an import into the
# non-empty target (must be refused and change nothing), a forced re-import and
# verify again, and finally a login through the built API (apps/api/dist) as a
# migrated bcrypt user, whose hash must become argon2id. Containers, processes
# and the work directory are removed on exit.
set -euo pipefail
TOOL_NAME=rehearsal
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
repo_root="$(cd "$TOOLKIT_DIR/../../.." && pwd)"

# Pinned like docker-compose.yml (MinIO no longer publishes community images).
MINIO_IMAGE="cgr.dev/chainguard/minio@sha256:3c60a2a8c4d33409a9bc7a623a7fcbfb4605adc3d89422d2f53b3f673a6e5597"
MC_IMAGE="cgr.dev/chainguard/minio-client@sha256:39768db4c3fa811bc8f2e2a3e0add8ea391648b1c980de179985e1c353dc1805"
PG_IMAGE="postgres:16"
export PG_CLIENT_IMAGE="${PG_CLIENT_IMAGE:-$PG_IMAGE}"

base="${REHEARSAL_PORT_BASE:-55400}"
src_port=$((base + 1)) tgt_port=$((base + 2)) minio_port=$((base + 3)) storage_port=$((base + 4)) api_port=$((base + 5))
id="$$-$(date +%s)"
src_c="vipe-rehearsal-source-$id" tgt_c="vipe-rehearsal-target-$id" minio_c="vipe-rehearsal-minio-$id"
work="$(mktemp -d)"
pids=()
# The database password carries @, : and / so the rehearsal proves no tool
# leaks it through a URL parser, a log line or a process argument.
hex="$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
password="re@h:ear/sal-$hex"
pw_enc="re%40h%3Aear%2Fsal-$hex"
export POSTGRES_PASSWORD="$password"
minio_user="rehearsal" minio_password="rehearsal-$hex"
failures=()
# Checks after the first import record failures and continue, so one run shows every broken case.
check_failed() { log "FAIL: $*"; failures+=("$*"); }
bucket="vipe-rehearsal"

cleanup() {
  local status=$?
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  docker rm -f "$src_c" "$tgt_c" "$minio_c" >/dev/null 2>&1 || true
  rm -rf "$work"
  if [ "$status" -eq 0 ]; then log "PASS"; else log "FAIL (exit $status)"; fi
  exit "$status"
}
trap cleanup EXIT
exec > >(tee "$work/rehearsal.log") 2>&1
export PG_TOOL_TRACE="$work/pg-tool-argv.log"
trap 'exit 130' INT TERM

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

step "starting source ($src_c :$src_port), target ($tgt_c :$tgt_port), MinIO ($minio_c :$minio_port)"
docker run -d --name "$src_c" -p "127.0.0.1:$src_port:5432" -e POSTGRES_PASSWORD "$PG_IMAGE" >/dev/null
docker run -d --name "$tgt_c" -p "127.0.0.1:$tgt_port:5432" -e POSTGRES_PASSWORD -e POSTGRES_DB=vipe_pos "$PG_IMAGE" >/dev/null
docker run -d --name "$minio_c" -p "127.0.0.1:$minio_port:9000" -e MINIO_ROOT_USER="$minio_user" -e MINIO_ROOT_PASSWORD="$minio_password" \
  "$MINIO_IMAGE" server /data >/dev/null
wait_pg "$src_c"
wait_pg "$tgt_c"

step "source: restoring fixtures/source-schema.sql and source-data.sql"
su_exec "$src_c" -d postgres < "$TOOLKIT_DIR/fixtures/source-schema.sql" >/dev/null
su_exec "$src_c" -d postgres < "$TOOLKIT_DIR/fixtures/source-data.sql"

step "target: roles.sql and every packages/db migration"
su_exec "$tgt_c" -d postgres -v migrator_password="$password" -v api_password="$password" -v db_name=vipe_pos \
  < "$repo_root/packages/db/scripts/roles.sql"
(cd "$repo_root" && DATABASE_URL="postgres://vipe_migrator:$pw_enc@127.0.0.1:$tgt_port/vipe_pos" pnpm --silent db:migrate)

step "MinIO: public-read bucket $bucket"
mc() { docker run --rm --network host -e MC_HOST_local="http://$minio_user:$minio_password@127.0.0.1:$minio_port" --entrypoint /bin/sh "$MC_IMAGE" -c "$1"; }
for _ in $(seq 1 30); do mc 'mc ready local' >/dev/null 2>&1 && break; sleep 1; done
mc "mc mb --ignore-existing local/$bucket >/dev/null && mc anonymous set download local/$bucket >/dev/null"

step "fake Supabase Storage on :$storage_port"
mkdir -p "$work/storage/dishes/menu"
for name in burger.png pizza.jpg "menu/sopa del dia.webp" orphan.png logo.svg; do
  printf 'fake image bytes for %s\n' "$name" > "$work/storage/dishes/$name"
done
node "$TOOLKIT_DIR/rehearsal/fake-storage-server.mjs" "$work/storage" "$storage_port" &
pids+=($!)
for _ in $(seq 1 30); do curl -sf -o /dev/null "http://127.0.0.1:$storage_port/storage/v1/object/public/dishes/burger.png" && break; sleep 0.2; done

export SUPABASE_DB_URL="postgres://postgres:$pw_enc@127.0.0.1:$src_port/postgres"
export TARGET_DATABASE_URL="postgres://postgres:$pw_enc@127.0.0.1:$tgt_port/vipe_pos"
export SUPABASE_PUBLIC_STORAGE_URL="http://127.0.0.1:$storage_port/storage/v1/object/public"
export S3_ENDPOINT="http://127.0.0.1:$minio_port" S3_REGION=us-east-1 S3_BUCKET="$bucket" S3_FORCE_PATH_STYLE=true
export S3_ACCESS_KEY_ID="$minio_user" S3_SECRET_ACCESS_KEY="$minio_password"
export S3_PUBLIC_BASE_URL="http://127.0.0.1:$minio_port/$bucket"
exp="$work/export"
tsx="$repo_root/packages/db/node_modules/.bin/tsx"

step "export.sh"
bash "$TOOLKIT_DIR/export.sh" "$exp"

step "copy-storage.ts (first run copies, second run must skip everything)"
"$tsx" "$TOOLKIT_DIR/copy-storage.ts" "$exp"
second="$("$tsx" "$TOOLKIT_DIR/copy-storage.ts" "$exp" 2>&1 | tail -1)"
echo "$second" >&2
case "$second" in *"copied 0, already present 4, failed 0"*) ;; *) die "copy-storage.ts is not resumable: $second" ;; esac

step "import.sh into the empty target"
bash "$TOOLKIT_DIR/import.sh" "$exp"

step "verify.sh"
bash "$TOOLKIT_DIR/verify.sh"

step "rehearsal/assertions.sql (fixture cases)"
su_exec "$tgt_c" -d vipe_pos -v s3_public_base_url="$S3_PUBLIC_BASE_URL" < "$TOOLKIT_DIR/rehearsal/assertions.sql" \
  || check_failed "rehearsal/assertions.sql"

step "copied objects are publicly readable"
curl -sf -o /dev/null "$(su_exec "$tgt_c" -d vipe_pos -At -c "SELECT image_url FROM public.dishes WHERE id = 'cd000000-0000-4000-8000-000000000001'")" \
  || die "copied image is not publicly readable"

step "import.sh into the non-empty target must be refused and change nothing"
before="$(su_exec "$tgt_c" -d vipe_pos -At -c "SELECT count(*) || '/' || (SELECT count(*) FROM public.orders) || '/' || (SELECT max(updated_at) FROM public.users) FROM public.users")"
set +e
bash "$TOOLKIT_DIR/import.sh" "$exp" 2>"$work/refused.log"
refused=$?
set -e
cat "$work/refused.log" >&2
after="$(su_exec "$tgt_c" -d vipe_pos -At -c "SELECT count(*) || '/' || (SELECT count(*) FROM public.orders) || '/' || (SELECT max(updated_at) FROM public.users) FROM public.users")"
[ "$refused" -eq 3 ] || check_failed "expected exit 3 from the refused import, got $refused"
grep -q 'target is not empty: public.restaurants has 2 rows' "$work/refused.log" || check_failed "refusal message missing"
[ "$before" = "$after" ] || check_failed "refused import changed the target ($before -> $after)"

step "import.sh must refuse an export whose storage copy has failed rows, even with --force-empty-target"
cp -r "$exp" "$work/export-failed"
printf '"failed","b0000000-0000-4000-8000-000000000001","pizza.jpg","source answered HTTP 500","https://abcdefghijklmnop.supabase.co/storage/v1/object/public/dishes/pizza.jpg"\n' >> "$work/export-failed/storage-report.csv"
set +e
bash "$TOOLKIT_DIR/import.sh" "$work/export-failed" --force-empty-target 2>"$work/failed-copy.log" >/dev/null
refused=$?
set -e
cat "$work/failed-copy.log" >&2
after="$(su_exec "$tgt_c" -d vipe_pos -At -c "SELECT count(*) || '/' || (SELECT count(*) FROM public.orders) || '/' || (SELECT max(updated_at) FROM public.users) FROM public.users")"
[ "$refused" -eq 4 ] || check_failed "expected exit 4 for an export with failed copies, got $refused"
grep -q 'storage-report.csv has 1 failed copies' "$work/failed-copy.log" || check_failed "failed-copy refusal message missing"
[ "$before" = "$after" ] || check_failed "failed-copy import changed the target ($before -> $after)"

step "import.sh --force-empty-target re-imports, verify.sh again"
bash "$TOOLKIT_DIR/import.sh" "$exp" --force-empty-target >/dev/null
bash "$TOOLKIT_DIR/verify.sh" >/dev/null

step "login through the built API as a migrated bcrypt user"
if [ ! -f "$repo_root/apps/api/dist/main.js" ]; then (cd "$repo_root" && pnpm --silent api:build); fi
PORT="$api_port" DATABASE_URL="postgres://vipe_api:$pw_enc@127.0.0.1:$tgt_port/vipe_pos" WEB_ORIGIN="http://localhost:3000" \
  JWT_SECRET="jwt-$hex-$hex-$hex" COOKIE_SECURE=false node "$repo_root/apps/api/dist/main.js" >"$work/api.log" 2>&1 &
pids+=($!)
for _ in $(seq 1 60); do curl -sf -o /dev/null "http://127.0.0.1:$api_port/api/health" && break; sleep 0.5; done
curl -sf -o /dev/null "http://127.0.0.1:$api_port/api/health" || { cat "$work/api.log" >&2; die "API did not start"; }
login() {
  curl -s -o "$work/login.json" -w '%{http_code}' -H 'content-type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"vipe-rehearsal-2026\"}" "http://127.0.0.1:$api_port/api/auth/login"
}
algo() { su_exec "$tgt_c" -d vipe_pos -At -c "SELECT password_algo || ' ' || left(password_hash, 10) FROM public.users WHERE email = '$1'"; }
[ "$(algo admin.a@example.test)" = 'bcrypt $2a$10$QtV' ] || die "admin.a should still hold the imported bcrypt hash before login"
code="$(login admin.a@example.test)"
[ "$code" = 200 ] || { cat "$work/login.json" >&2; die "login as admin.a returned $code"; }
grep -q '"restaurantId":"a0000000-0000-4000-8000-000000000001"' "$work/login.json" || die "login body lacks the migrated profile"
[ "$(algo admin.a@example.test)" = 'argon2id $argon2id$' ] || die "hash was not re-hashed to argon2id: $(algo admin.a@example.test)"
code="$(login admin.a@example.test)"
[ "$code" = 200 ] || die "second login (argon2id) returned $code"
for email in cocina.b@example.test invitado.a@example.test vetado.a@example.test borrado.b@example.test; do
  code="$(login "$email")"
  [ "$code" = 401 ] || check_failed "login as $email should be refused with 401, got $code"
done
log "login: admin.a 200 and re-hashed to argon2id; no-password, banned and deleted users 401"

step "an admin sets a password for a no-password user, who can then log in"
login admin.b@example.test >/dev/null
curl -s -o /dev/null -c "$work/admin-b.cookies" -H 'content-type: application/json' \
  -d '{"email":"admin.b@example.test","password":"vipe-rehearsal-2026"}' "http://127.0.0.1:$api_port/api/auth/login"
code="$(curl -s -o "$work/set-password.json" -w '%{http_code}' -b "$work/admin-b.cookies" -H 'content-type: application/json' \
  -d '{"password":"cocina-nueva-2026"}' "http://127.0.0.1:$api_port/api/staff/c2000000-0000-4000-8000-000000000005/password")"
[ "$code" = 204 ] || { cat "$work/set-password.json" >&2; check_failed "admin.b setting cocina.b's password returned $code"; }
code="$(curl -s -o "$work/login.json" -w '%{http_code}' -H 'content-type: application/json' \
  -d '{"email":"cocina.b@example.test","password":"cocina-nueva-2026"}' "http://127.0.0.1:$api_port/api/auth/login")"
[ "$code" = 200 ] || check_failed "cocina.b login with the password set by the admin returned $code (expected 200)"

step "no credential in a log line or a process argument"
leak="$(bash -c 'source "$1"; redact_url "postgres://u:pa@ss:w/rd@db.example:5433/vipe?sslmode=require"' _ "$TOOLKIT_DIR/lib.sh" 2>&1 || true)"
[ "$leak" = "db.example:5433/vipe" ] || check_failed "redact_url with a raw @ in the password printed: $leak"
leak="$(bash -c 'source "$1"; redact_url "host=db.example password=s3cr3t-kv"' _ "$TOOLKIT_DIR/lib.sh" 2>&1 || true)"
case "$leak" in *s3cr3t-kv*) check_failed "redact_url echoed a key=value connection string: $leak" ;; esac
sleep 1
for secret in "$password" "$pw_enc"; do
  grep -qF -- "$secret" "$work/rehearsal.log" && check_failed "a database credential appears in the rehearsal log"
  grep -qF -- "$secret" "$PG_TOOL_TRACE" && check_failed "a database credential appears in a client command line"
done
[ -s "$PG_TOOL_TRACE" ] || check_failed "no client command line was traced"

if [ "${#failures[@]}" -gt 0 ]; then die "${#failures[@]} failed checks: ${failures[*]}"; fi
