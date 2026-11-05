#!/usr/bin/env bash
# Loads the demo restaurant (seed/demo/demo.sql) for the staging demo, which
# is reachable only from the Tailscale network (odd/tasks/migracion-backend-nestjs.md,
# T16, L31): staff for every role, menu, tables, inventory and preparations,
# 30 days of history and live orders.
#
#   DEMO_PASSWORD=... demo-db.sh [--reset] [--target local|coolify] [--app-uuid <uuid>]
#
# DEMO_PASSWORD (12+ characters) is the password of every demo account
# (<role>@demo.vipe.pos, listed in docs/despliegue.md). It is hashed with
# argon2id by the API's `argon2` dependency, reading it on stdin, and only the
# hash reaches psql, also on stdin.
#
# Refuses a target that already has restaurants. --reset first deletes the
# restaurants the demo seed created (seed/demo/reset.sql) and seeds again, in
# one transaction; it still refuses when another restaurant exists. Every
# write runs as vipe_migrator (target.sh), whatever user psql connects as.
#
# Targets (seed/bootstrap/target.sh): local is the dev stack of
# docker-compose.yml, database $VIPE_DEMO_DB (default vipe_demo, created and
# migrated when missing, so the dev database keeps its own seed); coolify runs
# psql and node with `docker exec` in the containers of the Coolify app given
# by --app-uuid or VIPE_COOLIFY_APP_UUID (required, no default: a missing
# uuid must never load the demo into another app's database).
#
# Exit codes (`pnpm db:demo` passes them through with pnpm 11; other pnpm
# versions may report any failure as 1):
#   0  demo loaded
#   1  any other failure (nothing is written: one transaction)
#   2  invalid usage, DEMO_PASSWORD or app uuid
#   3  the target already has restaurants (without --reset), or has
#      restaurants the demo seed did not create
set -euo pipefail

seed_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../bootstrap/target.sh
source "$seed_dir/../bootstrap/target.sh"

usage() {
  sed -n '7p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

reset=false
target=local
while (($#)); do
  case "$1" in
    --reset) reset=true; shift ;;
    --target) [[ $# -ge 2 ]] || usage; target="$2"; shift 2 ;;
    --app-uuid) [[ $# -ge 2 ]] || usage; VIPE_COOLIFY_APP_UUID="$2"; VIPE_COOLIFY_APP_UUID_GIVEN=1; shift 2 ;;
    -h | --help) usage ;;
    *) echo "error: unknown argument $1" >&2; usage ;;
  esac
done

if [[ -z "${DEMO_PASSWORD:-}" ]]; then
  target_die "DEMO_PASSWORD is empty: set the password of the demo accounts (12+ characters)" 2
fi
if [[ ${#DEMO_PASSWORD} -lt 12 ]]; then
  target_die "DEMO_PASSWORD must have at least 12 characters" 2
fi

TARGET_DB="${VIPE_DEMO_DB:-vipe_demo}"
target_init "$target"
target_prepare

counts="$(target_query -At -c "SELECT count(*) || ' ' || count(*) FILTER (WHERE EXISTS (
  SELECT 1 FROM public.business_config bc
   WHERE bc.restaurant_id = r.id AND bc.key = 'demo_seed' AND bc.value = 'true'))
  FROM public.restaurants r")" || exit 1
read -r restaurants demo_restaurants <<<"$counts"

if [[ "$restaurants" != 0 && "$reset" != true ]]; then
  target_die "the target already has $restaurants restaurant(s); nothing was changed (use --reset to replace the demo)" 3
fi
if [[ "$restaurants" != "$demo_restaurants" ]]; then
  target_die "the target has $((restaurants - demo_restaurants)) restaurant(s) not created by the demo seed; nothing was changed" 3
fi

hash="$(printf '%s' "$DEMO_PASSWORD" | target_hash)" || exit 1

echo "loading the demo restaurant ($target)..." >&2
{
  printf '\\set demo_hash %s\n' "$(target_psql_quote "$hash")"
  printf '\\set admin_hash %s\n' "$(target_psql_quote "$hash")"
  printf '\\set restaurant_name %s\n' "'Casa Guadua'"
  printf '\\set admin_email %s\n' "'admin@demo.vipe.pos'"
  printf '\\set admin_name %s\n' "'Mariana Restrepo Gil'"
  printf '\\set admin_username %s\n' "'admin'"
  echo 'BEGIN;'
  echo "$TARGET_OWNER_SQL"
  if [[ "$reset" == true ]]; then
    cat "$seed_dir/reset.sql"
  fi
  cat "$seed_dir/../bootstrap/create-restaurant.sql"
  cat "$seed_dir/demo.sql"
  echo 'COMMIT;'
} | target_psql || target_die "the demo was not loaded (see the psql error above)"

target_query -At -F ': ' <<'SQL'
SELECT 'restaurant', r.name FROM public.restaurants r
 WHERE EXISTS (SELECT 1 FROM public.business_config bc WHERE bc.restaurant_id = r.id AND bc.key = 'demo_seed');
SELECT 'staff', string_agg(role || ' ' || n, ', ' ORDER BY role)
  FROM (SELECT role, count(*) AS n FROM public.profiles GROUP BY role) s;
SELECT 'categories / dishes / tables', (SELECT count(*) FROM public.categories) || ' / '
       || (SELECT count(*) FROM public.dishes) || ' / ' || (SELECT count(*) FROM public.tables);
SELECT 'orders (paid / open / cancelled)', count(*) FILTER (WHERE status = 'paid') || ' / '
       || count(*) FILTER (WHERE status IN ('kitchen', 'delivered')) || ' / '
       || count(*) FILTER (WHERE status = 'cancelled') FROM public.orders;
SELECT 'payments / registers / deliveries', (SELECT count(*) FROM public.payments) || ' / '
       || (SELECT count(*) FROM public.cash_registers) || ' / ' || (SELECT count(*) FROM public.order_deliveries);
SQL
echo "demo accounts: admin@demo.vipe.pos and the staff under @demo.vipe.pos, password DEMO_PASSWORD" >&2
