# Proposal: optimizar-arquitectura-realtime

Fix the table-grid flicker at its root and consolidate the app's realtime client architecture onto a single owner for table state.

- Change: `optimizar-arquitectura-realtime`
- Date: 2026-09-21
- Base branch: `sdd/revision-completa-sistema/p6c-legacy-cleanup` (58 commits ahead of `main`, unmerged)
- Artifact store: hybrid
- Input: `openspec/changes/optimizar-arquitectura-realtime/exploration.md` (findings F1–F9, re-verified against on-disk source)
- Scope decision: **A1 + A2** — authorized by the user after being shown the tradeoffs. Not re-opened here.

## Intent

### The problem

The POS table grid blanks and repaints whenever a realtime update arrives, worst when several waiters share a floor plan. The exploration established that this is **not** a transport problem: the `supabase_realtime` publication, `wal_level=logical`, and `REPLICA IDENTITY FULL` all landed correctly in `investigar-mesa-sync-realtime`, and `TableGrid` already merges payloads instead of refetching. Events arrive and are applied correctly.

The flicker is a client render and state defect introduced by this branch's P6a store-split and P6b React Query migration. Two mechanisms, both confirmed with file:line evidence:

1. `WaiterView.tsx:1116` puts `key={`tables-section-${activeTable ?? 'none'}`}` on `<TablesSection>`. Any change to `activeTable` remounts the whole `TablesSection` → `TableGrid` subtree, which resets `tables=[]`, `loading=true`, `initialLoadDone=false` (`TableGrid.tsx:85-88`), refetches, and paints the 12-card skeleton (`TableGrid.tsx:195-212`). The realtime path into this is `WaiterView.tsx:243-246`: a remote `UPDATE` freeing the selected table calls `setActiveTable(null)`, which changes the key, which remounts the grid — at the exact instant a remote update arrives.
2. `WaiterView.tsx:240` answers every table event with `queryClient.invalidateQueries({ queryKey: ['tables'] })`, re-running a full `tableService.getAll()` and rewriting both a local `useState` copy and the global store (`WaiterView.tsx:213-219`).

### Why now

The acute symptom is user-reported and reproducible in normal service. Beyond it, the exploration documented a structural defect that will keep regenerating bugs of this class: **three uncoordinated copies of "tables" are alive per `WaiterView` instance** — `TableGrid`'s local `useState` merge (`TableGrid.tsx:85`), `WaiterView`'s `useQuery(['tables'])` plus its own `useState` (`WaiterView.tsx:64, 159-162`), and the global `useTableStore`. Every full-array write to the store re-renders four unrelated render trees (`KitchenView.tsx:89`, `CashierView.tsx:123`, `AdminView.tsx:127`, `CompletedOrdersTable.tsx:29`). Three more defects (duplicate `orders-changes` channels, the Admin panel's full reload per event, an unbounded broadcast-listener leak) are live in production paths today.

Fixing only the acute symptom leaves the generator of these bugs in place. The user chose to fix both.

### What success looks like

A realtime table update repaints only the affected card, on every screen, with no skeleton and no remount — and there is exactly one place in the codebase that owns table state.

## Scope

### In Scope

**Part A — surgical fixes (all six confirmed defects)**

- **A-1** Remove the remount-forcing `key` from `<TablesSection>` (`components/views/WaiterView.tsx:1116`).
- **A-2** Replace the per-event full refetch at `WaiterView.tsx:240` with a direct application of `payload.new`. The merge is extracted from `TableGrid`'s existing `mergeTable` (`TableGrid.tsx:94-129`) into one shared pure module so the logic is written once and later relocated rather than rewritten.
- **A-3** Give `subscribeToOrders` (`lib/supabase/realtime-service.ts:180-234`) the shared-channel treatment `subscribeToTables` already has (`realtime-service.ts:57-85`): one channel per topic, callbacks in a `Set`, teardown only when the last caller unsubscribes. Per the exploration's F4 correction, the defect is **duplicate channels and duplicated per-delivery `order_items` round trips** (`realtime-service.ts:191-207`), not dropped callbacks — each caller's teardown already closes over its own channel reference.
- **A-4** Make `components/admin/tables/TableManagementPanel.tsx:55-62` merge the payload instead of `await loadTables()`, which flips `setLoading(true)` at line 36.
- **A-5** Stop the unbounded no-op listener leak in `sendFactura` / `sendCommand` (`realtime-service.ts:136-177`, registering into `broadcastListenerRegistry` at `realtime-service.ts:102-109` on every invoice and every kitchen ticket, never unsubscribed).
- **A-6** Replace raw `console.log` / `console.error` at `WaiterView.tsx:107, 116` with `lib/log.ts` (the file has no `log` import today; one must be added). Restores compliance with R6-04.

**Part B — consolidation**

- **B-7** Establish **one owner** for table state and delete the competing copies. Recommended shape: `useTableStore` patched in place from the `postgres_changes` payload, with React Query demoted to initial hydration. The alternative — React Query as the source with the Zustand table slice dropped — is a real fork and is analysed under *Approach*; **the design phase settles it**.
- **B-8** Contain the whole-store-write fan-out (F3). `WaiterView.tsx:216` replaces the entire tables array with fresh object references, re-rendering every consumer selecting `(s) => s.tables` under Zustand's default reference equality. Fix by patch-in-place updates plus narrowed selectors with shallow equality at `KitchenView.tsx:89`, `CashierView.tsx:123`, `AdminView.tsx:127`, `CompletedOrdersTable.tsx:29`.
- **B-9** Unify the remaining `postgres_changes` consumers onto the chosen owner and delete component-local realtime `useState` copies across Kitchen, Cashier, and Admin. Includes replacing the per-event `invalidateQueries` in the order path (`WaiterView.tsx:264`, `CashierView.tsx:238`, `AdminView.tsx:221`) with application of the payload that A-3's shared channel already fetched once.
- **B-10** Normalize the broadcast send/subscribe pattern (`room_bills`, `room_commands`) so senders obtain a channel without registering a listener.
- **B-11** Delete the dead data flow in `components/pos/TablesSection.tsx:7-37`: it accepts a `tables` prop and computes `filteredTables` / `searchTerm` / `filterStatus` that it never renders and never forwards (`TablesSection.tsx:41-49`; `TableGridProps` at `TableGrid.tsx:17-26` has no `tables` field).

**Part C — test runner (accepted by the user on 2026-09-21)**

- **C-12** Introduce a minimal Vitest setup as its own slice, landing **before S3**: install Vitest plus a React testing environment, add a `test` script to `package.json`, write unit cases for the pure surfaces S1 and S3 create (the extracted table-merge function from A-2 and the `applyTableChange` reducer from B-7), and update the `testing` snapshot in `openspec/config.yaml` and the Engram `sdd/vipe-pos-system/testing-capabilities` record. This was offered as a recommendation and the user accepted it; it is authorized scope, not a suggestion. Slices S3, S4, and S5 carry unit tests for any pure logic they add. `strict_tdd` stays `false` for this change — the runner is being introduced mid-flight, so tests accompany the code rather than gating it RED-first.

### Out of Scope

- **Replacing the transport.** The exploration's verdict is fix-in-place. Broadcast, `broadcast_changes` triggers, and Presence are all deferred: every confirmed defect (F1–F6) is a client render or state bug, and no RLS or throughput bottleneck was demonstrated at this app's size. Revisit only if RLS-per-subscriber cost is ever measured.
- **Rewriting `subscribeToKitchen`'s channel topology** (5 channels, each doing a full `orderService.getById` per event, `realtime-service.ts:237` onward). *Judgment:* this is avoidable under B-9. `subscribeToKitchen` carries order and order-item traffic, not table state; `KitchenView`'s table consumption (`KitchenView.tsx:89-93`) migrates under B-8/B-9 without touching the kitchen channels, whose callback signatures are unchanged by A-3. Sized as a follow-up at roughly 200–250 authored changed lines, confined to `realtime-service.ts` and `KitchenView.tsx`.
- **The missing 30 s polling fallback (F9).** The R1 spec requires it; no `refetchInterval` or equivalent exists. Recommended as a follow-up change, **with one caveat recorded under *Approach***: the fork chosen for B-7 materially changes its cost.
- **The `2025091709{05,06,07,08,99}` migrations** described in `investigar-mesa-sync-realtime/design.md` but absent from disk. Recorded as a **documentation-versus-reality gap to verify**, not work to do. No migration is authored, edited, or deleted by this change.
- **Merging or rebasing the 58-commit base branch.** Delivery targets the existing branch; the `main` merge remains the separate decision it already is.
- Echo suppression in `TableGrid` (F7, suspected harmless — its merge is idempotent), and any new feature work.

## Capabilities

### New Capabilities

- `realtime-client-sync`: single owner for table state; realtime events apply the payload in place instead of triggering a refetch; selection state never forces a remount of the grid; consumers subscribe with narrowed, shallow-compared selectors so a table change re-renders only the affected cards.
- `realtime-channel-lifecycle`: one Supabase channel per topic shared across all callers, callbacks held in a `Set`, per-callback teardown that closes the channel only when the last caller unsubscribes, and broadcast senders that acquire a channel without registering a listener.

### Modified Capabilities

None. `openspec/specs/` is empty — the R1/R6 deltas from `investigar-mesa-sync-realtime` live in that change's unarchived folder and are not yet root specs.

> **Spec-phase note, not a capability entry.** Two clauses of those unarchived deltas are **superseded** by this change and the specs written here must say so explicitly:
> - R1-02 ("`subscribeToTables` … merge incoming payloads into the shared `useTableStore` state") is *extended* to every table consumer, not just `TableGrid`.
> - R6-02's clause "`QueryClient` invalidation on realtime events MUST replace all per-event `loadTables()` calls" is **the direct cause of F2** and is reversed: realtime events MUST patch state, not invalidate a query. R6-02's remaining clauses (React Query as the server-state source for initial fetch, no `useEffect(() => loadX())`) stand.
>
> If `investigar-mesa-sync-realtime` is archived before this change, these become genuine delta specs against root capabilities. See *Dependencies*.

## Approach

### Principle

Patch, do not refetch. A `postgres_changes` payload already carries the new row; the correct response is to apply it to one owner and let narrowed selectors decide who re-renders. Every defect in this change is a violation of that sentence.

### The architectural fork (B-7) — for the design phase to settle

Three copies of table state exist. One must survive. The exploration left this open; concrete blast-radius evidence now favours one side.

**Option O1 — `useTableStore` is the owner (recommended).** React Query keeps the initial `['tables']` fetch and hands the result to the store once; every realtime event calls a new `applyTableChange(payload)` action that patches a single row in place. `TableGrid` reads from the store instead of self-fetching.

- *For:* the store is already the shared surface — `useTableStore` has consumers in `AdminView.tsx:8,127-130`, `CashierView.tsx:8,123`, `KitchenView.tsx:14,89-93`, `CompletedOrdersTable.tsx:9,29`, `app/page.tsx`, and **eleven** call sites in `WaiterView` alone (`:5, 216, 384, 432, 455, 504, 556, 624, 838, 877, 921`), most of them `getState()` mutators such as `releaseTable`, `updateTableStatus`, `assignWaiterToTable`. Patch-in-place plus `useShallow` gives precise re-render control. `setTables` already short-circuits identical writes on `id`/`status`/`waiter` (`store/useTableStore.ts:23-39`), so the store is already half-way to this model.
- *Against:* couples `TableGrid` to global state; forfeits React Query's refetch-on-focus/reconnect and retry surface for table data; partially walks back the P6b direction.

**Option O2 — React Query `['tables']` is the owner; the Zustand table slice is deleted.** Realtime events call `queryClient.setQueryData(['tables'], patch)`; consumers move to `useQuery(['tables'], { select })`.

- *For:* one cache, aligned with R6-02's stated direction; `refetchInterval: 30_000` would satisfy F9's missing polling fallback nearly for free, and reconnect refetch covers websocket gaps.
- *Against:* far larger blast radius — the ~20 `useTableStore` call sites above include mutator helpers (`reserveTable`, `releaseTable`, `updateTableStatus`, `isTableAccessibleByWaiter`, `getTableById`) with no React Query equivalent; all would need re-homing into mutations or a thin adapter. `select` memoisation is per-component and is itself a re-render trap if the selector identity is not stabilised.

**Recommendation: O1**, on blast-radius grounds. **Consequence to record:** O1 makes the F9 polling fallback a hand-rolled follow-up rather than a one-line query option. If the design phase judges F9 urgent, that argument moves toward O2, and the fork should be decided together with it rather than separately.

### Sequencing principle

The acute user-facing fix must ship first and stand alone. A-1 and A-2 land in slice 1 with no dependency on the consolidation. To avoid writing the merge twice, A-2 extracts `TableGrid`'s existing `mergeTable` into a shared pure module in slice 1; B-7 then **relocates ownership** of that already-correct function instead of rewriting it.

A-3's shared-channel work also precedes B-9 deliberately: once one channel performs the `order_items` lookup once per event, B-9's consumers can apply that payload instead of each re-invalidating.

### RLS and migrations

**No Supabase RLS or policy change is required by this change, and no file under `supabase/migrations/` is created, edited, or deleted.** The infrastructure layer was verified correct by the exploration (scoped publication, `REPLICA IDENTITY FULL` on `tables` / `orders` / `order_items`). This change is entirely client-side TypeScript.

## Delivery Plan

`delivery_strategy` is `auto-chain`; the review budget is 400 authored changed lines per PR. The forecast below exceeds it, so the work is sliced. The chain targets the existing base branch `sdd/revision-completa-sistema/p6c-legacy-cleanup`, not `main`.

| Slice | Content | Files touched | Forecast (add + del) | Risk | Ships alone |
|---|---|---|---|---|---|
| **S1 — Acute flicker fix** | A-1, A-2, A-6 | `WaiterView.tsx`, `TableGrid.tsx` (extraction, **not** a pure move — see D4), new shared merge module | ~110 | Low–Med | **Yes** |
| **S2 — Channel lifecycle** | A-3, A-5, B-10 | `realtime-service.ts` only; caller signatures unchanged | ~200 | Low–Med | Yes |
| **ST — Test runner** | C-12 | `package.json`, `vitest.config.ts`, `vitest.setup.ts`, `openspec/config.yaml`, unit tests for the A-2 merge fn, component test for the F1 remount invariant | ~150 | Low | **Yes** |
| **S3 — Single owner** | B-7, A-4, B-11 | `useTableStore.ts`, `TableGrid.tsx`, `TablesSection.tsx`, `WaiterView.tsx`, `TableManagementPanel.tsx` | ~300 | **Med–High** | Yes |
| **S4 — Fan-out containment** | B-8 | `KitchenView.tsx`, `CashierView.tsx`, `AdminView.tsx`, `CompletedOrdersTable.tsx` | ~130 | Med | Yes |
| **S5 — Consumer unification** | B-9 | `WaiterView.tsx`, `CashierView.tsx`, `AdminView.tsx`, `KitchenView.tsx` | ~220 | Med | Yes |

**Total forecast: ~1110 authored changed lines across 6 PRs.** No slice exceeds the 400-line budget; S3 is the closest and is the one to re-scope if `sdd-tasks` forecasts higher. Dependency order is S1 → S2 → ST → S3 → S4 → S5; S2 is independent of S1 and may be reordered, and ST must land before S3.

- `400-line budget risk: High` (total), `Low` per slice as sliced above.
- `Chained PRs recommended: Yes`
- `Size exception: granted for slice ST only` (2026-09-22, user as maintainer — see the section below).
- `Decision needed before apply: Yes` — `chain_strategy` (`stacked-to-main` vs `feature-branch-chain`) is **not yet collected**. This proposal does not assume one; the orchestrator collects it after `sdd-tasks` produces the Review Workload Forecast.

### Size exception — slice ST (granted 2026-09-22)

Slice ST landed at **479 authored changed lines** (351 code, 128 SDD evidence; the regenerated `pnpm-lock.yaml` is excluded as generated), against the 400-line review budget. The user, as maintainer, granted `size:exception` for this slice rather than splitting it.

Rationale for accepting rather than splitting: ST is a runner installation plus the two test files the runner exists to run. Every split boundary leaves a broken intermediate state — a `vitest.config.ts` with no tests, or test files with no runner to execute them — or drops the evidence documentation the hybrid store requires. The slice is cohesive, not inflated.

This exception applies to ST only. The remaining slices stay under the 400-line budget on the current forecast, and S3 is the closest at ~320.

Note for a reviewer of ST: `@vitejs/plugin-react` is pinned to `^4.7.0` deliberately. Its 5.x and 6.x majors ship `.d.ts` files using export-as-string-literal syntax (`export { x as "module.exports" }`) that this project's TypeScript 5.0.2 cannot parse, which breaks `tsc --noEmit` from outside any project source. `skipLibCheck: true` does not suppress it, because it is a parse error rather than a semantic check. An unconstrained dependency update will silently reintroduce it until the project's TypeScript is upgraded.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `components/views/WaiterView.tsx` (1294 ln) | Modified | Remove remount `key` (:1116); patch instead of invalidate (:231-265); `lib/log.ts` (:107,116); drop local `tables` `useState` (:64) and the dual write (:213-219) |
| `components/pos/TableGrid.tsx` (322 ln) | Modified | S1: extract `mergeTable` (:94-129) unchanged. S3: read from the owner; drop local `useState` (:85) and self-fetch (:134-158) |
| `components/pos/TablesSection.tsx` (52 ln) | Modified | Delete dead `tables` prop and `filteredTables`/`searchTerm`/`filterStatus` (:7-37) |
| `lib/supabase/realtime-service.ts` (567 ln) | Modified | Shared `orders-changes` channel (:180-234); leak-free broadcast senders (:136-177); shared channel helper |
| `store/useTableStore.ts` (116 ln) | Modified | New `applyTableChange` patch action; ownership of realtime-applied state |
| `components/admin/tables/TableManagementPanel.tsx` (514 ln) | Modified | Merge payload instead of `await loadTables()` (:55-62) |
| `components/views/KitchenView.tsx` (1043 ln) | Modified | Narrowed selectors (:89-93); drop the `setTables` write path; order-payload application |
| `components/views/CashierView.tsx` (949 ln) | Modified | Narrowed selector (:123); order-payload application (:234-238) |
| `components/views/AdminView.tsx` (825 ln) | Modified | Narrowed selectors (:127-130); order-payload application (:221) |
| `components/admin/CompletedOrdersTable.tsx` (301 ln) | Modified | Narrowed selector (:29) |
| `lib/realtime/` | New | Shared pure merge/patch module extracted in S1 |
| `supabase/**` | **Unchanged** | No migration, policy, or RLS change |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| The `key` at `WaiterView.tsx:1116` exists to reset `TablesSection`'s filter state on selection | Low | That filter state is dead code — never rendered, never forwarded (`TablesSection.tsx:41-49`). B-11 deletes it outright. Grep for other consumers of the remount side effect before S1 merges. |
| S3's owner switch regresses a `useTableStore` consumer | **Med** | ~20 call sites across 6 files are enumerated above; O1 keeps the store as owner precisely to leave the mutator call sites untouched. Two-tab manual check per slice; S3 ships alone and is revertible in isolation. |
| No automated test can catch a regression in any slice | **High** | Real and unmitigated by tooling — this repo has **no test runner**. See *Verification* for the honest recipe and a scoped recommendation. |
| `npx tsc --noEmit` noise hides a new error | Med | ~484 pre-existing errors are the recorded baseline. Every slice reports the **delta**, never an absolute. A slice that does not reduce or hold the count is not merged. |
| S1's extraction of `mergeTable` touches `TableGrid`, the component the fix protects | Low | Pure move, identical semantics, no call-site behaviour change. If the reviewer prefers, the extraction can be deferred to S3 at the cost of writing the merge twice. |
| A-3's shared `orders-changes` channel changes delivery multiplicity | Med | Today each of 3 callers gets its own channel and its own `order_items` round trip; after A-3 there is one delivery per caller callback from one channel. Consumers that (incorrectly) relied on duplicate delivery would change behaviour — none were found, but verify `CashierView.tsx:234` and `AdminView.tsx:221` under two tabs. |
| Deferring F9 leaves no fallback if the websocket drops | Med | Pre-existing gap, not introduced here. Explicitly recorded; revisit together with the O1/O2 fork. |
| The unarchived `investigar-mesa-sync-realtime` makes spec supersession ambiguous | Med | Recorded under *Capabilities* and *Dependencies*; `sdd-spec` writes the supersession explicitly regardless of archive order. |
| The `2025091709*` doc-vs-disk migration gap hides a real infra difference | Low | Out of scope as work; carried as a verification item. If disk RLS differs from `design.md`, the deferred-transport verdict needs re-checking. |

### Superseded by design D4 (2026-09-21)

This proposal described S1's `mergeTable` extraction as a pure move with identical semantics. `sdd-design` disproved that and the orchestrator verified it against `components/pos/TableGrid.tsx:94-129`: the `incoming` object built for INSERT and UPDATE carries only `id`, `number`, `status`, `waiter`, and `waiter_name` — never `updated_at`. `fetchTables` does not map it either. So `t.updated_at` is always `undefined`, `existingTime` is always `0`, and the out-of-order guard at lines 118-121 has never rejected a single event. Extracting it makes the guard live for the first time, which is a behaviour change, not a relocation. S1 is re-rated Low–Med and its reviewer must be told.

## Rollback Plan

Each slice is an independent, revertible commit range on the base branch, and nothing outside `components/`, `lib/`, and `store/` is touched.

- **Per slice:** `git revert <merge-commit>` restores the previous behaviour. No database, migration, schema, policy, or infrastructure state is involved, so revert is complete — there is no data to recover and no `supabase db reset` to run.
- **S1 specifically:** reverting restores the `key` prop and the `invalidateQueries` call, i.e. the flicker returns but nothing else regresses.
- **S3 specifically (highest risk):** reverting restores the three-copy model. Because S4 and S5 depend on S3's owner, a revert of S3 after S4/S5 have landed requires reverting them in reverse order (S5 → S4 → S3). If S3 is suspect, hold S4/S5 until S3 has been exercised in real service for at least one shift.
- **Emergency full rollback:** revert all five merge commits in reverse order; the branch returns to commit `1cbd88b` behaviour with no residue.

## Dependencies

- **Base branch:** `sdd/revision-completa-sistema/p6c-legacy-cleanup`, 58 commits ahead of `main` and unmerged. All slices target this branch. Its merge to `main` is a separate, pre-existing decision.
- **`chain_strategy` is not yet collected.** `sdd-apply` must not begin a multi-slice chain before the orchestrator resolves it.
- **Archive ordering:** `investigar-mesa-sync-realtime` is unarchived, so `openspec/specs/` is empty and the R1/R6 requirements are not root specs. `sdd-spec` must write the supersession of R1-02 and R6-02's invalidation clause explicitly rather than relying on a delta against a root spec that does not exist.
- **No new runtime dependency** is introduced. `useShallow` ships with the installed Zustand; no package is added.
- **Design-phase input required:** the O1/O2 fork (B-7) and the coupled F9 decision. `sdd-design` owns both; `sdd-apply` must not start S3 before they are settled.

## Verification

This repository has **no test runner** — no jest, vitest, or playwright config, no `test` script, zero `.test`/`.spec` files (`openspec/config.yaml`, `testing.strict_tdd: false`). No test plan is invented here.

**Per slice, before merge:**

1. `npm run lint` — clean, or unchanged from the slice's base.
2. `npx tsc --noEmit` — report the **delta** against the ~484-error pre-existing baseline. A slice must not add errors. No clean-zero claim is made or expected.
3. `npm run build` — exit 0.
4. **Two-tab manual recipe** (the prior change's documented procedure): two tabs at `http://localhost:3003`; flip a table's status in tab A; tab B updates without a skeleton repaint and without the grid blanking. Extended per slice:
   - S1: also click a table in tab A and confirm the grid does not repaint on selection.
   - S2: with Cashier and Admin both open, confirm one order event produces one update per view, and inspect the network panel for a single `order_items` request per event.
   - S3: repeat the base recipe with Waiter, Admin, and the `TableManagementPanel` open simultaneously.
   - S4: with Kitchen, Cashier, and Admin open, confirm a table change in Waiter does not repaint unrelated lists.
   - S5: confirm order status changes propagate to Waiter, Cashier, and Admin.
5. **Leak check for A-5:** print several invoices and kitchen tickets in one session, then confirm the `broadcastListenerRegistry` handler sets for `room_bills` / `room_commands` do not grow per send.

**Accepted by the user (2026-09-21) — a minimal test runner lands as slice ST, before S3.** S1 extracts a pure merge function and S3 introduces a pure `applyTableChange` reducer; both are trivially unit-testable and are exactly where the remaining risk concentrates. Cost: install Vitest with a React environment (`vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@vitejs/plugin-react`) plus config and a setup file, add a `test` script, write the pure-function cases and the F1 remount component test, and update the `testing` snapshot in `openspec/config.yaml` and the Engram testing-capabilities record. Estimate: half a day, roughly 120 new lines, delivered as slice ST ahead of S3. From ST onward, every slice that adds pure logic ships unit tests for it; S1 and S2 may land before ST and are verified by the manual recipe alone.

## Success Criteria

- [ ] Selecting or deselecting a table in `WaiterView` does not remount `TableGrid` and produces no skeleton repaint.
- [ ] A remote table `UPDATE` repaints only the affected card; the grid stays visible throughout, on Waiter, Admin, Kitchen, and Cashier screens.
- [ ] Zero `queryClient.invalidateQueries` calls remain inside any `postgres_changes` handler.
- [ ] Exactly one module owns table state; `grep` finds no second `useState<Table[]>` fed by a realtime handler.
- [ ] One `orders-changes` channel exists regardless of how many views are mounted, and one event produces one `order_items` round trip.
- [ ] `sendFactura` and `sendCommand` register no listener; the broadcast registry does not grow with repeated sends.
- [ ] No `console.*` call remains in `components/views/WaiterView.tsx`.
- [ ] A table change in `WaiterView` does not re-render the tables-derived UI of `KitchenView`, `CashierView`, `AdminView`, or `CompletedOrdersTable` unless that view's own data changed.
- [ ] `TablesSection`'s dead `tables` prop and filter state are deleted.
- [ ] `npm test` exists and passes from slice ST onward; the A-2 merge function and the B-7 reducer each have unit cases.
- [ ] Each slice: `npm run lint` clean, `npx tsc --noEmit` delta ≤ 0 against baseline, `npm run build` exit 0, two-tab recipe passed.
- [ ] No slice exceeds 400 authored changed lines.
- [ ] No file under `supabase/` is modified.

## Open Decisions Returned to the Orchestrator

These are not resolved here and are not assumed.

1. **O1 vs O2 for B-7** (`useTableStore` as owner, or React Query with the Zustand table slice dropped). Recommendation O1 with evidence above; `sdd-design` settles it. Coupled to decision 2.
2. **F9 polling fallback** — deferred as a follow-up per the authorized scope, but O2 would make it nearly free. If it is judged urgent, decide it together with decision 1 rather than after.
3. **Test runner** — **RESOLVED 2026-09-21: accepted by the user, with a React environment.** Lands as slice ST before S3 (see C-12). The design initially narrowed it to a pure-function runner (D11); the user restored jsdom and Testing Library so the F1 remount and D6 fan-out invariants are covered by assertion rather than by the manual recipe alone. `strict_tdd` remains `false` for this change.
4. **`chain_strategy`** — pending, collected by the orchestrator after `sdd-tasks`. Not assumed here.

## Ready for Spec / Design

Yes. `sdd-spec` and `sdd-design` may run in parallel, with one constraint: `sdd-design` owns the O1/O2 fork, so `sdd-spec` should write `realtime-client-sync`'s ownership requirement in owner-agnostic terms ("exactly one module owns table state and realtime events patch it in place") and leave the concrete module to the design.
