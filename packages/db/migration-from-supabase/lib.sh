# Shared helpers for the Supabase -> plain Postgres toolkit (sourced, not run).
#
# Postgres client tools run from a container so the operator needs only Docker:
#   PG_CLIENT_IMAGE  client image (default postgres:17; pg_dump 17 reads Supabase
#                    projects on Postgres 15 and 17, psql 17 writes to Postgres 16)
#   PG_CLIENT=local  use psql/pg_dump from PATH instead
# Connection strings must be postgres:// or postgresql:// URLs. They are split
# into the libpq variables PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE (and
# PGSSLMODE from ?sslmode=), URL-decoded, and handed to the client through the
# environment (`docker run --env NAME`), so no credential is ever a process
# argument visible in `ps`, and logs show only host:port/database.

PG_CLIENT_IMAGE="${PG_CLIENT_IMAGE:-postgres:17}"

log() { printf '%s: %s\n' "${TOOL_NAME:-migration}" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

url_decode() { local v="${1//+/%2B}"; printf '%b' "${v//%/\\x}"; }

# parse_pg_url <url>: sets pg_host pg_port pg_user pg_password pg_db pg_sslmode.
# The userinfo ends at the LAST @, so a password with a raw @ still parses.
parse_pg_url() {
  local url="$1" rest userinfo="" hostpart path query=""
  [[ "$url" =~ ^postgres(ql)?:// ]] || return 1
  rest="${url#*://}"
  if [[ "$rest" == *@* ]]; then
    userinfo="${rest%@*}"
    rest="${rest##*@}"
  fi
  hostpart="${rest%%[/?]*}"
  rest="${rest:${#hostpart}}"
  path="${rest%%\?*}"
  [[ "$rest" == *\?* ]] && query="${rest#*\?}"
  pg_host="${hostpart%:*}"
  pg_port=5432
  [[ "$hostpart" == *:* ]] && pg_port="${hostpart##*:}"
  [[ -n "$pg_host" && "$pg_port" =~ ^[0-9]+$ ]] || return 1
  pg_user="$(url_decode "${userinfo%%:*}")"
  pg_password=""
  [[ "$userinfo" == *:* ]] && pg_password="$(url_decode "${userinfo#*:}")"
  pg_db="$(url_decode "${path#/}")"
  pg_sslmode=""
  if [[ "&$query" =~ \&sslmode=([^&]*) ]]; then pg_sslmode="${BASH_REMATCH[1]}"; fi
  return 0
}

# host:port/database of a connection URL, nothing else. Anything that is not a
# postgres:// URL prints a fixed placeholder, never the input.
redact_url() {
  local pg_host pg_port pg_user pg_password pg_db pg_sslmode
  if parse_pg_url "$1"; then
    printf '%s:%s/%s' "$pg_host" "$pg_port" "$pg_db"
  else
    printf '<not a postgres:// URL>'
    return 1
  fi
}

# require_pg_url <VAR_NAME>: refuse an unset or non-URL connection string.
require_pg_url() {
  local name="$1" pg_host pg_port pg_user pg_password pg_db pg_sslmode
  [ -n "${!name:-}" ] || die "$name is required"
  parse_pg_url "${!name}" \
    || die "$name must be a postgres:// or postgresql:// URL (key=value connection strings are not accepted; percent-encode @ : / in the password)"
}

# pg_tool <URL_VAR_NAME> <tool> [args...]
# Runs <tool> against the database of the URL in the named variable. Paths
# passed as arguments must be absolute; the toolkit and work directories are
# mounted at the same paths inside the container. PG_TOOL_TRACE=<file> appends
# each client command line to <file> (the rehearsal checks it holds no secret).
pg_tool() (
  # Subshell: the PG* variables never reach the caller's environment.
  local url_var="$1" tool="$2" pg_host pg_port pg_user pg_password pg_db pg_sslmode
  shift 2
  require_pg_url "$url_var"
  parse_pg_url "${!url_var}"
  local envs=(PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGCONNECT_TIMEOUT)
  export PGHOST="$pg_host" PGPORT="$pg_port" PGUSER="$pg_user" PGPASSWORD="$pg_password" PGDATABASE="$pg_db" PGCONNECT_TIMEOUT=15
  if [ -n "$pg_sslmode" ]; then export PGSSLMODE="$pg_sslmode"; envs+=(PGSSLMODE); else unset PGSSLMODE; fi
  [ -n "${PGOPTIONS:-}" ] && envs+=(PGOPTIONS)
  local cmd
  if [ "${PG_CLIENT:-}" = "local" ]; then
    cmd=("$tool" "$@")
  else
    cmd=(docker run --rm -i --network host -u "$(id -u):$(id -g)" -v "$TOOLKIT_DIR:$TOOLKIT_DIR:ro")
    if [ -n "${WORK_DIR:-}" ]; then cmd+=(-v "$WORK_DIR:$WORK_DIR"); fi
    for e in "${envs[@]}"; do cmd+=(--env "$e"); done
    cmd+=(-w "${WORK_DIR:-/tmp}" "$PG_CLIENT_IMAGE" "$tool" "$@")
  fi
  if [ -n "${PG_TOOL_TRACE:-}" ]; then printf '%q ' "${cmd[@]}" >> "$PG_TOOL_TRACE"; echo >> "$PG_TOOL_TRACE"; fi
  "${cmd[@]}"
)

TOOLKIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
