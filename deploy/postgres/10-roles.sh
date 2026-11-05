#!/bin/sh
# Docker init hook for the production postgres service: runs once, on an empty
# data directory. Creates vipe_migrator and vipe_api (packages/db/scripts/roles.sql,
# mounted at /opt/vipe/roles.sql by docker-compose.prod.yml, or baked into the
# Coolify image by deploy/postgres/Dockerfile) and hands the database to vipe_migrator.
# No default passwords: the compose file requires both variables.
set -eu

: "${VIPE_MIGRATOR_PASSWORD:?VIPE_MIGRATOR_PASSWORD is required}"
: "${VIPE_API_PASSWORD:?VIPE_API_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v migrator_password="$VIPE_MIGRATOR_PASSWORD" \
  -v api_password="$VIPE_API_PASSWORD" \
  -v db_name="$POSTGRES_DB" \
  -f /opt/vipe/roles.sql
