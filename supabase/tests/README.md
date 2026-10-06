# Database tests (pgTAP)

Database-level tests live in this directory as `*.test.sql` files and are run with
[pgTAP](https://pgtap.org/) through the Supabase CLI (`supabase test db` runs
[pg_prove](https://pgtap.org/) against the local database started by
`pnpm supabase start`):

```bash
pnpm test:db                                             # every test file
pnpm supabase test db supabase/tests/001_bootstrap.test.sql
```

## Writing a test

- One file per behaviour, named `NNN_something.test.sql` (`NNN` controls run order).
- Each file is **self-contained**: pg_prove does not wrap anything for you, so the
  file opens and closes its own transaction:

  ```sql
  BEGIN;
  CREATE EXTENSION IF NOT EXISTS pgtap;
  SET LOCAL search_path = public, extensions;
  SELECT plan(3);
  -- assertions...
  SELECT * FROM finish();
  ROLLBACK;
  ```

  `SET LOCAL search_path` covers both cases: Supabase pre-installs pgtap in
  `extensions`, while a bare `CREATE EXTENSION` lands in `public`.
- Declare the plan as the first assertion statement (`SELECT plan(N);`) and emit
  exactly N assertions, otherwise pgTAP reports a mismatch and the file fails.
- Use pgTAP assertions (`has_table`, `has_column`, `has_function`, `ok`,
  `is`, `cmp_ok`, `throws_ok`, `results_eq`, `lives_ok`); never bare `SELECT`s.
- Run a single file while iterating:
  `pnpm supabase test db supabase/tests/010_my_test.test.sql`.

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

## Tenant isolation test pattern

`010_tenant_isolation.test.sql` is the reference pattern for anything that
touches tenancy. Every test that needs a real caller follows the same four
beats, all inside the one rolled-back transaction:

1. **Build a tenant as the test author.** Two `public.restaurants` rows, one
   `auth.users` row per tenant, and a `profiles` row per user carrying the
   right `restaurant_id`. `handle_new_user()` creates the profile when the
   `auth.users` row lands, so re-point it with an `UPDATE` rather than
   inserting a second one (`profiles.auth_user_id` is unique).
2. **Forge the JWT.** Set `request.jwt.claims` with a `sub` and a
   `user_metadata.restaurant_id` that **lies** (points at the other tenant).
   Tenancy must be resolved from `profiles.auth_user_id`, so the lie must make
   no difference. A claims blob with no `sub` at all covers the reverse case:
   no `sub` means no rows, never a bypass.
3. **Switch and stay switched.** `SET LOCAL ROLE authenticated;` once, run
   every pgTAP assertion for that caller, then `RESET ROLE` before the next
   `set_config`. pgTAP functions are callable under `authenticated`, so
   assertions may observe the impersonated session directly. Wrap `INSERT`s
   that must be rejected in `throws_ok(sql, '42501', <message>, <description>)`
   — the four-argument form, because the three-argument one is
   `(sql, errcode, errmsg)`.
4. **Verify writes as the author.** RLS filters `UPDATE`/`DELETE` silently, so
   `RESET ROLE` and count rows afterwards to prove nothing outside the caller's
   tenant moved.

Two fixture facts worth copying: `public.categories.icon` is `NOT NULL`, and a
column `DEFAULT private.current_restaurant_id()` resolves to `NULL` outside an
authenticated session, so fixtures inserted as `postgres` must pass
`restaurant_id` explicitly or the `NOT NULL` constraint rejects the row.

## Everything is rolled back

Each file runs as:

```sql
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
-- test file contents --
SELECT * FROM finish();
ROLLBACK;
```

Consequences:

- The database is left exactly as it was: no rows, no schema changes, no test
  fixtures, and the pgtap extension disappears again if it was not installed
  before the run.
- A failing file aborts the transaction, so a red test cannot poison the next one.