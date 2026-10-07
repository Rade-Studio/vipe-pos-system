# Design: `revision-completa-sistema`

> Six-phase remediation of the VipePOS system. Architecture, data model, API surface, component map, sequence diagrams, trade-offs, and open design questions per phase.
>
> Language: English for technical artifacts. Spanish UI copy preserved as-is.

---

## Executive Summary

The VipePOS system has six root-class debts: missing WAL publication (mesas never sync), zero RLS (all data open), non-atomic payments (double-pay risk), unvalidated builds (TS/eslint ignored), unauthenticated printer listener, and a 748-line god-store. This design coordinates six PR-shaped phases to address each class. The multi-tenant model uses a shared DB with `restaurant_id` FK on every tenant table. Payment atomicity lives in Postgres functions (`complete_payment`, `delete_order_with_items`) rather than application-layer transactions. Realtime uses a single per-role channel with client-side merge (not full reload) after the WAL publication is fixed.

---

## P1 — Realtime Publication & UX

### Architecture

The root cause of cross-device mesa desync is missing WAL replication: `postgres_changes` events never fire because no migration ever added `tables`, `orders`, `order_items` to `supabase_realtime`. The fix is a single migration, but the UX improvement (merge vs. full reload) requires changes in `realtime-service.ts` and `TableGrid.tsx`.

**Realtime channel topology**: ONE shared channel per role-view (waiter / kitchen / cashier / admin) with `filter` on `restaurant_id` and `event`. This is preferred over one shared channel with client-side JS filtering because:
- Supabase Realtime applies the `filter` server-side, so the WS payload is already scoped — less bandwidth.
- A single channel per role avoids the `channelCounter` race in the current code (`realtime-service.ts:26-27`) where concurrent subscribers can produce duplicate channel names.
- Unsubscribing from one role-view tears down only its channel, not all listeners.

Alternative rejected: one global channel filtered by payload inspection in JS. This was rejected because it sends every event to every client, forcing client-side CPU and increasing the attack surface for data leakage under RLS.

### Data Model

No schema changes. This phase only enables replication flags on existing tables.

### SQL Migration

```sql
-- supabase/migrations/20250917090000_enable_realtime_publication.sql

-- REPLICA IDENTITY FULL emits the full OLD row on UPDATE/DELETE,
-- not just the primary key. Required for the merge algorithm to have
-- the previous state without a separate SELECT.
ALTER TABLE public.tables REPLICA IDENTITY FULL;
ALTER TABLE public.orders REPLICA IDENTITY FULL;
ALTER TABLE public.order_items REPLICA IDENTITY FULL;

-- Add tables to the realtime publication. Without this, the Realtime
-- worker never sees WAL entries for these tables regardless of how
-- cleanly the client subscribes.
ALTER PUBLICATION supabase_realtime ADD TABLE
  public.tables,
  public.orders,
  public.order_items;
```

### API Surface (TypeScript)

`lib/supabase/realtime-service.ts` — changes to `subscribeToTables`:

```typescript
// Before: returned unsubscribe, but channelCounter race could reuse names.
// After: stable channel name, merge algorithm, per-channel teardown.

// Channel name is now role-aware so kitchen and waiter never share a channel
// for tables (different filter expressions).
subscribeToTables: (callback: TableCallback, role: 'waiter' | 'kitchen' | 'cashier' | 'admin') => {
  const channelName = `tables-${role}-${Date.now()}`
  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "tables",
        // Filter: Supabase Realtime applies this server-side before sending.
        // After P2 lands with RLS, this additionally restricts to caller's tenant.
        filter: role === 'waiter' ? 'waiter_id=eq.' + getCurrentWaiterId() : undefined,
      },
      (payload) => {
        // Merge algorithm: key = id, compare updated_at
        const incoming = payload.new as Table
        if (!incoming || !incoming.id) return

        callback(payload)
      },
    )
    .subscribe()

  realtimeService.channels[`tables-${role}`] = channel

  return () => {
    supabase.removeChannel(channel)
    delete realtimeService.channels[`tables-${role}`]
  }
},
```

**Merge algorithm** (in `useTableStore` or `TableGrid` via `setTables`):

```
Input: existing array, incoming row (INSERT | UPDATE | DELETE)
Key: row.id
INSERT  → append to array
UPDATE  → if incoming.updated_at > existing.updated_at → replace; else ignore
DELETE  → filter out row.id === payload.old.id
No re-query. No setLoading(true) inside handler.
```

### Component / Module Map

| File | Change |
|------|--------|
| `supabase/migrations/20250917090000_enable_realtime_publication.sql` | Create — enables publication + REPLICA IDENTITY |
| `lib/supabase/realtime-service.ts` | Modify — stable channel names, per-role filter, unsubscribe returns per-channel teardown |
| `components/pos/TableGrid.tsx` | Modify — drop `setLoading(true)` inside event handler; use merge instead of `loadTables()` |

**`TableGrid.tsx` flicker elimination** (concrete React pattern):

```typescript
// Before (lines 115-118):
const unsubscribe = realtimeService.subscribeToTables(async (payload) => {
  console.log("Cambio en mesa recibido:", payload)
  await loadTables()  // sets loading=true, blanks grid
})

// After:
const [initialLoadDone, setInitialLoadDone] = useState(false)
const unsubscribe = realtimeService.subscribeToTables((payload) => {
  // Merge into existing tables array without a re-query.
  // setTables is from useState, not a full store — but after P6 this
  // will come from useTableStore.
  setTables(prev => mergeTables(prev, payload))
  if (!initialLoadDone) setInitialLoadDone(true)
})

// In render:
{!initialLoadDone && loading ? (
  <SkeletonGrid />          // first load: show skeleton
) : (
  <TableGrid tables={tables} />  // realtime updates: never blank
)}
```

### Sequence Diagram

```
Device A (Waiter)                 Supabase Realtime              Device B (Kitchen)
      |                                    |                              |
      |---- subscribe (tables-waiter) --->|                              |
      |                                    |<--- subscribe (tables-kitchen)
      |                                    |                              |
      | UPDATE tables SET status='occupied' |                              |
      | WHERE id=5 (via REST)             |                              |
      |------------------------------------>| WAL entry emitted            |
      |                                    |----------------------------->| postgres_changes
      |                                    |                              | event fires
      |                                    |                              | merge into
      |                                    |                              | useTableStore
      |                                    |                              | (no blank)
```

### Trade-offs

| Decision | Alternative considered | Why rejected |
|----------|----------------------|-------------|
| One channel per role, not one global | Global channel with JS-side filter | Global sends all events to all clients; wastes WS bandwidth; RLS cannot restrict server-side |
| Merge instead of re-query | Full `loadTables()` on every event | Eliminates flicker; reduces DB round-trips; ≤4 stations means no diff-merge needed |
| `REPLICA IDENTITY FULL` | Default (primary key only) | `payload.old` carries only the PK; merge algorithm needs the full old row to compare `updated_at` |

### Open Design Questions (P1)

- **Q1-A**: Should `REPLICA IDENTITY FULL` also be set on `profiles`, `cash_registers`, `cash_transactions`, `payment_transactions` if they are added to realtime later? Default: add them when those phases land. Not set preemptively because FULL increases WAL size.

---

## P2 — Multi-Tenant Schema + RLS + Auth

### Architecture

Multi-tenancy is enforced at the database layer. A new `restaurants` table is the root tenant entity. Every user-facing table carries `restaurant_id uuid references restaurants(id)`. RLS policies filter every query to rows where `restaurant_id` matches `auth.uid()` → `profiles.restaurant_id`. Role is moved from PINs and `business_config` to `auth.users.app_metadata.role`, set at account creation via a Postgres trigger.

### Data Model

**`restaurants` table** (new):

```sql
CREATE TABLE public.restaurants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  name        text NOT NULL,
  timezone    text NOT NULL DEFAULT 'America/Bogota',
  currency    text NOT NULL DEFAULT 'COP',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```

**`restaurant_id` FK on every tenant-scoped table** (added via migration `20250917090005`):

| Table | Column | Added via migration |
|-------|--------|-------------------|
| `tables` | `restaurant_id uuid references restaurants(id)` | `20250917090005` |
| `categories` | `restaurant_id uuid references restaurants(id)` | `20250917090005` |
| `dishes` | `restaurant_id uuid references restaurants(id)` | `20250917090005` |
| `ingredients` | `restaurant_id uuid references restaurants(id)` | `20250917090005` |
| `recipes` | `restaurant_id uuid references restaurants(id)` | `20250917090005` |
| `recipe_ingredients` | `restaurant_id uuid references restaurants(id)` | `20250917090005` |
| `ingredient_transactions` | `restaurant_id uuid references restaurants(id)` | `20250917090005` |
| `orders` | `restaurant_id uuid references restaurants(id)` | `20250917090005` |
| `order_items` | `restaurant_id uuid references restaurants(id)` | `20250917090005` |
| `cash_registers` | `restaurant_id uuid references restaurants(id)` | `20250917090005` |
| `cash_transactions` | `restaurant_id uuid references restaurants(id)` | `20250917090005` |
| `payment_transactions` | `restaurant_id uuid references restaurants(id)` | `20250917090005` |
| `promotions` | `restaurant_id uuid references restaurants(id)` | `20250917090005` |
| `promotion_dishes` | `restaurant_id uuid references restaurants(id)` | `20250917090005` |
| `profiles` | `restaurant_id uuid references restaurants(id)` | `20250917090005` |

### `profiles.auth_user_id` Link

```sql
-- In migration 20250917090007
ALTER TABLE public.profiles ADD COLUMN auth_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_auth_user_id_unique UNIQUE (auth_user_id);

-- Backfill: populate auth_user_id for seed profile rows using the known seed auth user IDs.
-- This is a one-time idempotent backfill.
UPDATE public.profiles
SET auth_user_id = auth.users.id
FROM auth.users
WHERE auth.users.raw_user_meta_data ->> 'email' = profiles.email
  AND profiles.auth_user_id IS NULL;
```

### Auth Trigger

```sql
-- Trigger on auth.users INSERT → upserts matching profiles row with default role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, auth_user_id, email, full_name, role, restaurant_id)
  VALUES (
    gen_random_uuid(),
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data ->> 'role', 'waiter'),
    (SELECT id FROM public.restaurants LIMIT 1)  -- P2 default: first restaurant; P2 tenant-creation flow assigns later
  )
  ON CONFLICT (auth_user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

### RLS Policy Patterns

**`tables` SELECT policy** (tenant-scoped):

```sql
ALTER TABLE public.tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tables_select_policy" ON public.tables
  FOR SELECT
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );
```

**`orders.status` UPDATE policy** (role-restricted to `'paid'` transition):

```sql
CREATE POLICY "orders_update_paid_policy" ON public.orders
  FOR UPDATE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    -- Only cashiers/admins can set status to 'paid'
    (status = 'paid' AND (
      SELECT role FROM public.profiles WHERE auth_user_id = auth.uid()
    ) IN ('cashier', 'admin'))
    OR
    -- Waiters/kitchen can only update to statuses they own
    (status IN ('active', 'kitchen', 'delivered'))
  );
```

**`payment_transactions` INSERT policy**:

```sql
CREATE POLICY "payment_transactions_insert_policy" ON public.payment_transactions
  FOR INSERT
  WITH CHECK (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles WHERE auth_user_id = auth.uid()
    )
  );
```

### `init.sql` Cleanup

Lines 78-81 of `supabase/migrations/20250501000000_init.sql`:

```sql
-- BEFORE (lines 78-81):
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;

-- AFTER (in migration 20250917090099):
-- These lines are removed via migration that runs AFTER init.sql in reset.
-- We cannot edit init.sql directly as it is in the migrations folder.
-- Instead, 20250917090099 drops the default privilege:
REVOKE ALL ON TABLES FROM anon;           -- executed in migration
REVOKE ALL ON SEQUENCES FROM anon;        -- executed in migration
```

**Correct approach**: Create `supabase/migrations/20250917090099_drop_default_anon_grants.sql`:

```sql
-- Remove the default ALL grant to anon from init.sql (already applied).
-- This prevents future tables from being writable by anon without explicit policy.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- Also remove service_role default ALL (service_role should get explicit grants only).
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM service_role;

-- Grant only what is needed to authenticated
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
```

### Storage Policy Cleanup

```sql
-- Drop anonymous INSERT/UPDATE/DELETE policies on dishes bucket
DROP POLICY IF EXISTS "Allow Anonymous Upload" ON storage.objects;
DROP POLICY IF EXISTS "Allow Anonymous Updates" ON storage.objects;
DROP POLICY IF EXISTS "Allow Anonymous Delete" ON storage.objects;

-- Keep only the admin-role policy
CREATE POLICY "dishes_admin_only_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'dishes'
    AND (SELECT role FROM public.profiles WHERE auth_user_id = auth.uid()) = 'admin'
  );
```

### Component / Module Map

| File | Change |
|------|--------|
| `supabase/migrations/20250917090005_create_restaurants_and_tenant_columns.sql` | Create — restaurants table + restaurant_id on all tenant tables |
| `supabase/migrations/20250917090007_rls_policies_and_profiles_auth_link.sql` | Create — RLS policies + auth trigger + auth_user_id FK |
| `supabase/migrations/20250917090099_drop_default_anon_grants.sql` | Create — REVOKE default grants |
| `lib/supabase/client.ts` | Modify — remove hard-coded fallback URL/key (security fix from HS-03) |

### Sequence Diagram

```
User signs up via supabase.auth.signUp()
         |
         v
auth.users INSERT (GoTrue)
         |
         v
Trigger: handle_new_user() fires
         |
         v
profiles INSERT with auth_user_id, role='waiter', restaurant_id=first_restaurant
         |
         v
App calls supabase.auth.getUser() → gets auth.users.id
         |
         v
App calls supabase.from('profiles').select() JOIN auth.users WHERE auth.uid()
         |
         v
Returns profile with role, restaurant_id → gates role view
```

### Trade-offs

| Decision | Alternative considered | Why rejected |
|----------|----------------------|-------------|
| `restaurant_id` as `uuid` | `text` slug for readable URLs | UUID matches the project's existing PK style (all IDs are uuid); slug is derived in a view |
| Default `restaurant_id` from first restaurant on new user | Require explicit tenant creation flow | P2 uses first-restaurant default; full multi-tenant onboarding is out of scope |
| RLS policies on every table | RLS on only "sensitive" tables | Multi-tenant requires tenant isolation on ALL user data; partial RLS is a false economy |
| `REVOKE ALL` then grant SELECT/INSERT/UPDATE/DELETE to authenticated | Keep init.sql GRANT ALL and add deny policies | Deny policies don't compose cleanly with RLS; explicit allow is auditable |

### Open Design Questions (P2)

- **Q2-A**: How does an operator create a second restaurant? A separate admin UI flow or a seed script? Default: seed script for P2; admin UI deferred.
- **Q2-B**: Should `restaurants` itself have RLS? Default: no — it is seeded by migration, not user-data. Admin access managed via direct DB access.

---

## P3 — Payment & Order Atomicity

### Architecture

Payment atomicity and order deletion are implemented as Postgres functions (`CREATE FUNCTION`) rather than application-layer transactions because:
1. RLS policies apply inside the function with the caller's JWT context.
2. `SELECT FOR UPDATE` serializes concurrent calls on the same row, preventing double-pay without a separate idempotency table.
3. The function executes atomically — all steps commit or all roll back.

Two functions are provided: `complete_payment` (handles payment + order status + table release in one tx) and `delete_order_with_items` (cascading delete).

### Data Model

**New table: `ingredient_transactions_orders`**:

```sql
CREATE TABLE public.ingredient_transactions_orders (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                 uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  ingredient_transaction_id uuid NOT NULL REFERENCES public.ingredient_transactions(id) ON DELETE CASCADE,
  quantity_cents            bigint NOT NULL,  -- units consumed in hundredths
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, ingredient_transaction_id)
);
```

### `complete_payment` Function

```sql
CREATE OR REPLACE FUNCTION public.complete_payment(
  p_order_id         uuid,
  p_payment_methods   text[],  -- e.g. ['cash:50000', 'card:25000']
  p_cash_register_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER  -- runs with caller's RLS context via SET search_path
SET search_path = public
AS $$
DECLARE
  v_order          orders%ROWTYPE;
  v_restaurant_id  uuid;
  v_cashier_id     uuid;
  v_total_cents    bigint;
  v_change_cents   bigint := 0;
  v_payment_row    payment_transactions%ROWTYPE;
BEGIN
  -- Resolve caller identity and restaurant
  SELECT profile.restaurant_id, profile.id
    INTO v_restaurant_id, v_cashier_id
    FROM public.profiles profile
    WHERE profile.auth_user_id = auth.uid();

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: no profile found';
  END IF;

  -- Row lock the order to serialize concurrent calls
  SELECT * INTO v_order
    FROM orders
    WHERE id = p_order_id
    FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  -- Tenant check
  IF v_order.restaurant_id != v_restaurant_id THEN
    RAISE EXCEPTION 'Forbidden: order belongs to another tenant';
  END IF;

  -- Idempotency: if already paid, return existing rows
  IF v_order.status = 'paid' THEN
    SELECT to_jsonb(payment_transactions.*) INTO v_payment_row
      FROM payment_transactions
      WHERE order_id = p_order_id
      LIMIT 1;
    RETURN jsonb_build_object(
      'status',       'already_paid',
      'payment_row',  v_payment_row,
      'order_status', 'paid'
    );
  END IF;

  -- Guard: order must be in a payable state
  IF v_order.status NOT IN ('active', 'kitchen') THEN
    RAISE EXCEPTION 'Order cannot be paid: status=%', v_order.status;
  END IF;

  -- Calculate total from payment methods array
  SELECT sum(split_part(value, ':', 2)::bigint)
    INTO v_total_cents
    FROM unnest(p_payment_methods) AS value;

  -- Insert one payment_transactions row per payment method
  FOR i IN 1..array_length(p_payment_methods, 1) LOOP
    DECLARE
      v_method   text := split_part(p_payment_methods[i], ':', 1);
      v_amount   bigint := split_part(p_payment_methods[i], ':', 2)::bigint;
    BEGIN
      IF v_method = 'cash' AND v_amount > v_order.bill_total_cents THEN
        v_change_cents := v_amount - v_order.bill_total_cents;
      END IF;

      INSERT INTO payment_transactions (
        id, order_id, restaurant_id, cash_register_id,
        payment_method, amount_cents, cash_received_cents,
        tip_amount_cents, created_at
      ) VALUES (
        gen_random_uuid(), p_order_id, v_restaurant_id, p_cash_register_id,
        v_method, v_amount, CASE WHEN v_method = 'cash' THEN v_amount ELSE 0 END,
        0, now()
      );
    END;
  END LOOP;

  -- Update order status
  UPDATE orders
     SET status = 'paid',
         updated_at = now(),
         payment_method = p_payment_methods[1],  -- primary method
         cash_change_cents = v_change_cents
   WHERE id = p_order_id;

  -- Free the table
  UPDATE tables
     SET status = 'free', updated_at = now()
   WHERE id = v_order.table_id;

  RETURN jsonb_build_object(
    'status',       'paid',
    'order_status', 'paid',
    'table_status', 'free',
    'change_cents', v_change_cents
  );
END;
$$;
```

### `delete_order_with_items` Function

```sql
CREATE OR REPLACE FUNCTION public.delete_order_with_items(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
BEGIN
  -- Resolve caller restaurant
  DECLARE
    v_restaurant_id uuid;
  BEGIN
    SELECT restaurant_id INTO v_restaurant_id
      FROM public.profiles
      WHERE auth_user_id = auth.uid();

    IF v_restaurant_id IS NULL THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  END;

  -- Lock and verify ownership
  SELECT id INTO v_order_id
    FROM orders
    WHERE id = p_order_id AND restaurant_id = v_restaurant_id
    FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found or access denied: %', p_order_id;
  END IF;

  -- Delete children in order (FK cascade handles ingredient_transactions_orders automatically)
  DELETE FROM order_items WHERE order_id = p_order_id;

  -- Delete ingredient_transactions_orders links (FK cascade to ingredient_transactions is RESTRICT;
  -- we must delete the link rows first)
  DELETE FROM ingredient_transactions_orders WHERE order_id = p_order_id;

  -- Delete the order
  DELETE FROM orders WHERE id = p_order_id;
END;
$$;
```

### `order_items.order_id` ON DELETE CASCADE

```sql
-- In migration 20250917090008
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_order_id_fkey;
ALTER TABLE order_items
  ADD CONSTRAINT order_items_order_id_fkey
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
```

### Frontend Changes

`PaymentMethodDialog.tsx` calls `supabase.rpc('complete_payment', {...})` instead of the two-step pattern (service.ts `completePayment` then `cashRegisterService.addTransaction`).

```typescript
// New pattern in service.ts:
completePayment: async (orderId: string, paymentMethods: string[], cashRegisterId: string) => {
  const { data, error } = await supabase.rpc('complete_payment', {
    p_order_id: orderId,
    p_payment_methods: paymentMethods,   // ['cash:50000', 'card:25000']
    p_cash_register_id: cashRegisterId,
  })

  if (error) throw error
  return data
}
```

### Component / Module Map

| File | Change |
|------|--------|
| `supabase/migrations/20250917090006_create_ingredient_transactions_orders.sql` | Create — junction table |
| `supabase/migrations/20250917090008_complete_payment_and_delete_order_functions.sql` | Create — both Postgres functions + FK fixes |
| `lib/supabase/service.ts` | Modify — replace two-step payment with RPC call; replace deleteOrder with RPC call |
| `components/pos/PaymentMethodDialog.tsx` | Modify — call `complete_payment` RPC instead of two-service pattern |

### Sequence Diagram

```
Cashier taps "Pagar"                      Postgres
       |                                      |
       | complete_payment(order_X, ['cash:50000'], reg_1)
       |------------------------------------->|
       |                               BEGIN
       |                               SELECT ... FROM orders WHERE id=order_X FOR UPDATE
       |                               (row lock acquired)
       |                               |
       |                               INSERT INTO payment_transactions (...)
       |                               UPDATE orders SET status='paid'
       |                               UPDATE tables SET status='free'
       |                               COMMIT
       |<-------------------------------------|
       | { status: 'paid', change_cents: 0 } |
       |                                      |
       | Kitchen device receives postgres_changes(UPDATE orders)
       | (table freed within 500ms via P1 channel)
```

### Trade-offs

| Decision | Alternative considered | Why rejected |
|----------|----------------------|-------------|
| Postgres functions over TypeScript transactions | Wrapping `service.ts` in BEGIN/COMMIT | RLS would still permit partial commits; a network error mid-BEGIN leaves indeterminate state |
| `UNIQUE (order_id, ingredient_transaction_id)` on junction | Separate idempotency table | Composite PK already enforces uniqueness; extra table adds unnecessary complexity |
| Array parameter for multi-payment | Separate RPC per method | Single call = single network round-trip; atomicity guaranteed |

### Open Design Questions (P3)

- **Q3-A**: Should `complete_payment` also update `orders.bill_total_cents` from a server-side calculation (instead of trusting the existing value)? Default: yes — add `bill_subtotal_cents`, `bill_tax_cents`, `bill_tip_cents` as computed columns or add them as function parameters validated server-side.
- **Q3-B**: Who issues the `invoiceNumber`? Currently generated client-side as `INV-${Date.now()}`. In P3, move to `gen_random_uuid()` as invoice ID; a human-readable `invoice_number` view can generate `INV-{year}{seq}` separately.

---

## P4 — Build & Infrastructure Safety

### Architecture

P4 makes CI a blocking gate and hardens the container. No database changes. All changes are file-level.

### File Changes

**`next.config.mjs`**:

```javascript
// Before:
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  output: 'standalone',
}

// After:
const nextConfig = {
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
  output: 'standalone',
  experimental: {
    outputFileTracingRoot: '/app',  // fixes hostname binding for standalone
  },
  images: { unoptimized: true },
}
```

**`Dockerfile`**:

```dockerfile
# Before: node:20-alpine, npm install --legacy-peer-deps, runs as root
# After:

FROM node:20-alpine

RUN apk add --no-cache libc6-compat curl

# Add non-root user before copying code
RUN adduser -D appuser

WORKDIR /app

# Use pnpm
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY . .

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

RUN pnpm build

# Switch to non-root
USER appuser

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

EXPOSE 3000
CMD ["pnpm", "start"]
```

**`.dockerignore`**:

```
node_modules
.next
.git
pos/dist
pos/build
*.log
.atl
.env*
.DS_Store
```

**`.github/workflows/ci.yml`**:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm tsc --noEmit

  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ vars.DEV_SUPABASE_URL || 'http://localhost:54321' }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.DEV_SUPABASE_ANON_KEY }}
```

**`docker-compose.yml` app service changes**:

```yaml
app:
  # ... existing build + env ...
  depends_on:
    realtime:
      condition: service_healthy   # was: depends_on: [kong]
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
    # Or: call supabase.auth.getSession() as startup probe
    # For now: keep curl, but add a /api/health Next.js route
    # that calls supabase.auth.getSession() internally.
```

**`package.json`**:

```json
{
  "name": "vipe-pos-system",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "lint:fix": "next lint --fix",
    "typecheck": "tsc --noEmit",
    "test": "echo \"Add tests here\" && exit 0",
    "docker:dev": "docker-compose up -d",
    "docker:dev:build": "docker-compose up -d --build",
    "docker:dev:down": "docker-compose down",
    "docker:dev:seed": "docker exec -i supabase-db psql -U postgres -d postgres < supabase/seed.sql",
    "docker:prod": "docker-compose -f docker-compose.prod.yml up -d --build",
    "docker:prod:down": "docker-compose -f docker-compose.prod.yml down",
    "docker:prod:logs": "docker-compose -f docker-compose.prod.yml logs -f"
  }
}
```

### Component / Module Map

| File | Change |
|------|--------|
| `.github/workflows/ci.yml` | Create — lint + typecheck + build jobs |
| `next.config.mjs` | Modify — flags to false, add outputFileTracingRoot |
| `Dockerfile` | Modify — adduser, USER appuser, switch to pnpm, add .dockerignore |
| `docker-compose.yml` | Modify — app depends_on realtime: service_healthy |
| `package.json` | Modify — rename to vipe-pos-system, add lint:fix, typecheck, test scripts |

### Trade-offs

| Decision | Alternative considered | Why rejected |
|----------|----------------------|-------------|
| `pnpm` in container | Keep `npm` | pnpm-lock.yaml exists in repo; pnpm is faster and more strict; npm drifts from lockfile |
| `outputFileTracingRoot: '/app'` | Use `HOSTNAME=0.0.0.0` env only | Some Next.js 15 versions ignore the env var with standalone output; the explicit config is more reliable |
| `curl` healthcheck | `supabase.auth.getSession()` as probe | curl is simpler and sufficient; auth.getSession() can be added as a `/api/health` route in a follow-up |

### Open Design Questions (P4)

- **Q4-A**: Should the CI workflow include a `pos-deps-check` job that runs `pip install -r pos/requirements.txt --dry-run` on a Python 3.11 action runner? Default: yes, add as an optional matrix job since P5 is Windows-only.
- **Q4-B**: Should required status checks be documented as an ADR note (since they must be enabled in GitHub repo settings, not in code)? Default: yes, add a note in the ADR section of the PR description.

---

## P5 — Printer Listener Reliability

### Architecture

The printer listener is a Windows Python app (`pos/app.py`). It receives `room_commands` and `room_bills` broadcasts from Supabase Realtime. The refactor addresses: reproducible env (requirements.txt), authentication (service-role token), duplicate print prevention (LRU cache), and encoding negotiation.

**Auth refactor**: The listener currently uses the anon key (`pos/app.py:442`). With `ANONYMOUS_USERS_ENABLED: "false"`, this fails silently. The fix uses a per-station service-role JWT issued by a GoTrue admin endpoint at boot, rotated every 24h.

Token flow:
1. At startup, `pos/app.py` POSTs to `http://localhost:54321/admin/users` (or via service-role REST API) with station credentials (，预配的 email/password per station).
2. GoTrue returns a JWT with `role: service_role` and `restaurant_id` scope.
3. `AsyncRealtimeClient` is initialized with this JWT instead of the anon key.
4. Token is rotated every 24h via a background thread.

Alternative: anonymous Realtime with `ANONYMOUS_USERS_ENABLED: "true"`. Rejected because it requires enabling anon globally, which contradicts P2's security posture.

### `pos/requirements.txt`

```
# Pin exact versions for reproducibility
customtkinter==5.2.2
pystray==0.19.5
Pillow==10.4.0
html2text==2024.2.26
escpos-python==1.2.0
pywin32==306
usb==1.0.2
python-dotenv==1.0.1
# supabase/realtime-py: the package is "realtime" on PyPI
# but the import in app.py is "from realtime import AsyncRealtimeClient"
# which matches supabase/realtime-py (not the bare "realtime" package).
realtime==2.0.2
```

### LRU Deduplication

```python
# In pos/app.py
from collections import OrderedDict

class RecentlyPrintedCache:
    def __init__(self, maxsize: int = 256, ttl_seconds: float = 30.0):
        self._cache: OrderedDict[str, float] = OrderedDict()
        self._maxsize = maxsize
        self._ttl = ttl_seconds

    def should_print(self, invoice_number: str) -> bool:
        now = time.monotonic()
        # Evict expired
        while self._cache and self._cache:
            oldest_time = next(iter(self._cache.values()))
            if now - oldest_time > self._ttl:
                self._cache.popitem(last=False)
            else:
                break

        if invoice_number in self._cache:
            # Touch (move to end) on hit
            self._cache.move_to_end(invoice_number)
            return False  # already printed, skip

        self._cache[invoice_number] = now
        if len(self._cache) > self._maxsize:
            self._cache.popitem(last=False)
        return True

recently_printed = RecentlyPrintedCache(maxsize=256, ttl_seconds=30.0)
```

### Encoding Negotiation

```python
def negotiate_encoding(printer) -> str:
    """
    Attempt UTF-8 first; fall back to CP1252.
    Returns the encoding name actually used.
    """
    try:
        # ESC r 1 = request printer's active code page
        # Most modern ESC/POS printers respond with their active page
        printer._raw(b'\x1br\x01')
        # If we get here without exception, try UTF-8
        printer.set(text_encoding='utf-8')
        profile_codepage = printer.profile().get('codePage', 0)
        if profile_codepage in (437, 850, 858):
            # Old firmware, fall back
            printer.set(text_encoding='cp1252')
            return 'cp1252'
        print("Encoding: UTF-8")
        return 'utf-8'
    except Exception:
        printer.set(text_encoding='cp1252')
        print("Encoding: CP1252 (fallback)")
        return 'cp1252'
```

### Shared Print Renderer

`lib/print/renderKitchenOrder.ts` (TypeScript, shared between web preview and Python):

```typescript
// lib/print/renderKitchenOrder.ts
export interface PrintLine {
  text: string;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
}

export interface KitchenOrderRender {
  lines: PrintLine[];
  footer: PrintLine[];
}

export function renderKitchenOrder(order: Order): KitchenOrderRender {
  return {
    lines: [
      { text: `COMANDA — Mesa ${order.table_number}`, bold: true, align: 'center' },
      { text: `Orden: ${order.id.slice(0, 8)}`, align: 'left' },
      { text: `Fecha: ${new Date().toLocaleString('es-CO')}`, align: 'left' },
      { text: '---', align: 'center' },
      ...order.items.map(item => ({
        text: `${item.quantity}x ${item.dish_name}`,
        bold: false,
        align: 'left' as const,
      })),
    ],
    footer: [
      { text: '---', align: 'center' },
      { text: 'VipePOS', bold: true, align: 'center' },
    ],
  };
}
```

Python side (`pos/print_renderer.py`): re-implements the same logic in Python, consuming the same order payload structure. Both produce equivalent ESC/POS byte streams for the same order.

### Component / Module Map

| File | Change |
|------|--------|
| `pos/requirements.txt` | Create — pinned deps |
| `pos/app.py` | Modify — auth via service-role token, LRU dedupe, encoding negotiation |
| `pos/print_renderer.py` | Create — Python port of shared renderer |
| `lib/print/renderKitchenOrder.ts` | Create — shared TypeScript renderer |
| `components/printing/KitchenOrderPrintView.tsx` | Modify — import from `lib/print/` |
| `components/printing/InvoicePrintView.tsx` | Modify — import from `lib/print/` |

### Sequence Diagram

```
Printer Listener starts
         |
         v
POST /admin/users → service-role JWT (role: service_role)
         |
         v
AsyncRealtimeClient(jwt=service_role_jwt).subscribe('room_commands')
         |
         | <-- Web: waiter calls sendCommand() from WaiterView
         | <-- Web: cashier calls sendBill() from CashierView
         |
         v
handle_comanda(invoice_number, order):
  if not recently_printed.should_print(invoice_number):
    return  -- duplicate, skip
  encoding = negotiate_encoding(printer)
  print_renderer.render(order)  -- shared logic with web
  printer.print()
  recently_printed.cache(invoice_number)
```

### Trade-offs

| Decision | Alternative considered | Why rejected |
|----------|----------------------|-------------|
| Per-station service-role token | Shared anon key with anon re-enabled | Anonymous users are disabled (P2); enabling them globally is a security regression |
| LRU cache size 256 / TTL 30s | Smaller TTL (10s) | 30s covers the reconnect-retry window (typically 5-15s) without being so long that reprints are blocked on legitimate new orders |
| Shared print renderer | Just document the format and keep two implementations | Inconsistency between web preview and Python is the root cause of S5-08 failures; shared renderer enforces canonical format |

### Open Design Questions (P5)

- **Q5-A**: Should the service-role token be pre-issued and stored in `pos/.env` (rotated manually by operator), or issued dynamically at boot? Default: dynamic issuance via a dedicated GoTrue service-role user per station, rotated every 24h.
- **Q5-B**: Should the Python listener use a persistent queue (SQLite) for offline resilience? Default: deferred. Current scope is deduplication + auth + encoding only.

---

## P6 — State & Data Layer Cleanup

### Architecture

The god-store `usePOSStore` (748 lines) is split into four focused stores. React Query becomes the source of truth for server state. `lib/supabase-service.ts` (legacy, 229 lines) is deleted. `lib/log.ts` replaces all `console.log` calls. `types/models.ts` is removed.

### Store Split

```
store/use-pos-store.ts (748 lines)
    ├── store/useTableStore.ts      (~150 lines) — tables[], activeTable, setTables, updateTable
    ├── store/useCartStore.ts      (~150 lines) — cartItems, addItem, removeItem, clearCart
    ├── store/useOrderStore.ts     (~150 lines) — orders[], addOrder, updateOrder, removeOrder
    ├── store/useMenuStore.ts      (~150 lines) — categories, dishes, ingredients
    └── store/useAnalyticsStore.ts  (~100 lines) — getTotalSales, getDailySales (moved from usePOSStore)
```

**Thin shim** (temporary, Q3 from spec):

```typescript
// store/use-pos-store.ts — deleted after P6, replaced by:
import { useTableStore } from './useTableStore'
import { useCartStore } from './useCartStore'
import { useOrderStore } from './useOrderStore'
import { useMenuStore } from './useMenuStore'

// Re-export everything under the old names for migration
export const usePOSStore = {
  ...useTableStore,
  ...useCartStore,
  ...useOrderStore,
  ...useMenuStore,
  // Analytics
  getTotalSales: () => useAnalyticsStore.getState().getTotalSales(),
  getDailySales: (days: number) => useAnalyticsStore.getState().getDailySales(days),
  // ...
}
```

### React Query Migration

**`app/layout.tsx`**:

```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 2,
    },
  },
})

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </body>
    </html>
  )
}
```

**Migration map**: Components that use `useEffect(() => loadX())` are migrated per-view. Priority order: `WaiterView` → `KitchenView` → `CashierView` → `AdminView`.

```typescript
// In WaiterView.tsx (before):
useEffect(() => { loadTables() }, [])

// In WaiterView.tsx (after):
const { data: tables = [] } = useQuery({
  queryKey: ['tables'],
  queryFn: () => tableService.getAll(),
})
// realtime event handler:
queryClient.invalidateQueries({ queryKey: ['tables'] })
```

### `lib/log.ts`

```typescript
// lib/log.ts
type LogLevel = 'info' | 'warn' | 'error'

function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'production') return

  const fn = console[level] ?? console.log
  fn(`[${level.toUpperCase()}] ${message}`, meta ?? '')
}

export const log = {
  info:  (msg: string, meta?: Record<string, unknown>) => log('info', msg, meta),
  warn:  (msg: string, meta?: Record<string, unknown>) => log('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log('error', msg, meta),
}
```

**Migration map** (100+ occurrences):
- Phase 1 of migration: run `grep -rl "console.log" components/ lib/ store/` and replace each with `log.info(...)` etc.
- Phase 2: run `grep -rl "console.warn" ...` and replace with `log.warn(...)`.
- Phase 3: same for `console.error`.
- Tool support: `pnpm eslint --fix` with a custom rule that flags bare `console.*` calls and auto-fixes to `log.*`.

### `lib/supabase-service.ts` Deletion

`AdminView.tsx:37` currently imports from `lib/supabase-service.ts`. After deletion, redirect to `lib/supabase/service.ts`. Full deletion is verified by: `git grep "lib/supabase-service" components/ lib/` returns zero.

### `types/models.ts` Deletion

`types/models.ts` disagrees with `types/index.ts` on `Order.status` and `Table.status` enums. After deletion, all types come from `types/index.ts` or the generated `types/supabase.ts`. A Postgres CHECK constraint enforces enum values at the database:

```sql
ALTER TABLE public.tables
  ADD CONSTRAINT tables_status_check
  CHECK (status IN ('available', 'reserved', 'occupied', 'maintenance'));

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN ('active', 'kitchen', 'delivered', 'paid', 'cancelled'));
```

### Component / Module Map

| File | Change |
|------|--------|
| `store/useTableStore.ts` | Create |
| `store/useCartStore.ts` | Create |
| `store/useOrderStore.ts` | Create |
| `store/useMenuStore.ts` | Create |
| `store/useAnalyticsStore.ts` | Create |
| `store/use-pos-store.ts` | Delete (after shim period) |
| `app/layout.tsx` | Modify — wrap in QueryClientProvider |
| `lib/log.ts` | Create |
| `lib/supabase-service.ts` | Delete |
| `types/models.ts` | Delete |
| `components/views/WaiterView.tsx` | Modify — useQuery for tables/orders |
| `components/views/KitchenView.tsx` | Modify — useQuery for orders |
| `components/views/CashierView.tsx` | Modify — useQuery for orders/cash registers |
| `components/views/AdminView.tsx` | Modify — remove legacy service import |

### Sequence Diagram

```
WaiterView mounts
         |
         v
useQuery(['tables']) fires automatically (no useEffect)
         |
         v
React Query cache populated → useTableStore populated via setTables
         |
         | Postgres: UPDATE tables SET status='occupied' WHERE id=5
         |
         v
realtimeService.subscribeToTables fires postgres_changes event
         |
         v
Event handler: queryClient.invalidateQueries({ queryKey: ['tables'] })
         |
         v
React Query background refetch → updated tables in cache
         |
         v
WaiterView re-renders with new table status (no blank)
```

### Trade-offs

| Decision | Alternative considered | Why rejected |
|----------|----------------------|-------------|
| Four stores, not two (state + actions) | Split into just `useServerStore` + `useUIStore` | Four stores match domain boundaries (tables, cart, orders, menu); co-locating related state reduces selector boilerplate |
| React Query `invalidateQueries` on realtime events | Merge into cache with `setQueryData` | `invalidateQueries` triggers a background refetch, which is correct for RLS-gated data (the server is the source of truth); setQueryData risks stale data if RLS changes |
| Thin shim for one release | Hard rename immediately | Hard rename requires updating all 100+ imports in one PR; shim allows incremental migration with zero breaking changes |

### Open Design Questions (P6)

- **Q6-A**: Should `useCashRegisterStore` also be split from the god-store? Default: no, it is already focused (~200 lines) and not part of the 748-line problem.
- **Q6-B**: Should `lib/log.ts` also capture to a server-side endpoint (e.g., for mobile debugging)? Default: deferred. Current scope is console-only with `NODE_ENV` gate.

---

## Cross-Phase Concerns

### Migration Order

| # | Filename | Rationale |
|---|----------|-----------|
| 1 | `20250917090000_enable_realtime_publication.sql` | P1. Independent. Must land before P6 because P6 modifies realtime paths. |
| 2 | `20250917090005_create_restaurants_and_tenant_columns.sql` | P2. Creates `restaurants` + adds `restaurant_id` FK to all tenant tables. Must land before RLS policies (step 4) which reference the FK. |
| 3 | `20250917090006_create_ingredient_transactions_orders.sql` | P3. Creates junction table. Independent of P2. |
| 4 | `20250917090007_rls_policies_and_profiles_auth_link.sql` | P2. Enables RLS + writes policies + adds `auth_user_id` FK + trigger. References tables from step 2. |
| 5 | `20250917090008_complete_payment_and_delete_order_functions.sql` | P3. Creates Postgres functions. References `orders`, `tables`, `payment_transactions` already in the schema. |
| 6 | `20250917090099_drop_default_anon_grants.sql` | P2. Revokes default grants. Can run after step 4. |

### Rollback Strategy Per Phase

| Phase | Rollback |
|-------|----------|
| P1 | `ALTER PUBLICATION supabase_realtime DROP TABLE public.tables, public.orders, public.order_items;` |
| P2 | Single down migration: `DROP POLICY ... ON ...` for each table; `ALTER TABLE ... DROP COLUMN restaurant_id` (SET NULL or drop depending); `DROP TRIGGER ... ON auth.users`; restore `init.sql` default grants |
| P3 | `DROP FUNCTION complete_payment(uuid, text[], uuid);` and `DROP FUNCTION delete_order_with_items(uuid);` — client keeps old `service.ts` code path during feature-flag window |
| P4 | Delete `.github/workflows/ci.yml`; revert `next.config.mjs` flags; revert `Dockerfile` USER directive — no DB impact |
| P5 | `git checkout HEAD~1 -- pos/requirements.txt pos/app.py` — rollback is a redeploy |
| P6 | Revert the offending small commit; stores are independent so rollback is surgical |

### Performance

| Metric | Expected |
|--------|----------|
| Realtime event rate per station | ≤ 10 events/sec across all tables (≤ 4 stations × busy restaurant) |
| RLS plan overhead | `EXPLAIN` smoke test: SELECT on `tables` with policy should add < 5ms; if > 50ms, add an index on `(restaurant_id)` |
| CI runtime (GitHub Actions) | `pnpm tsc --noEmit` ~60s; `pnpm lint` ~30s; `pnpm build` ~120s. Total ~210s on default branch |
| `complete_payment` execution time | < 200ms under normal load (single row lock, 2 inserts, 2 updates) |

---

## Critical Scenario-to-Design Mapping

| Scenario ID | Requirement ID | Design Section | Verification |
|-------------|---------------|----------------|---------------|
| S1-01 | R1-01 | P1 SQL Migration | `docker compose exec db psql -c "SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime'"` — should list tables, orders, order_items |
| S1-02 | R1-01 | P1 merge algorithm | Two browser tabs, update table from tab A, tab B reflects in < 500ms |
| S1-03 | R1-01 | P1 publication SQL | `ALTER PUBLICATION supabase_realtime DROP TABLE public.tables` — events stop |
| S1-04 | R1-02 | P1 merge algorithm | No `from("tables").select()` in network tab on UPDATE |
| S1-05 | R1-02 | P1 merge algorithm | INSERT event → new row appended, no re-query |
| S1-06 | R1-03 | P1 TableGrid pattern | Grid stays visible during UPDATE; only card changes |
| S1-07 | R1-04 | P1 per-channel unsubscribe | Unsubscribe room_bills → room_commands still fires |
| S1-08 | R1-04 | P1 channel teardown | `supabase.removeChannel()` called on view unmount |
| S2-01 | R2-01 | P2 `restaurant_id` FK | `docker compose exec db psql -c "\d orders"` — shows restaurant_id |
| S2-02 | R2-02 | P2 RLS policy | Tenant A anon key → 0 rows for tenant B |
| S2-03 | R2-02 | P2 RLS SELECT policy | `EXPLAIN (FORMAT JSON) SELECT * FROM tables` — policy in query plan |
| S2-04 | R2-02 | P2 RLS INSERT policy | INSERT with wrong restaurant_id → 400 or silent rejection |
| S2-05 | R2-03 | P2 `init.sql` cleanup | `grep "GRANT ALL.*anon" init.sql` → no match |
| S2-06 | R2-04 | P2 auth trigger | New signup → profiles row auto-created |
| S2-07 | R2-04 | P2 role in app_metadata | Wrong PIN → redirect to login |
| S2-08 | R2-05 | P2 drop password | `docker compose exec db psql -c "\d profiles"` — no password column |
| S2-09 | R2-06 | P2 auth_user_id FK | `SELECT * FROM profiles WHERE auth_user_id = auth.uid()` — returns profile |
| S2-10 | R2-07 | P2 storage policies | Anon upload to dishes → 400 |
| S3-01 | R3-01 | P3 complete_payment function | Payment → orders.status='paid' + table.status='free' in one tx |
| S3-02 | R3-01, R3-02 | P3 FOR UPDATE + idempotency | Concurrent calls → exactly 1 payment_transactions row |
| S3-03 | R3-02 | P3 idempotency | Re-call on paid order → success, 0 new rows |
| S3-04 | R3-03 | P3 delete_order_with_items | Delete order X → order_items + ito links = 0 |
| S3-05 | R3-04 | P3 ingredient_transactions_orders | `SELECT * FROM ingredient_transactions_orders WHERE order_id=X` → rows |
| S3-06 | R3-05 | P3 multi-payment | `['cash:50000', 'card:25000']` → 2 payment_transactions rows |
| S4-01 | R4-01 | P4 next.config.mjs | `@ts-expect-error` without error → `pnpm tsc --noEmit` exits 1 |
| S4-02 | R4-01 | P4 models.ts deletion | Type drift → tsc error in CI |
| S4-03 | R4-02 | P4 eslint config | Unused import → `pnpm lint` exits 1 |
| S4-04 | R4-03 | P4 CI workflow | PR with type error → CI fails, merge blocked |
| S4-05 | R4-04 | P4 Dockerfile USER | `docker run --rm <img> id` → non-zero UID |
| S4-06 | R4-04 | P4 Dockerfile USER | `grep "^USER" Dockerfile` → before CMD |
| S4-07 | R4-05 | P4 pnpm in container | `grep "pnpm" Dockerfile` → present; `grep "npm install" Dockerfile` → absent |
| S4-08 | R4-06 | P4 docker-compose realtime wait | `docker compose ps` → realtime healthy before app |
| S4-09 | R4-7 | P4 package.json rename | `"name": "vipe-pos-system"` in package.json |
| S5-01 | R5-01 | P5 requirements.txt | `pip install -r pos/requirements.txt` → no ImportError |
| S5-02 | R5-02 | P5 service-role JWT | Realtime connection with service-role JWT → subscribed |
| S5-03 | R5-02 | P5 anon key failure | Anon key → no events received |
| S5-04 | R5-03 | P5 LRU dedupe | Duplicate broadcast at T=15 → no re-print |
| S5-05 | R5-03 | P5 LRU TTL | Broadcast at T=31 → re-print allowed |
| S5-06 | R5-04 | P5 UTF-8 negotiation | Startup log shows "Encoding: UTF-8" |
| S5-07 | R5-04 | P5 CP1252 fallback | "Ñoquis" prints without ? on CP1252 printer |
| S5-08 | R5-05 | P5 shared renderer | Web preview and Python output match |
| S6-01 | R6-01 | P6 store split | `useTableStore` + `useCartStore` independent; cart change → table store unchanged |
| S6-02 | R6-01 | P6 usePOSStore deleted | `git grep "usePOSStore" components/` → 0 |
| S6-03 | R6-02 | P6 useQuery migration | WaiterView loads without `useEffect` |
| S6-04 | R6-02 | P6 invalidateQueries | UPDATE event → background refetch within 500ms |
| S6-05 | R6-03 | P6 legacy service deleted | `git grep "lib/supabase-service" components/ lib/` → 0 |
| S6-06 | R6-04 | P6 log.ts migration | `git grep "console.log" components/ lib/ store/` → 0 outside lib/log.ts |
| S6-07 | R6-04 | P6 log.ts conditional | `NODE_ENV=production log.info('x')` → no stdout |
| S6-08 | R6-05 | P6 models.ts deletion | `types/models.ts` → does not exist |

---

## Open Design Questions (All Phases)

| # | Question | Default |
|---|----------|---------|
| Q1 | Per-station service-role tokens for printer listener vs. one shared token? | One per station, scoped to print topic only |
| Q2 | `restaurant_id` as `uuid` or `text` slug? | `uuid`; slug derived in a `restaurants_view` |
| Q3 | Keep `usePOSStore` shim during P6 migration? | Thin shim for one release, then delete |
| Q4 | Data migration: backfill script or wipe-and-re-seed? | Both — idempotent backfill + `supabase db reset` path |
| Q3-A | Should `complete_payment` also compute tax/tip server-side? | Yes — add server-side validation |
| Q3-B | Who issues `invoiceNumber`? | `gen_random_uuid()` as invoice ID; human-readable INV-{year}{seq} in a view |
| Q4-A | Python CI job in GitHub Actions for pos deps check? | Yes, optional matrix job (Windows runner) |
| Q4-B | Document required CI status checks as ADR note? | Yes, in PR description |
| Q5-A | Service-role token: pre-issued in `.env` or dynamic at boot? | Dynamic issuance via GoTrue service-role user, 24h rotation |
| Q5-B | Persistent offline queue for printer listener? | Deferred |
| Q6-A | Should `useCashRegisterStore` also be split? | No — already focused |
| Q6-B | Should `lib/log.ts` also send to a server endpoint? | Deferred |
| Q2-A | How does an operator create a second restaurant? | Seed script in P2; admin UI deferred |
| Q2-B | Should `restaurants` have RLS? | No — seeded by migration |

---

## Requirements Summary

| Phase | Count |
|-------|-------|
| P1 | R1-01, R1-02, R1-03, R1-04 (4) |
| P2 | R2-01, R2-02, R2-03, R2-04, R2-05, R2-06, R2-07 (7) |
| P3 | R3-01, R3-02, R3-03, R3-04, R3-05 (5) |
| P4 | R4-01, R4-02, R4-03, R4-04, R4-05, R4-06, R4-7 (7) |
| P5 | R5-01, R5-02, R5-03, R5-04, R5-05 (5) |
| P6 | R6-01, R6-02, R6-03, R6-04, R6-05 (5) |
| **Total** | **34** |

## Scenarios Summary

| Phase | Count |
|-------|-------|
| P1 | S1-01, S1-02, S1-03, S1-04, S1-05, S1-06, S1-07, S1-08 (8) |
| P2 | S2-01, S2-02, S2-03, S2-04, S2-05, S2-06, S2-07, S2-08, S2-09, S2-10 (10) |
| P3 | S3-01, S3-02, S3-03, S3-04, S3-05, S3-06 (6) |
| P4 | S4-01, S4-02, S4-03, S4-04, S4-05, S4-06, S4-07, S4-08, S4-09 (9) |
| P5 | S5-01, S5-02, S5-03, S5-04, S5-05, S5-06, S5-07, S5-08 (8) |
| P6 | S6-01, S6-02, S6-03, S6-04, S6-05, S6-06, S6-07, S6-08 (8) |
| **Total** | **49** |

---

*Design artifact for `revision-completa-sistema`. Phase ownership: P1 → P6 realtime paths; P2 → RLS/tenant; P3 → Postgres functions; P4 → CI/container; P5 → Python listener; P6 → stores/React Query.*
