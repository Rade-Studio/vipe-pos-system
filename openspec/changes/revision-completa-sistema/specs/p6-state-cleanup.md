# Delta for State and Data Layer Cleanup (P6)

## Purpose

Split the 748-line `usePOSStore` into four focused stores (`useTableStore`, `useCartStore`, `useOrderStore`, `useMenuStore`); migrate table/order/menu reads to React Query; delete `lib/supabase-service.ts`; replace all `console.log` with `lib/log.ts`; remove `types/models.ts`.

## ADDED Requirements

### Requirement: R6-01 — POS Store Split into Four Focused Stores

The system MUST split `store/use-pos-store.ts` into four files:
- `store/useTableStore.ts` — table state, `setTables`, `updateTable`
- `store/useCartStore.ts` — cart items, `addItem`, `removeItem`, `clearCart`
- `store/useOrderStore.ts` — active orders, `setOrders`, `updateOrder`
- `store/useMenuStore.ts` — categories, dishes, ingredients

Each store MUST have ≤ 200 lines and MUST export a `use[Entity]Store` hook with typed state and actions.

#### Scenario: S6-01 — Each store has independent state

- GIVEN `useTableStore` holds tables; `useCartStore` holds cart items
- WHEN `useCartStore.getState().addItem(...)` is called
- THEN `useTableStore.getState()` is unchanged
- AND no re-render is triggered for components subscribed only to `useTableStore`

#### Scenario: S6-02 — `usePOSStore` is deleted

- GIVEN `git grep "usePOSStore" components/` is run after P6 migration
- THEN zero matches are returned
- AND `store/use-pos-store.ts` does not exist on disk

### Requirement: R6-02 — React Query Is the Server-State Source

`app/layout.tsx` MUST wrap the app in `<QueryClientProvider>`.

All data fetching for `tables`, `orders`, `categories`, `dishes`, `profiles` MUST use `useQuery` from `@tanstack/react-query`.

Components MUST NOT use `useEffect(() => loadX())` for initial data fetching; they MUST use `useQuery`.

`QueryClient` invalidation on realtime events MUST replace all per-event `loadTables()` calls.

#### Scenario: S6-03 — First load uses useQuery

- GIVEN `WaiterView` is mounted with a fresh `QueryClient`
- WHEN the component renders
- THEN `useQuery(['tables'])` fires automatically
- AND the result populates `useTableStore` state
- AND no `useEffect` triggers the load

#### Scenario: S6-04 — Realtime event invalidates query cache

- GIVEN `useQuery(['tables'])` has loaded tables into cache
- WHEN a `postgres_changes` UPDATE event fires for `tables`
- THEN `queryClient.invalidateQueries({ queryKey: ['tables'] })` is called
- AND a background refetch updates the cache within 500 ms

### Requirement: R6-03 — `lib/supabase-service.ts` Deleted

`lib/supabase-service.ts` MUST NOT exist on disk after P6.

No component or service file may import from `lib/supabase-service.ts`.

#### Scenario: S6-05 — Legacy service deleted

- GIVEN `git grep "lib/supabase-service" components/ lib/` is run
- THEN zero matches are returned
- AND `AdminView.tsx` imports only from `lib/supabase/service.ts`

### Requirement: R6-04 — `lib/log.ts` Is the Only Console Logger

All code in `components/`, `lib/`, and `store/` MUST use `lib/log.ts` for logging.

`lib/log.ts` MUST:
- Expose `log.info(...)`, `log.warn(...)`, `log.error(...)` functions
- Conditionally call `console.log/warn/error` based on `NODE_ENV !== "production"`
- Accept structured metadata as a second argument

#### Scenario: S6-06 — No bare console.log in source

- GIVEN `git grep "console.log" components/ lib/ store/` is run
- THEN zero matches are returned
- AND only `lib/log.ts` contains a `console.log` call

#### Scenario: S6-07 — Log functions conditionally output

- GIVEN `NODE_ENV = "production"` is set
- WHEN `log.info('test')` is called
- THEN no output appears on stdout
- AND when `NODE_ENV = "development"`, output appears

### Requirement: R6-05 — `types/models.ts` Removed

`types/models.ts` MUST NOT exist on disk after P6.

All type exports MUST come from `types/index.ts` or generated Supabase types in `types/supabase.ts`.

#### Scenario: S6-08 — models.ts deleted, index.ts is sole source

- GIVEN `types/models.ts` does not exist
- WHEN any `.ts` file imports a type
- THEN the type is resolved from `types/index.ts` or `types/supabase.ts`
- AND no import references `models.ts`

## MODIFIED Requirements

None — P6 introduces new behavior only.

## NON-FUNCTIONAL REQUIREMENTS

| Aspect | Requirement |
|--------|-------------|
| Bundle size | Store split MUST NOT increase the total JS bundle size by > 5 KB |
| Migration path | A `usePOSStore` re-export shim MAY exist for one release to ease migration, then be deleted |
| Console noise | Production build MUST ship zero `console.log` calls |

## MIGRATION / ROLLBACK

- **Migration**: store split in small commits; each commit is individually compilable
- **Rollback**: revert the offending commit; stores are independent so rollback is surgical

## OUT OF SCOPE

- RLS / multi-tenant schema (P2)
- Payment atomicity (P3)
- CI / build hardening (P4)
- Printer listener (P5)
- Realtime publication (P1)
