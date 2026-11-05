#!/usr/bin/env bash
# Regenerate fixtures/source-schema.sql: the schema of a Supabase project built
# from supabase/migrations, restorable on plain postgres:16.
#
#   bash packages/db/migration-from-supabase/scripts/build-source-schema.sh
#
# supabase/ was removed from the tree in T13; the migrations are read from git
# history at VIPE_SOURCE_COMMIT. The default is b1038706 (PR #94), which is
# on origin/dev and has a supabase/migrations tree identical to the last
# commit before the removal, so it survives a squashed or rebased feature PR. VIPE_SOURCE_SCHEMA_OUT writes the dump elsewhere, for comparing it
# with the committed fixture.
#
# Design: odd/tasks/migracion-backend-nestjs.md, "Design: T14 data migration
# toolkit", step 1. Same approach as the T4 baseline: a scratch
# supabase/postgres container (pinned tag below), a fresh database with the
# Supabase pieces the migrations call stubbed (auth.users with the columns the
# export reads, auth.uid(), auth.jwt(), auth.role(), storage.buckets,
# storage.objects, the supabase_realtime publication), every migration applied
# as supabase_admin, then a schema-only dump of public, private, auth and
# storage. The dump is post-processed so it restores on postgres:16 without the
# Supabase image (PG17-only settings removed, roles and extensions created by a
# preamble). supabase/migrations is frozen at VIPE_SOURCE_COMMIT.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "$here/../../.." && pwd)"
image="public.ecr.aws/supabase/postgres:17.11.0.002"
container="vipe-t14-source-schema-$$"
out="${VIPE_SOURCE_SCHEMA_OUT:-$here/fixtures/source-schema.sql}"
source_commit="${VIPE_SOURCE_COMMIT:-b1038706489aa0009fd303d2ba56296d2de2741c}"
source_dir="$(mktemp -d)"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$source_dir"
}
trap cleanup EXIT

if ! git -C "$repo_root" cat-file -e "${source_commit}^{tree}" 2>/dev/null; then
  echo "build-source-schema: commit $source_commit not found; run 'git fetch --unshallow' (or fetch origin/dev) or set VIPE_SOURCE_COMMIT" >&2
  exit 2
fi
echo "build-source-schema: extracting supabase/migrations at $source_commit"
git -C "$repo_root" archive "$source_commit" supabase/migrations | tar -x -C "$source_dir"

echo "build-source-schema: starting $image as $container"
docker run -d --name "$container" -e POSTGRES_PASSWORD=postgres "$image" >/dev/null
for _ in $(seq 1 60); do
  # The image restarts Postgres once after its init scripts; wait for a stable server.
  if docker exec "$container" psql -U supabase_admin -d postgres -Atc 'select 1' >/dev/null 2>&1; then
    sleep 3
    docker exec "$container" psql -U supabase_admin -d postgres -Atc 'select 1' >/dev/null 2>&1 && break
  fi
  sleep 1
done

su_psql() { docker exec -i -e PGOPTIONS=-cclient_min_messages=warning "$container" psql -U supabase_admin -v ON_ERROR_STOP=1 -q "$@"; }

echo "build-source-schema: creating database vipe_source with auth/storage stubs"
su_psql -d postgres -c 'CREATE DATABASE vipe_source'
su_psql -d vipe_source < "$here/fixtures/supabase-stubs.sql"

echo "build-source-schema: applying supabase/migrations"
for f in "$source_dir"/supabase/migrations/*.sql; do
  su_psql -d vipe_source < "$f" >/dev/null
done
echo "build-source-schema: applied $(ls "$source_dir"/supabase/migrations/*.sql | wc -l) migrations"

echo "build-source-schema: dumping schema to $out"
{
  cat "$here/fixtures/source-schema.preamble.sql"
  docker exec "$container" pg_dump -U supabase_admin -d vipe_source --schema-only --no-owner --no-privileges \
      --schema=public --schema=private --schema=auth --schema=storage \
    | grep -v -E '^SET transaction_timeout' \
    | grep -v -E '^\\(un)?restrict ' \
    | sed -e '/^CREATE SCHEMA public;$/d' -e '/^COMMENT ON SCHEMA public IS/d'
} > "$out"
echo "build-source-schema: wrote $(wc -l < "$out") lines"
