#!/usr/bin/env bash
# Creates one restaurant and its first admin user on a database that has none
# (odd/tasks/migracion-backend-nestjs.md, T17): the app has no signup screen.
#
#   create-restaurant.sh [--target local|coolify] [--app-uuid <uuid>] \
#     [--admin-name "<full name>"] [--username <login name>] \
#     "<restaurant name>" <admin email>
#
# The admin password is read from ADMIN_PASSWORD or, when that is unset or
# empty, from the first line of stdin (a silent prompt on a terminal). It is
# never an argument. At least 12 characters; hashed with argon2id by the
# API's `argon2` dependency (node in apps/api locally, in the `api` container
# on Coolify) and sent to psql on stdin.
#
# --username is the admin's profile username, unique across the database;
# it defaults to the part of the email before the @ (1..50 characters, no
# spaces). An empty --username exits 2.
#
# Targets (seed/bootstrap/target.sh): local is the dev stack of
# docker-compose.yml, database $VIPE_DB_NAME (default vipe_pos); coolify runs
# psql and node with `docker exec` in the containers of the Coolify app given
# by --app-uuid or VIPE_COOLIFY_APP_UUID (required, no default).
#
# Exit codes (`pnpm db:create-restaurant` passes them through unchanged):
#   0  restaurant and admin created
#   1  any other failure (nothing is written: one transaction)
#   2  invalid usage, name, email, username, password or app uuid
#   3  a restaurant with that name, a user with that email or a profile with
#      that username already exists, including one created concurrently
set -euo pipefail

# shellcheck source=target.sh
source "$(dirname "${BASH_SOURCE[0]}")/target.sh"

usage() {
  sed -n '5,7p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

target=local
admin_name=Administrador
username=
username_given=false
positional=()
while (($#)); do
  case "$1" in
    --target) [[ $# -ge 2 ]] || usage; target="$2"; shift 2 ;;
    --app-uuid) [[ $# -ge 2 ]] || usage; VIPE_COOLIFY_APP_UUID="$2"; shift 2 ;;
    --admin-name) [[ $# -ge 2 ]] || usage; admin_name="$2"; shift 2 ;;
    --username) [[ $# -ge 2 ]] || usage; username="$2"; username_given=true; shift 2 ;;
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
admin_email="$(printf '%s' "$admin_email" | tr '[:upper:]' '[:lower:]')"
if [[ "$username_given" == true && -z "$username" ]]; then
  target_die "--username is empty; omit it to use the part of the email before the @" 2
fi
if [[ "$username_given" == false ]]; then
  username="${admin_email%%@*}"
  username_hint=" (taken from the email; choose another with --username)"
else
  username_hint=
fi
if [[ ${#username} -gt 50 || "$username" =~ [[:space:][:cntrl:]] ]]; then
  target_die "the username '$username' must have 1..50 characters and no spaces$username_hint" 2
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
username_q="$(target_psql_quote "$username")"
existing="$(printf '\\set n %s\n\\set e %s\n\\set u %s\n%s\n' "$name_q" "$email_q" "$username_q" \
  "SELECT (SELECT count(*) FROM public.restaurants WHERE lower(btrim(name)) = lower(:'n'))
       || ' ' || (SELECT count(*) FROM public.users WHERE email = :'e'::public.citext)
       || ' ' || (SELECT count(*) FROM public.profiles WHERE username = :'u');" \
  | target_query -At)" || exit 1
read -r same_name same_email same_username <<<"$existing"
if [[ "$same_name" != 0 ]]; then
  target_die "a restaurant named \"$trimmed_name\" already exists; nothing was changed" 3
fi
if [[ "$same_email" != 0 ]]; then
  target_die "a user with email $admin_email already exists; nothing was changed" 3
fi
if [[ "$same_username" != 0 ]]; then
  target_die "the username '$username' is already taken$username_hint; nothing was changed" 3
fi

hash="$(printf '%s' "$password" | target_hash)" || exit 1
unset password

# stderr is folded into the captured output so a unique violation raised
# inside the transaction (a concurrent run) can be told apart: create-restaurant.sql
# reports every one of them as "conflict: ...".
script_dir="$(dirname "${BASH_SOURCE[0]}")"
output="$({
  printf '\\set restaurant_name %s\n' "$name_q"
  printf '\\set admin_email %s\n' "$email_q"
  printf '\\set admin_name %s\n' "$(target_psql_quote "$admin_name")"
  printf '\\set admin_username %s\n' "$username_q"
  printf '\\set admin_hash %s\n' "$(target_psql_quote "$hash")"
  echo 'BEGIN;'
  echo "$TARGET_OWNER_SQL"
  cat "$script_dir/create-restaurant.sql"
  echo "SELECT r.slug || ' ' || r.id FROM public.restaurants r WHERE r.id = current_setting('vipe.restaurant_id')::uuid;"
  echo 'COMMIT;'
} | target_psql -At 2>&1)" && status=0 || status=$?
if ((status != 0)); then
  printf '%s\n' "$output" >&2
  if grep -q '^ERROR: *conflict: ' <<<"$output"; then
    target_die "the restaurant, the email or the username was taken while this ran; nothing was changed" 3
  fi
  target_die "the restaurant was not created (see the psql error above)"
fi

read -r slug restaurant_id <<<"$(tail -n 1 <<<"$output")"
echo "restaurant created: $trimmed_name (slug $slug, id $restaurant_id)"
echo "first admin: $admin_email (username $username); log in and add the staff from Personal"
