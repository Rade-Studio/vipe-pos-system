#!/usr/bin/env bash
# Local plain-Postgres stack for development (no Supabase).
#
#   pnpm db:dev
#
# Starts the compose `db` service, keeps the roles in line with
# scripts/roles.sql, applies every migration to vipe_pos as vipe_migrator and
# loads seed/dev.sql as the superuser. Safe to run again: the migrator skips
# applied migrations and the seed is idempotent.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo_root"

dev_db=vipe_pos
db_port="${VIPE_DB_PORT:-5432}"
migrator_password="${VIPE_MIGRATOR_PASSWORD:-vipe_migrator}"
api_password="${VIPE_API_PASSWORD:-vipe_api}"

# docker-compose.yml interpolates the whole file, and the `app` service
# requires the Supabase build variables. The `db` service does not use them.
export NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-http://unused.invalid}"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-unused}"

compose() { docker compose "$@"; }
psql_su() { compose exec -T db psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

compose up -d --build --wait db

psql_su -d postgres \
  -v migrator_password="$migrator_password" \
  -v api_password="$api_password" \
  -v db_name="$dev_db" \
  -f /opt/vipe/scripts/roles.sql

DATABASE_URL="postgres://vipe_migrator:${migrator_password}@localhost:${db_port}/${dev_db}" pnpm --silent db:migrate

# seed/ is not mounted in the container: stream the file through stdin.
psql_su -d "$dev_db" < packages/db/seed/dev.sql

echo "dev database ready: postgres://vipe_api:${api_password}@localhost:${db_port}/${dev_db} (admin@vipe.local / vipe-dev-2026)"
