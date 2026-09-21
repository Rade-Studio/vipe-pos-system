#!/usr/bin/env bash
# post-auth-init.sh
# Runs after GoTrue is healthy to apply user migrations that depend on auth.users.
# Wired into docker-compose as a one-shot init container after supabase-auth.

set -euo pipefail

echo "[post-auth-init] Waiting for GoTrue to be reachable..."
for i in $(seq 1 60); do
  if (echo > /dev/tcp/supabase-auth/9999) 2>/dev/null; then
    echo "[post-auth-init] GoTrue reachable after ${i}s"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "[post-auth-init] TIMEOUT: GoTrue not reachable after 60s"
    exit 1
  fi
  sleep 1
done

# Give auth a few more seconds to finish schema migrations
echo "[post-auth-init] Waiting 5s for auth schema to settle..."
sleep 5

echo "[post-auth-init] Applying user migrations..."
for MIGRATION in /migrations/*.sql; do
  echo "[post-auth-init] Applying $(basename "$MIGRATION")"
  psql -h db -U postgres -d postgres -v ON_ERROR_STOP=1 -f "$MIGRATION" || {
    echo "[post-auth-init] FAILED on $MIGRATION"
    exit 1
  }
done

echo "[post-auth-init] Applying seed..."
psql -h db -U postgres -d postgres -v ON_ERROR_STOP=1 -f /seed.sql || {
  echo "[post-auth-init] Seed had warnings (may be idempotent, continuing)"
}

echo "[post-auth-init] Done."