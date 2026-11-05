#!/usr/bin/env bash
# Provisions one application on the shared MinIO: bucket, anonymous read of
# objects, dedicated user and a policy limited to that bucket's objects.
# Idempotent: re-running keeps the existing user and secret unless --rotate.
#
# Usage:
#   MINIO_ROOT_USER=... MINIO_ROOT_PASSWORD=... \
#   MINIO_NETWORK=<docker network of the minio service> \
#   S3_PUBLIC_ENDPOINT=https://<s3-domain> \
#     deploy/shared-storage/provision-app.sh [--rotate] <bucket> <app-user>
#
# Environment:
#   MINIO_ROOT_USER, MINIO_ROOT_PASSWORD  root credentials (required, never printed)
#   MINIO_URL           URL mc uses to reach MinIO (default http://minio:9000)
#   MINIO_NETWORK       docker network to attach the mc container to (optional;
#                       leave empty when MINIO_URL is the public S3 domain)
#   S3_PUBLIC_ENDPOINT  public S3 URL written into the printed block
#                       (default MINIO_URL)
#
# Exit codes:
#   0  provisioned (user created, rotated or kept)
#   1  MinIO error, including an existing user's info that cannot be read;
#      nothing is changed when that check fails
#   2  usage error: invalid bucket or user name, or <app-user> equal to
#      MINIO_ROOT_USER; nothing is changed
#   3  <app-user> already exists with a policy for another bucket (one user
#      per bucket); nothing is changed
#
# stdout carries only the final S3_* block; every progress line goes to stderr.
set -euo pipefail

MC_IMAGE=cgr.dev/chainguard/minio-client@sha256:39768db4c3fa811bc8f2e2a3e0add8ea391648b1c980de179985e1c353dc1805

usage() {
  echo "usage: $0 [--rotate] <bucket> <app-user>" >&2
  exit 2
}

ROTATE=0
args=()
for arg in "$@"; do
  case "$arg" in
    --rotate) ROTATE=1 ;;
    -*) usage ;;
    *) args+=("$arg") ;;
  esac
done
[ "${#args[@]}" -eq 2 ] || usage
BUCKET=${args[0]}
APP_USER=${args[1]}

# S3 bucket naming rules (lowercase, digits, dots, hyphens; 3-63 chars).
[[ "$BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || { echo "invalid bucket name: $BUCKET" >&2; exit 2; }
[[ "$APP_USER" =~ ^[A-Za-z0-9._-]{3,64}$ ]] || { echo "invalid app user: $APP_USER" >&2; exit 2; }
: "${MINIO_ROOT_USER:?define MINIO_ROOT_USER}"
: "${MINIO_ROOT_PASSWORD:?define MINIO_ROOT_PASSWORD}"
[ "$APP_USER" != "$MINIO_ROOT_USER" ] || { echo "app user must not be MINIO_ROOT_USER" >&2; exit 2; }
MINIO_URL=${MINIO_URL:-http://minio:9000}
S3_PUBLIC_ENDPOINT=${S3_PUBLIC_ENDPOINT:-$MINIO_URL}
S3_PUBLIC_ENDPOINT=${S3_PUBLIC_ENDPOINT%/}

# Generated on the host; only used if the user is created or rotated.
APP_SECRET=$(od -An -tx1 -N24 /dev/urandom | tr -d ' \n')

export MINIO_ROOT_USER MINIO_ROOT_PASSWORD MINIO_URL BUCKET APP_USER APP_SECRET ROTATE

network=()
[ -n "${MINIO_NETWORK:-}" ] && network=(--network "$MINIO_NETWORK")

# Values travel as inherited env (-e NAME), never on a command line: mc reads
# the root credentials and the app user and secret from stdin (printf is a
# builtin of the image's busybox sh). mc alias set takes the password as is;
# MC_HOST_* would need it percent-encoded and this mc does not decode it.
# The container writes only "created", "rotated" or "kept" to stdout.
state=$(docker run --rm -i "${network[@]}" \
  -e MINIO_ROOT_USER -e MINIO_ROOT_PASSWORD -e MINIO_URL -e BUCKET -e APP_USER -e APP_SECRET -e ROTATE \
  --entrypoint /bin/sh "$MC_IMAGE" -s <<'SH'
set -eu
log() { echo "$*" >&2; }
POLICY="app-$BUCKET"
printf '%s\n%s\n' "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" | mc alias set local "$MINIO_URL" >/dev/null

# One user per bucket: refuse an existing user bound to any other policy,
# before touching the bucket, the user or its policies. Only mc's
# XMinioAdminNoSuchUser answer means "create"; any other failure aborts.
fail() { log "cannot read user $APP_USER: $1; nothing changed"; exit 1; }
if info=$(mc admin user info --json local "$APP_USER" 2>/dev/null); then
  exists=1
  case "$info" in *'"status":"success"'*) ;; *) fail "unexpected answer" ;; esac
  # A user with no policy has no policyName key; a key that does not parse aborts.
  policies=$(echo "$info" | sed -n 's/.*"policyName":"\([^"]*\)".*/\1/p')
  case "$info" in *'"policyName"'*) [ -n "$policies" ] || fail "unparsable policyName" ;; esac
  for p in $(echo "$policies" | tr ',' ' '); do
    if [ "$p" != "$POLICY" ]; then
      log "user $APP_USER already has policies: $policies; refusing to attach $POLICY (one user per bucket)"
      exit 3
    fi
  done
else
  case "$info" in
    *'"Code":"XMinioAdminNoSuchUser"'*) exists=0 ;;
    *) fail "$(echo "$info" | sed -n 's/.*"Code":"\([^"]*\)".*/\1/p')" ;;
  esac
fi

mc mb --ignore-existing "local/$BUCKET" >&2

# Anyone may read an object by its key; nobody may list the bucket.
printf '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":["*"]},"Action":["s3:GetObject"],"Resource":["arn:aws:s3:::%s/*"]}]}' \
  "$BUCKET" > /tmp/anonymous.json
mc anonymous set-json /tmp/anonymous.json "local/$BUCKET" >&2

# The API only presigns PUTs and deletes by key: no s3:ListBucket.
printf '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:DeleteObject"],"Resource":["arn:aws:s3:::%s/*"]}]}' \
  "$BUCKET" > /tmp/policy.json
mc admin policy create local "$POLICY" /tmp/policy.json >&2

add_user() { printf '%s\n%s\n' "$APP_USER" "$APP_SECRET" | mc admin user add local >/dev/null; }
if [ "$exists" = 1 ]; then
  if [ "$ROTATE" = 1 ]; then
    add_user
    state=rotated
  else
    state=kept
  fi
else
  add_user
  state=created
fi
log "user $APP_USER: $state"

if mc admin user info --json local "$APP_USER" | grep -q "\"$POLICY\""; then
  log "policy $POLICY already attached"
else
  mc admin policy attach local "$POLICY" --user "$APP_USER" >&2
fi
echo "$state"
SH
)

if [ "$state" = kept ]; then
  secret_line="# S3_SECRET_ACCESS_KEY sin cambios (usuario existente; usar --rotate para generar uno nuevo)"
else
  secret_line="S3_SECRET_ACCESS_KEY=$APP_SECRET"
  echo "ATENCIÓN: el secreto se muestra una sola vez. Cópielo ahora en el entorno de la aplicación." >&2
fi

# us-east-1 is MinIO's default region, the one SigV4 signatures are made for.
cat <<EOF
S3_ENDPOINT=$S3_PUBLIC_ENDPOINT
S3_REGION=us-east-1
S3_BUCKET=$BUCKET
S3_ACCESS_KEY_ID=$APP_USER
$secret_line
S3_PUBLIC_BASE_URL=$S3_PUBLIC_ENDPOINT/$BUCKET
S3_FORCE_PATH_STYLE=true
EOF
