# Shared by seed/bootstrap/create-restaurant.sh and seed/demo/demo-db.sh.
# Source it; it defines functions only.
#
# Two targets:
#   local    the dev stack of docker-compose.yml: psql in the `db` service as
#            postgres, node from apps/api (its `argon2` dependency). The
#            database is $TARGET_DB on that server; target_prepare creates it
#            when missing, aligns the roles and applies the migrations, the
#            same steps as seed/dev-db.sh.
#   coolify  the Coolify Docker Compose app on the server: psql in its
#            `postgres` container (POSTGRES_USER / POSTGRES_DB of that
#            container) and node in its `api` container, both through
#            `docker exec`. Containers are found by compose service name plus
#            the Coolify app uuid ($VIPE_COOLIFY_APP_UUID). Migrations are the
#            `migrate` service's job there, so target_prepare only checks
#            that the schema exists.
#
# Secrets never reach a command line: passwords go to node on stdin, hashes
# and values go to psql on stdin (as \set lines ahead of the script).

VIPE_COOLIFY_APP_UUID="${VIPE_COOLIFY_APP_UUID:-zyxpf2vqnowxdolrgne8vxew}"

target_repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"

# Reads the password from stdin and prints its argon2id hash, in the format
# apps/api/src/auth/passwords.service.ts verifies.
target_hash_js='let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",(c)=>{s+=c}).on("end",()=>{const a=require("argon2");a.hash(s,{type:a.argon2id}).then((h)=>process.stdout.write(h+"\n"),(e)=>{console.error(e.message);process.exit(1)})})'

target_die() {
  echo "error: $1" >&2
  exit "${2:-1}"
}

# Exactly one running container of compose service $1 in the Coolify app.
target_find_container() {
  local service="$1" names
  # Coolify names compose containers <service>-<app uuid>-<timestamp>, for
  # example postgres-zyxpf2vqnowxdolrgne8vxew-20261105T031048.
  names="$(docker ps --format '{{.Names}}' | grep -E "^${service}-${VIPE_COOLIFY_APP_UUID}(-|$)" || true)"
  if [[ -z "$names" ]]; then
    target_die "no running '${service}' container for Coolify app ${VIPE_COOLIFY_APP_UUID}"
  fi
  if [[ "$(printf '%s\n' "$names" | wc -l)" -ne 1 ]]; then
    target_die "more than one '${service}' container for Coolify app ${VIPE_COOLIFY_APP_UUID}: $(echo $names)"
  fi
  printf '%s\n' "$names"
}

# target_init <local|coolify>
target_init() {
  TARGET="$1"
  case "$TARGET" in
    local)
      : "${TARGET_DB:?TARGET_DB must be set for the local target}"
      [[ "$TARGET_DB" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || target_die "invalid database name '$TARGET_DB'" 2
      ;;
    coolify)
      command -v docker >/dev/null || target_die "docker is required for the coolify target"
      TARGET_PG_CONTAINER="$(target_find_container postgres)"
      TARGET_API_CONTAINER="$(target_find_container api)"
      ;;
    *)
      target_die "unknown target '$TARGET' (expected local or coolify)" 2
      ;;
  esac
}

# Superuser psql on the target database; the script comes on stdin.
target_psql() {
  case "$TARGET" in
    local)
      (cd "$target_repo_root" && docker compose exec -T db \
        psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$TARGET_DB" "$@")
      ;;
    coolify)
      docker exec -i "$TARGET_PG_CONTAINER" sh -c \
        'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' psql "$@"
      ;;
  esac
}

# Password on stdin, argon2id hash on stdout.
target_hash() {
  local hash
  case "$TARGET" in
    local) hash="$(cd "$target_repo_root/apps/api" && node -e "$target_hash_js")" ;;
    coolify) hash="$(docker exec -i "$TARGET_API_CONTAINER" node -e "$target_hash_js")" ;;
  esac
  [[ "$hash" == '$argon2id$'* ]] || target_die "could not hash the password with argon2id"
  printf '%s\n' "$hash"
}

# Local: database, roles and migrations in place (idempotent). Coolify: the
# migrate service has run.
target_prepare() {
  case "$TARGET" in
    local)
      local port="${VIPE_DB_PORT:-5432}"
      local migrator_password="${VIPE_MIGRATOR_PASSWORD:-vipe_migrator}"
      local api_password="${VIPE_API_PASSWORD:-vipe_api}"
      (
        cd "$target_repo_root"
        docker compose up -d --wait db >/dev/null 2>&1 || target_die "the dev stack's db service did not start (docker compose up -d --wait db)"
        docker compose exec -T db psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -At \
          -c "SELECT 1 FROM pg_database WHERE datname = '${TARGET_DB}'" | grep -q 1 \
          || docker compose exec -T db psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
               -c "CREATE DATABASE \"${TARGET_DB}\""
        docker compose exec -T db psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
          -v migrator_password="$migrator_password" \
          -v api_password="$api_password" \
          -v db_name="$TARGET_DB" \
          -f /opt/vipe/scripts/roles.sql
        DATABASE_URL="postgres://vipe_migrator:${migrator_password}@localhost:${port}/${TARGET_DB}" \
          pnpm --silent db:migrate >/dev/null
      )
      ;;
    coolify)
      [[ "$(target_psql -At -c "SELECT to_regclass('public.restaurants') IS NOT NULL")" == t ]] \
        || target_die "the schema is missing: the migrate service has not run on this stack"
      ;;
  esac
}

# A value for a psql `\set name '<value>'` line: backslashes and single quotes
# escaped. Callers reject newlines first.
target_psql_quote() {
  local value="${1//\\/\\\\}"
  printf "'%s'" "${value//\'/\'\'}"
}
