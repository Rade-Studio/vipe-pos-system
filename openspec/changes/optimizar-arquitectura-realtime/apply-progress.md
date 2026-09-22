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
