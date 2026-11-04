# Database tests (pgTAP, plain Postgres)

Database-level tests live in this directory as `*.test.sql` files and run with
[pgTAP](https://pgtap.org/) through `pg_prove` on plain Postgres 16, with no
Supabase component:

```bash
pnpm test:db                                                  # every test file
pnpm test:db packages/db/tests/010_tenant_isolation.test.sql  # one file
```

`scripts/test-db.sh` starts the compose `db` service (`docker/Dockerfile`:
`postgres:16` + pgTAP + pg_prove), recreates the throwaway database
`vipe_pos_test`, applies `migrations/` as `vipe_migrator` with
`pnpm db:migrate`, loads `seed.sql` as the superuser and runs the files inside
the container. Set `VIPE_DB_PORT` when 5432 is taken on the host.

These files were ported from `supabase/tests/` (task T4 of
`odd/tasks/migracion-backend-nestjs.md`); that directory stays until Supabase is
removed (T13).

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

  The `extensions` entry is harmless on plain Postgres (the schema does not
  exist) and keeps the header identical to the Supabase-era files.
- Declare the plan as the first assertion statement (`SELECT plan(N);`) and emit
  exactly N assertions, otherwise pgTAP reports a mismatch and the file fails.
- Use pgTAP assertions (`has_table`, `has_column`, `has_function`, `ok`,
  `is`, `cmp_ok`, `throws_ok`, `results_eq`, `lives_ok`); never bare `SELECT`s.

## Roles

| Role | Meaning |
| --- | --- |
| `postgres` | Test author (superuser). Fixtures are inserted as this role. |
| `vipe_api` | The API's runtime role: no superuser, no BYPASSRLS, NOINHERIT. RLS always applies. |
| `vipe_migrator` | Schema owner; runs migrations. Owner of every SECURITY DEFINER function, so the guard triggers treat it (and `postgres`) as the trusted RPC path. |
| `PUBLIC` | Every other role on the server. Privilege tests assert it holds nothing. |

There is no `anon`, `authenticated` or `service_role`. When a test needs a
caller with no grants at all, create a throwaway role inside the transaction:
`CREATE ROLE vipe_test_outsider NOLOGIN; SET LOCAL ROLE vipe_test_outsider;`.

## Impersonating a user

The caller is whatever `app.user_id` says, exactly as the API does with
`SET LOCAL app.user_id = '<uuid>'` at the start of every request transaction.
`private.current_user_id()` reads it; `private.current_restaurant_id()` and
`private.current_app_role()` resolve the tenant and role through
`profiles.user_id`:

```sql
SELECT set_config('app.user_id', '00000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE vipe_api;
-- assertions as that user
RESET ROLE;
```

`true` makes the setting transaction-local, matching `SET LOCAL ROLE`. No
setting, an empty setting or a user without a profile all resolve to NULL, so
every tenant policy matches nothing (`005_app_user_setting.test.sql`).

## Fixtures

`seed.sql` is loaded once per run and contains:

- the default restaurant `a0eebc99-0000-0000-0000-000000000000` that a
  Supabase-era migration inserted as data (the baseline is schema-only);
- `tests.auth_users`, a test-only shim with the column list of Supabase's
  `auth.users`. Inserting into it creates the `public.users` row and the linked
  profile exactly like the removed `handle_new_user()` trigger did (role and
  tenant from `raw_app_meta_data`, else `waiter` in the oldest restaurant).
  Re-point or delete that profile with an `UPDATE`/`DELETE` on
  `profiles.user_id` when a test needs something else;
- the business data of `supabase/seed.sql`.

New tests may insert into `public.users` and `public.profiles` directly instead
of using the shim. Two fixture facts worth copying: `public.categories.icon` is
`NOT NULL`, and a column `DEFAULT private.current_restaurant_id()` resolves to
`NULL` outside an impersonated session, so fixtures inserted as `postgres` must
pass `restaurant_id` explicitly.

## Tenant isolation test pattern

`010_tenant_isolation.test.sql` is the reference for anything that touches
tenancy: build two tenants as the test author, impersonate one user, run every
assertion for that caller, `RESET ROLE`, then count rows as the author to prove
that filtered `UPDATE`/`DELETE` touched nothing outside the caller's tenant.
Wrap `INSERT`s that must be rejected in
`throws_ok(sql, '42501', <message>, <description>)`, the four-argument form.
