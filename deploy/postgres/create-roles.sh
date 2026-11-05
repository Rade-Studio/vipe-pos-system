#!/usr/bin/env bash
# Creates or updates vipe_migrator and vipe_api on a standalone PostgreSQL
# (a Coolify database resource, docker-compose.coolify.yml) and hands its
# database to vipe_migrator: packages/db/scripts/roles.sql, which is
# idempotent, so a second run only resets the passwords and settings.
#
#   VIPE_MIGRATOR_PASSWORD=... VIPE_API_PASSWORD=... \
#     create-roles.sh --container <name>
#
# psql runs in the container with `docker exec`, as its own POSTGRES_USER on
# its own POSTGRES_DB (the container's env, like 10-roles.sh). roles.sql is
# piped from this repository, so the container does not need it.
#
# The passwords never reach a command line: they go to psql on stdin, as
# \set lines ahead of roles.sql.
#
# Exit codes: 0 roles in place, 1 docker or psql failure, 2 invalid usage or
# a missing password.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
roles_sql="$repo_root/packages/db/scripts/roles.sql"

die() {
  echo "error: $1" >&2
  exit "${2:-1}"
}

usage() {
  sed -n '7,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

container=
while (($#)); do
  case "$1" in
    --container) [[ $# -ge 2 ]] || usage; container="$2"; shift 2 ;;
    -h | --help) usage ;;
    *) echo "error: unknown argument $1" >&2; usage ;;
  esac
done
[[ -n "$container" ]] || usage
[[ -n "${VIPE_MIGRATOR_PASSWORD:-}" ]] || die "VIPE_MIGRATOR_PASSWORD is required" 2
[[ -n "${VIPE_API_PASSWORD:-}" ]] || die "VIPE_API_PASSWORD is required" 2
for value in "$VIPE_MIGRATOR_PASSWORD" "$VIPE_API_PASSWORD"; do
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || die "the passwords must be on one line" 2
done

# A value for a psql `\set name '<value>'` line: backslashes and single quotes
# escaped (the same quoting as packages/db/seed/bootstrap/target.sh).
psql_quote() {
  local value="${1//\\/\\\\}"
  printf "'%s'" "${value//\'/\'\'}"
}

command -v docker >/dev/null || die "docker is required"
docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null | grep -qx true \
  || die "no running container named '$container'"

{
  printf '\\set migrator_password %s\n' "$(psql_quote "$VIPE_MIGRATOR_PASSWORD")"
  printf '\\set api_password %s\n' "$(psql_quote "$VIPE_API_PASSWORD")"
  cat "$roles_sql"
} | docker exec -i "$container" sh -c \
  'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v db_name="$POSTGRES_DB"' \
  || die "roles.sql failed in '$container' (see the psql error above)"

echo "roles vipe_migrator and vipe_api ready in '$container'"
