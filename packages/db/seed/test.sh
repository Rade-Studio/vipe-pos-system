#!/usr/bin/env bash
# Contract test of the production bootstrap (seed/bootstrap) and the demo seed
# (seed/demo), odd/tasks/migracion-backend-nestjs.md T16/T17.
#
#   pnpm --filter @vipe/db test:seeds      (or: bash packages/db/seed/test.sh)
#
# Runs both scripts with --target coolify against throwaway stand-ins of a
# Coolify app and its standalone database: a postgres container named
# `<db uuid>` (the pinned image of docker-compose.prod.yml, roles created by
# deploy/postgres/create-roles.sh) and an `api-<app uuid>-test` node container
# that reads the repository (read-only) for the API's argon2 dependency. Two
# stacks: A with POSTGRES_USER=postgres (bootstrap matrix) and B with
# POSTGRES_USER=vipeowner, as a Coolify database may define it (demo, reset
# and the demo's invariants). Migrations run from the host with
# `pnpm db:migrate`. Containers (with their anonymous volumes) and scratch
# directory are removed on exit, and a volume left behind fails the run. Not
# wired into CI.
# Exit 0 when every check passes, 1 otherwise.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
seed_dir="$repo_root/packages/db/seed"
run_id="seedtest$(date +%s)$$"
image="$(sed -n 's/^[[:space:]]*image:[[:space:]]*\(postgres:[^[:space:]]*\).*/\1/p' "$repo_root/docker-compose.prod.yml" | head -n1)"
scratch="$(mktemp -d)"
containers=()
passed=0
failed=0

cleanup() {
  local status=$? volumes=() leaked=() v
  if ((${#containers[@]})); then
    # The postgres image declares a data volume: record the names before removal.
    mapfile -t volumes < <(docker inspect -f '{{range .Mounts}}{{if .Name}}{{println .Name}}{{end}}{{end}}' \
      "${containers[@]}" 2>/dev/null | sed '/^$/d')
    docker rm -fv "${containers[@]}" >/dev/null 2>&1 || true
  fi
  rm -rf "$scratch"
  for v in "${volumes[@]}"; do
    docker volume inspect "$v" >/dev/null 2>&1 && leaked+=("$v")
  done
  if ((${#leaked[@]})); then
    echo "FAIL volumes left behind by the run: ${leaked[*]}" >&2
    exit 1
  fi
  exit "$status"
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

# start_stack <app uuid> <db uuid> <POSTGRES_USER>: database + api stand-ins,
# roles created, migrated.
start_stack() {
  local pg="$2" user="$3" api="api-$1-test" port i
  containers+=("$pg" "$api")
  docker run -d --name "$pg" -p 127.0.0.1::5432 \
    -e POSTGRES_USER="$user" -e POSTGRES_PASSWORD=test-owner-pw -e POSTGRES_DB=vipe_pos \
    "$image" >/dev/null
  docker run -d --name "$api" -v "$repo_root:$repo_root:ro" -w "$repo_root/apps/api" \
    node:24-alpine sleep infinity >/dev/null
  # TCP answers only after the init scripts are done.
  for i in $(seq 1 60); do
    docker exec "$pg" psql -h 127.0.0.1 -U "$user" -d vipe_pos -Atc 'SELECT 1' >/dev/null 2>&1 && break
    [[ $i == 60 ]] && { echo "postgres stand-in $pg did not start" >&2; exit 1; }
    sleep 1
  done
  VIPE_MIGRATOR_PASSWORD=test-migrator-pw VIPE_API_PASSWORD=test-api-pw \
    bash "$repo_root/deploy/postgres/create-roles.sh" --container "$pg" >/dev/null
  port="$(docker port "$pg" 5432/tcp | head -n1 | sed 's/.*://')"
  (cd "$repo_root" && DATABASE_URL="postgres://vipe_migrator:test-migrator-pw@127.0.0.1:${port}/vipe_pos" \
    pnpm --silent db:migrate >/dev/null)
}

# sql <db uuid> <POSTGRES_USER> <query>: one unaligned value per line.
sql() { docker exec -i "$1" psql -X -q -v ON_ERROR_STOP=1 -U "$2" -d vipe_pos -At -c "$3"; }

bootstrap() { ADMIN_PASSWORD="${ADMIN_PASSWORD-bootstrap-pass-2026}" bash "$seed_dir/bootstrap/create-restaurant.sh" "$@"; }
demo() { DEMO_PASSWORD=demo-pass-2026 bash "$seed_dir/demo/demo-db.sh" "$@"; }

for script in "$seed_dir"/test.sh "$seed_dir"/bootstrap/*.sh "$seed_dir"/demo/*.sh "$repo_root"/deploy/postgres/*.sh; do
  bash -n "$script"
done

[[ "$image" == postgres:*@sha256:* ]] || { echo "no pinned postgres image in docker-compose.prod.yml" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Stack A (POSTGRES_USER=postgres): bootstrap matrix
# ---------------------------------------------------------------------------
a="${run_id}a"
adb="${a}db"
echo "stack A ($a, database $adb, POSTGRES_USER=postgres)"
start_stack "$a" "$adb" postgres
fingerprint_a() { sql "$adb" postgres "SELECT (SELECT count(*) FROM public.restaurants) || '/' || (SELECT count(*) FROM public.users) || '/' || (SELECT count(*) FROM public.profiles)"; }

expect_exit 2 "bootstrap: --target coolify without an app uuid" \
  env -u VIPE_COOLIFY_APP_UUID ADMIN_PASSWORD=bootstrap-pass-2026 bash "$seed_dir/bootstrap/create-restaurant.sh" --target coolify "La Mesa" admin@mesa.example
expect_stderr "bootstrap: the missing app uuid names --app-uuid" "--app-uuid"
# An app uuid without --target coolify must stop before any database: a stub
# docker records any call, so the refusal is proven to touch nothing.
nodocker="$scratch/nodocker"
mkdir -p "$nodocker"
printf '#!/bin/sh\ntouch "%s/called"\nexit 1\n' "$nodocker" >"$nodocker/docker"
chmod +x "$nodocker/docker"
expect_exit 2 "bootstrap: --app-uuid without --target coolify" \
  env PATH="$nodocker:$PATH" ADMIN_PASSWORD=bootstrap-pass-2026 bash "$seed_dir/bootstrap/create-restaurant.sh" --app-uuid "$a" "La Mesa" admin@mesa.example
expect_stderr "bootstrap: the refusal names --target coolify" "--target coolify"
expect_exit 2 "demo: --app-uuid without --target coolify" \
  env PATH="$nodocker:$PATH" DEMO_PASSWORD=demo-pass-2026 bash "$seed_dir/demo/demo-db.sh" --app-uuid "$a"
expect_stderr "demo: the refusal names --target coolify" "--target coolify"
expect_exit 2 "bootstrap: VIPE_COOLIFY_APP_UUID set for the local target" \
  env PATH="$nodocker:$PATH" VIPE_COOLIFY_APP_UUID="$a" ADMIN_PASSWORD=bootstrap-pass-2026 bash "$seed_dir/bootstrap/create-restaurant.sh" "La Mesa" admin@mesa.example
# `--app-uuid "$UUID"` with the variable unset and --target coolify forgotten.
expect_exit 2 "bootstrap: empty --app-uuid without --target coolify" \
  env -u VIPE_COOLIFY_APP_UUID PATH="$nodocker:$PATH" ADMIN_PASSWORD=bootstrap-pass-2026 bash "$seed_dir/bootstrap/create-restaurant.sh" --app-uuid "" "La Mesa" admin@mesa.example
expect_exit 2 "demo: empty --app-uuid without --target coolify" \
  env -u VIPE_COOLIFY_APP_UUID PATH="$nodocker:$PATH" DEMO_PASSWORD=demo-pass-2026 bash "$seed_dir/demo/demo-db.sh" --target local --app-uuid ""
expect_exit 2 "demo: VIPE_COOLIFY_APP_UUID set for the local target" \
  env PATH="$nodocker:$PATH" VIPE_COOLIFY_APP_UUID="$a" DEMO_PASSWORD=demo-pass-2026 bash "$seed_dir/demo/demo-db.sh" --target local
expect_exit 2 "bootstrap: --username empty after the positionals" \
  env PATH="$nodocker:$PATH" ADMIN_PASSWORD=bootstrap-pass-2026 bash "$seed_dir/bootstrap/create-restaurant.sh" --target coolify --app-uuid "$a" --db-uuid "$adb" "La Mesa" admin@mesa.example --username ""
expect_exit 2 "bootstrap: --db-uuid without --target coolify" \
  env -u VIPE_COOLIFY_APP_UUID PATH="$nodocker:$PATH" ADMIN_PASSWORD=bootstrap-pass-2026 bash "$seed_dir/bootstrap/create-restaurant.sh" --db-uuid "$adb" "La Mesa" admin@mesa.example
expect_stderr "bootstrap: the db uuid refusal names --target coolify" "--target coolify"
expect_exit 2 "demo: VIPE_COOLIFY_DB_UUID set for the local target" \
  env -u VIPE_COOLIFY_APP_UUID PATH="$nodocker:$PATH" VIPE_COOLIFY_DB_UUID="$adb" DEMO_PASSWORD=demo-pass-2026 bash "$seed_dir/demo/demo-db.sh" --target local
expect_exit 2 "demo: empty --db-uuid without --target coolify" \
  env -u VIPE_COOLIFY_APP_UUID -u VIPE_COOLIFY_DB_UUID PATH="$nodocker:$PATH" DEMO_PASSWORD=demo-pass-2026 bash "$seed_dir/demo/demo-db.sh" --db-uuid ""
expect_eq "refused local runs never called docker" "absent" "$([[ -e "$nodocker/called" ]] && echo called || echo absent)"
expect_exit 2 "bootstrap: --target coolify without a db uuid" \
  env -u VIPE_COOLIFY_DB_UUID ADMIN_PASSWORD=bootstrap-pass-2026 bash "$seed_dir/bootstrap/create-restaurant.sh" --target coolify --app-uuid "$a" "La Mesa" admin@mesa.example
expect_stderr "bootstrap: the missing db uuid names --db-uuid" "--db-uuid"
expect_exit 2 "demo: --target coolify without a db uuid" \
  env -u VIPE_COOLIFY_DB_UUID DEMO_PASSWORD=demo-pass-2026 bash "$seed_dir/demo/demo-db.sh" --target coolify --app-uuid "$a"
for bad in "" VBPB 'x;id' '../x' "^$adb"; do
  expect_exit 2 "bootstrap: db uuid [$bad]" env -u VIPE_COOLIFY_DB_UUID ADMIN_PASSWORD=bootstrap-pass-2026 bash "$seed_dir/bootstrap/create-restaurant.sh" --target coolify --app-uuid "$a" --db-uuid "$bad" "La Mesa" admin@mesa.example
  expect_exit 2 "demo: db uuid [$bad]" env -u VIPE_COOLIFY_DB_UUID DEMO_PASSWORD=demo-pass-2026 bash "$seed_dir/demo/demo-db.sh" --target coolify --app-uuid "$a" --db-uuid "$bad"
done
# A prefix of the database name is not the database: the name must match exactly.
expect_exit 1 "bootstrap: db uuid that only prefixes a running container" \
  bootstrap --target coolify --app-uuid "$a" --db-uuid "${adb%db}" "La Mesa" admin@mesa.example
expect_stderr "bootstrap: the unknown db uuid is named" "no running database container named ${adb%db}"
# Exact db container match: among names that only contain the uuid, psql runs
# in the container named exactly $adb. The stub docker logs every call and
# fails everything but `ps`.
stub="$scratch/stub-docker"
mkdir -p "$stub"
cat >"$stub/docker" <<STUB
#!/usr/bin/env bash
printf '%s\n' "\$*" >>"$scratch/docker.log"
[[ "\$1" == ps ]] || exit 1
printf '%s\n' x$adb ${adb}x ${adb}-backup $adb api-$a-1
STUB
chmod +x "$stub/docker"
: >"$scratch/docker.log"
expect_exit 1 "bootstrap: the stub docker fails the first exec" \
  env PATH="$stub:$PATH" ADMIN_PASSWORD=bootstrap-pass-2026 bash "$seed_dir/bootstrap/create-restaurant.sh" --target coolify --app-uuid "$a" --db-uuid "$adb" "R" r@r.co
expect_eq "bootstrap: the first exec targets exactly the db uuid" "$adb" \
  "$(awk '$1 == "exec" { print ($2 == "-i" ? $3 : $2); exit }' "$scratch/docker.log")"
expect_exit 2 "bootstrap: VIPE_COOLIFY_APP_UUID set but empty" \
  env VIPE_COOLIFY_APP_UUID= ADMIN_PASSWORD=bootstrap-pass-2026 bash "$seed_dir/bootstrap/create-restaurant.sh" --target coolify "La Mesa" admin@mesa.example
expect_exit 2 "bootstrap: short password" \
  env ADMIN_PASSWORD=short bash "$seed_dir/bootstrap/create-restaurant.sh" --target coolify --app-uuid "$a" --db-uuid "$adb" "La Mesa" admin@mesa.example
expect_exit 2 "bootstrap: --username with a space" \
  bootstrap --target coolify --app-uuid "$a" --db-uuid "$adb" --username "la mesa" "La Mesa" admin@mesa.example
expect_exit 2 "bootstrap: --username empty" bootstrap --target coolify --app-uuid "$a" --db-uuid "$adb" --username "" "La Mesa" admin@mesa.example
expect_stderr "bootstrap: the empty username names --username" "--username"
for bad in "" VBPB 'x;id' '../x'; do
  expect_exit 2 "bootstrap: app uuid [$bad]" env -u VIPE_COOLIFY_APP_UUID ADMIN_PASSWORD=bootstrap-pass-2026 bash "$seed_dir/bootstrap/create-restaurant.sh" --target coolify --app-uuid "$bad" --db-uuid "$adb" "La Mesa" admin@mesa.example
  expect_exit 2 "demo: app uuid [$bad]" env -u VIPE_COOLIFY_APP_UUID DEMO_PASSWORD=demo-pass-2026 bash "$seed_dir/demo/demo-db.sh" --target coolify --app-uuid "$bad" --db-uuid "$adb"
done
expect_eq "bootstrap: rejected input wrote nothing" "0/0/0" "$(fingerprint_a)"

expect_exit 0 "bootstrap: create La Mesa (uuids from VIPE_COOLIFY_APP_UUID and VIPE_COOLIFY_DB_UUID)" \
  env VIPE_COOLIFY_APP_UUID="$a" VIPE_COOLIFY_DB_UUID="$adb" ADMIN_PASSWORD=bootstrap-pass-2026 bash "$seed_dir/bootstrap/create-restaurant.sh" --target coolify "La Mesa" Admin@Mesa.example
expect_eq "bootstrap: one restaurant, admin profile with the email's local part" "La Mesa|admin@mesa.example|admin|admin" \
  "$(sql "$adb" postgres "SELECT r.name || '|' || p.email || '|' || p.username || '|' || p.role FROM public.restaurants r JOIN public.profiles p ON p.restaurant_id = r.id")"
expect_eq "bootstrap: the admin password is an argon2id hash" "t" \
  "$(sql "$adb" postgres "SELECT bool_and(password_hash LIKE '\$argon2id\$%') FROM public.users")"

expect_exit 3 "bootstrap: duplicate name in another case" bootstrap --target coolify --app-uuid "$a" --db-uuid "$adb" "  la MESA " otra@mesa.example
expect_exit 3 "bootstrap: duplicate email" bootstrap --target coolify --app-uuid "$a" --db-uuid "$adb" "Otra Mesa" ADMIN@mesa.example
expect_exit 3 "bootstrap: taken username (email local part)" bootstrap --target coolify --app-uuid "$a" --db-uuid "$adb" "Otra Mesa" admin@otra.example
expect_stderr "bootstrap: the taken username suggests --username" "--username"
expect_eq "bootstrap: refused runs wrote nothing" "1/1/1" "$(fingerprint_a)"

# A unique violation inside the transaction (a concurrent run created the
# same row between the checks and the insert) is exit 3, not 1.
sql "$adb" postgres "CREATE FUNCTION public.zz_race() RETURNS trigger LANGUAGE plpgsql AS \$\$ BEGIN RAISE unique_violation USING MESSAGE = 'duplicate key value violates unique constraint \"restaurants_slug_key\"'; END \$\$;
  CREATE TRIGGER zz_race BEFORE INSERT ON public.restaurants FOR EACH ROW EXECUTE FUNCTION public.zz_race();" >/dev/null
expect_exit 3 "bootstrap: unique violation during the insert (race)" bootstrap --target coolify --app-uuid "$a" --db-uuid "$adb" "Mesa Race" race@mesa.example
sql "$adb" postgres "DROP TRIGGER zz_race ON public.restaurants; DROP FUNCTION public.zz_race();" >/dev/null
expect_eq "bootstrap: the race wrote nothing" "1/1/1" "$(fingerprint_a)"

# A psql error in the up-front checks is a failure (1), never "exists" (3).
sql "$adb" postgres "ALTER TABLE public.users RENAME TO zz_users" >/dev/null
expect_exit 1 "bootstrap: database error in the checks" bootstrap --target coolify --app-uuid "$a" --db-uuid "$adb" "Mesa Error" error@mesa.example
sql "$adb" postgres "ALTER TABLE public.zz_users RENAME TO users" >/dev/null

expect_exit 0 "bootstrap: --username for a taken local part" \
  bootstrap --target coolify --app-uuid "$a" --db-uuid "$adb" --username admin.otra "Otra Mesa" admin@otra.example
expect_eq "bootstrap: the second admin has the given username" "admin.otra" \
  "$(sql "$adb" postgres "SELECT username FROM public.profiles WHERE email = 'admin@otra.example'")"
expect_exit 3 "bootstrap: --username already taken" \
  bootstrap --target coolify --app-uuid "$a" --db-uuid "$adb" --username admin.otra "Tercera Mesa" tercera@mesa.example

# create-roles.sh: exit codes, and no password on any command line.
create_roles() { bash "$repo_root/deploy/postgres/create-roles.sh" "$@"; }
expect_exit 2 "create-roles: no --container" env VIPE_MIGRATOR_PASSWORD=m VIPE_API_PASSWORD=a bash "$repo_root/deploy/postgres/create-roles.sh"
expect_exit 2 "create-roles: VIPE_MIGRATOR_PASSWORD unset" \
  env -u VIPE_MIGRATOR_PASSWORD VIPE_API_PASSWORD=a bash "$repo_root/deploy/postgres/create-roles.sh" --container "$adb"
expect_exit 2 "create-roles: VIPE_API_PASSWORD unset" \
  env -u VIPE_API_PASSWORD VIPE_MIGRATOR_PASSWORD=m bash "$repo_root/deploy/postgres/create-roles.sh" --container "$adb"
expect_exit 1 "create-roles: unknown container" \
  env VIPE_MIGRATOR_PASSWORD=m VIPE_API_PASSWORD=a bash "$repo_root/deploy/postgres/create-roles.sh" --container "nosuch$run_id"
tricky="q'u\"o\\te-$run_id"
printf '%s\n' "$tricky" >"$scratch/needles"
: >"$scratch/ps"
( while :; do ps -eo args >>"$scratch/ps"; done ) &
sampler=$!
VIPE_MIGRATOR_PASSWORD="$tricky" VIPE_API_PASSWORD=test-api-pw expect_exit 0 "create-roles: password with quotes and a backslash" \
  create_roles --container "$adb"
kill "$sampler" 2>/dev/null; wait "$sampler" 2>/dev/null || true
expect_eq "create-roles: ps was sampled during the run" "yes" "$([[ -s "$scratch/ps" ]] && echo yes || echo no)"
expect_eq "create-roles: no password in any sampled command line" "0" "$(grep -cF -f "$scratch/needles" "$scratch/ps" || true)"

# ---------------------------------------------------------------------------
# Stack B (POSTGRES_USER=vipeowner): demo, reset, invariants
# ---------------------------------------------------------------------------
b="${run_id}b"
bdb="${b}db"
echo "stack B ($b, database $bdb, POSTGRES_USER=vipeowner)"
start_stack "$b" "$bdb" vipeowner
q() { sql "$bdb" vipeowner "$1"; }
# Restaurant ids included: a reset re-creates the demo with a new id.
fingerprint_b() { q "SELECT (SELECT string_agg(id::text, ',' ORDER BY id) FROM public.restaurants) || '/' || (SELECT count(*) FROM public.orders) || '/' || (SELECT count(*) FROM public.payments) || '/' || (SELECT count(*) FROM public.users)"; }

expect_exit 2 "demo: --target coolify without an app uuid" env -u VIPE_COOLIFY_APP_UUID DEMO_PASSWORD=demo-pass-2026 bash "$seed_dir/demo/demo-db.sh" --target coolify
expect_exit 0 "demo: load on an empty database" demo --target coolify --app-uuid "$b" --db-uuid "$bdb"
expect_eq "demo: one demo restaurant" "Casa Guadua" "$(q "SELECT string_agg(name, ',') FROM public.restaurants")"
expect_eq "demo: preparations with production batches" "t" \
  "$(q "SELECT (SELECT count(*) FROM public.ingredients WHERE kind = 'prep') >= 3 AND (SELECT count(*) FROM public.production_batches) >= 3")"

expect_eq "demo: three zones and every table placed on one" "Barra,Salón principal,Terraza/0" \
  "$(q "SELECT (SELECT string_agg(name, ',' ORDER BY name) FROM public.zones) || '/' || (SELECT count(*) FROM public.tables WHERE zone_id IS NULL OR x IS NULL)")"
expect_eq "demo: categories with subcategories put every dish in one, Postres skips the step" "Bebidas:3,Entradas:3,Platos fuertes:2/0/0/8" \
  "$(q "SELECT (SELECT string_agg(c.name || ':' || n, ',' ORDER BY c.name) FROM (SELECT category_id, count(*) AS n FROM public.subcategories GROUP BY category_id) s JOIN public.categories c ON c.id = s.category_id)
         || '/' || (SELECT count(*) FROM public.dishes d WHERE d.subcategory_id IS NULL AND EXISTS (SELECT 1 FROM public.subcategories s WHERE s.category_id = d.category_id))
         || '/' || (SELECT count(*) FROM public.dishes d JOIN public.categories c ON c.id = d.category_id WHERE c.name = 'Postres' AND d.subcategory_id IS NOT NULL)
         || '/' || (SELECT count(DISTINCT sort_order) FROM public.categories)")"

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
# Every tenant row belongs to the demo restaurant (none outside it, none NULL).
expect_eq "demo: every tenant row has the demo restaurant_id" "0" "$(q "
CREATE FUNCTION pg_temp.rows_outside_demo() RETURNS bigint LANGUAGE plpgsql AS \$\$
DECLARE
  v_demo uuid := (SELECT id FROM public.restaurants);
  v_table text;
  v_rows bigint;
  v_total bigint := 0;
BEGIN
  FOR v_table IN
    SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables t USING (table_schema, table_name)
     WHERE c.table_schema = 'public' AND c.column_name = 'restaurant_id' AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE restaurant_id IS DISTINCT FROM \$1', v_table)
      INTO v_rows USING v_demo;
    v_total := v_total + v_rows;
  END LOOP;
  RETURN v_total;
END
\$\$;
SELECT pg_temp.rows_outside_demo();")"

before="$(fingerprint_b)"
expect_exit 3 "demo: re-run without --reset" demo --target coolify --app-uuid "$b" --db-uuid "$bdb"
expect_eq "demo: the refused re-run changed nothing" "$before" "$(fingerprint_b)"
expect_exit 0 "demo: --reset (1st)" demo --reset --target coolify --app-uuid "$b" --db-uuid "$bdb"
expect_exit 0 "demo: --reset (2nd)" demo --reset --target coolify --app-uuid "$b" --db-uuid "$bdb"
expect_eq "demo: still exactly one restaurant after two resets" "1" "$(q "SELECT count(*) FROM public.restaurants")"

# A tenant table reset.sql does not cover fails the reset before any delete.
# A trigger proves that no DELETE runs before the guard fires.
q "CREATE TABLE public.zz_new_tenant_table (id serial PRIMARY KEY, restaurant_id uuid)" >/dev/null
q "CREATE FUNCTION public.zz_delete_reached() RETURNS trigger LANGUAGE plpgsql AS \$\$ BEGIN RAISE EXCEPTION 'DELETE REACHED'; END \$\$;
  CREATE TRIGGER zz_delete_reached BEFORE DELETE ON public.payment_tenders FOR EACH STATEMENT EXECUTE FUNCTION public.zz_delete_reached();" >/dev/null
before="$(fingerprint_b)"
expect_exit 1 "demo: --reset with an uncovered tenant table" demo --reset --target coolify --app-uuid "$b" --db-uuid "$bdb"
expect_stderr "demo: the reset names the uncovered table" "zz_new_tenant_table"
expect_eq "demo: the guard fired before any delete" "absent" "$(grep -qF 'DELETE REACHED' "$scratch/err" && echo reached || echo absent)"
expect_eq "demo: the failed reset changed nothing" "$before" "$(fingerprint_b)"
q "DROP TRIGGER zz_delete_reached ON public.payment_tenders; DROP FUNCTION public.zz_delete_reached(); DROP TABLE public.zz_new_tenant_table" >/dev/null

# The verifier's reproduction: bootstrap next to the demo (its admin is
# `admin`), then the demo refuses to reset a database with a real tenant.
expect_exit 3 "bootstrap next to the demo: taken username" bootstrap --target coolify --app-uuid "$b" --db-uuid "$bdb" "La Otra Mesa" admin@otra.example
expect_exit 0 "bootstrap next to the demo: --username" bootstrap --target coolify --app-uuid "$b" --db-uuid "$bdb" --username admin.otra "La Otra Mesa" admin@otra.example
before="$(fingerprint_b)"
expect_exit 3 "demo: --reset with a non-demo restaurant" demo --reset --target coolify --app-uuid "$b" --db-uuid "$bdb"
expect_eq "demo: the refused reset changed nothing" "$before" "$(fingerprint_b)"

echo "seed contract: $passed passed, $failed failed"
((failed == 0))
