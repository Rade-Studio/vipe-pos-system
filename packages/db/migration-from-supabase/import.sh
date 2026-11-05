#!/usr/bin/env bash
# Step 3 of the cut-over: load an export into the plain-Postgres target.
#
#   TARGET_DATABASE_URL='postgres://postgres:<password>@<host>:5432/vipe_pos' \
#     bash packages/db/migration-from-supabase/import.sh <export-dir> [--force-empty-target]
#
# The target must have every packages/db migration applied (pnpm db:migrate)
# and TARGET_DATABASE_URL must be a superuser: the load runs with
# session_replication_role = replica so no guard, numbering or pg_notify
# trigger fires. <export-dir> comes from export.sh plus mapping.csv from
# copy-storage.ts.
#
# 0. Refuses an export whose storage-report.csv has a failed copy (exit 4).
# 1. Refuses a target whose public.restaurants has rows, unless
#    --force-empty-target, which deletes every row of the application tables
#    first (inside the import transaction).
# 2. Stages the export in schema import_src (every column as text, as dumped),
#    replacing any previous staging. import_src stays after the import so
#    verify.sql can compare; drop it once the cut-over is accepted.
# 3. Runs import.sql in ONE transaction: any error rolls everything back.
# The report (skipped users, closed registers, image rewrites, counters) is
# printed and saved as <export-dir>/import-report.txt.
# Design: odd/tasks/migracion-backend-nestjs.md, "Design: T14", step 3.
set -euo pipefail
TOOL_NAME=import
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

force=off
args=()
for arg in "$@"; do
  case "$arg" in
    --force-empty-target) force=on ;;
    -*) die "unknown option $arg" ;;
    *) args+=("$arg") ;;
  esac
done
[ "${#args[@]}" -eq 1 ] || die "usage: import.sh <export-dir> [--force-empty-target]"
require_pg_url TARGET_DATABASE_URL
WORK_DIR="$(cd "${args[0]}" && pwd)"
for f in public-data.sql auth-users.csv storage-objects.csv source-counts.csv mapping.csv storage-report.csv; do
  [ -f "$WORK_DIR/$f" ] || die "$WORK_DIR/$f is missing (export.sh writes the data, copy-storage.ts writes mapping.csv and storage-report.csv)"
done
# A failed copy would clear that dish image: refuse before touching anything.
failed_copies="$(grep -c '^"failed",' "$WORK_DIR/storage-report.csv" || true)"
if [ "$failed_copies" != "0" ]; then
  log "ERROR: storage-report.csv has $failed_copies failed copies. Rerun copy-storage.ts until it exits 0 (it resumes). Nothing was changed."
  exit 4
fi

tgt_psql() { pg_tool TARGET_DATABASE_URL psql -X -q -v ON_ERROR_STOP=1 "$@"; }

log "target: $(redact_url "$TARGET_DATABASE_URL")"
state="$(tgt_psql -At -c "SELECT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)::text
  || ',' || (to_regclass('public.users') IS NOT NULL AND to_regclass('private.migration_0009_closed_registers') IS NOT NULL AND to_regclass('public.print_jobs') IS NOT NULL)::text
  || ',' || CASE WHEN to_regclass('public.restaurants') IS NULL THEN '0' ELSE (SELECT count(*) FROM public.restaurants)::text END")"
IFS=, read -r is_super migrated restaurants <<<"$state"
[ "$is_super" = "true" ] || die "TARGET_DATABASE_URL must connect as a superuser (session_replication_role needs it)"
[ "$migrated" = "true" ] || die "target is missing packages/db migrations; run pnpm db:migrate against it first"
if [ "$restaurants" != "0" ] && [ "$force" != "on" ]; then
  log "ERROR: target is not empty: public.restaurants has $restaurants rows."
  log "Rerun with --force-empty-target to delete every application row first. Nothing was changed."
  exit 3
fi
[ "$restaurants" = "0" ] || log "--force-empty-target: the $restaurants restaurants and every application row will be deleted in the import transaction"

log "staging the export in schema import_src"
staging="$WORK_DIR/staging.sql"
{
  echo 'SET client_min_messages = warning;'
  echo 'DROP SCHEMA IF EXISTS import_src CASCADE;'
  echo 'CREATE SCHEMA import_src;'
  echo 'REVOKE ALL ON SCHEMA import_src FROM PUBLIC;'
  # One text column per dumped column, in dump order, from each COPY header.
  awk '/^COPY (public|private)\.[^ ]+ \(.*\) FROM stdin;$/ {
         name = $2; sub(/^(public|private)\./, "", name)
         cols = $0; sub(/^COPY [^(]*\(/, "", cols); sub(/\) FROM stdin;$/, "", cols)
         n = split(cols, parts, /, /); ddl = ""
         for (i = 1; i <= n; i++) ddl = ddl (i > 1 ? ", " : "") parts[i] " text"
         printf "CREATE TABLE import_src.%s (%s);\n", name, ddl
       }' "$WORK_DIR/public-data.sql"
  # The dump itself, retargeted at import_src. Only COPY headers outside a
  # data block are rewritten; client-only and version-specific lines dropped.
  awk 'incopy { print; if ($0 == "\\.") incopy = 0; next }
       /^COPY (public|private)\.[^ ]+ \(.*\) FROM stdin;$/ { sub(/^COPY (public|private)\./, "COPY import_src."); print; incopy = 1; next }
       /^\\(un)?restrict / { next }
       /^SET transaction_timeout/ { next }
       /^SELECT pg_catalog\.(setval|set_config)\(/ { next }
       { print }' "$WORK_DIR/public-data.sql"
  cat <<SQL
CREATE TABLE import_src._auth_users (id text, email text, encrypted_password text, created_at text, deleted_at text, banned_until text);
\\copy import_src._auth_users FROM '$WORK_DIR/auth-users.csv' WITH (FORMAT csv, HEADER)
CREATE TABLE import_src._storage_objects (bucket_id text, name text, size text, mimetype text);
\\copy import_src._storage_objects FROM '$WORK_DIR/storage-objects.csv' WITH (FORMAT csv, HEADER)
CREATE TABLE import_src._mapping (old_url text, new_url text, key text, restaurant_id text);
\\copy import_src._mapping FROM '$WORK_DIR/mapping.csv' WITH (FORMAT csv, HEADER)
CREATE TABLE import_src._storage_report (status text, restaurant_id text, name text, detail text, old_url text);
\\copy import_src._storage_report FROM '$WORK_DIR/storage-report.csv' WITH (FORMAT csv, HEADER)
CREATE TABLE import_src._source_counts (table_name text, row_count text);
\\copy import_src._source_counts FROM '$WORK_DIR/source-counts.csv' WITH (FORMAT csv, HEADER)
-- Registers open in the source, before the 0009 survivor rule (verify.sql audit).
CREATE TABLE import_src._open_registers AS
  SELECT id::uuid AS id, restaurant_id::uuid AS restaurant_id FROM import_src.cash_registers WHERE status = 'open';
SQL
} > "$staging"
tgt_psql --single-transaction -f "$staging"
rm -f "$staging"
log "staged $(tgt_psql -At -c "SELECT count(*) FROM pg_class WHERE relnamespace = 'import_src'::regnamespace AND relkind = 'r'") tables"

log "importing in one transaction (session_replication_role = replica)"
tgt_psql --single-transaction -v force_empty_target="$force" -f "$TOOLKIT_DIR/import.sql" | tee "$WORK_DIR/import-report.txt"
refused_types="$(grep -c '^"refused_type",' "$WORK_DIR/storage-report.csv" || true)"
[ "$refused_types" = "0" ] || log "WARNING: $refused_types dish images were refused (SVG or not an image) and cleared; see image_refused_type at the top of the report"
log "done; report saved to $WORK_DIR/import-report.txt. Next: verify.sh"
