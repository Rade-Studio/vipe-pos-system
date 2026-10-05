# Database tests (pgTAP)

Database-level tests live in this directory as `*.test.sql` files and are run
with [pgTAP](https://pgtap.org/) against the running `supabase-db` container:

```bash
pnpm test:db                                    # every test file, sorted
bash scripts/db-test.sh supabase/tests/000_schema_smoke.test.sql
DB_CONTAINER=other-db bash scripts/db-test.sh   # override the container
```

## Writing a test

- One file per behaviour, named `NNN_something.test.sql` (`NNN` controls run order).
- Every file declares its own plan as the first statement: `SELECT plan(3);`
  and then emits exactly three assertions, otherwise pgTAP reports a mismatch.
- Use pgTAP assertions (`has_table`, `has_column`, `has_function`, `ok`,
  `is`, `throws_ok`, `results_eq`, `lives_ok`); never bare `SELECT`s.
- Run a single file while iterating:
  `bash scripts/db-test.sh supabase/tests/010_my_test.test.sql`.

## Impersonating roles for RLS tests

`SET LOCAL ROLE` applies only to the current transaction (which is always rolled
back), so impersonation never leaks between files:

```sql
SET LOCAL ROLE anon;
SELECT lives_ok($$ SELECT * FROM public.orders $$);

RESET ROLE;  -- back to the test author (superuser) inside the transaction
```

For `authenticated`, seed the JWT claims first so `auth.uid()` /
`auth.role()` resolve, then impersonate the role:

```sql
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
```

`true` as the third argument makes the setting transaction-local, matching the
`SET LOCAL ROLE` scope. Note that `auth.uid()` reads `sub` from
`request.jwt.claims`; profiles or rows you assert against must exist for that
same `sub`, otherwise the RLS predicate under test evaluates to false.

## Everything is rolled back

Each file runs as:

```sql
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap SCHEMA public;
-- test file contents --
SELECT * FROM finish(true);  -- raises when a test failed
ROLLBACK;
```

Consequences:

- The database is left exactly as it was: no rows, no schema changes, no test
  fixtures, and the pgtap extension disappears again if it was not installed
  before the run.
- A failing file aborts the transaction, so a red test cannot poison the next one.