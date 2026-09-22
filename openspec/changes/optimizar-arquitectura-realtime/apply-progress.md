# Apply Progress: optimizar-arquitectura-realtime

## Slice S1 — Acute flicker fix (A-1, A-2, A-6)

**Status**: S1.1–S1.7 complete, including two post-commit fixes from orchestrator review (see "Orchestrator Review Fixes" below). S1.8's automated portion (lint/typecheck/build) complete and re-verified after the fixes; its manual two-tab recipe is pending human verification and was NOT executed by this agent (no running app or browser in this environment).

### Commits

- `6ca74c8` — `fix(realtime): patch table state in place instead of remounting/refetching` — branch `sdd/optimizar-arquitectura-realtime/s1-flicker-fix`.
- `7b30746` — `docs(sdd): record S1 apply progress and tick S1.3`.
- `efb941b` — `fix(realtime): hydrate updated_at and purify the tables setState updater` — orchestrator-review fixes, see "Orchestrator Review Fixes" below.

Not pushed, no PR opened (delivery is the user's decision per the phase instructions).

### Completed Tasks

- [x] S1.1 — Created `lib/realtime/table-merge.ts` exporting `TableRow`, `TableChange`, `toTable`, `mergeTableList`, `toTimestamp`. Pure module, only `import type { Table } from "@/types"`. Implements all 11 D10 behaviour-table rows; every no-op row returns the identical `prev` reference (verified by code inspection — no unit test exists yet, ST introduces the runner).
- [x] S1.2 — `toTable` carries `updated_at` mapped as `row.updated_at ? new Date(row.updated_at) : undefined`, with the required `// D4: makes the out-of-order guard live for the first time — see design.md` comment directly above the mapping line.
- [x] S1.3 — Reviewer-notice sentence included in the commit message (see commit `6ca74c8` body).
- [x] S1.4 — Deleted the local `mergeTable` function body in `TableGrid.tsx` (including the `as unknown as string` cast) and replaced the call site with `mergeTableList(prev, payload as unknown as TableChange)` imported from `lib/realtime/table-merge.ts`. `TableGrid`'s local `useState` for `tables` is untouched (S3 removes it).
- [x] S1.5 — Removed `key={\`tables-section-${activeTable ?? 'none'}\`}}` from `<TablesSection>` in `WaiterView.tsx`. No replacement key added.
- [x] S1.6 — Replaced `queryClient.invalidateQueries({ queryKey: ['tables'] })` in the `subscribeToTables` handler with `setTables((prevTables) => mergeTableList(prevTables, payload as unknown as TableChange))`, a pure updater (revised post-review, see "Orchestrator Review Fixes" below). The store mirror lives in a dedicated `useEffect` keyed on `tables`, so the dual write (component-local `tables` state + `useTableStore` mirror) is still exactly what S1.6 originally specified — only *where* the store write happens changed. Ownership model unchanged — `applyTableChange` is not introduced (S3 scope).
- [x] S1.7 — Replaced `console.log`/`console.error` in `fetchTables` with `log.info`/`log.error` from the newly added `import { log } from "@/lib/log"`.
- [~] S1.8 — Automated portion done (see Verification below). Manual two-tab recipe NOT executed — see "Pending Human Verification" below.

### Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `lib/realtime/table-merge.ts` | Created | Pure merge module: `TableRow`, `TableChange`, `toTimestamp`, `toTable`, `mergeTableList`. All 11 D10 rows. |
| `components/pos/TableGrid.tsx` | Modified | Deleted local `mergeTable` (incl. the `as unknown as string` cast); now calls `mergeTableList`/`toTable` from the shared module. Removed the now-unused `RealtimePostgresChangesPayload` import. |
| `components/views/WaiterView.tsx` | Modified | Removed the selection-keyed `key` on `<TablesSection>`; replaced the `tables`-topic `invalidateQueries` with a direct `mergeTableList` patch into the existing dual-write locations; replaced `console.log`/`console.error` with `lib/log.ts`'s `log.info`/`log.error`; added the `mergeTableList`/`TableChange`/`log` imports. |
| `openspec/changes/optimizar-arquitectura-realtime/tasks.md` | Modified | S1.1–S1.7 marked `[x]`. S1.8's manual-recipe checkbox left unticked. |

## Orchestrator Review Fixes

The orchestrator independently reviewed the S1 diff after the initial commit (`6ca74c8`) and confirmed the tsc baseline, the four grep invariants, and the commits were sound, but found two real defects, both fixed in commit `efb941b`.

### Finding 1 — the D4 out-of-order guard was still inert for hydrated rows

`toTable` correctly carries `updated_at` for realtime payloads (S1.2), but neither hydration mapper did:

- `components/views/WaiterView.tsx`'s `fetchTables` returned only `id, number, status, waiter, waiter_name`.
- `components/pos/TableGrid.tsx`'s `loadTables` (`formattedTables`) had the same five fields.

Consequence: immediately after any load, every row's `updated_at` was `undefined`, so `toTimestamp(existing.updated_at)` was `0` for every row until that specific row received its first realtime UPDATE. A genuinely out-of-order/stale event arriving before that first UPDATE would still pass `incoming >= 0` and overwrite fresher data — the guard D4 claims this slice makes live was only live for a subset of rows, not all of them, right after any hydration.

**Fix**: both mappers now include `updated_at: table.updated_at ? new Date(table.updated_at) : undefined`, normalized identically to `toTable`, with the same `// D4: ...` comment. `tableService.getAll()` already `select("*, ...")`s the `tables` row, so `updated_at` was present on the wire and simply dropped by both mappers — no data-layer change needed.

### Finding 2 — a side effect inside a React state updater

The original S1.6 implementation wrote to `useTableStore` from inside the `setTables` updater passed to the realtime handler:

```ts
setTables((prevTables) => {
  const merged = mergeTableList(prevTables, payload as unknown as TableChange)
  if (merged !== prevTables) {
    useTableStore.getState().setTables(merged)
  }
  return merged
})
```

A `setState` updater must be pure. React 19 double-invokes updaters under StrictMode in development specifically to surface impurity, and a Zustand `set()` synchronously notifies subscribers — five other components subscribe to this store (`KitchenView`, `CashierView`, `AdminView`, `CompletedOrdersTable`, `app/page.tsx`) — so this could push a store update into React's render phase and risk "Cannot update a component while rendering a different component."

**Fix**: the updater is now pure — `setTables((prevTables) => mergeTableList(prevTables, payload as unknown as TableChange))` — with no side effect. A new dedicated `useEffect` in `WaiterView.tsx`, keyed on `[tables]`, is the single place that mirrors the local `tables` copy into `useTableStore`:

```ts
useEffect(() => {
  useTableStore.getState().setTables(tables)
}, [tables])
```

The now-redundant `useTableStore.getState().setTables(tablesData)` call inside the hydration effect was removed, so there is exactly one mirror site covering both hydration and every realtime patch. The dual-write model itself (local `useState` + store mirror) is unchanged — S1.6's original intent survives, only the mechanism moved from inside the updater to an effect. Comment added explaining why the mirror lives in the effect.

### Re-verification (all commands re-run after both fixes)

1. `npx tsc --noEmit 2>&1 | grep -c "error TS"` → **0** (unchanged from the 0 baseline).
2. `npm run lint` → exit 0; warning count → **104** (unchanged).
3. `npm run build` → exit 0; static generation completed.
4. Grep invariants, all still zero matches:
   - `grep -n "as unknown as string" components/pos/TableGrid.tsx` → none
   - `grep -n 'tables-section-${activeTable' components/views/WaiterView.tsx` → none
   - `grep -n "invalidateQueries({ queryKey: \['tables'\]" components/views/WaiterView.tsx` → none
   - `grep -nE "console\.(log|warn|error)" components/views/WaiterView.tsx` → none

### Deviations from Design

None — implementation matches design D3, D4, D10 exactly. `toTable`'s field mapping required two `as` casts (`row.number as number`, `row.status as Table["status"]`) not spelled out verbatim in design.md's interface sketch, because `TableRow`'s fields are nullable while `Table`'s corresponding fields are not; this keeps the type-narrowing local to `toTable` rather than reintroducing a scattered cast at call sites, consistent with design's stated intent for the module's `as` usage.

### Out-of-scope findings (recorded, not fixed)

None found while working the S1 file set. All findings and follow-ups noted for other slices are already captured in design.md's Open Questions and were not touched here (`realtime-service.ts`, `TableManagementPanel.tsx`, `useTableStore.ts`, `TablesSection.tsx`, `KitchenView`/`CashierView`/`AdminView`, `CompletedOrdersTable`, `app/page.tsx`, `supabase/**` — all explicitly out of scope for S1 and left untouched).

## Verification — initial run, before orchestrator review (all commands actually run, with observed results)

Superseded in part by "Orchestrator Review Fixes" → "Re-verification" above, which re-ran all four checks after the two findings were fixed. Kept here for the historical record of the pre-review commit `6ca74c8`.

1. **Baseline `tsc --noEmit`** (before any edit, on HEAD `ecce6e8`):
   `npx tsc --noEmit 2>&1 | grep -c "error TS"` → **0**
   (Note: the ~484-error baseline cited in tasks.md/spec.md/design.md is stale for this checkout — the measured baseline on this branch's HEAD is 0. Reporting the measured figure per the phase instructions, not the stale document figure.)

2. **`npm run lint`**: exits 0. Warning count unchanged before/after: **104** warnings both with the stash applied and with it reverted (verified via `git stash` / `git stash pop` around the lint run). No new warning appears in `lib/realtime/table-merge.ts`, `components/pos/TableGrid.tsx`, or `components/views/WaiterView.tsx` on any line this slice touched. Clean/unchanged from baseline — PASS.

3. **`tsc --noEmit` delta**: after all S1 edits, `grep -c "error TS"` → **0**. Delta = 0 − 0 = **0** (≤ 0 required) — PASS.

4. **`npm run build`**: exit 0. Static generation completed (`✓ Generating static pages (2/2)`) — PASS.

5. **Grep invariants** (all run after the edits, all returned zero matches as required):
   - `grep -n "as unknown as string" components/pos/TableGrid.tsx` → no matches (exit 1) — PASS
   - `grep -n 'tables-section-${activeTable' components/views/WaiterView.tsx` → no matches (exit 1) — PASS
   - `grep -n "invalidateQueries({ queryKey: \['tables'\]" components/views/WaiterView.tsx` → no matches (exit 1) — PASS
   - `grep -nE "console\.(log|warn|error)" components/views/WaiterView.tsx` → no matches (exit 1) — PASS

## Pending Human Verification (cannot be executed by this agent)

Task **S1.8**'s two-tab manual recipe was NOT run — there is no running app and no browser in this environment. The user must run it manually:

1. Start the dev server (`npm run dev`) and open the Waiter view in two browser tabs, tab A and tab B, both logged in as a waiter.
2. **Flicker/patch check**: in tab A, flip a table's status (reserve/release, or complete an order that frees the table). In tab B, confirm the affected table's card updates to the new status WITHOUT a skeleton repaint and WITHOUT the grid blanking.
3. **Remount check**: in tab A, click a table to select it (and click again to deselect it). Confirm the table grid does not remount or flash/reset scroll position on selection change.
4. Report back whether both checks pass; if either fails, it is a genuine regression against this slice's intent (A-1/A-2) and should be raised before proceeding to S2/ST.

## Engram Persistence

`mem_save` was attempted once with `topic_key: "sdd/optimizar-arquitectura-realtime/apply-progress"`, `type: "architecture"`, `project: "vipe-pos-system"`. Result: **engram_write: pending** — per the known environment failure noted in the launch instructions (`multiple active runtime sessions match the current project and directory`), this was not retried. The orchestrator is expected to mirror this file via the `engram` CLI.

## Next Steps (superseded by Slice S2 section below for S2 status)

- Slice S1 is code-complete and committed. Remaining before archive/next-slice: the human two-tab manual recipe above (S1.8).
- Next slice per `tasks.md`'s dependency order: S2 (channel lifecycle) — independent of S1, can proceed in parallel/next.

---

## Slice S2 — Channel lifecycle (A-3, A-5, B-10)

**Status**: S2.1–S2.8 complete. S2.9's automated portion (lint/typecheck/build) complete; its two-tab manual recipe and the A-5 leak check are pending human verification and were NOT executed by this agent (no running app, no browser, no network panel in this environment).

### Scope

Files touched: `lib/supabase/realtime-service.ts` only, as required. All four public signatures (`subscribeToOrders`, `sendFactura`, `sendCommand`, `subscribeToPosEvents`) are unchanged; confirmed by inspection that `WaiterView.tsx:275`, `CashierView.tsx:234`, and `AdminView.tsx:221` (the three `subscribeToOrders` call sites) required no edit.

### Completed Tasks

- [x] S2.1 — Added `type OrdersChannelEntry = { channel: RealtimeChannel; callbacks: Set<OrderCallback> }` and `const ordersChannels = new Map<string, OrdersChannelEntry>()`, placed directly below `tablesChannels` and mirroring its shape exactly.
- [x] S2.2 — Rewrote `subscribeToOrders` to the same Map/Set/create-once pattern already used by `subscribeToTables`: a caller's callback is added to the shared entry's `Set`; `supabase.channel("orders-changes")` and the `postgres_changes` listener are created only when no entry exists yet for the `"orders-changes"` topic key. Public signature `subscribeToOrders(callback: OrderCallback) => () => void` is unchanged. Confirmed via `git diff` that only `realtime-service.ts` changed, so no caller site needed an edit.
- [x] S2.3 — Moved the `order_items` `SELECT` to run exactly once per event, inside the shared handler, before the `entry.callbacks.forEach` fan-out. **Behaviour change (D7, stated explicitly per phase instructions)**: on fetch error, the previous silent `return` (which dropped the event for the one caller that triggered the fetch) is replaced with `log.error(...)` via `lib/log`, and the handler still falls through to fan out to every subscribed callback with `payload.new.order_items` left `undefined` — never `[]`. A code comment above the `if (error)` branch and another directly above the `entry?.callbacks.forEach(...)` line state the read-only contract: the payload object is the same reference fanned out to every callback, so consumers must derive new local state rather than mutate `payload.new`/`payload.old`/`order_items`. The pre-existing outer `try/catch` (for thrown exceptions, not query errors) and its toast are left exactly as they were — out of this task's described scope, which names only the `if (error) return` line.
- [x] S2.4 — Rewrote `subscribeToOrders`'s returned teardown to remove only the calling callback from the topic's `Set`, calling `supabase.removeChannel(e.channel)` (preserving the pre-existing mechanism) only when the `Set` becomes empty, at which point the `ordersChannels` entry for that topic is also deleted. Removed the single-slot `realtimeService.channels["orders"]` bookkeeping entirely (no more `realtimeService.channels["orders"] = channel` / `delete realtimeService.channels["orders"]`). Confirmed by grep — see Verification below — and by an additional codebase-wide grep for `channels["orders"]`/`channels['orders']` outside this file, which returned zero matches, corroborating design's claim that nothing else reads that slot.
- [x] S2.5 — Extracted a module-private `getBroadcastChannel(channelKey: string): RealtimeChannel` helper that acquires or creates a channel via `realtimeService.channels[channelKey]` bookkeeping, calling `channel.subscribe()` on creation, WITHOUT touching `broadcastListenerRegistry` and WITHOUT registering any `.on()` listener. `subscribeToPosEvents` now calls this helper for its own channel acquisition, then performs its existing registry insert and `channel.on(...)` binding exactly as before — its own signature and behaviour are unchanged.
- [x] S2.6 — `sendFactura` now calls `getBroadcastChannel("room_bills")` and sends on the returned channel directly, instead of `realtimeService.subscribeToPosEvents(channelKey, "new_invoice", () => {})`. The no-op listener registration that used to run on every invoice send is gone. `sendFactura`'s own signature and its `.send(...)` call are unchanged.
- [x] S2.7 — `sendCommand` now calls `getBroadcastChannel("room_commands")` the same way, removing its own no-op `subscribeToPosEvents(channelKey, "new_command", () => {})` call.
- [x] S2.8 — **[Confirm-at-apply finding, resolved]** Read `node_modules/.pnpm/@supabase+realtime-js@2.116.0/node_modules/@supabase/realtime-js/dist/main/RealtimeChannel.js` (confirmed via `node_modules/@supabase/supabase-js` symlink → `.pnpm/@supabase+supabase-js@2.116.0` and its `pnpm-lock.yaml` dependency pin, `@supabase/realtime-js: 2.116.0`, that this is the version actually resolved — a second, unused copy at `2.11.2` also exists in the pnpm store but is not what `@supabase/supabase-js` depends on). **Finding: `channel.on("broadcast", ...)` registered after `channel.subscribe()` DOES bind correctly.** Evidence: `RealtimeChannel.prototype.on()` (lines 416–424) contains an explicit guard — `if ((isJoined() || isJoining()) && (type === PRESENCE || type === POSTGRES_CHANGES)) throw ...` — that rejects late bindings ONLY for `presence` and `postgres_changes`; `broadcast` is not in that check and falls through to `_on()` unconditionally. `_on()` (lines 636–673) then calls `this.channelAdapter.on(type, callback)` to register the handler directly on the channel's live message dispatcher and pushes the binding into `this.bindings[typeLower]` for bookkeeping — it does not need to be included in the one-shot join/subscribe payload the way `postgres_changes` filters do (`subscribe()`, lines 135–184, builds its `postgres_changes` array from `this.bindings.postgres_changes` only, and has no equivalent requirement for broadcast). A one-line comment recording this is at `lib/supabase/realtime-service.ts` directly above the `channel.on("broadcast", ...)` call inside `subscribeToPosEvents`.
- [~] S2.9 — Automated portion done (see Verification below). Manual two-tab recipe and the A-5 leak check were NOT executed — see "Pending Human Verification" below.

### Files Changed

| File | Action | What Was Done |
|------|--------|----------------|
| `lib/supabase/realtime-service.ts` | Modified | Added `OrdersChannelEntry`/`ordersChannels` Map; rewrote `subscribeToOrders` to a shared-channel/Set pattern mirroring `subscribeToTables`; moved the `order_items` fetch to run once per event before fan-out with the D7 error-path fan-out-with-`undefined` fix; removed `channels["orders"]` bookkeeping; extracted `getBroadcastChannel`; rewired `subscribeToPosEvents`, `sendFactura`, `sendCommand` to use it. 114 insertions / 62 deletions (`git diff --stat`). |
| `openspec/changes/optimizar-arquitectura-realtime/tasks.md` | Modified | S2.1–S2.8 marked `[x]`. S2.9's checkbox left unticked (mixes automated-done with manual-pending, same convention S1.8 used). |
| `openspec/changes/optimizar-arquitectura-realtime/apply-progress.md` | Modified | This S2 section merged in, preserving all S1 content above including "Orchestrator Review Fixes". |

### Deviations from Design

None — implementation matches design D7, D8 exactly, including both stated behaviour changes (D7's error-path fan-out, D8's `getBroadcastChannel` extraction). The S2.8 confirm-at-apply question is resolved with cited evidence rather than assumed either way, as the phase instructions required.

### Out-of-scope findings (recorded, not fixed)

Nothing new found beyond what design.md's Open Questions already record for this file (`subscribeToPosEvents`'s unsubscribe not removing its `.on()` binding; `subscribeToTables` tearing down with `channel.unsubscribe()` vs `subscribeToOrders`'s `supabase.removeChannel()`; `subscribeToKitchen`'s 5-channel topology). None of these were touched, per the explicit out-of-scope instruction for this slice.

### Verification (all commands actually run, with observed results)

1. **Baseline, measured on this branch's HEAD (`c263193`) before any S2 edit**, via `git stash push -- lib/supabase/realtime-service.ts` then restoring afterward:
   - `npx tsc --noEmit 2>&1 | grep -c "error TS"` → **0**
   - `npm run lint` → exit **0**; warning count → **104**
2. **After the S2 edit:**
   - `npm run lint` → exit **0**; warning count → **104** (unchanged). The five `realtime-service.ts` "'error' is defined but never used"/`BillPayload`/`CHANNEL_KEY_POS` warnings are the same pre-existing ones, only shifted to new line numbers by the added code — diffed line-by-line to confirm no new warning was introduced.
   - `npx tsc --noEmit 2>&1 | grep -c "error TS"` → **0**. Delta = 0 − 0 = **0** (≤ 0 required) — PASS.
   - `npm run build` → exit **0**; static generation completed (`✓ Generating static pages (2/2)`).
   - `grep -n 'channels\["orders"\]' lib/supabase/realtime-service.ts` → no matches (exit 1) — PASS (S2.4).
   - `git diff --name-only c263193 -- .` (working-tree diff against the S1 branch tip) → `lib/supabase/realtime-service.ts`, plus `openspec/changes/optimizar-arquitectura-realtime/tasks.md` and `apply-progress.md` once staged/committed. `.atl/.skill-registry.cache.json` and `.atl/skill-registry.md` also show as modified, but they were already modified at session start (before this agent began S2 work) and were not touched by this agent — left alone, not part of this commit.
   - Callers grep: `subscribeToOrders` call sites at `WaiterView.tsx:275`, `CashierView.tsx:234`, `AdminView.tsx:221` — read, confirmed unchanged, no edit needed.
   - Codebase-wide grep for `channels["orders"]` / `channels['orders']` outside `realtime-service.ts` → zero matches.

### Pending Human Verification (cannot be executed by this agent)

Task **S2.9**'s two-tab manual recipe and the A-5 leak check were NOT run — there is no running app, no browser, and no network panel in this environment. The user must run them manually:

1. Start the dev server (`npm run dev`) and open **Cashier** and **Admin** views in two separate tabs/windows.
2. **Single round trip check**: trigger one order change (status update, new order, etc.). Confirm both views' UI updates in response to the same event, and inspect the browser Network panel to confirm exactly **one** `order_items` request fires for that event (not two).
3. **A-5 leak check**: in one session, print several invoices (from Cashier) and send several kitchen commands/tickets (from Waiter). Inspect `broadcastListenerRegistry` (e.g., via a debugger breakpoint or a temporary `console.log` in dev tools) for the `room_bills` and `room_commands` entries, and confirm their handler `Set`s do **not** grow with each send — each send should reuse the same channel reference without adding a new no-op listener.
4. Report back whether both checks pass; if either fails, it is a genuine regression against this slice's intent (A-3/A-5/B-10) and should be raised before proceeding to slice ST.

**Honest note on what static verification proves**: the shared-channel refactor's core benefit — one `order_items` request per event instead of one per mounted view — is a runtime/network-level property. `tsc`, `lint`, and `build` prove the code *shape* (one shared `Map` entry, one fetch site, one fan-out loop) is structurally correct, but only the browser Network panel in step 2 above can observe that the amplification is actually gone at runtime. The same applies to the A-5 leak check: static inspection confirms `sendFactura`/`sendCommand` no longer call `subscribeToPosEvents`, so nothing in the code path can grow the registry from a send, but only live inspection of `broadcastListenerRegistry` after repeated sends is direct evidence of the leak being closed at runtime.

### Commits

- `25ca62d` — `refactor(realtime): share one orders channel and stop leaking broadcast listeners` — branch `sdd/optimizar-arquitectura-realtime/s2-channel-lifecycle`, stacked on S1 at `c263193`.

Not pushed, no PR opened (delivery is the user's decision per the phase instructions).

### Engram Persistence

`mem_save` attempted once with `topic_key: "sdd/optimizar-arquitectura-realtime/apply-progress"`, `type: "architecture"`, `project: "vipe-pos-system"`. See the top-level "Engram Persistence" result at the end of this report for the outcome.

### Next Steps

- Slice S2 is code-complete and committed. Remaining before archive/next-slice: the human two-tab manual recipe and A-5 leak check above (S2.9).
- Next slice per `tasks.md`'s dependency order: **ST** (test runner) — must land before S3. S1 and S2 are both done; the orchestrator can now proceed to ST.

---

## S1.8 — closed by human verification (2026-09-22)

The two-tab manual recipe, the only outstanding evidence gap in slice S1, was **run and confirmed working by the user**. S1 is closed.

Setup used: a git worktree at `/home/ahernand/projects/vipe-pos-system-worktrees/s1-verify`, pinned to commit `c263193` (the S1 branch tip, including both orchestrator review fixes), with `node_modules` symlinked from the main checkout and `.env.local` copied. Dev server on `http://localhost:3003`. The worktree was deliberate: the S2 agent was concurrently editing `lib/supabase/realtime-service.ts` on the S2 branch, and a hot reload mid-verification would have invalidated the result.

Environment note for anyone reproducing this: `.env.local` points at a hosted Supabase project, not the local docker stack, so the absent local `realtime` and `kong` containers were irrelevant — only `supabase-db` and `supabase-auth` were running locally. Seed credentials in `supabase/seed.sql` target the local database and may not exist on the hosted project.

The user reported the fix as working. No finer-grained per-step result is recorded here, because none was reported.

## Still pending human verification

**S2.9** — slice S2's manual half is still open. Neither check can be performed without a browser:

1. Two-tab recipe: open Cashier and Admin together and confirm one order event produces one update per view, with exactly one `order_items` request per event in the network panel. Static checks prove the code shape — one Map entry, one fetch site, one fan-out loop — not the runtime request count.
2. A-5 leak check: print several invoices and kitchen tickets in one session and confirm the `broadcastListenerRegistry` handler sets for `room_bills` / `room_commands` do not grow per send.

---

## Slice ST — Test runner (C-12)

**Status**: ST.1–ST.9 complete. Every task in this slice is fully automated (no manual-recipe half), so all nine are ticked `[x]`.

### Scope

Files touched: `package.json`, `pnpm-lock.yaml`, `vitest.config.ts` (new), `vitest.setup.ts` (new), `lib/realtime/table-merge.test.ts` (new), `components/pos/TableGrid.test.tsx` (new), `openspec/config.yaml`. **No production source file was touched** — confirmed by `git diff --name-only` before commit (see Verification below). `strict_tdd` stays `false`, unchanged, per explicit instruction: this slice installs the runner alongside tests for surfaces S1/S2 already created; it does not retroactively require RED-first proof for that prior work.

### Completed Tasks

- [x] ST.1 — Added devDependencies via `pnpm add -D`: `vitest@^5.0.1`, `jsdom@^30.1.0`, `@testing-library/react@^16.3.3`, `@testing-library/jest-dom@^7.0.1`, `@vitejs/plugin-react@^4.7.0` (**not** the latest `^6.1.1` — see "Finding" below). Added `"test": "vitest run"` / `"test:watch": "vitest"` scripts; removed `"test:placeholder"`.
- [x] ST.2 — Created `vitest.config.ts` matching design D11's sketch exactly: `plugins: [react()]`, `resolve.alias["@"]` via `resolve(__dirname, ".")`, `test.environment: "jsdom"`, `test.setupFiles: ["./vitest.setup.ts"]`, `test.include` covering `lib/**/*.test.ts`, `store/**/*.test.ts`, `components/**/*.test.tsx`.
- [x] ST.3 — **[Confirm-at-apply, resolved: no fallback needed.]** Ran `npx vitest run` against the plain config (before any test files existed) and observed no `__dirname is not defined` error — the config loads as CJS, exactly as design D11 predicted from the absent `"type"` field in `package.json`. Evidence: `npx vitest run` output was `No test files found, exiting with code 1` (an unrelated, expected failure since no `.test.ts` existed yet at that point) with **zero** parse/`ReferenceError` output regarding `__dirname`. Neither the `fileURLToPath` fallback nor `vite-tsconfig-paths` was needed.
- [x] ST.4 — Created `vitest.setup.ts`. **Deviation from the design's literal text, same intent**: imports `@testing-library/jest-dom/vitest` (not the bare `@testing-library/jest-dom` design's snippet shows) and adds `afterEach(cleanup)` from `@testing-library/react`. Both are fixes for two runtime failures actually observed while running `npx vitest run`, documented under "Findings" below.
- [x] ST.5 — Created `lib/realtime/table-merge.test.ts`: 19 tests total. 11 `describe` cases in `mergeTableList — D10 behaviour table`, one per D10 row (INSERT×3, UPDATE×4, DELETE×3, unknown-eventType×1), each asserting `toBe(prev)` reference identity on no-op rows and a new-array result with the correct row appended/replaced/filtered otherwise (including the D4 out-of-order rejection and D5 UPDATE-not-upserted rows). Plus 3 `toTable` cases (Date normalization, undefined-passthrough, null-id → `null`) and 5 `toTimestamp` cases (`null`, `undefined`, unparseable string, valid `Date`, valid string).
- [x] ST.6 — Created `components/pos/TableGrid.test.tsx`: 2 tests for the F1 remount invariant. `tableService.getAll` and `realtimeService.subscribeToTables` are stubbed with `vi.mock` (per instructions — `TableGrid.tsx` itself is untouched, its self-fetch/subscribe `useEffect` is exercised, not bypassed). Renders `TableGrid` inside a `SelectionHarness` wrapper that toggles `activeTable` via a button; asserts the `.grid` container `container.querySelector(".grid")` is `toBe`-identical (same DOM node reference) across a select and a clear, and that "Mesa 1" (i.e., no skeleton) stays visible throughout.
- [x] ST.7 — Updated `openspec/config.yaml`'s `testing` snapshot: `test_command`, `rules.apply.test_command`, `rules.verify.test_command` all set to `"npm test"`. `strict_tdd: false` left unchanged; `strict_tdd_rationale` updated to describe the new runner instead of "no runner installed" (now stale). The Python subproject's own `test_command: ""` under `testing.projects[1]` was left untouched, per instructions.
- [x] ST.8 — `mem_save` attempted once for `sdd/vipe-pos-system/testing-capabilities`. Result: **`engram_write: pending`** — failed with the documented environment error (`multiple active runtime sessions match the current project and directory`), not retried per instructions. `openspec/config.yaml`'s `testing` block (ST.7) is the durable, already-persisted mirror of this same information.
- [x] ST.9 — Per-slice verification run; see below. All commands pass.

### Findings (the most valuable output of this slice)

**Finding 1 — `@vitejs/plugin-react`'s latest major versions (5.x and 6.x) cannot be typechecked by this project's pinned TypeScript.** `pnpm add -D @vitejs/plugin-react` initially resolved `6.1.1` (latest). This broke `npx tsc --noEmit` with 3 new errors (`TS1003`, `TS1005`, `TS1128`, all "Identifier expected" / "; expected") — **not** in any source file, but in `@vitejs/plugin-react`'s own `dist/index.d.ts`, at the line `export { ..., viteReactForCjs as "module.exports" };`. This is TypeScript's "arbitrary module namespace identifier names as a re-export target for a value" syntax; the project's pinned `typescript@5.0.2` (resolved from `"typescript": "^5"` in `package.json`, unmodified by this slice) cannot parse it, confirmed with an isolated one-line repro file. `skipLibCheck: true` does not help — this is a parser/syntax error, not a semantic type-check finding, so `skipLibCheck` (which only skips checking, not parsing) is irrelevant here. Verified the same syntax is present in `@vitejs/plugin-react@5.2.0`'s (latest 5.x) declarations too, so downgrading only the minor/patch would not have helped. **Fix**: pinned `@vitejs/plugin-react@^4.7.0` instead — confirmed its `dist/index.d.ts` has no such syntax (no `module.exports` string re-export at all) and re-verified `npx tsc --noEmit` returns to the 0-error baseline. This changed the transitively-resolved `vite` from `8.3.0` down to `7.3.6` (satisfies both vitest 5's `vite: ^6.4.0 || ^7.0.0 || ^8.0.0` peer range and plugin-react 4.7.0's `vite: ^4.2.0 || ^5.0.0 || ^6.0.0 || ^7.0.0` range) — `pnpm peers check` shows no new unmet-peer entries introduced by this choice (the five unmet peers it reports — `@types/node`, `postcss`, `date-fns`, `react`, `react-dom` — are all pre-existing mismatches from dependencies this slice did not touch: `vaul`, `react-day-picker`, `autoprefixer`). `npx vitest run` and `npm test` both work correctly against `vite@7.3.6` + `@vitejs/plugin-react@4.7.0`. **This is a real gap in design D11's code sketch**: the sketch names `@vitejs/plugin-react` with no version constraint, and the "more robust… stays correct if `paths` changes" tradeoff discussion for `vite-tsconfig-paths` never anticipated that the plugin's own type declarations, at latest, would be unparseable by the project's own pinned TypeScript. A future `pnpm add -D @vitejs/plugin-react` (or an unconstrained `latest`) on this project would silently reintroduce this regression until `typescript` itself is upgraded past whatever version first supports this export syntax.

**Finding 2 — `@testing-library/jest-dom@7`'s plain entrypoint requires `test.globals: true`, which D11's config does not set.** `import "@testing-library/jest-dom"` (design's literal snippet) throws `ReferenceError: expect is not defined` at setup time, because v7 assumes a Jest-style global `expect` that only exists in Vitest when `globals: true` is configured — and D11's sketch deliberately does not set that flag. **Fix**: `vitest.setup.ts` imports `@testing-library/jest-dom/vitest` instead, which extends Vitest's own `expect` export directly, with no global-injection requirement. Observed and fixed by running `npx vitest run` against the first test file and reading the actual `ReferenceError`.

**Finding 3 — `@testing-library/react`'s auto-cleanup does not run without global test hooks.** Without `test.globals: true`, `@testing-library/react`'s internal `afterEach(cleanup)` registration (which only self-activates when it detects Jest-style globals on `globalThis`) never fires, so DOM nodes from one test leak into the next. This surfaced as a real, reproduced test failure: `TableGrid.test.tsx`'s second test failed with `getByText` matching two "toggle-selection" buttons (one from the leaked previous test's unmounted-but-still-attached DOM, one from the current render). **Fix**: `vitest.setup.ts` explicitly imports `cleanup` from `@testing-library/react` and calls it in a `vitest`-imported `afterEach`.

None of these three findings required touching `TableGrid.tsx`, `table-merge.ts`, or any other production file — all three are fixed entirely within `package.json`'s devDependency pin and `vitest.setup.ts`, both explicitly in this slice's scope.

### What the tests reveal about production behaviour (the second most valuable output)

Both new suites pass against the **current, unmodified** production code:

- `table-merge.test.ts` confirms `lib/realtime/table-merge.ts` (written in S1) implements the D10 contract exactly as documented — all 11 rows behave as specified, including the D4 out-of-order rejection and the D5 "UPDATE for an absent id is dropped, not upserted" rule.
- `TableGrid.test.tsx` confirms the **F1 remount invariant already holds today**, against `TableGrid.tsx` as it stands after S1 (S3 has not run yet — the component still self-fetches and self-subscribes). The grid's DOM node identity is provably stable across an `activeTable` prop change. This is the first automated evidence for the user's originally reported bug's core fix; previously this was verifiable only by the manual two-tab recipe (S1.8, since closed by human verification).

**Out-of-scope observation, recorded not fixed**: while writing `TableGrid.test.tsx`, inspection of `TableGrid.tsx`'s data-loading `useEffect` (`:91-135`) showed its dependency array is `[initialLoadDone]`, and the effect body itself calls `setInitialLoadDone(true)` at the end of a successful `loadTables()`. This means the effect body runs a second time immediately after the first successful load (mount → `loadTables()` → `setInitialLoadDone(true)` → dependency changes → effect re-runs → `loadTables()` again, unsubscribe+resubscribe once), so `tableService.getAll()` and `realtimeService.subscribeToTables()` are each called twice on a normal mount, not once. It self-stabilizes (no infinite loop, since the second `setInitialLoadDone(true)` is a no-op state value) and is unrelated to F1/D10, so it was not fixed here — S3 is expected to remove this `useEffect` entirely when it moves ownership into the store (S3.3 explicitly deletes this effect). Flagging it now so S3's reviewer has independent confirmation this exists today, before S3 makes it moot.

### Files Changed

| File | Action | What Was Done |
|------|--------|----------------|
| `package.json` | Modified | Added 5 devDependencies (`vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@vitejs/plugin-react@^4.7.0`); added `test`/`test:watch` scripts; removed `test:placeholder`. |
| `pnpm-lock.yaml` | Modified | Regenerated by `pnpm add -D` / `pnpm remove` / `pnpm add -D @vitejs/plugin-react@^4.7.0`. |
| `vitest.config.ts` | Created | Runner config per design D11: React plugin, jsdom environment, `@/*` alias, setup file, test includes. |
| `vitest.setup.ts` | Created | Imports `@testing-library/jest-dom/vitest` (not the bare package — Finding 2) and registers `afterEach(cleanup)` (Finding 3). |
| `lib/realtime/table-merge.test.ts` | Created | 19 tests: all 11 D10 rows + `toTable` + `toTimestamp`. |
| `components/pos/TableGrid.test.tsx` | Created | 2 tests for the F1 remount invariant, with `tableService`/`realtimeService` stubbed via `vi.mock`. |
| `openspec/changes/optimizar-arquitectura-realtime/tasks.md` | Modified | ST.1–ST.9 marked `[x]`, each with its actual observed outcome inline. |
| `openspec/changes/optimizar-arquitectura-realtime/apply-progress.md` | Modified | This ST section merged in, preserving all S1 and S2 content above (including "Orchestrator Review Fixes" and the S1.8 human-verification closure). |
| `openspec/config.yaml` | Modified | `testing` snapshot: `test_command`, `rules.apply.test_command`, `rules.verify.test_command` → `"npm test"`; `strict_tdd_rationale` updated to describe the installed runner; `strict_tdd: false` unchanged. |

### Deviations from Design

Two, both documented above under "Findings" and both confined to files this slice owns:

1. `vitest.setup.ts` imports `@testing-library/jest-dom/vitest`, not the bare `@testing-library/jest-dom` design D11's code snippet shows, and adds an explicit `afterEach(cleanup)` the snippet does not mention. Same intent (jest-dom matchers + a clean DOM between tests), different (correct, observed-necessary) mechanism.
2. `@vitejs/plugin-react` is pinned to `^4.7.0`, not left unconstrained/latest as design D11's snippet implies. Necessary because latest (`5.x`/`6.x`) breaks `npx tsc --noEmit` against this project's pinned TypeScript version — see Finding 1.

`vitest.config.ts` itself matches design D11's sketch verbatim (no deviation there). No production source file was touched.

### Verification (all commands actually run, with observed results)

1. **Baseline, measured on this branch's HEAD (`736241a`) before any ST edit:**
   - `npx tsc --noEmit 2>&1 | grep -c "error TS"` → **0**
   - `npm run lint` → exit **0**; `grep -c "Warning:"` → **104**
2. **After installing `@vitejs/plugin-react@6.1.1` (the version `pnpm add -D` resolved by default) — intermediate, not the final state:**
   - `npx tsc --noEmit 2>&1 | grep -c "error TS"` → **3** (all three in `@vitejs/plugin-react`'s own `.d.ts`, not project source — see Finding 1). This intermediate state was **not** committed.
3. **After pinning `@vitejs/plugin-react@^4.7.0` (the final, committed state):**
   - `npx tsc --noEmit 2>&1 | grep -c "error TS"` → **0**. Delta = 0 − 0 = **0** (≤ 0 required) — PASS.
   - `npm run lint` → exit **0**; `grep -c "Warning:"` → **104** (unchanged from baseline) — PASS.
   - `npm run build` → exit **0**; static generation completed (`✓ Generating static pages (2/2)`) — PASS.
   - `npm test` → **21/21 tests pass**, 2 test files (`lib/realtime/table-merge.test.ts`: 19 tests; `components/pos/TableGrid.test.tsx`: 2 tests). Exit 0.
   - `grep -n "test:placeholder" package.json` → no matches (exit 1) — PASS.
   - `git diff --name-only` against the working tree (before commit) showed only: `openspec/config.yaml`, `package.json`, `pnpm-lock.yaml` modified, plus the four new files (`vitest.config.ts`, `vitest.setup.ts`, `lib/realtime/table-merge.test.ts`, `components/pos/TableGrid.test.tsx`) untracked. `.atl/.skill-registry.cache.json` and `.atl/skill-registry.md` also show modified, but — like in S2 — they were already modified at session start, before this agent began ST work, and were not touched by this agent. `.codegraph/`, `.env.local`, `.runtime/`, `docs/PRESENTACION-COMERCIAL.md` are pre-existing untracked files from session start, also untouched by this agent. **No production source file appears in this diff.**
   - `pnpm peers check` → 5 unmet peers reported, all pre-existing and unrelated to this slice's own devDependencies (`@types/node` vs. `vite`'s want; `postcss` vs. `autoprefixer`'s want; `date-fns`/`react`/`react-dom` vs. `react-day-picker`/`vaul`'s wants). None of these five packages were touched by this slice.

### Commits

Recorded after this section is persisted — see the commit list appended below once created.

### Next Steps

- Slice ST is complete: `strict_tdd` remains `false`, the runner is installed and proven working, and both new suites pass against the current, un-modified S1/S2 code.
- Per `tasks.md`'s dependency order, **S3 (single owner)** is next — it explicitly depends on ST for its own tests (`store/useTableStore.test.ts`) and must re-run the F1 remount test (`TableGrid.test.tsx`, this slice) after moving `TableGrid`'s data ownership into the store, since S3.3 changes the component's data source.
- The `useEffect([initialLoadDone])` double-fetch/double-subscribe behavior noted above under "Out-of-scope observation" is expected to become moot once S3.3 deletes that effect; flagged here for the S3 reviewer's awareness, not for action in this slice.

### Engram Persistence

`mem_save` was attempted once for `sdd/vipe-pos-system/testing-capabilities` (title, topic_key, type `architecture`, project `vipe-pos-system`, `capture_prompt: false`). Result: **`engram_write: pending`** — failed with `multiple active runtime sessions match the current project and directory`, the same documented environment limitation noted for S1/S2's `apply-progress` saves. Not retried, per instructions. The orchestrator is expected to mirror this via the `engram` CLI; `openspec/config.yaml`'s `testing` block (already updated and committed) is the durable hybrid-store half of this record in the meantime.
