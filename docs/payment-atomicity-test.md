# Payment Flow Atomicity Tests

> The atomic checkout lives in `public.pay_order` (migration 20261006120000) plus the `payments` /
> `payment_tenders` ledger (20261006110000) and the `split_order` /
> `register_summary` / `close_register` siblings. This document maps every
> guarantee to its pgTAP file and gives a UI checklist + psql recipes for what
> pgTAP cannot pin (renderer, double-click, UI warnings).

## Quick path

```bash
pnpm supabase start          # API 44321, DB 44322, Studio 44323
pnpm supabase db reset       # migrations + supabase/seed.sql
pnpm test:db                 # pgTAP, 11 files / 519 tests
pnpm test                    # Vitest (lib/payments, store)
```

The Supabase CLI container is `supabase_db_vipe-pos-system` (project_id in
`supabase/config.toml`); reach the DB with `docker exec -it
supabase_db_vipe-pos-system psql -U postgres -d postgres`.

## Automated guarantees

| Guarantee | pgTAP file | Migration | Pins |
|-----------|------------|-----------|------|
| `payment_methods` catalog, admin-only writes, `code` immutable | `050_payment_methods.test.sql` | 20261006100000 | RLS, INSERT/UPDATE/DELETE policies, `guard_payment_methods_code_immutable` trigger, defaults per restaurant |
| `payments` + `payment_tenders` schema, CHECKs, deferred cross-row invariants, RLS (42501 on write), `payment_transactions` legacy read-only | `060_payments_tenders.test.sql` | 20261006110000 | UNIQUE (order_id), bigint money, cash vs electronic CHECK, restaurant consistency trigger, anon holds nothing |
| `pay_order` RPC: caller role, `tip_amount`, ≤20 tenders, sum = `amount_due + tip`, idempotency, drawer warning, table release, drop of `complete_payment` | `070_pay_order.test.sql` | 20261006120000 | SECURITY DEFINER, FOR UPDATE / FOR SHARE lock shape, 42501 / P0002 / P0001 / 22023, replay returns `status='already_paid'` |
| `split_order` / `undo_split` RPCs: parent lock, item move, full-move guard, partial-child prohibition | `080_split_order.test.sql` | 20261006130000 | SECURITY DEFINER, caller role, tenant isolation via P0002, bad-shape 22023 |
| `register_summary` (STABLE INVOKER) + `close_register` (FOR UPDATE vs pay_order FOR SHARE): tips payout, expected cash = initial + cash tender sums + deposits − withdrawals, legacy section under `legacy` | `090_register_summary.test.sql` | 20261006140000 | caller role 42501, P0002 visibility, bigint rounding, expected_cash_after_tips may be negative |

### Reading the headers

Each test file opens with a comment block that lists every guarantee it pins.
That block is the authoritative description; the table above is the index.

## Run the automated tests

```bash
# everything
pnpm test:db

# a single file while iterating
pnpm supabase test db supabase/tests/070_pay_order.test.sql
```

Each file is self-contained (`BEGIN; ... SELECT plan(N); ... finish();
ROLLBACK;`); the database is never mutated. See `supabase/tests/README.md`
for the pgTAP conventions and the JWT-impersonation pattern used by tenancy
tests.

## Manual UI smoke checklist

pgTAP cannot see the renderer. Walk these once per release branch.

- [ ] **Mixed-tender payment dialog.** Open `PaymentMethodDialog`, add two
      tenders (e.g. Nequi 30 000 + cash 25 000), set a non-zero tip, confirm
      the remaining amount reaches 0 at `amount_due + tip`, and submit. The
      order leaves the table and the payment appears in the register lists.
- [ ] **Tip options.** Cycle through `TipControl` presets and a custom value;
      the dialog must always recompute `total` before submit, and submit with
      tip=0 must be allowed.
- [ ] **Warn-only drawer.** With the drawer empty, pay a cash-only order that
      forces `change_given > drawer_cash_before`. The payment must still
      succeed; a warning toast ("La caja no tenía efectivo suficiente para
      el cambio…") appears, but the payment is never aborted.
- [ ] **Double-click on pay / split / undo.** Spam-click the action button;
      exactly one `payments` row (or one split / undo) is written. The second
      call must either be a no-op or the idempotent replay of `pay_order`
      with the same `idempotency_key`.
- [ ] **Close register with tips payout.** After several payments with mixed
      tip amounts, run `CloseRegisterDialog`. `tips_payout` equals `total_tips`
      and `expected_cash_after_tips` is rendered as-is (negative is legal).
- [ ] **Reprint with tender breakdown.** In Admin → Órdenes Completadas,
      press **Factura** on a paid order. The invoice lists every tender with
      its method name and amount, the cash received and change for cash
      lines, and the tip. Orders paid before the ledger keep a single
      payment label.
- [ ] **Print listener (installed vs rebuilt).** With the Python listener
      running, pay a mixed order. An installed listener built before this
      change prints the single `FORMA DE PAGO:` line (now with the correct
      method); a listener rebuilt from `pos/` prints `FORMAS DE PAGO:` with
      one line per tender. Both must print; see `pos/README.md`.

## psql inspection (debugging)

```bash
# enter the local DB container
docker exec -it supabase_db_vipe-pos-system psql -U postgres -d postgres
```

```sql
-- one payment row per order (UNIQUE enforced)
SELECT p.id, p.order_id, p.amount_due, p.tip_amount, p.change_given,
       p.idempotency_key
  FROM public.payments p
 ORDER BY p.created_at DESC LIMIT 10;

-- tender lines of one payment, ordered by line_no
SELECT t.method_code, t.method_kind, t.amount, t.cash_received
  FROM public.payment_tenders t
 WHERE t.payment_id = '00000000-0000-0000-0000-000000000000'
 ORDER BY t.line_no;

-- register snapshot (same numbers as the close-register screen);
-- run it as an impersonated cashier or admin, see the note below
SELECT * FROM public.register_summary(ARRAY[
  '00000000-0000-0000-0000-000000000000'::uuid
]);

-- legacy read-only history (must not be written anymore)
SELECT pt.order_id, pt.method, pt.amount, pt."timestamp"
  FROM public.payment_transactions pt
 ORDER BY pt."timestamp" DESC LIMIT 5;
```

As `postgres` these queries bypass RLS and see every tenant, and
`register_summary` rejects the call because the role has no profile. To
see a cashier's view, impersonate one inside a transaction with
`SET LOCAL ROLE authenticated` and `SET LOCAL request.jwt.claims`, as the
pgTAP files do.

## Out of scope

- `000_schema_smoke` / `001_bootstrap` (extension and migration sanity) and
  `010_tenant_isolation` /
  `020_anon_lockdown` / `030_profile_privileges` /
  `040_remaining_tables_tenancy` cover the cross-cutting tenancy surface and
  the EXECUTE grants on every RPC; they are part of `pnpm test:db`, not
  duplicated here.
- Vitest covers the pure-TS adapters in `lib/supabase/payments-service.ts`
  and `lib/payments/register-summary.ts` (`pnpm test`); see those files for
  per-case assertions.
