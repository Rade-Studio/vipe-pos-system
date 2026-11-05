#!/usr/bin/env bash
# Step 2 of the cut-over: read-only export of a Supabase project.
#
#   SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
#     bash packages/db/migration-from-supabase/export.sh <export-dir>
#
# Writes into <export-dir> (created, must be empty):
#   public-data.sql      pg_dump --data-only of every public table and
#                        private.inventory_counters (when present)
#   auth-users.csv       auth.users (id, email, encrypted_password, created_at,
#                        deleted_at, banned_until)
#   storage-objects.csv  storage.objects of bucket `dishes` (bucket_id, name, size, mimetype)
#   dish-images.csv      dishes (id, restaurant_id, image_url) with an image_url, for copy-storage.ts
#   source-counts.csv    row count per exported table, checked again by verify.sql
#
# Consistent: every file comes from one exported snapshot (pg_export_snapshot
# held by one session, pg_dump --snapshot, SET TRANSACTION SNAPSHOT).
# Read-only: every session runs with default_transaction_read_only=on, nothing is
# written to the source, the auth and storage schemas are never restored
# anywhere. auth-users.csv holds password hashes: keep the directory private
# and delete it after the cut-over. Design: odd/tasks/migracion-backend-nestjs.md,
# "Design: T14 data migration toolkit", step 2.
set -euo pipefail
TOOL_NAME=export
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[ "$#" -eq 1 ] || die "usage: export.sh <export-dir>"
require_pg_url SUPABASE_DB_URL
mkdir -p "$1"
WORK_DIR="$(cd "$1" && pwd)"
[ -z "$(ls -A "$WORK_DIR")" ] || die "$WORK_DIR is not empty; use a new directory per export"
chmod 700 "$WORK_DIR"
export PGOPTIONS="-c default_transaction_read_only=on"

log "source: $(redact_url "$SUPABASE_DB_URL") (read-only sessions)"
src_psql() { pg_tool SUPABASE_DB_URL psql -X -q -v ON_ERROR_STOP=1 "$@"; }

# One consistent snapshot for every file: a holder session exports it and
# stays open; pg_dump --snapshot and the CSV session attach to it. Needs a
# session connection (direct or session pooler on :5432), not the transaction
# pooler on :6543.
fifo_dir="$(mktemp -d)"
mkfifo "$fifo_dir/in"
holder_pid=""
release_snapshot() {
  if [ -n "$holder_pid" ]; then
    { echo 'COMMIT;' >&3; exec 3>&-; } 2>/dev/null || true
    wait "$holder_pid" 2>/dev/null || true
    holder_pid=""
  fi
  rm -rf "$fifo_dir"
}
trap release_snapshot EXIT
src_psql -At < "$fifo_dir/in" > "$fifo_dir/out" &
holder_pid=$!
exec 3>"$fifo_dir/in"
echo "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();" >&3
snapshot=""
for _ in $(seq 1 150); do
  snapshot="$(grep -m1 -E '^[0-9A-F]+-[0-9A-F]+(-[0-9]+)?$' "$fifo_dir/out" 2>/dev/null || true)"
  [ -n "$snapshot" ] && break
  kill -0 "$holder_pid" 2>/dev/null || die "could not open the snapshot session"
  sleep 0.2
done
[ -n "$snapshot" ] || die "timed out waiting for pg_export_snapshot()"
log "snapshot $snapshot held for the whole export"

has_counters="$(src_psql -At -c "SELECT to_regclass('private.inventory_counters') IS NOT NULL")"
tables=(--table='public.*')
if [ "$has_counters" = "t" ]; then tables+=(--table=private.inventory_counters); fi

log "dumping public data$([ "$has_counters" = t ] && echo ' and private.inventory_counters') to public-data.sql"
pg_tool SUPABASE_DB_URL pg_dump --data-only --no-owner --no-privileges --snapshot="$snapshot" "${tables[@]}" \
  --file="$WORK_DIR/public-data.sql"

# Row counts in one statement (the table list is catalog data, stable during the freeze).
count_sql="$(src_psql -At -c "SELECT string_agg(format('SELECT %L AS table_name, count(*) AS row_count FROM %s', c.relname, c.oid::regclass), ' UNION ALL ' ORDER BY c.relname)
  FROM pg_class c
 WHERE c.relkind IN ('r', 'p')
   AND (c.relnamespace = 'public'::regnamespace OR c.oid = to_regclass('private.inventory_counters'))")"

log "copying auth.users, storage.objects (bucket dishes), dish images and row counts from the same snapshot"
src_psql <<SQL
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET TRANSACTION SNAPSHOT '$snapshot';
\copy (SELECT id, email, encrypted_password, created_at, deleted_at, banned_until FROM auth.users ORDER BY id) TO '$WORK_DIR/auth-users.csv' WITH (FORMAT csv, HEADER)
\copy (SELECT bucket_id, name, metadata->>'size' AS size, metadata->>'mimetype' AS mimetype FROM storage.objects WHERE bucket_id = 'dishes' ORDER BY name) TO '$WORK_DIR/storage-objects.csv' WITH (FORMAT csv, HEADER)
\copy (SELECT id, restaurant_id, image_url FROM public.dishes WHERE coalesce(image_url, '') <> '' ORDER BY id) TO '$WORK_DIR/dish-images.csv' WITH (FORMAT csv, HEADER)
\copy ($count_sql) TO '$WORK_DIR/source-counts.csv' WITH (FORMAT csv, HEADER)
COMMIT;
SQL
release_snapshot

log "users: $(($(wc -l < "$WORK_DIR/auth-users.csv") - 1)), dish objects: $(($(wc -l < "$WORK_DIR/storage-objects.csv") - 1)), dishes with image: $(($(wc -l < "$WORK_DIR/dish-images.csv") - 1)), tables: $(($(wc -l < "$WORK_DIR/source-counts.csv") - 1))"
log "done: $WORK_DIR (contains password hashes; keep it private)"
