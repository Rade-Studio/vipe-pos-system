#!/usr/bin/env bash
# Regenerate fixtures/source-schema.sql: the schema of a Supabase project built
# from supabase/migrations, restorable on plain postgres:16.
#
#   bash packages/db/migration-from-supabase/scripts/build-source-schema.sh
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
# preamble). Only needed again if supabase/migrations changes, which stops at T13.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "$here/../../.." && pwd)"
image="public.ecr.aws/supabase/postgres:17.11.0.002"
container="vipe-t14-source-schema-$$"
out="$here/fixtures/source-schema.sql"

cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT

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
for f in "$repo_root"/supabase/migrations/*.sql; do
  su_psql -d vipe_source < "$f" >/dev/null
done
echo "build-source-schema: applied $(ls "$repo_root"/supabase/migrations/*.sql | wc -l) migrations"

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
