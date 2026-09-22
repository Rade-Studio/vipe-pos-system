# Tasks: optimizar-arquitectura-realtime

> Chain target: `sdd/revision-completa-sistema/p6c-legacy-cleanup` (not `main`). Delivery strategy: `auto-chain`. `chain_strategy` (stacked-to-main vs feature-branch-chain) is **not yet collected** — the orchestrator collects it after this document is produced. Slice order: **S1 → S2 → ST → S3 → S4 → S5**. S1 and S2 are mutually independent and may be reordered; **ST must land before S3**; S4 and S5 both require S3.
>
> `strict_tdd` is `false` for this change. A Vitest runner is introduced by slice ST itself — S1 and S2 ship before it exists and are verified by lint/typecheck/build/manual recipe only. From ST onward, pure logic added by a slice ships with unit tests alongside the code, not RED-first.
>
> No file under `supabase/` is created, edited, or deleted by any task in this document.

## Review Workload Forecast (summary — full detail at the end of this document)

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1220 total (see per-slice breakdown at the bottom) |
| 400-line budget risk | High (total, pre-slicing) / Low per individual slice (largest: S3 ≈ 320) |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 = S1, PR 2 = S2, PR 3 = ST, PR 4 = S3, PR 5 = S4, PR 6 = S5 |
| Delivery strategy | auto-chain |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain (user decision, 2026-09-21). PR #1 targets the tracker branch `sdd/revision-completa-sistema/p6c-legacy-cleanup`; each child PR targets the immediately preceding PR branch; only the tracker merges to `main`. Chosen because the base branch already carries 58 unmerged commits, so stacking to `main` would drag that backlog into every PR diff in this chain.
400-line budget risk: Low (per slice as sliced below; High in aggregate before slicing — see full forecast)

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| S1 | Acute flicker fix: no remount on selection, patch instead of refetch, structured logging | PR 1 | `npx tsc --noEmit` (delta) + `npm run build` (no `npm test` yet) | Two-tab manual recipe: flip status in tab A, tab B updates without skeleton; click a table in tab A, grid does not repaint | `git revert` restores the `key` prop and `invalidateQueries`; flicker returns, nothing else regresses |
| S2 | Channel lifecycle: shared `orders-changes` channel, leak-free broadcast senders | PR 2 | `npx tsc --noEmit` (delta) + `npm run build` (no `npm test` yet) | Two-tab manual recipe: Cashier + Admin open, one order event → one update each, network panel shows one `order_items` request; leak check for repeated invoice/ticket sends | `git revert` restores duplicate channels and the listener leak; touches only `realtime-service.ts` |
| ST | Introduce Vitest + jsdom + Testing Library | PR 3 | `npm test` (new) | `npx vitest run` against the two new test files | `git revert` removes the runner and its tests; no production code affected |
| S3 | Single owner: `useTableStore.applyTableChange`, `TableGrid`/`WaiterView` read from the store, `TableManagementPanel` row-merge, dead prop removal | PR 4 | `npm test` + `npx tsc --noEmit` (delta) + `npm run build` | Two-tab manual recipe with Waiter, Admin, and `TableManagementPanel` open together | **Highest risk.** `git revert` restores the three-copy model; if S4/S5 have landed, revert them first (S5 → S4 → S3) |
| S4 | Fan-out containment: D6 classification + narrowed selectors + `app/page.tsx` fix | PR 5 | `npm test` + `npx tsc --noEmit` (delta) + `npm run build` | Two-tab manual recipe with Kitchen, Cashier, Admin open; confirm a Waiter table change does not repaint unrelated lists | `git revert` restores wide selectors; correctness unaffected, only re-render breadth |
| S5 | Consumer unification: payload application replaces `invalidateQueries` in the order path across three views | PR 6 | `npm test` + `npx tsc --noEmit` (delta) + `npm run build` | Two-tab manual recipe confirming order status changes propagate to Waiter, Cashier, Admin | `git revert` restores per-event `invalidateQueries` in the order path |

---

## Slice S1 — Acute flicker fix (A-1, A-2, A-6)

Files touched: `components/views/WaiterView.tsx`, `components/pos/TableGrid.tsx`, `lib/realtime/table-merge.ts` (new). No test runner exists yet — verification is lint + typecheck delta + build + the two-tab manual recipe.

- [ ] S1.1 Create `lib/realtime/table-merge.ts` exporting `TableRow`, `TableChange`, `toTable(row): Table | null`, and `mergeTableList(prev, change): Table[]`, per design D3/D10. The module imports only `import type { Table } from "@/types"` — no Supabase client, no store, no `lib/log`, no React. Implement all 11 rows of the D10 behaviour table (INSERT new/duplicate/id-less, UPDATE not-older/older/unknown-id/id-less, DELETE present/absent/id-less, unknown `eventType`), returning the identical `prev` reference on every no-op row. `toTimestamp(value)` returns `0` for `null`/`undefined`/unparseable input; comparison is `incomingTs >= existingTs`.
  - **Req**: `realtime-client-sync` / "Realtime Table Events Patch State In Place" (foundation); D3, D10.
  - **Verify**: `npx tsc --noEmit` delta unchanged or improved; file exists with the exported signatures listed in design.md's Interfaces section.

- [ ] S1.2 In `toTable`, carry `updated_at` onto the normalized row, mapped as `row.updated_at ? new Date(row.updated_at) : undefined` (design D4). This is a **deliberate behaviour change, not a pure move**: today's `mergeTable` (`components/pos/TableGrid.tsx:94-129`) never populates `updated_at`, so the out-of-order guard at `TableGrid.tsx:118-121` has never rejected an event. After this task the guard becomes live for the first time — an out-of-order UPDATE that is applied today will be rejected after this slice ships. Add a code comment directly above the `updated_at` mapping line citing this (`// D4: makes the out-of-order guard live for the first time — see design.md`).
  - **Req**: `realtime-client-sync` (D4 correction to A-2); not a spec scenario on its own, but the mechanism the "Update event patches one row without a re-fetch" scenario depends on.
  - **Verify**: unit-testable once ST lands (ST.5 covers this); until then, manual code review confirms the comment and the `Date` normalization are present. `npx tsc --noEmit` delta.

- [ ] S1.3 [Reviewer-notice task, no additional code] Add one sentence to the S1 PR/commit description stating explicitly: *"This extraction makes the `updated_at` out-of-order guard reject events for the first time (see design.md D4). `proposal.md`'s original framing of this slice as a pure move is superseded — treat this as a behaviour fix, not a refactor."* This satisfies the orchestrator's requirement that S1 not be described as a pure refactor.
  - **Req**: process/documentation requirement carried from design D4.
  - **Verify**: commit message or PR description contains the sentence.

- [ ] S1.4 Delete the local `mergeTable` function body at `components/pos/TableGrid.tsx:94-129` (including the `as unknown as string` cast at `:120`) and replace the merge call site (`TableGrid.tsx:165`, per design) with `mergeTableList`/`toTable` imported from `lib/realtime/table-merge.ts`. `TableGrid` keeps its own local `useState` for now — S3 is what removes it (see S3.3); this task only swaps the merge implementation.
  - **Req**: `realtime-client-sync` / supports "Realtime Table Events Patch State In Place" for the `TableGrid` consumer.
  - **Verify**: `grep -n "as unknown as string" components/pos/TableGrid.tsx` returns zero matches; `npx tsc --noEmit` delta ≤ 0.

- [ ] S1.5 Remove `key={\`tables-section-${activeTable ?? 'none'}\`}}` from `<TablesSection>` in `components/views/WaiterView.tsx:1116` (A-1). `TablesSection`'s filter state that this key was theorized to protect is dead code (confirmed never rendered/forwarded, `TablesSection.tsx:41-49`) and is deleted outright in S3 (B-11); do not add a replacement key.
  - **Req**: `realtime-client-sync` / "Selection State Must Not Force A Grid Remount", both scenarios.
  - **Verify**: `grep -n "tables-section-\${activeTable" components/views/WaiterView.tsx` returns zero matches; two-tab recipe (S1.8) — selecting a table produces no skeleton repaint.

- [ ] S1.6 Replace the per-event `queryClient.invalidateQueries({ queryKey: ['tables'] })` call at `components/views/WaiterView.tsx:240` with a direct call to `mergeTableList(prevTables, change)` from `lib/realtime/table-merge.ts`, writing the merged result into the **existing** dual-write locations at `WaiterView.tsx:213-219` (the local `useState` copy and `useTableStore.setTables`). This slice does **not** change the ownership model — S3 removes the local `useState` and the dual write; S1 only removes the refetch, it does not yet route through the not-yet-existing `applyTableChange` store action.
  - **Req**: `realtime-client-sync` / "Realtime Table Events Patch State In Place", scenarios "Update event patches one row without a re-fetch" and "Zero invalidateQueries calls inside a postgres_changes handler" (for the `tables` topic only — the `orders` topic's `invalidateQueries` calls are out of scope for S1 and are addressed in S5).
  - **Verify**: `grep -n "invalidateQueries({ queryKey: \['tables'\]" components/views/WaiterView.tsx` returns zero matches; `npx tsc --noEmit` delta; two-tab recipe confirms a remote UPDATE repaints the affected card without a full-list refetch.

- [ ] S1.7 Replace raw `console.log`/`console.error` calls at `components/views/WaiterView.tsx:107, 116` with `log.info`/`log.error` from `lib/log.ts`, adding the missing `import { log } from "@/lib/log"` (A-6).
  - **Req**: `realtime-client-sync` / "Structured Logging In WaiterView", scenario "No bare console calls in WaiterView".
  - **Verify**: `grep -n "console\.\(log\|warn\|error\)" components/views/WaiterView.tsx` returns zero matches; `WaiterView.tsx` imports `log` from `lib/log.ts`.

- [ ] S1.8 Per-slice verification (no `npm test` yet): `npm run lint` clean or unchanged from base; `npx tsc --noEmit` — report the delta against the ~484-error pre-existing baseline, never an absolute; `npm run build` exit 0; two-tab manual recipe — flip a table's status in tab A, confirm tab B updates without a skeleton repaint and without the grid blanking; additionally click a table in tab A and confirm the grid does not repaint on selection.
  - **Req**: proposal *Verification* §1–4 (S1 extension); no formal spec scenario, this is the slice gate.

---

## Slice S2 — Channel lifecycle (A-3, A-5, B-10)

Files touched: `lib/supabase/realtime-service.ts` only. Public signatures (`subscribeToOrders`, `sendFactura`, `sendCommand`, `subscribeToPosEvents`) are unchanged, so no caller in `WaiterView.tsx`, `CashierView.tsx`, or `AdminView.tsx` needs an edit in this slice.

- [ ] S2.1 Add `type OrdersChannelEntry = { channel: RealtimeChannel; callbacks: Set<OrderCallback> }` and `const ordersChannels = new Map<string, OrdersChannelEntry>()` in `lib/supabase/realtime-service.ts`, mirroring the existing `TablesChannelEntry`/`tablesChannels` shape already in the file (`:33-38`).
  - **Req**: `realtime-channel-lifecycle` / "One Channel Per Topic, Shared Across Callers".
  - **Verify**: `npx tsc --noEmit` delta.

- [ ] S2.2 Rewrite `subscribeToOrders` (`realtime-service.ts:180-234`) so a caller's callback is added to the `ordersChannels` entry's `Set`, and `supabase.channel("orders-changes")` plus the `postgres_changes` listener attachment run only when no entry exists yet for that topic. Preserve the exact public signature `subscribeToOrders(callback: OrderCallback) => () => void`.
  - **Req**: `realtime-channel-lifecycle` / "One Channel Per Topic, Shared Across Callers", scenario "Multiple callers share one channel".
  - **Verify**: `npx tsc --noEmit` delta; caller sites (`WaiterView.tsx:255`, `CashierView.tsx:234`, `AdminView.tsx:221`) require no edit — confirm by `git diff` touching only `realtime-service.ts`.

- [ ] S2.3 Move the `order_items` `SELECT` (today at `realtime-service.ts:197-200`, one per caller) to run exactly once per event, inside the shared handler, **before** the fan-out loop over `entry.callbacks`. On fetch error: replace today's silent `return` (`:202-204`, which drops the event for one caller) with a `log.error` call via `lib/log`, and still fan out to every callback with `order_items` left `undefined` (never `[]`, which would render a paid order as empty). Add a code comment stating the read-only contract: the fanned-out payload object is shared by reference across all callbacks; consumers must not mutate it (D7).
  - **Req**: `realtime-channel-lifecycle` / "One Realtime Event Produces One Downstream Round Trip", both scenarios. Producer-side half of `realtime-client-sync`'s payload-application contract that S5 consumes.
  - **Verify**: `npx tsc --noEmit` delta; two-tab recipe (S2.9) — network panel shows exactly one `order_items` request per event with Cashier and Admin both open.

- [ ] S2.4 Rewrite `subscribeToOrders`'s returned teardown to remove only the calling callback from the topic's `Set`, calling `supabase.removeChannel(channel)` (preserving today's mechanism at `:231`) only when the `Set` becomes empty, and deleting the `ordersChannels` entry for that topic at that point. Remove the now-redundant single-slot `realtimeService.channels["orders"]` bookkeeping (`:226, 232`) — verified by design that nothing outside this file reads that slot.
  - **Req**: `realtime-channel-lifecycle` / "One Channel Per Topic, Shared Across Callers", scenarios "One caller unsubscribing does not affect the others", "The channel is torn down only after the last caller unsubscribes", "Bookkeeping does not leak stale entries".
  - **Verify**: `npx tsc --noEmit` delta; `grep -n 'channels\["orders"\]' lib/supabase/realtime-service.ts` returns zero matches.

- [ ] S2.5 Extract a module-private `getBroadcastChannel(channelKey: string): RealtimeChannel` helper (D8) that acquires or creates a channel **without** registering any listener and without touching `broadcastListenerRegistry`. `subscribeToPosEvents` is refactored to call this helper internally for its own channel acquisition, then perform its existing registry insert and `channel.on(...)` binding exactly as today — its own signature and behaviour are unchanged.
  - **Req**: `realtime-channel-lifecycle` / "Broadcast Senders Obtain A Channel Without Registering A Listener" (enabling change).
  - **Verify**: `npx tsc --noEmit` delta.

- [ ] S2.6 Update `sendFactura` (`realtime-service.ts:136-157`) to call `getBroadcastChannel("room_bills")` instead of `realtimeService.subscribeToPosEvents(channelKey, "new_invoice", () => {})` (`:139`), removing that no-op listener registration entirely. `sendFactura`'s own signature and its `.send(...)` call are unchanged.
  - **Req**: `realtime-channel-lifecycle` / "Broadcast Senders Obtain A Channel Without Registering A Listener", scenario "Sending does not register a listener".
  - **Verify**: `npx tsc --noEmit` delta; A-5 leak check (S2.9).

- [ ] S2.7 Update `sendCommand` (`realtime-service.ts:159-177`) to call `getBroadcastChannel("room_commands")` instead of its own `subscribeToPosEvents(channelKey, "new_command", () => {})` call (`:161`), removing that no-op listener registration.
  - **Req**: `realtime-channel-lifecycle` / "Broadcast Senders Obtain A Channel Without Registering A Listener", scenario "The broadcast registry does not grow with repeated sends".
  - **Verify**: `npx tsc --noEmit` delta; A-5 leak check (S2.9).

- [ ] S2.8 [Confirm-at-apply task] Verify whether `channel.on("broadcast", ...)` registered **after** `channel.subscribe()` binds correctly in the installed `@supabase/supabase-js`/`@supabase/realtime-js` version, since `subscribeToPosEvents`'s existing call order is preserved unchanged by this slice. Inspect `node_modules/@supabase/realtime-js` (read-only) for the `RealtimeChannel` implementation of `.on`/`.subscribe`, or run a minimal manual check against the dev server. Record the finding as a one-line code comment near `subscribeToPosEvents` and in the PR description. Not a blocker for D8, but must be checked rather than assumed.
  - **Req**: design D8 `[confirm at apply]` item.
  - **Verify**: PR description states the finding explicitly (binds / does not bind, with evidence cited).

- [ ] S2.9 Per-slice verification (no `npm test` yet): `npm run lint`; `npx tsc --noEmit` delta; `npm run build`; two-tab manual recipe — open Cashier and Admin together, confirm one order event produces one update per view, inspect the network panel for a single `order_items` request per event; leak check for A-5 — print several invoices and kitchen tickets in one session, confirm `broadcastListenerRegistry` handler sets for `room_bills`/`room_commands` do not grow per send.
  - **Req**: proposal *Verification* §2, §5.

---

## Slice ST — Test runner (C-12)

Files touched: `package.json`, `vitest.config.ts` (new), `vitest.setup.ts` (new), `openspec/config.yaml`, `lib/realtime/table-merge.test.ts` (new), `components/pos/TableGrid.test.tsx` (new). `strict_tdd` stays `false` — this slice installs the runner alongside tests for surfaces S1 already created; it does not retroactively require RED-first proof for S1/S2.

- [ ] ST.1 Add devDependencies to `package.json`: `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@vitejs/plugin-react`. Add `"test": "vitest run"` and `"test:watch": "vitest"` scripts. Delete the now-misleading `"test:placeholder": "echo 'No test runner configured yet' && exit 0"`.
  - **Req**: proposal C-12; design D11 (revised).
  - **Verify**: install succeeds; `cat package.json` shows the new scripts and no `test:placeholder`.

- [ ] ST.2 Create `vitest.config.ts` per design D11: `plugins: [react()]`, `resolve.alias["@"]` pointing at the repo root (mirrors `tsconfig.json` `paths: { "@/*": ["./*"] }`), `test.environment: "jsdom"`, `test.setupFiles: ["./vitest.setup.ts"]`, `test.include` covering `lib/**/*.test.ts`, `store/**/*.test.ts`, `components/**/*.test.tsx`.
  - **Req**: design D11.
  - **Verify**: `npx vitest run` boots without a config-load error.

- [ ] ST.3 [Confirm-at-apply task] Verify `__dirname` availability inside `vitest.config.ts` at the moment it actually loads. `package.json` declares no `"type"` field (expected CJS), but the actual Vite config loader's resolution must be observed by running `npx vitest run` once and checking for a `__dirname is not defined` error. If it fails, apply the design's named fallback: either `fileURLToPath(new URL(".", import.meta.url))`, or add `vite-tsconfig-paths` as a second devDependency and let it read `tsconfig.json` directly. Record which path was needed (or that no fallback was needed) in the PR description.
  - **Req**: design D11 `[confirm at apply]` item.
  - **Verify**: PR description states the outcome; `npx vitest run` succeeds either way.

- [ ] ST.4 Create `vitest.setup.ts` importing `@testing-library/jest-dom`.
  - **Req**: design D11.
  - **Verify**: referenced by `vitest.config.ts`'s `setupFiles`; `npx vitest run` loads it without error.

- [ ] ST.5 Create `lib/realtime/table-merge.test.ts` with unit cases covering all 11 rows of the D10 behaviour table, asserting reference identity (`expect(result).toBe(prev)`) on every no-op row and a new-array result with the correct row replaced/appended/filtered on every changed row. Add `toTable` cases (carries and normalizes `updated_at` to `Date` per D4; an `id`-less row returns `null`) and `toTimestamp` cases (`null`, `undefined`, and unparseable input all yield `0`).
  - **Req**: `realtime-client-sync` *Verification Notes* — "pure logic extracted by this change ... SHOULD have unit test coverage under the newly introduced Vitest runner"; design D10, D4.
  - **Verify**: `npm test` passes; the test file contains one assertion group per D10 row (11 groups) plus the `toTable`/`toTimestamp` cases.

- [ ] ST.6 Create `components/pos/TableGrid.test.tsx` asserting the F1 remount invariant: render `TableGrid` inside a parent whose selection prop changes, and assert a stable DOM node identity or a mount-counter ref across that change (i.e., no unmount/remount occurs).
  - **Req**: `realtime-client-sync` / "Selection State Must Not Force A Grid Remount" — first automated coverage of this invariant, replacing reliance on the manual recipe alone for this specific case.
  - **Verify**: `npm test` passes.

- [ ] ST.7 Update the `testing` snapshot in `openspec/config.yaml`: set `test_command`, `rules.apply.test_command`, and `rules.verify.test_command` to the new `npm test` command; leave `strict_tdd: false` unchanged.
  - **Req**: proposal C-12 acceptance criterion.
  - **Verify**: read back `openspec/config.yaml` and confirm the three fields point at `npm test`.

- [ ] ST.8 Update the Engram `sdd/vipe-pos-system/testing-capabilities` record to reflect the new Vitest + jsdom + Testing Library runner (hybrid-store mirror of ST.7). Attempt via `mem_save`; if it fails, report `engram_write: pending` rather than claiming success.
  - **Req**: proposal C-12 acceptance criterion (hybrid persistence convention).
  - **Verify**: `mem_search` for the updated record returns the new runner description, or the write is explicitly reported as pending.

- [ ] ST.9 Per-slice verification: `npm run lint`; `npx tsc --noEmit` delta; `npm run build`; `npm test` — first slice where this check applies, both new test files pass.
  - **Req**: proposal *Verification*, updated per-slice gate ("From ST onward: `npm test`").

---

## Slice S3 — Single owner (B-7, A-4, B-11)

Files touched: `store/useTableStore.ts`, `store/useTableStore.test.ts` (new), `components/pos/TableGrid.tsx`, `components/pos/TablesSection.tsx`, `components/views/WaiterView.tsx`, `components/admin/tables/TableManagementPanel.tsx`, `lib/realtime/table-merge.ts` (extended). **Highest-risk slice** — depends on ST for its tests.

- [ ] S3.1 Add `applyTableChange: (change: TableChange) => void` to the `TableState` interface and implementation in `store/useTableStore.ts`, per design D1: `set((state) => { const next = mergeTableList(state.tables, change); return next === state.tables ? state : { tables: next } })`. Import `mergeTableList`/`TableChange` from `lib/realtime/table-merge`. Every other member of `TableState` (all mutators, `activeTable`, helpers) stays unchanged — this is the entire point of choosing O1.
  - **Req**: `realtime-client-sync` / "Single Owner For Table State" (establishes the owner's patch entry point); "Realtime Table Events Patch State In Place".
  - **Verify**: `npx tsc --noEmit` delta; S3.2's unit tests pass.

- [ ] S3.2 Create `store/useTableStore.test.ts`: assert a no-op change leaves `useTableStore.getState().tables` reference-identical to its pre-call value, and an UPDATE replaces exactly one element while every other element reference is preserved (`toBe` on the untouched rows). Use a vanilla store instance — no React render required.
  - **Req**: `realtime-client-sync` *Verification Notes*; design D1 rationale ("Purity and composition").
  - **Verify**: `npm test` passes.

- [ ] S3.3 In `components/pos/TableGrid.tsx`, delete the local `useState` at `:85` and the self-fetch effect (`:132-173`); read `tables` from `useTableStore` instead. Confirm the F1 remount test (ST.6) still passes against this updated component — re-run it explicitly as part of this task, not deferred to S3.9, since the component's data source changed underneath the test.
  - **Req**: `realtime-client-sync` / "Single Owner For Table State", scenario "Exactly one table-state container exists"; re-verification of "Selection State Must Not Force A Grid Remount".
  - **Verify**: `npm test` (including `TableGrid.test.tsx`) passes; `npx tsc --noEmit` delta.

- [ ] S3.4 In `components/views/WaiterView.tsx`: route the realtime handler through `useTableStore.getState().applyTableChange(payload)` in place of the S1-era direct `mergeTableList` call at `:240`; delete the local `tables` `useState` at `:64` and the dual write at `:213-219` that S1 preserved; demote the `useQuery(['tables'])` at `:159-162` to a one-time hydration seed for the store (its result is handed to the store once and no longer feeds a component-local `tables` array).
  - **Req**: `realtime-client-sync` / "Single Owner For Table State", scenario "Consumers read through the owner, not a private copy"; "Realtime Table Events Patch State In Place".
  - **Verify**: `grep -n "useState<Table\[\]>" components/views/WaiterView.tsx` (or equivalent typed pattern) returns zero matches; `npx tsc --noEmit` delta; `npm test`.

- [ ] S3.5 Add `mergeRowList<T extends { id: string }>(prev, change)` to `lib/realtime/table-merge.ts` — the generic raw-row merger over `{ id }`-bearing records described in design D9/D10, sharing the same event-dispatch and reference-stability logic as `mergeTableList`. Extend `lib/realtime/table-merge.test.ts` with cases confirming `mergeRowList` preserves `waiter_id`/`updated_at` untouched on raw rows (i.e., it performs no field mapping, unlike `toTable`).
  - **Req**: design D9 (implementation prerequisite for S3.6).
  - **Verify**: `npm test` passes.

- [ ] S3.6 In `components/admin/tables/TableManagementPanel.tsx`, replace `await loadTables()` (`:55-62`, which flips `setLoading(true)` at `:36`) with a call to `mergeRowList` applied to the panel's own `useState<any[]>` (`:18`). Do **not** route this through `useTableStore`/`mergeTableList`/`toTable` — the panel holds raw DB rows (rendering `table.waiter_id` at `:285` and `table.updated_at` at `:304-305`, fields the mapped `Table` type does not carry under those names), so migrating it onto the shared `Table` shape is out of this task's scope (recorded as a follow-up per design D9).
  - **Req**: `realtime-client-sync` / "Realtime Table Events Patch State In Place", scenario "TableManagementPanel merges instead of reloading".
  - **Verify**: `grep -n "await loadTables()" components/admin/tables/TableManagementPanel.tsx` inside the realtime handler returns zero matches; the panel's loading indicator is not toggled by a realtime event; `npx tsc --noEmit` delta.

- [ ] S3.7 Delete the dead `tables` prop and the `filteredTables`/`searchTerm`/`filterStatus` computation in `components/pos/TablesSection.tsx:7-37` (B-11). Confirm `TableGridProps` at `components/pos/TableGrid.tsx:17-26` (read-only) has no `tables` field, so nothing needs a replacement forwarding path.
  - **Req**: `realtime-client-sync` / "Dead Table-Filter State Is Removed", scenario "No unused tables prop or filter state remains".
  - **Verify**: `grep -n "filteredTables\|searchTerm\|filterStatus" components/pos/TablesSection.tsx` returns zero matches; `npx tsc --noEmit` delta.

- [ ] S3.8 Per-slice verification: `npm run lint`; `npx tsc --noEmit` delta; `npm run build`; `npm test`; two-tab manual recipe repeated with Waiter, Admin, and `TableManagementPanel` open simultaneously.
  - **Req**: proposal *Verification* §4 (S3 extension).

---

## Slice S4 — Fan-out containment (B-8)

Files touched: `components/views/KitchenView.tsx`, `components/views/CashierView.tsx`, `components/views/AdminView.tsx`, `components/admin/CompletedOrdersTable.tsx`, `app/page.tsx`. Depends on S3 (`applyTableChange` and the single owner must already exist).

- [ ] S4.1 [Classification task — MUST precede S4.4] Classify every `components/views/AdminView.tsx` site that reads `tables`/`useTableStore` as Rule A (handler-only, no render subscription needed), Rule B (render path needs a narrow primitive projection), or Rule C (render path genuinely renders every row), per design D6. Known sites to classify: `:127` (currently a full-array read-only subscription — classify against how it is actually used before deciding whether it stays C or narrows to A/B); `:559-571` (four status counts — design pre-classifies as Rule B); `:586` (per-waiter assigned count — Rule B); `:642` (Mesas tab full render — Rule C). Search `AdminView.tsx` for any additional `tables`/`useTableStore` read not already enumerated by design and classify it here. Record the site-to-rule mapping in the PR description before S4.4 touches any of these lines.
  - **Req**: `realtime-client-sync` / "Store Writes Must Not Fan Out To Unaffected Consumers" (prerequisite); design D6 `[confirm at apply]` item.
  - **Verify**: PR description contains the complete site → rule table for `AdminView.tsx`.

- [ ] S4.2 Apply Rule A to `components/admin/CompletedOrdersTable.tsx:29` (currently a subscribed selector) and its handler use at `:133` (`handlePrintInvoice`): drop the hook subscription and read `useTableStore.getState().tables` / a `getTableById(id)` lookup at the point of use instead.
  - **Req**: `realtime-client-sync` / "Store Writes Must Not Fan Out To Unaffected Consumers", scenario "An unrelated view does not re-render on a table change"; design D6 Rule A.
  - **Verify**: `npm test`; new component test in S4.8 covers this site or a sibling; `npx tsc --noEmit` delta.

- [ ] S4.3 In `components/views/CashierView.tsx`: apply Rule A at the handler-only reads `:411, 676, 815` — drop hook subscriptions there in favor of `useTableStore.getState()` access at point of use. For `:123` (the render-path selector cited by design without a pre-assigned rule), classify it against its actual usage in this task before applying A, B, or C — do not leave it as an unclassified full-array subscription.
  - **Req**: `realtime-client-sync` / "Store Writes Must Not Fan Out To Unaffected Consumers"; design D6.
  - **Verify**: PR description states the classification chosen for `:123` and why; `npm test`; `npx tsc --noEmit` delta.

- [ ] S4.4 Apply the S4.1 classification to `components/views/AdminView.tsx`: narrow `:127` to whichever rule the classification assigned; apply Rule B — `useTableStore(useShallow((s) => ({ available: ..., reserved: ..., kitchen: ..., served: ... })))` — at `:559-571`; apply Rule B (a primitive per-waiter count projection) at `:586`; keep Rule C (`(s) => s.tables`, unchanged) at `:642` for the Mesas tab full render, since that tab genuinely renders every row and the re-render there is correct, not a defect.
  - **Req**: `realtime-client-sync` / "Store Writes Must Not Fan Out To Unaffected Consumers", scenario "A realtime update repaints only the affected card"; design D6 Rules A/B/C.
  - **Verify**: `npm test`; `npx tsc --noEmit` delta; `grep -n "useShallow" components/views/AdminView.tsx` shows it applied only at `:559-571` and `:586`, projecting to primitives — not wrapping `(s) => s.tables` directly.

- [ ] S4.5 In `components/views/KitchenView.tsx`: explicitly confirm and leave Rule C (`(s) => s.tables`, unchanged) at `:899, 1007` (Mesas tab, genuinely renders every row — no edit needed there, state this in the PR description). Classify the non-Mesas-tab usage at `:89-93` as handler vs. render before applying a rule — design flags this site for narrowing but does not pre-assign A/B/C — and apply whichever rule the classification yields.
  - **Req**: `realtime-client-sync` / "Store Writes Must Not Fan Out To Unaffected Consumers"; design D6.
  - **Verify**: PR description states the `:89-93` classification and its rule; `npm test`; `npx tsc --noEmit` delta.

- [ ] S4.6 Fix `app/page.tsx:30`: change `const { setTables } = useTableStore()` to `const setTables = useTableStore((s) => s.setTables)`, eliminating the widest-blast-radius selectorless subscription in the codebase (it currently re-renders the root page component on every store write, including every unrelated table patch).
  - **Req**: `realtime-client-sync` / "Store Writes Must Not Fan Out To Unaffected Consumers"; design D6 (newly enumerated site, not in the original proposal).
  - **Verify**: `grep -n "const { setTables } = useTableStore()" app/page.tsx` returns zero matches; `npx tsc --noEmit` delta.

- [ ] S4.7 [Scope decision task, not necessarily an edit] Decide and record, in the PR description, whether the two adjacent selectorless destructures at `app/page.tsx:31` (`useCashRegisterStore()`) and `app/page.tsx:34` (`useConfigStore()`) — which share the identical no-selector pattern as `:30` — are being left as pre-existing out-of-scope patterns, or opportunistically fixed alongside S4.6. B-8's authorized scope is `useTableStore` only; do not silently fix or silently skip these two without stating the decision. If fixed, list the exact lines changed here rather than folding them into S4.6 unannounced.
  - **Req**: honesty/scope-boundary requirement from the phase instructions (not a spec requirement).
  - **Verify**: PR description states the decision explicitly, either way.

- [ ] S4.8 Create a component test asserting the D6 fan-out invariant (design's Coverage plan "Component" row): a store patch for table X re-renders X's card and does not re-render a sibling card or an unrelated view's tables-derived list, using React Testing Library with a render-count probe. Cover at least one Rule A site (e.g., `CompletedOrdersTable`) and one Rule B site (e.g., an `AdminView` status count) to prove both narrowing strategies actually suppress unrelated re-renders.
  - **Req**: `realtime-client-sync` *Verification Notes* / design Coverage plan — first automated coverage of the fan-out invariant.
  - **Verify**: `npm test` passes; the test fails if `useShallow` is removed or the projection is widened back to the full array (confirm this by temporarily reverting one site locally and observing the test fail, then re-apply the fix — do not commit the reverted state).

- [ ] S4.9 Per-slice verification: `npm run lint`; `npx tsc --noEmit` delta; `npm run build`; `npm test`; two-tab manual recipe — with Kitchen, Cashier, and Admin all open, confirm a table change in Waiter does not repaint unrelated lists.
  - **Req**: proposal *Verification* §4 (S4 extension).

---

## Slice S5 — Consumer unification (B-9)

Files touched: `components/views/WaiterView.tsx`, `components/views/CashierView.tsx`, `components/views/AdminView.tsx`, `components/views/KitchenView.tsx`. Depends on S2 (shared `orders-changes` channel) and S3 (single owner).

- [ ] S5.1 [Read-only contract task] Confirm the read-only contract comment added in S2.3 is present at the shared `orders-changes` handler in `lib/supabase/realtime-service.ts`, and add an explicit restatement in this slice's PR description: *"The payload object fanned out to N callbacks is the same object reference for all of them. No consumer touched in this slice mutates `payload.new`, `payload.old`, or `order_items` — each derives new local state instead."* This slice is exactly where a mutation could be introduced (three consumer sites are edited here), so the contract must be checked at each site below, not assumed once at S2.
  - **Req**: design D7, consequence 1 (shared payload reference contract).
  - **Verify**: PR description restates the contract; code review of S5.2–S5.5 confirms no `payload.new`/`payload.old`/`order_items` mutation.

- [ ] S5.2 In `components/views/WaiterView.tsx`, replace `queryClient.invalidateQueries({ queryKey: ['orders'] })` (currently at `:264`) with direct application of the `subscribeToOrders` payload the shared channel (S2) already fetched once. Treat `order_items === undefined` on that payload as "unknown — do not overwrite the current items," never as "the order has no items" (design D7, consequence 2). Confirm the exact current line number at apply time, since S1–S4 edits will have shifted it from the proposal's original citation.
  - **Req**: `realtime-channel-lifecycle` / "One Realtime Event Produces One Downstream Round Trip", consumer-side half; `realtime-client-sync` / "Realtime Table Events Patch State In Place" extension to the order path.
  - **Verify**: `grep -n "invalidateQueries" components/views/WaiterView.tsx` inside the orders realtime handler body returns zero matches; `npm test`; `npx tsc --noEmit` delta.

- [ ] S5.3 In `components/views/CashierView.tsx`, replace `queryClient.invalidateQueries({ queryKey: ['orders', 'cashier'] })` (currently at `:238`) with payload application, applying the same `order_items === undefined` → "unknown, do not overwrite" rule as S5.2.
  - **Req**: same as S5.2, applied to the Cashier consumer.
  - **Verify**: `grep -n "invalidateQueries" components/views/CashierView.tsx` inside the orders realtime handler body returns zero matches; `npm test`; `npx tsc --noEmit` delta.

- [ ] S5.4 In `components/views/AdminView.tsx`, replace `queryClient.invalidateQueries({ queryKey: ['orders', 'admin'] })` (currently around `:217-221` — confirm the exact current line at apply time) with payload application, applying the same `order_items === undefined` rule as S5.2/S5.3.
  - **Req**: same as S5.2, applied to the Admin consumer.
  - **Verify**: `grep -n "invalidateQueries" components/views/AdminView.tsx` inside the orders realtime handler body returns zero matches; `npm test`; `npx tsc --noEmit` delta.

- [ ] S5.5 In `components/views/KitchenView.tsx`, remove the `setTables` full-array write path at `:454` (and any related whole-array replacement still present at `:680, 743, 788, 789` after S3/S4) in favor of the owner's `applyTableChange`/narrowed-selector pattern already established by S3/S4; apply order-payload application consistent with S5.2–S5.4 to Kitchen's own order-event handling.
  - **Req**: `realtime-client-sync` / "Single Owner For Table State" and "Store Writes Must Not Fan Out To Unaffected Consumers" (closing the last remaining whole-array write); `realtime-channel-lifecycle` payload-application extension.
  - **Verify**: `grep -n "setTables(" components/views/KitchenView.tsx` shows no whole-array replacement remaining outside narrowed patch application; `npm test`; `npx tsc --noEmit` delta.

- [ ] S5.6 Create an integration test verifying that a simulated `postgres_changes` payload dispatched through the store produces exactly one state transition and no refetch, with `realtimeService` stubbed, under jsdom (design Coverage plan "Integration" row).
  - **Req**: `realtime-client-sync` *Verification Notes* / design Coverage plan.
  - **Verify**: `npm test` passes.

- [ ] S5.7 Verify the spec's "Zero invalidateQueries calls inside a postgres_changes handler" scenario across the whole codebase after S5 lands: run `grep -rn "invalidateQueries" components/views/*.tsx` and manually confirm every remaining match (if any) sits outside a `postgres_changes`/realtime handler body.
  - **Req**: `realtime-client-sync` / "Realtime Table Events Patch State In Place", scenario "Zero invalidateQueries calls inside a postgres_changes handler" — final, codebase-wide confirmation.
  - **Verify**: `grep` output reviewed and annotated in the PR description; zero matches inside a realtime handler.

- [ ] S5.8 Per-slice verification: `npm run lint`; `npx tsc --noEmit` delta; `npm run build`; `npm test`; two-tab manual recipe confirming order status changes propagate to Waiter, Cashier, and Admin.
  - **Req**: proposal *Verification* §4 (S5 extension); *Success Criteria* checklist item "Zero `queryClient.invalidateQueries` calls remain inside any `postgres_changes` handler."

---

## Traceability — deliverable → tasks

| Deliverable | Slice | Tasks |
|---|---|---|
| A-1 (remove remount key) | S1 | S1.5 |
| A-2 (extract merge, patch not refetch) | S1 | S1.1, S1.2, S1.3, S1.4, S1.6 |
| A-3 (shared orders channel) | S2 | S2.1, S2.2, S2.3, S2.4 |
| A-4 (TableManagementPanel merges) | S3 | S3.5, S3.6 |
| A-5 (broadcast listener leak) | S2 | S2.5, S2.6, S2.7 |
| A-6 (structured logging) | S1 | S1.7 |
| B-7 (single owner) | S3 | S3.1, S3.2, S3.3, S3.4 |
| B-8 (fan-out containment) | S4 | S4.1–S4.9 |
| B-9 (consumer unification) | S5 | S5.1–S5.8 |
| B-10 (broadcast normalization) | S2 | S2.5, S2.6, S2.7, S2.8 |
| B-11 (dead filter state) | S3 | S3.7 |
| C-12 (test runner) | ST | ST.1–ST.9 |

---

## Review Workload Forecast

Every slice below is independently committable and independently revertible per the design's *Migration / Rollout* section, and carries its own verification steps (lint + typecheck delta + build for every slice; `npm test` from ST onward; the two-tab manual recipe, extended per slice, for every slice).

### Per-slice estimate

| Slice | Proposal forecast | This breakdown's estimate | Delta | Why it moved |
|---|---|---|---|---|
| S1 | ~110 | ~120 | +10 | D4's `updated_at` carry-through and its explicit code comment (S1.2, S1.3) add a few lines the proposal's "pure move" framing did not anticipate. |
| S2 | ~200 | ~200 | 0 | Matches the proposal; D7/D8 mechanics were already priced in. |
| ST | ~150 | ~160 | +10 | Same file set as the proposal/design, with slightly more assertion volume in `table-merge.test.ts` (11 D10 rows plus `toTable`/`toTimestamp` cases explicitly enumerated). |
| S3 | ~300 | ~320 | +20 | `mergeRowList` (S3.5) is additional surface beyond the proposal's file list, needed to keep D9's raw-row/`Table`-shape split honest. |
| S4 | ~130 | ~180 | +50 | The D6 fan-out component test (S4.8) and the explicit classification tasks (S4.1, S4.3, S4.5) were not separately counted in the proposal's line estimate; the `app/page.tsx` fix (S4.6) was already anticipated by design but not by the original proposal figure. |
| S5 | ~220 | ~240 | +20 | The integration test (S5.6) is new relative to the proposal's file list, drawn from the design's Coverage plan. |
| **Total** | **~1110** | **~1220** | **+110** | Growth concentrates in **S4** (+50) and **S3** (+20), driven by the design's own coverage plan (component/integration tests) and by making the D6 classification an explicit, auditable step rather than a blanket edit, as this phase's instructions require. No slice crosses the 400-line budget; S3 remains the closest at ~320. |

### Guard lines

- Estimated changed lines: ~1220 total (S1 ≈120, S2 ≈200, ST ≈160, S3 ≈320, S4 ≈180, S5 ≈240)
- 400-line budget risk: Low
- Chained PRs recommended: Yes
- Decision needed before apply: No

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain (user decision, 2026-09-21). PR #1 targets the tracker branch `sdd/revision-completa-sistema/p6c-legacy-cleanup`; each child PR targets the immediately preceding PR branch; only the tracker merges to `main`. Chosen because the base branch already carries 58 unmerged commits, so stacking to `main` would drag that backlog into every PR diff in this chain.
400-line budget risk: Low
