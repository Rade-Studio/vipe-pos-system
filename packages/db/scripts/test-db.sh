#!/usr/bin/env bash
# pgTAP suite on plain Postgres (no Supabase).
#
#   pnpm test:db                                           # every file
#   pnpm test:db packages/db/tests/010_tenant_isolation.test.sql
#
# Steps: start the compose `db` service, recreate the throwaway database
# vipe_pos_test, apply the migrations as vipe_migrator with `pnpm db:migrate`,
# load tests/seed.sql as the superuser, then run the test files through
# pg_prove inside the container. The dev database vipe_pos is never touched.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo_root"

test_db="${VIPE_TEST_DB:-vipe_pos_test}"
db_port="${VIPE_DB_PORT:-5432}"
migrator_password="${VIPE_MIGRATOR_PASSWORD:-vipe_migrator}"
api_password="${VIPE_API_PASSWORD:-vipe_api}"

compose() { docker compose "$@"; }
psql_su() { compose exec -T db psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

compose up -d --build --wait db

# Roles are created by the Docker init on a fresh volume; running the script
# again keeps an older volume in line with scripts/roles.sql.
psql_su -d postgres \
  -v migrator_password="$migrator_password" \
  -v api_password="$api_password" \
  -v db_name=vipe_pos \
  -f /opt/vipe/scripts/roles.sql
psql_su -d postgres \
  -c "DROP DATABASE IF EXISTS ${test_db} WITH (FORCE)" \
  -c "CREATE DATABASE ${test_db} OWNER vipe_migrator"

DATABASE_URL="postgres://vipe_migrator:${migrator_password}@localhost:${db_port}/${test_db}" pnpm --silent db:migrate

psql_su -d "$test_db" -f /opt/vipe/tests/seed.sql

files=()
if [ "$#" -eq 0 ]; then
  for f in packages/db/tests/*.test.sql; do files+=("/opt/vipe/tests/$(basename "$f")"); done
else
  for f in "$@"; do files+=("/opt/vipe/tests/$(basename "$f")"); done
fi

compose exec -T db pg_prove -U postgres -d "$test_db" "${files[@]}"
