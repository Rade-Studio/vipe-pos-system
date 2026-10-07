# Tasks: P6 — State & Data Layer Cleanup

## Phase Goal
Split the 748-line `usePOSStore` into four focused stores (`useTableStore`, `useCartStore`, `useOrderStore`, `useMenuStore`); migrate table/order/menu reads to React Query; delete the legacy `lib/supabase-service.ts`; replace all `console.log` with `lib/log.ts`; remove `types/models.ts`.

## PR Slice Recommendation
- **Three chained PRs** (P6a, P6b, P6c) because the rough size is ~700 lines — well over the 400-line PR budget.
- **P6a (store split)**: T6-01 through T6-06 — create four focused stores + thin shim + delete `usePOSStore`. ~220 lines.
- **P6b (react-query migration)**: T6-07 through T6-11 — wrap layout in `QueryClientProvider`, migrate four views to `useQuery`. ~240 lines.
- **P6c (legacy cleanup)**: T6-12 through T6-14 — `lib/log.ts`, delete `lib/supabase-service.ts`, delete `types/models.ts` + CHECK constraints. ~220 lines.
- **Branch base**: `main` per `stacked-to-main`. PR #6a → `sdd/revision-completa-sistema/p6a-store-split`; PR #6b → `sdd/revision-completa-sistema/p6b-react-query`; PR #6c → `sdd/revision-completa-sistema/p6c-legacy-cleanup` — all targeting `main` (stacked-to-main).

## Tasks (PR #6a — Store Split)

### T6-01 — Create `store/useTableStore.ts`
- **description**: New file (~150 lines) owning `tables[]`, `activeTable`, `setTables`, `updateTable`, `mergeTable`. Uses `create` from `zustand` with no `persist` middleware (server state owned by React Query in P6b; this store holds UI/draft state only). Typed against `types/index.ts`.
- **touches**: [`store/useTableStore.ts`]
- **command**: `pnpm tsc --noEmit` exits 0. `useTableStore.getState().tables` returns the initial empty array.
- **acceptance_criteria**: [a] exports `useTableStore` hook; [b] ≤ 200 lines; [c] typed state + actions.
- **depends_on**: []
- **size_lines_estimate**: ~150 lines
- **commit_split_hint**: Single commit: `refactor(store): extract useTableStore from usePOSStore`.
- **spec_refs**: R6-01 / S6-01.

### T6-02 — Create `store/useCartStore.ts`
- **description**: New file (~150 lines) owning `cartItems[]`, `addItem`, `removeItem`, `updateQuantity`, `clearCart`, `totalCents` selector. UI/draft state — no persistence to Supabase. Typed against `types/index.ts`.
- **touches**: [`store/useCartStore.ts`]
- **command**: `pnpm tsc --noEmit` exits 0. `useCartStore.getState().addItem(item)` → `cartItems.length === 1`.
- **acceptance_criteria**: [a] exports `useCartStore` hook; [b] ≤ 200 lines; [c] independent of `useTableStore` (no cross-imports).
- **depends_on**: []
- **size_lines_estimate**: ~150 lines
- **commit_split_hint**: Single commit: `refactor(store): extract useCartStore from usePOSStore`.
- **spec_refs**: R6-01 / S6-01.

### T6-03 — Create `store/useOrderStore.ts`
- **description**: New file (~150 lines) owning `orders[]`, `activeOrders`, `addOrder`, `updateOrder`, `removeOrder`, `setOrders`. Server state will move to React Query in P6b; this holds UI/optimistic-update state.
- **touches**: [`store/useOrderStore.ts`]
- **command**: `pnpm tsc --noEmit` exits 0.
- **acceptance_criteria**: [a] exports `useOrderStore` hook; [b] ≤ 200 lines; [c] typed state.
- **depends_on**: []
- **size_lines_estimate**: ~150 lines
- **commit_split_hint**: Single commit: `refactor(store): extract useOrderStore from usePOSStore`.
- **spec_refs**: R6-01 / S6-01.

### T6-04 — Create `store/useMenuStore.ts`
- **description**: New file (~150 lines) owning `categories[]`, `dishes[]`, `ingredients[]`, plus `setCategories`, `setDishes`, `setIngredients`. UI/draft state — server data flows via React Query in P6b.
- **touches**: [`store/useMenuStore.ts`]
- **command**: `pnpm tsc --noEmit` exits 0.
- **acceptance_criteria**: [a] exports `useMenuStore` hook; [b] ≤ 200 lines.
- **depends_on**: []
- **size_lines_estimate**: ~150 lines
- **commit_split_hint**: Single commit: `refactor(store): extract useMenuStore from usePOSStore`.
- **spec_refs**: R6-01 / S6-01.

### T6-05 — Replace `store/use-pos-store.ts` with a thin re-export shim
- **description**: Replace the 748-line `use-pos-store.ts` with a small file that re-exports from the four new stores + `useAnalyticsStore`. Keeps all existing imports of `usePOSStore` working during the migration window. Mirrors `usePOSStore` public surface.
- **touches**: [`store/use-pos-store.ts`]
- **command**: `pnpm tsc --noEmit` exits 0; `grep -r "from.*use-pos-store" components/ lib/ hooks/` returns the same number of matches as before the migration.
- **acceptance_criteria**: [a] `usePOSStore` still importable; [b] every existing consumer compiles without changes; [c] file ≤ 60 lines.
- **depends_on**: [T6-01, T6-02, T6-03, T6-04]
- **size_lines_estimate**: ~50 lines
- **commit_split_hint**: Single commit: `refactor(store): thin usePOSStore shim delegating to focused stores`.
- **spec_refs**: R6-01 / —.

### T6-06 — Delete `store/use-pos-store.ts` (after shim verification)
- **description**: Once consumers are migrated off `usePOSStore` (T6-08–T6-11 in P6b), delete `store/use-pos-store.ts` entirely. `git grep "usePOSStore" components/ lib/ hooks/ store/` returns zero.
- **touches**: [`store/use-pos-store.ts`]
- **command**: `grep -r "usePOSStore" components/ lib/ hooks/ store/` → zero matches. `pnpm tsc --noEmit` exits 0.
- **acceptance_criteria**: [a] file does not exist; [b] zero references; [c] bundle size delta ≤ +5 KB.
- **depends_on**: [T6-05, P6b completion]
- **size_lines_estimate**: ~5 lines deleted
- **commit_split_hint**: Single commit: `chore(store): remove usePOSStore shim after migration`.
- **spec_refs**: R6-01 / S6-02.

## Tasks (PR #6b — React Query Migration)

### T6-07 — Wrap `app/layout.tsx` in `QueryClientProvider`
- **description**: Create `QueryClient` with sane defaults (`staleTime: 30_000`, `refetchOnWindowFocus: false`, `retry: 2`). Wrap `{children}` in `<QueryClientProvider client={queryClient}>`. Add `devtools` import behind `NODE_ENV !== 'production'`.
- **touches**: [`app/layout.tsx`, `lib/queryClient.ts`]
- **command**: `pnpm build` exits 0. App boots → React Query DevTools visible (dev only).
- **acceptance_criteria**: [a] `<QueryClientProvider>` wraps the tree; [b] `staleTime` set; [c] DevTools gated to dev.
- **depends_on**: [T6-05]
- **size_lines_estimate**: ~25 lines
- **commit_split_hint**: Single commit: `feat(react-query): wrap app in QueryClientProvider`.
- **spec_refs**: R6-02 / S6-03.

### T6-08 — Migrate `WaiterView.tsx` to `useQuery` for tables + orders
- **description**: Replace `useEffect(() => loadTables())` and `useEffect(() => loadOrders())` with `useQuery({queryKey: ['tables'], queryFn: tableService.getAll})` and `useQuery({queryKey: ['orders'], queryFn: orderService.getAll})`. Realtime event handler calls `queryClient.invalidateQueries({queryKey: ['tables']})` instead of `loadTables()`. Hydrates `useTableStore`/`useOrderStore` via `useEffect` mirroring react-query data.
- **touches**: [`components/views/WaiterView.tsx`]
- **command**: `pnpm tsc --noEmit` exits 0. `grep "useEffect.*loadTables\|useEffect.*loadOrders" components/views/WaiterView.tsx` → zero matches. UPDATE table event → refetch within 500ms.
- **acceptance_criteria**: [a] `useEffect` for initial load removed; [b] realtime uses `invalidateQueries`; [c] no flicker on refetch.
- **depends_on**: [T6-07]
- **size_lines_estimate**: ~80 lines (replace ~120 with ~80)
- **commit_split_hint**: Single commit: `refactor(waiter): migrate to useQuery for tables + orders`.
- **spec_refs**: R6-02 / S6-03, S6-04.

### T6-09 — Migrate `KitchenView.tsx` to `useQuery` for orders
- **description**: Same pattern as T6-08 but for `KitchenView`: replace manual `useEffect` order loaders with `useQuery(['orders', 'kitchen'], kitchenOrderService.getActive)`. Realtime subscription invalidates the same key.
- **touches**: [`components/views/KitchenView.tsx`]
- **command**: `pnpm tsc --noEmit` exits 0. `grep "useEffect.*load" components/views/KitchenView.tsx` → zero matches for data loads.
- **acceptance_criteria**: [a] `useEffect` for data loads removed; [b] kitchen orders stream live; [c] no flicker.
- **depends_on**: [T6-07]
- **size_lines_estimate**: ~60 lines
- **commit_split_hint**: Single commit: `refactor(kitchen): migrate to useQuery for orders`.
- **spec_refs**: R6-02 / S6-04.

### T6-10 — Migrate `CashierView.tsx` to `useQuery` for orders + cash registers
- **description**: Replace `useEffect` loaders for orders + active cash registers with `useQuery`. Realtime subscription invalidates `['orders']` and `['cash_registers', 'active']`.
- **touches**: [`components/views/CashierView.tsx`]
- **command**: `pnpm tsc --noEmit` exits 0. `grep "useEffect.*load" components/views/CashierView.tsx` → zero matches for data loads.
- **acceptance_criteria**: [a] `useEffect` for data loads removed; [b] payment status reflects via realtime invalidation; [c] no flicker.
- **depends_on**: [T6-07]
- **size_lines_estimate**: ~60 lines
- **commit_split_hint**: Single commit: `refactor(cashier): migrate to useQuery for orders + cash registers`.
- **spec_refs**: R6-02 / S6-04.

### T6-11 — Migrate `AdminView.tsx` to `useQuery` + remove legacy `lib/supabase-service` import
- **description**: Replace `useEffect` loaders with `useQuery` for admin dashboard data. Switch the only remaining `lib/supabase-service` import (`AdminView.tsx:37`) to `lib/supabase/service.ts`. Forward the legacy deletion to T6-13.
- **touches**: [`components/views/AdminView.tsx`]
- **command**: `pnpm tsc --noEmit` exits 0. `grep "lib/supabase-service" components/views/AdminView.tsx` → zero matches.
- **acceptance_criteria**: [a] `useEffect` for data loads removed; [b] legacy import replaced.
- **depends_on**: [T6-07]
- **size_lines_estimate**: ~40 lines
- **commit_split_hint**: Single commit: `refactor(admin): migrate to useQuery + drop legacy service import`.
- **spec_refs**: R6-02 / S6-05.

## Tasks (PR #6c — Legacy Cleanup)

### T6-12 — Replace all `console.log` with `lib/log.ts`
- **description**: Create `lib/log.ts` exporting `log.info/warn/error(...)` that gates on `process.env.NODE_ENV !== 'production'`. Migrate every `console.log/warn/error` call in `components/`, `lib/`, `store/` to the corresponding `log.*` call (100+ occurrences). Run `pnpm eslint --fix` with a custom rule that flags bare `console.*` and auto-fixes to `log.*`. Closes HS-32 + HS-33.
- **touches**: [`lib/log.ts`, `components/**/*.tsx`, `lib/**/*.ts`, `store/**/*.ts`]
- **command**: `grep -r "console\.\(log\|warn\|error\)" components/ lib/ store/` → zero matches except inside `lib/log.ts`. `NODE_ENV=production log.info('test')` → no stdout.
- **acceptance_criteria**: [a] `lib/log.ts` exists; [b] no bare `console.*` outside `lib/log.ts`; [c] `NODE_ENV=production` gates output.
- **depends_on**: []
- **size_lines_estimate**: ~30 lines (new file) + many `console.*` → `log.*` replacements
- **commit_split_hint**: Two commits: (1) `feat(log): add lib/log.ts with NODE_ENV gate`; (2) `refactor: replace console.* with log.* across components/lib/store` (large diff but mechanical).
- **spec_refs**: R6-04 / S6-06, S6-07.

### T6-13 — Delete `lib/supabase-service.ts`
- **description**: After T6-11 lands, delete `lib/supabase-service.ts` (the 229-line legacy). `git grep "lib/supabase-service" components/ lib/` returns zero. Closes HS-10.
- **touches**: [`lib/supabase-service.ts`]
- **command**: `git grep "lib/supabase-service" components/ lib/` → zero matches. `pnpm tsc --noEmit` exits 0.
- **acceptance_criteria**: [a] file does not exist; [b] no imports reference it.
- **depends_on**: [T6-11]
- **size_lines_estimate**: ~5 lines deleted
- **commit_split_hint**: Single commit: `chore(refactor): delete legacy lib/supabase-service.ts`.
- **spec_refs**: R6-03 / S6-05.

### T6-14 — Delete `types/models.ts` + add CHECK constraints on enum columns
- **description**: Delete `types/models.ts` (its enum values disagree with `types/index.ts` and the database CHECK). Add migrations adding CHECK constraints to `public.tables.status` and `public.orders.status` matching the canonical enum values. Audit every import of `models.ts` and switch to `types/index.ts` or `types/supabase.ts`. Closes HS-35.
- **touches**: [`types/models.ts`, `supabase/migrations/20250917090014_enum_check_constraints.sql`]
- **command**: `ls types/models.ts` → does not exist. `grep -r "from.*types/models" components/ lib/ hooks/` → zero matches. `docker compose exec db psql -c "\d+ tables"` → shows `tables_status_check` constraint.
- **acceptance_criteria**: [a] `types/models.ts` removed; [b] CHECK constraints present; [c] `pnpm tsc --noEmit` exits 0; [d] no imports reference the deleted file.
- **depends_on**: []
- **size_lines_estimate**: ~30 lines (CHECK constraints + import audit)
- **commit_split_hint**: Two commits: (1) `feat(db): CHECK constraints on tables/orders status enums`; (2) `chore(types): remove models.ts, route to index.ts`.
- **spec_refs**: R6-05 / S6-08.

### T6-15 — Phase verification smoke harness
- **description**: Add `pnpm verify:p6` that runs: (1) `grep -r "usePOSStore\|console\.log\|lib/supabase-service\|types/models" components/ lib/ store/ hooks/` → zero matches; (2) `pnpm tsc --noEmit` exits 0; (3) `pnpm build` exits 0; (4) bundle size diff check via `pnpm next build` output (≤ +5 KB vs baseline).
- **touches**: [`package.json`, `docs/state-cleanup-test.md`]
- **command**: `pnpm verify:p6`.
- **acceptance_criteria**: [a] all grep targets return zero; [b] tsc + build pass; [c] bundle delta within budget.
- **depends_on**: [T6-06, T6-08..T6-11, T6-12, T6-13, T6-14]
- **size_lines_estimate**: ~25 lines
- **commit_split_hint**: Single commit: `chore(verify): add p6 state-cleanup smoke harness`.
- **spec_refs**: R6-01..R6-05 / S6-01..S6-08.

## Verification (apply agent will run per PR)
```
# After PR #6a:
pnpm tsc --noEmit && pnpm build

# After PR #6b:
pnpm tsc --noEmit && pnpm build
# Manual: open two browser tabs on different roles, fire UPDATE on a table, both reflect within 500ms with no flicker.

# After PR #6c:
pnpm verify:p6
```

## Known environmental failures
- The shim T6-05 keeps existing imports working but `useAnalyticsStore` must be created first (not in this phase — added in the apply pass as part of T6-01–T6-04 family).
- Bundle size delta from the four-store split + React Query DevTools is bounded but measurable (~3–5 KB). Anything > +5 KB should be revisited.
- `lib/supabase-service.ts` deletion in T6-13 requires `pnpm tsc --noEmit` to be a hard gate (P4) — otherwise the type errors would silently land.

## Rollback Plan
- **PR #6a**: revert the merge; consumers continue using `usePOSStore` (untouched until revert).
- **PR #6b**: revert; consumers continue using `useEffect` loaders.
- **PR #6c**: revert; `console.log` restored, `models.ts` returns, CHECK constraints dropped.

## Out-of-phase items
- Splitting `useCashRegisterStore` (Q6-A: not needed, already focused).
- Sending `lib/log.ts` output to a server endpoint (Q6-B deferred).
- Removing `localChangesRef` Set in `WaiterView.tsx` (cleaned up in T6-08 because it becomes a no-op with React Query invalidation).
- Custom ESLint rule to flag bare `console.*` — referenced in T6-12 as a possible tool but not delivered.
