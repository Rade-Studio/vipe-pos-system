#!/usr/bin/env bash
# Step 5 of the cut-over: run verify.sql against the imported target.
#
#   TARGET_DATABASE_URL='postgres://postgres:<password>@<host>:5432/vipe_pos' \
#   S3_PUBLIC_BASE_URL='https://<bucket public URL>' \
#     bash packages/db/migration-from-supabase/verify.sh
#
# Exits non-zero when any check fails. Writes only session temp tables.
set -euo pipefail
TOOL_NAME=verify
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_pg_url TARGET_DATABASE_URL
[ -n "${S3_PUBLIC_BASE_URL:-}" ] || die "S3_PUBLIC_BASE_URL is required"
log "target: $(redact_url "$TARGET_DATABASE_URL")"
pg_tool TARGET_DATABASE_URL psql -X -q -v ON_ERROR_STOP=1 -v s3_public_base_url="${S3_PUBLIC_BASE_URL%/}" \
  -f "$TOOLKIT_DIR/verify.sql"
