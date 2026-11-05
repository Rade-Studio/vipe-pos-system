# Shared by seed/bootstrap/create-restaurant.sh and seed/demo/demo-db.sh.
# Source it; it defines functions only.
#
# Two targets:
#   local    the dev stack of docker-compose.yml: psql in the `db` service as
#            postgres, node from apps/api (its `argon2` dependency). The
#            database is $TARGET_DB on that server; target_prepare creates it
#            when missing, aligns the roles and applies the migrations, the
#            same steps as seed/dev-db.sh.
#   coolify  the Coolify app on the server and its standalone PostgreSQL
#            resource: psql in the database container (POSTGRES_USER /
#            POSTGRES_DB of that container) and node in the app's `api`
#            container, both through `docker exec`. The database container
#            is named exactly after the database resource uuid: --db-uuid or
#            $VIPE_COOLIFY_DB_UUID. The api container is found by compose
#            service name plus the Coolify app uuid: --app-uuid or
#            $VIPE_COOLIFY_APP_UUID. Neither has a default, so a run never
#            lands on another app's database by omission. Either uuid with
#            the local target exits 2.
#            Migrations are the `migrate` service's job there, so
#            target_prepare only checks that the schema exists.
#
# Writes run as vipe_migrator, the schema owner: callers put
# TARGET_OWNER_SQL right after BEGIN. The connecting user differs per target
# (postgres locally, POSTGRES_USER on Coolify), while the database guards
# allow writes past the API rules only to postgres and vipe_migrator by name.
#
# Every psql or docker failure exits 1; only the callers' own checks use 2/3.
#
# Secrets never reach a command line: passwords go to node on stdin, hashes
# and values go to psql on stdin (as \set lines ahead of the script).

# shellcheck disable=SC2034 # used by the scripts that source this file
TARGET_OWNER_SQL='SET LOCAL ROLE vipe_migrator;'

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

# Exactly one running container named $VIPE_COOLIFY_DB_UUID (a standalone
# Coolify database is named after its resource uuid).
target_find_db_container() {
  local names
  names="$(docker ps --filter "name=^${VIPE_COOLIFY_DB_UUID}\$" --format '{{.Names}}' | grep -Fx "$VIPE_COOLIFY_DB_UUID" || true)"
  if [[ -z "$names" ]]; then
    target_die "no running database container named ${VIPE_COOLIFY_DB_UUID}"
  fi
  if [[ "$(printf '%s\n' "$names" | wc -l)" -ne 1 ]]; then
    target_die "more than one database container named ${VIPE_COOLIFY_DB_UUID}"
  fi
  printf '%s\n' "$names"
}

# target_init <local|coolify>
target_init() {
  TARGET="$1"
  case "$TARGET" in
    local)
      # A named Coolify app or database means the operator meant the server:
      # never fall back to the local database because --target coolify was
      # omitted. --app-uuid "" counts too: `--app-uuid "$UUID"` with UUID
      # unset is the same mistake (the *_GIVEN flags are set by the parsers).
      [[ -z "${VIPE_COOLIFY_APP_UUID:-}" && -z "${VIPE_COOLIFY_APP_UUID_GIVEN:-}" ]] \
        || target_die "a Coolify app uuid was given (--app-uuid or VIPE_COOLIFY_APP_UUID) but the target is local; pass --target coolify, or unset it for the local stack" 2
      [[ -z "${VIPE_COOLIFY_DB_UUID:-}" && -z "${VIPE_COOLIFY_DB_UUID_GIVEN:-}" ]] \
        || target_die "a Coolify database uuid was given (--db-uuid or VIPE_COOLIFY_DB_UUID) but the target is local; pass --target coolify, or unset it for the local stack" 2
      : "${TARGET_DB:?TARGET_DB must be set for the local target}"
      [[ "$TARGET_DB" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || target_die "invalid database name '$TARGET_DB'" 2
      ;;
    coolify)
      [[ -n "${VIPE_COOLIFY_APP_UUID:-}" ]] \
        || target_die "--target coolify needs the Coolify app uuid: pass --app-uuid <uuid> or set VIPE_COOLIFY_APP_UUID" 2
      [[ "$VIPE_COOLIFY_APP_UUID" =~ ^[a-z0-9]+$ ]] \
        || target_die "invalid Coolify app uuid '$VIPE_COOLIFY_APP_UUID' (lowercase letters and digits)" 2
      [[ -n "${VIPE_COOLIFY_DB_UUID:-}" ]] \
        || target_die "--target coolify needs the Coolify database uuid: pass --db-uuid <uuid> or set VIPE_COOLIFY_DB_UUID" 2
      [[ "$VIPE_COOLIFY_DB_UUID" =~ ^[a-z0-9]+$ ]] \
        || target_die "invalid Coolify database uuid '$VIPE_COOLIFY_DB_UUID' (lowercase letters and digits)" 2
      command -v docker >/dev/null || target_die "docker is required for the coolify target"
      TARGET_PG_CONTAINER="$(target_find_db_container)"
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
    local) hash="$(cd "$target_repo_root/apps/api" && node -e "$target_hash_js")" || hash= ;;
    coolify) hash="$(docker exec -i "$TARGET_API_CONTAINER" node -e "$target_hash_js")" || hash= ;;
  esac
  [[ "$hash" == '$argon2id$'* ]] || target_die "could not hash the password with argon2id"
  printf '%s\n' "$hash"
}

# target_query <psql args...>: target_psql whose failure exits 1 (psql itself
# exits 3 on a script error, which callers reserve for "already exists").
target_query() {
  target_psql "$@" || target_die "the query on the target database failed (see the psql error above)"
}

# Local: database, roles and migrations in place (idempotent). Coolify: the
# migrate service has run. Both: the connecting user can act as vipe_migrator.
target_prepare() {
  case "$TARGET" in
    local)
      local port="${VIPE_DB_PORT:-5432}"
      local migrator_password="${VIPE_MIGRATOR_PASSWORD:-vipe_migrator}"
      local api_password="${VIPE_API_PASSWORD:-vipe_api}"
      # A subshell for the cd; errexit is off inside it (it sits on the left
      # of ||), so every step names its own failure.
      (
        cd "$target_repo_root" || exit 1
        docker compose up -d --wait db >/dev/null 2>&1 || target_die "the dev stack's db service did not start (docker compose up -d --wait db)"
        docker compose exec -T db psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -At \
          -c "SELECT 1 FROM pg_database WHERE datname = '${TARGET_DB}'" | grep -q 1 \
          || docker compose exec -T db psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
               -c "CREATE DATABASE \"${TARGET_DB}\"" \
          || target_die "could not create the database ${TARGET_DB}"
        docker compose exec -T db psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
          -v migrator_password="$migrator_password" \
          -v api_password="$api_password" \
          -v db_name="$TARGET_DB" \
          -f /opt/vipe/scripts/roles.sql || target_die "roles.sql failed on the dev stack"
        DATABASE_URL="postgres://vipe_migrator:${migrator_password}@localhost:${port}/${TARGET_DB}" \
          pnpm --silent db:migrate >/dev/null || target_die "the migrations failed on ${TARGET_DB}"
      ) || exit 1
      ;;
  esac
  local state
  state="$(target_query -At -c "SELECT (to_regclass('public.restaurants') IS NOT NULL)::text || ' '
    || (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vipe_migrator')
        AND pg_has_role(current_user, 'vipe_migrator', 'MEMBER'))::text")" || exit 1
  [[ "$state" == "true "* ]] || target_die "the schema is missing: the migrate service has not run on this stack"
  [[ "$state" == *" true" ]] \
    || target_die "the database user cannot act as vipe_migrator (SET ROLE), or the role is missing; run roles.sql as the superuser"
}

# A value for a psql `\set name '<value>'` line: backslashes and single quotes
# escaped. Callers reject newlines first.
target_psql_quote() {
  local value="${1//\\/\\\\}"
  printf "'%s'" "${value//\'/\'\'}"
}
