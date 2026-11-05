#!/usr/bin/env bash
# Docker init hook: create the application roles and hand the database to the
# migration owner. Passwords come from the container environment and default
# to the role name for local development.
set -euo pipefail

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v migrator_password="${VIPE_MIGRATOR_PASSWORD:-vipe_migrator}" \
  -v api_password="${VIPE_API_PASSWORD:-vipe_api}" \
  -v db_name="$POSTGRES_DB" \
  -f /opt/vipe/roles.sql
