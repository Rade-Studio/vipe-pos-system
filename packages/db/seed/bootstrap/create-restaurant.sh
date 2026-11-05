#!/usr/bin/env bash
# Creates one restaurant and its first admin user on a database that has none
# (odd/tasks/migracion-backend-nestjs.md, T17): the app has no signup screen.
#
#   create-restaurant.sh [--target local|coolify] [--admin-name "<full name>"] \
#     "<restaurant name>" <admin email>
#
# The admin password is read from ADMIN_PASSWORD or, when that is unset or
# empty, from the first line of stdin (a silent prompt on a terminal). It is
# never an argument. At least 12 characters; hashed with argon2id by the
# API's `argon2` dependency (node in apps/api locally, in the `api` container
# on Coolify) and sent to psql on stdin.
#
# Targets (seed/bootstrap/target.sh): local is the dev stack of
# docker-compose.yml, database $VIPE_DB_NAME (default vipe_pos); coolify runs
# psql and node with `docker exec` in the containers of the Coolify app
# $VIPE_COOLIFY_APP_UUID (default zyxpf2vqnowxdolrgne8vxew, staging).
#
# Exit codes:
#   0  restaurant and admin created
#   1  any other failure (nothing is written: one transaction)
#   2  invalid usage, name, email or password
#   3  a restaurant with that name or a user with that email already exists
set -euo pipefail

# shellcheck source=target.sh
source "$(dirname "${BASH_SOURCE[0]}")/target.sh"

usage() {
  sed -n '5,6p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

target=local
admin_name=Administrador
positional=()
while (($#)); do
  case "$1" in
    --target) [[ $# -ge 2 ]] || usage; target="$2"; shift 2 ;;
    --admin-name) [[ $# -ge 2 ]] || usage; admin_name="$2"; shift 2 ;;
    -h | --help) usage ;;
    --*) echo "error: unknown option $1" >&2; usage ;;
    *) positional+=("$1"); shift ;;
  esac
done
[[ ${#positional[@]} -eq 2 ]] || usage
restaurant_name="${positional[0]}"
admin_email="${positional[1]}"

no_control() { [[ "$1" != *[[:cntrl:]]* ]]; }
trimmed_name="$(printf '%s' "$restaurant_name" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
if [[ -z "$trimmed_name" || ${#trimmed_name} -gt 120 ]] || ! no_control "$restaurant_name"; then
  target_die "the restaurant name must have 1..120 characters on one line" 2
fi
if [[ ! "$admin_email" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || ! no_control "$admin_email"; then
  target_die "the admin email is not valid: $admin_email" 2
fi
if [[ -z "$admin_name" || ${#admin_name} -gt 100 ]] || ! no_control "$admin_name"; then
  target_die "the admin name must have 1..100 characters on one line" 2
fi

password="${ADMIN_PASSWORD:-}"
if [[ -z "$password" ]]; then
  if [[ -t 0 ]]; then
    read -r -s -p "Admin password (12+ characters): " password
    echo >&2
  else
    IFS= read -r password || true
  fi
fi
if [[ ${#password} -lt 12 ]]; then
  target_die "the admin password must have at least 12 characters (ADMIN_PASSWORD or stdin)" 2
fi

TARGET_DB="${VIPE_DB_NAME:-vipe_pos}"
target_init "$target"
target_prepare

name_q="$(target_psql_quote "$trimmed_name")"
email_q="$(target_psql_quote "$admin_email")"
existing="$(printf '\\set n %s\n\\set e %s\n%s\n' "$name_q" "$email_q" \
  "SELECT (SELECT count(*) FROM public.restaurants WHERE lower(btrim(name)) = lower(:'n'))
       || ' ' || (SELECT count(*) FROM public.users WHERE email = lower(btrim(:'e'))::public.citext);" \
  | target_psql -At)"
read -r same_name same_email <<<"$existing"
if [[ "$same_name" != 0 ]]; then
  target_die "a restaurant named \"$trimmed_name\" already exists; nothing was changed" 3
fi
if [[ "$same_email" != 0 ]]; then
  target_die "a user with email $admin_email already exists; nothing was changed" 3
fi

hash="$(printf '%s' "$password" | target_hash)"
unset password

script_dir="$(dirname "${BASH_SOURCE[0]}")"
result="$({
  printf '\\set restaurant_name %s\n' "$name_q"
  printf '\\set admin_email %s\n' "$email_q"
  printf '\\set admin_name %s\n' "$(target_psql_quote "$admin_name")"
  printf '\\set admin_hash %s\n' "$(target_psql_quote "$hash")"
  echo 'BEGIN;'
  cat "$script_dir/create-restaurant.sql"
  echo "SELECT r.slug || ' ' || r.id FROM public.restaurants r WHERE r.id = current_setting('vipe.restaurant_id')::uuid;"
  echo 'COMMIT;'
} | target_psql -At)" || target_die "the restaurant was not created (see the psql error above)"

read -r slug restaurant_id <<<"$result"
echo "restaurant created: $trimmed_name (slug $slug, id $restaurant_id)"
echo "first admin: $(printf '%s' "$admin_email" | tr '[:upper:]' '[:lower:]'); log in and add the staff from Personal"
