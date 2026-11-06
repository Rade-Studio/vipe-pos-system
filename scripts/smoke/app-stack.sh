#!/usr/bin/env bash
# Isolated local stack for visual QA of the running app (scripts/smoke/README.md).
#
#   scripts/smoke/app-stack.sh up | down | status
#
# up: its own postgres:16 container ($QA_DB_CONTAINER, default vipe-screens-db,
# on 127.0.0.1:$QA_DB_PORT, default 55900), roles from packages/db/scripts/roles.sql,
# migrations, seed/dev.sql (dev accounts, password vipe-dev-2026), then the API
# and `next dev` on free ports in the background. Logs and pids live in
# $QA_STATE_DIR (default /tmp/vipe-screens-stack). The demo seed is not loaded:
# seed/demo/demo-db.sh only targets the compose `db` service.
# down: stops the servers and removes the container that up created, nothing else.
# Never uses docker-compose.yml (its container_name is pinned) and refuses
# container names of the other stacks (vipe-pos-*, rediseno-db*).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

container="${QA_DB_CONTAINER:-vipe-screens-db}"
db_port="${QA_DB_PORT:-55900}"
state="${QA_STATE_DIR:-/tmp/vipe-screens-stack}"
db=vipe_pos
label=vipe.qa-stack=1

case "$container" in
  vipe-pos-* | rediseno-db*) echo "error: refusing container name $container (another stack)" >&2; exit 2 ;;
esac

free_port() { node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }

wait_http() { # url seconds
  for ((i = 0; i < $2; i++)); do
    curl -fsS -o /dev/null "$1" 2>/dev/null && return 0
    sleep 1
    ((i % 15 == 14)) && echo "  ...waiting for $1 (${i}s)"
  done
  return 1
}

# spawn <name> <dir> <cmd...>: background session leader (pid = process group),
# so stop_pid also stops the children (next dev workers).
spawn() {
  local name="$1" dir="$2"; shift 2
  (cd "$dir" && setsid --fork bash -c 'echo $$ > "$0"; exec "$@"' "$state/$name.pid" "$@" \
    < /dev/null > "$state/$name.log" 2>&1)
  for _ in 1 2 3 4 5 6 7 8 9 10; do [[ -s "$state/$name.pid" ]] && break; sleep 0.2; done
}

stop_pid() {
  local f="$state/$1.pid"
  [[ -f "$f" ]] || return 0
  local pid; pid="$(cat "$f")"
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    kill -KILL -- "-$pid" 2>/dev/null || true
    echo "stopped $1 (pid $pid)"
  fi
  rm -f "$f"
}

up() {
  mkdir -p "$state"
  if docker ps -a --format '{{.Names}}' | grep -Fxq "$container"; then
    docker inspect -f '{{index .Config.Labels "vipe.qa-stack"}}' "$container" | grep -qx 1 \
      || { echo "error: $container exists and was not created by this script" >&2; exit 2; }
    docker start "$container" >/dev/null
  else
    echo "starting $container on 127.0.0.1:$db_port"
    docker run -d --name "$container" --label "$label" -e POSTGRES_PASSWORD=postgres \
      -p "127.0.0.1:$db_port:5432" -v "$repo_root/packages/db/scripts:/opt/vipe/scripts:ro" postgres:16 >/dev/null
  fi
  for ((i = 0; i < 60; i++)); do
    docker exec "$container" pg_isready -U postgres -q 2>/dev/null && break; sleep 1
  done
  psql_su() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
  psql_su -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 \
    || psql_su -d postgres -c "CREATE DATABASE $db"
  psql_su -d postgres -v migrator_password=vipe_migrator -v api_password=vipe_api -v db_name="$db" \
    -f /opt/vipe/scripts/roles.sql
  echo "migrating"
  DATABASE_URL="postgres://vipe_migrator:vipe_migrator@127.0.0.1:$db_port/$db" pnpm --silent db:migrate
  echo "seeding dev.sql"
  psql_su -d "$db" < packages/db/seed/dev.sql

  stop_pid api; stop_pid web
  rm -f "$state/api.pid" "$state/web.pid"
  local api_port web_port
  api_port="$(free_port)"; web_port="$(free_port)"
  echo "building the API"
  pnpm --silent --filter @vipe/api build > "$state/api-build.log" 2>&1 \
    || { tail -20 "$state/api-build.log" >&2; exit 1; }
  echo "starting API on :$api_port (log $state/api.log)"
  PORT="$api_port" DATABASE_URL="postgres://vipe_api:vipe_api@127.0.0.1:$db_port/$db" \
    WEB_ORIGIN="http://localhost:$web_port" JWT_SECRET=vipe-screens-local-jwt-secret-0123456789abcdef \
    COOKIE_SECURE=false spawn api apps/api node dist/main.js
  wait_http "http://127.0.0.1:$api_port/api/health" 90 || { tail -30 "$state/api.log" >&2; exit 1; }
  echo "starting web on :$web_port (log $state/web.log)"
  API_PROXY_TARGET="http://127.0.0.1:$api_port" spawn web . node_modules/.bin/next dev -p "$web_port"
  wait_http "http://localhost:$web_port/portal" 180 || { tail -30 "$state/web.log" >&2; exit 1; }
  echo "http://localhost:$web_port" > "$state/web.url"
  echo "ready: web http://localhost:$web_port  api http://127.0.0.1:$api_port  (dev accounts, password vipe-dev-2026)"
}

down() {
  stop_pid web; stop_pid api
  if docker ps -a --format '{{.Names}}' | grep -Fxq "$container"; then
    if docker inspect -f '{{index .Config.Labels "vipe.qa-stack"}}' "$container" | grep -qx 1; then
      docker rm -f "$container" >/dev/null && echo "removed $container"
    else
      echo "error: $container was not created by this script; left alone" >&2; exit 2
    fi
  fi
  rm -f "$state/web.url"
}

status() {
  for n in api web; do
    [[ -f "$state/$n.pid" ]] && kill -0 "$(cat "$state/$n.pid")" 2>/dev/null && echo "$n running" || echo "$n stopped"
  done
  docker ps --filter "name=^${container}\$" --format '{{.Names}} {{.Status}}'
  [[ -f "$state/web.url" ]] && cat "$state/web.url" || true
}

case "${1:-}" in
  up) up ;; down) down ;; status) status ;;
  *) echo "usage: $0 up|down|status" >&2; exit 2 ;;
esac
