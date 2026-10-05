#!/usr/bin/env bash
#
# pgTAP test runner for the local Supabase database.
#
# Every test file is executed inside its own transaction that is always rolled
# back, so running the suite never mutates the database (including the pgtap
# extension itself, which is created inside the transaction).
#
# Usage:
#   scripts/db-test.sh                      # run supabase/tests/**/*.test.sql
#   scripts/db-test.sh supabase/tests/x.test.sql
#   scripts/db-test.sh 'supabase/tests/00*.test.sql'
#
# Environment:
#   DB_CONTAINER  docker container running postgres (default: supabase-db)
#   DB_USER       database user (default: postgres)
#   DB_NAME       database name (default: postgres)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TESTS_DIR="$REPO_ROOT/supabase/tests"

DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-postgres}"

die() {
	printf 'db-test: %s\n' "$1" >&2
	exit "${2:-2}"
}

relative_path() {
	printf '%s\n' "${1#"$REPO_ROOT"/}"
}

# --- Test discovery --------------------------------------------------------

FILES=()

collect_files() {
	if (($# == 0)); then
		mapfile -t FILES < <(find "$TESTS_DIR" -type f -name '*.test.sql' | LC_ALL=C sort)
		return
	fi

	for pattern in "$@"; do
		matches=()
		mapfile -t matches < <(compgen -G "$pattern" || true)
		# Allow bare file names such as `000_schema_smoke.test.sql`.
		if ((${#matches[@]} == 0)) && [[ "$pattern" != */* && "$pattern" != *'*'* ]]; then
			mapfile -t matches < <(compgen -G "$TESTS_DIR/$pattern" || true)
		fi
		if ((${#matches[@]} == 0)); then
			die "no test file matches \"$pattern\""
		fi
		FILES+=("${matches[@]}")
	done
}

collect_files "$@"

if ((${#FILES[@]} == 0)); then
	die "no *.test.sql files found under $(relative_path "$TESTS_DIR")"
fi

# --- Container check -------------------------------------------------------

if ! docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" >/dev/null 2>&1; then
	die "container \"$DB_CONTAINER\" not found (is the stack up? try: pnpm docker:dev)"
fi

if [[ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER")" != "true" ]]; then
	die "container \"$DB_CONTAINER\" is not running (is the stack up? try: pnpm docker:dev)"
fi

# --- Run -------------------------------------------------------------------

run_test() {
	local file="$1"
	local sql output

	sql="$(printf 'BEGIN;\nCREATE EXTENSION IF NOT EXISTS pgtap SCHEMA public;\n%s\nSELECT * FROM finish(true);\nROLLBACK;' "$(cat "$file")")"

	if output="$(printf '%s\n' "$sql" | docker exec -i "$DB_CONTAINER" \
		psql -X -q -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" 2>&1)"; then
		# psql succeeded: `finish(true)` did not raise. Guard the cases where
		# pgTAP only emits a diagnostic without failing the session, e.g. a
		# plan/count mismatch ("Looks like you planned N tests but ran M").
		if grep -Eq '(^|[[:space:]])not ok [0-9]+|Looks like you planned|No tests run' <<<"$output"; then
			printf 'FAIL %s\n' "$(relative_path "$file")"
			printf '%s\n' "$output" | sed 's/^/    /'
			return 1
		fi
		printf 'PASS %s\n' "$(relative_path "$file")"
		return 0
	fi

	printf 'FAIL %s\n' "$(relative_path "$file")"
	printf '%s\n' "$output" | sed 's/^/    /'
	return 1
}

passed=0
failed=0

printf 'pgTAP: %s test file(s) against %s (%s/%s)\n\n' \
	"${#FILES[@]}" "$DB_CONTAINER" "$DB_USER" "$DB_NAME"

for file in "${FILES[@]}"; do
	if run_test "$file"; then
		passed=$((passed + 1))
	else
		failed=$((failed + 1))
	fi
done

printf '\n%d passed, %d failed, %d total\n' "$passed" "$failed" "${#FILES[@]}"

if ((failed > 0)); then
	exit 1
fi