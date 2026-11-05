#!/usr/bin/env bash
# Contract test of the production bootstrap (seed/bootstrap) and the demo seed
# (seed/demo), odd/tasks/migracion-backend-nestjs.md T16/T17.
#
#   pnpm --filter @vipe/db test:seeds      (or: bash packages/db/seed/test.sh)
#
# Runs both scripts with --target coolify against throwaway stand-ins of a
# Coolify app: a `postgres-<uuid>-test` container built from
# deploy/postgres/Dockerfile and an `api-<uuid>-test` node container that
# reads the repository (read-only) for the API's argon2 dependency. Two stacks:
# A with POSTGRES_USER=postgres (bootstrap matrix) and B with
# POSTGRES_USER=vipeowner, as a Coolify app may define it (demo, reset and the
# demo's invariants). Migrations run from the host with `pnpm db:migrate`.
# Containers, image and scratch directory are removed on exit. Not wired into
# CI. Exit 0 when every check passes, 1 otherwise.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
seed_dir="$repo_root/packages/db/seed"
run_id="seedtest$(date +%s)$$"
image="vipe-seed-test-postgres:$run_id"
scratch="$(mktemp -d)"
containers=()
passed=0
failed=0

cleanup() {
  if ((${#containers[@]})); then docker rm -f "${containers[@]}" >/dev/null 2>&1 || true; fi
  docker image rm -f "$image" >/dev/null 2>&1 || true
  rm -rf "$scratch"
}
trap cleanup EXIT

ok() { passed=$((passed + 1)); echo "ok   $1"; }
not_ok() {
  failed=$((failed + 1))
  echo "FAIL $1"
  sed 's/^/     | /' "$scratch/err" | tail -n 8
}

# expect_exit <code> <label> <command...>: stdout/stderr land in $scratch/out|err.
expect_exit() {
  local want="$1" label="$2" got=0
  shift 2
  "$@" >"$scratch/out" 2>"$scratch/err" </dev/null && got=0 || got=$?
  if [[ "$got" == "$want" ]]; then ok "$label (exit $got)"; else echo "     | expected exit $want, got $got" >>"$scratch/err"; not_ok "$label"; fi
}

# expect_stderr <label> <fixed text>: the last expect_exit printed it on stderr.
expect_stderr() {
  if grep -qF -- "$2" "$scratch/err"; then ok "$1"; else echo "     | stderr lacks: $2" >>"$scratch/err"; not_ok "$1"; fi
}

# expect_eq <label> <expected> <actual>
expect_eq() {
  if [[ "$2" == "$3" ]]; then ok "$1"; else echo "     | expected '$2', got '$3'" >"$scratch/err"; not_ok "$1"; fi
}

# start_stack <app uuid> <POSTGRES_USER>: postgres + api stand-ins, migrated.
start_stack() {
  local uuid="$1" user="$2" pg="postgres-$1-test" api="api-$1-test" port i
  containers+=("$pg" "$api")
  docker run -d --name "$pg" -p 127.0.0.1::5432 \
    -e POSTGRES_USER="$user" -e POSTGRES_PASSWORD=test-owner-pw -e POSTGRES_DB=vipe_pos \
    -e VIPE_MIGRATOR_PASSWORD=test-migrator-pw -e VIPE_API_PASSWORD=test-api-pw \
    "$image" >/dev/null
  docker run -d --name "$api" -v "$repo_root:$repo_root:ro" -w "$repo_root/apps/api" \
    node:24-alpine sleep infinity >/dev/null
  # TCP answers only after the init scripts are done.
  for i in $(seq 1 60); do
    docker exec "$pg" psql -h 127.0.0.1 -U "$user" -d vipe_pos -Atc 'SELECT 1' >/dev/null 2>&1 && break
    [[ $i == 60 ]] && { echo "postgres stand-in $pg did not start" >&2; exit 1; }
    sleep 1
  done
  port="$(docker port "$pg" 5432/tcp | head -n1 | sed 's/.*://')"
  (cd "$repo_root" && DATABASE_URL="postgres://vipe_migrator:test-migrator-pw@127.0.0.1:${port}/vipe_pos" \
    pnpm --silent db:migrate >/dev/null)
}

# sql <app uuid> <POSTGRES_USER> <query>: one unaligned value per line.
sql() { docker exec -i "postgres-$1-test" psql -X -q -v ON_ERROR_STOP=1 -U "$2" -d vipe_pos -At -c "$3"; }

bootstrap() { ADMIN_PASSWORD="${ADMIN_PASSWORD-bootstrap-pass-2026}" bash "$seed_dir/bootstrap/create-restaurant.sh" "$@"; }
demo() { DEMO_PASSWORD=demo-pass-2026 bash "$seed_dir/demo/demo-db.sh" "$@"; }

for script in "$seed_dir"/test.sh "$seed_dir"/bootstrap/*.sh "$seed_dir"/demo/*.sh; do
  bash -n "$script"
done

echo "building the postgres stand-in image..."
docker build -q -f "$repo_root/deploy/postgres/Dockerfile" -t "$image" "$repo_root" >/dev/null

# ---------------------------------------------------------------------------
# Stack A (POSTGRES_USER=postgres): bootstrap matrix
# ---------------------------------------------------------------------------
a="${run_id}a"
echo "stack A ($a, POSTGRES_USER=postgres)"
start_stack "$a" postgres
fingerprint_a() { sql "$a" postgres "SELECT (SELECT count(*) FROM public.restaurants) || '/' || (SELECT count(*) FROM public.users) || '/' || (SELECT count(*) FROM public.profiles)"; }

expect_exit 2 "bootstrap: --target coolify without an app uuid" \
  env -u VIPE_COOLIFY_APP_UUID ADMIN_PASSWORD=bootstrap-pass-2026 bash "$seed_dir/bootstrap/create-restaurant.sh" --target coolify "La Mesa" admin@mesa.example
expect_stderr "bootstrap: the missing app uuid names --app-uuid" "--app-uuid"
expect_exit 2 "bootstrap: VIPE_COOLIFY_APP_UUID set but empty" \
  env VIPE_COOLIFY_APP_UUID= ADMIN_PASSWORD=bootstrap-pass-2026 bash "$seed_dir/bootstrap/create-restaurant.sh" --target coolify "La Mesa" admin@mesa.example
expect_exit 2 "bootstrap: short password" \
  env ADMIN_PASSWORD=short bash "$seed_dir/bootstrap/create-restaurant.sh" --target coolify --app-uuid "$a" "La Mesa" admin@mesa.example
expect_exit 2 "bootstrap: --username with a space" \
  bootstrap --target coolify --app-uuid "$a" --username "la mesa" "La Mesa" admin@mesa.example
expect_eq "bootstrap: rejected input wrote nothing" "0/0/0" "$(fingerprint_a)"

expect_exit 0 "bootstrap: create La Mesa (app uuid from VIPE_COOLIFY_APP_UUID)" \
  env VIPE_COOLIFY_APP_UUID="$a" ADMIN_PASSWORD=bootstrap-pass-2026 bash "$seed_dir/bootstrap/create-restaurant.sh" --target coolify "La Mesa" Admin@Mesa.example
expect_eq "bootstrap: one restaurant, admin profile with the email's local part" "La Mesa|admin@mesa.example|admin|admin" \
  "$(sql "$a" postgres "SELECT r.name || '|' || p.email || '|' || p.username || '|' || p.role FROM public.restaurants r JOIN public.profiles p ON p.restaurant_id = r.id")"
expect_eq "bootstrap: the admin password is an argon2id hash" "t" \
  "$(sql "$a" postgres "SELECT bool_and(password_hash LIKE '\$argon2id\$%') FROM public.users")"

expect_exit 3 "bootstrap: duplicate name in another case" bootstrap --target coolify --app-uuid "$a" "  la MESA " otra@mesa.example
expect_exit 3 "bootstrap: duplicate email" bootstrap --target coolify --app-uuid "$a" "Otra Mesa" ADMIN@mesa.example
expect_exit 3 "bootstrap: taken username (email local part)" bootstrap --target coolify --app-uuid "$a" "Otra Mesa" admin@otra.example
expect_stderr "bootstrap: the taken username suggests --username" "--username"
expect_eq "bootstrap: refused runs wrote nothing" "1/1/1" "$(fingerprint_a)"

# A unique violation inside the transaction (a concurrent run created the
# same row between the checks and the insert) is exit 3, not 1.
sql "$a" postgres "CREATE FUNCTION public.zz_race() RETURNS trigger LANGUAGE plpgsql AS \$\$ BEGIN RAISE unique_violation USING MESSAGE = 'duplicate key value violates unique constraint \"restaurants_slug_key\"'; END \$\$;
  CREATE TRIGGER zz_race BEFORE INSERT ON public.restaurants FOR EACH ROW EXECUTE FUNCTION public.zz_race();" >/dev/null
expect_exit 3 "bootstrap: unique violation during the insert (race)" bootstrap --target coolify --app-uuid "$a" "Mesa Race" race@mesa.example
sql "$a" postgres "DROP TRIGGER zz_race ON public.restaurants; DROP FUNCTION public.zz_race();" >/dev/null
expect_eq "bootstrap: the race wrote nothing" "1/1/1" "$(fingerprint_a)"

# A psql error in the up-front checks is a failure (1), never "exists" (3).
sql "$a" postgres "ALTER TABLE public.users RENAME TO zz_users" >/dev/null
expect_exit 1 "bootstrap: database error in the checks" bootstrap --target coolify --app-uuid "$a" "Mesa Error" error@mesa.example
sql "$a" postgres "ALTER TABLE public.zz_users RENAME TO users" >/dev/null

expect_exit 0 "bootstrap: --username for a taken local part" \
  bootstrap --target coolify --app-uuid "$a" --username admin.otra "Otra Mesa" admin@otra.example
expect_eq "bootstrap: the second admin has the given username" "admin.otra" \
  "$(sql "$a" postgres "SELECT username FROM public.profiles WHERE email = 'admin@otra.example'")"
expect_exit 3 "bootstrap: --username already taken" \
  bootstrap --target coolify --app-uuid "$a" --username admin.otra "Tercera Mesa" tercera@mesa.example

# ---------------------------------------------------------------------------
# Stack B (POSTGRES_USER=vipeowner): demo, reset, invariants
# ---------------------------------------------------------------------------
b="${run_id}b"
echo "stack B ($b, POSTGRES_USER=vipeowner)"
start_stack "$b" vipeowner
q() { sql "$b" vipeowner "$1"; }
# Restaurant ids included: a reset re-creates the demo with a new id.
fingerprint_b() { q "SELECT (SELECT string_agg(id::text, ',' ORDER BY id) FROM public.restaurants) || '/' || (SELECT count(*) FROM public.orders) || '/' || (SELECT count(*) FROM public.payments) || '/' || (SELECT count(*) FROM public.users)"; }

expect_exit 2 "demo: --target coolify without an app uuid" env -u VIPE_COOLIFY_APP_UUID DEMO_PASSWORD=demo-pass-2026 bash "$seed_dir/demo/demo-db.sh" --target coolify
expect_exit 0 "demo: load on an empty database" demo --target coolify --app-uuid "$b"
expect_eq "demo: one demo restaurant" "Casa Guadua" "$(q "SELECT string_agg(name, ',') FROM public.restaurants")"
expect_eq "demo: preparations with production batches" "t" \
  "$(q "SELECT (SELECT count(*) FROM public.ingredients WHERE kind = 'prep') >= 3 AND (SELECT count(*) FROM public.production_batches) >= 3")"

# Invariants of the loaded demo (independent verifier of 2eaf3d5).
expect_eq "demo: every payment inside its register's window" "0" \
  "$(q "SELECT count(*) FROM public.payments p JOIN public.cash_registers c ON c.id = p.cash_register_id
         WHERE p.created_at < c.opening_timestamp OR p.created_at > coalesce(c.closing_timestamp, now())")"
expect_eq "demo: every paid total equals its tenders" "0" \
  "$(q "SELECT count(*) FROM public.payments p
         WHERE p.total_charged <> (SELECT coalesce(sum(t.amount), 0) FROM public.payment_tenders t WHERE t.payment_id = p.id)")"
expect_eq "demo: one order_deliveries row per delivery order" "0" \
  "$(q "SELECT count(*) FROM public.orders o WHERE o.order_type = 'delivery'
         AND (SELECT count(*) FROM public.order_deliveries od WHERE od.order_id = o.id) <> 1")"
expect_eq "demo: order_items.updated_at >= created_at" "0" \
  "$(q "SELECT count(*) FROM public.order_items WHERE updated_at < created_at")"
expect_eq "demo: nothing in the future" "0" \
  "$(q "SELECT (SELECT count(*) FROM public.payments WHERE created_at > now()) + (SELECT count(*) FROM public.orders WHERE created_at > now())")"

before="$(fingerprint_b)"
expect_exit 3 "demo: re-run without --reset" demo --target coolify --app-uuid "$b"
expect_eq "demo: the refused re-run changed nothing" "$before" "$(fingerprint_b)"
expect_exit 0 "demo: --reset (1st)" demo --reset --target coolify --app-uuid "$b"
expect_exit 0 "demo: --reset (2nd)" demo --reset --target coolify --app-uuid "$b"
expect_eq "demo: still exactly one restaurant after two resets" "1" "$(q "SELECT count(*) FROM public.restaurants")"

# A tenant table reset.sql does not cover fails the reset before any delete.
q "CREATE TABLE public.zz_new_tenant_table (id serial PRIMARY KEY, restaurant_id uuid)" >/dev/null
before="$(fingerprint_b)"
expect_exit 1 "demo: --reset with an uncovered tenant table" demo --reset --target coolify --app-uuid "$b"
expect_stderr "demo: the reset names the uncovered table" "zz_new_tenant_table"
expect_eq "demo: the failed reset changed nothing" "$before" "$(fingerprint_b)"
q "DROP TABLE public.zz_new_tenant_table" >/dev/null

# The verifier's reproduction: bootstrap next to the demo (its admin is
# `admin`), then the demo refuses to reset a database with a real tenant.
expect_exit 3 "bootstrap next to the demo: taken username" bootstrap --target coolify --app-uuid "$b" "La Otra Mesa" admin@otra.example
expect_exit 0 "bootstrap next to the demo: --username" bootstrap --target coolify --app-uuid "$b" --username admin.otra "La Otra Mesa" admin@otra.example
before="$(fingerprint_b)"
expect_exit 3 "demo: --reset with a non-demo restaurant" demo --reset --target coolify --app-uuid "$b"
expect_eq "demo: the refused reset changed nothing" "$before" "$(fingerprint_b)"

echo "seed contract: $passed passed, $failed failed"
((failed == 0))
