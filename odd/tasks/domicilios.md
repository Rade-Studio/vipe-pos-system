# ODD feature: domicilios

Branch `feat/domicilios` (worktree `../vipe-pos-system-worktrees/domicilios`), stacked on
`feat/pagos-08-invoices` (PR #82, tip `3b02839`).

## Goal

Home-delivery module: a delivery operator takes delivery orders for registered customers,
the kitchen prepares them in the same queue, the operator dispatches them with a courier
and closes them as delivered or failed, and payments (prepaid or cash on delivery) go
through the existing `pay_order` ledger.

## Decisions (user, 2026-10-06)

- New role `delivery_operator`: takes delivery orders, assigns couriers, tracks and closes
  them. Couriers do not use the app.
- Customers: registry keyed by phone (unique per restaurant) with saved addresses; each
  order keeps a snapshot of the address used. Base for the later WhatsApp integration.
- Couriers: simple admin-managed list (name, phone, active), no login.
- Payment: prepaid (Nequi/transfer) or cash on delivery. The operator may record payments
  with `pay_order` on the shift's open register (cannot open or close registers); cash on
  delivery is settled when the courier returns.
- Delivery fee: configurable suggested value, editable per order, added to the bill with
  no tax and no tip.
- Kitchen: delivery orders share the queue, labelled DOMICILIO; the kitchen ticket prints
  the customer instead of the table. The kitchen marks a delivery order ready.
- States: received -> preparing -> ready -> out_for_delivery -> delivered | failed
  (with reason); a failed order can be re-dispatched or cancelled. Transitions are
  enforced server-side. `orders.status` keeps its current meaning; delivery progress
  lives in its own column.

## Tasks

- [x] 1. Role `delivery_operator` app side: app type, routing to a placeholder
      DeliveryView, profile labels/PIN prefix, staff form option. (`pay_order` and
      `register_summary` accept the role in task 3, with the fee change.)
- [x] 2. Schema: `couriers`, `customers`, `customer_addresses`, `orders.order_type` +
      `order_deliveries` (1:1), RLS per role, realtime publication, default fee config.
- [x] 3. RPCs: atomic `create_delivery_order`, delivery state machine RPC (ready,
      dispatch with courier, delivered, failed, re-dispatch, cancel), `pay_order` amount
      due includes the delivery fee, `split_order` rejects delivery orders.
- [x] 4. `lib/delivery` pure logic (state machine mirror, fee, phone normalization,
      address formatting) + typed service.
- [x] 5. Operator view: delivery board by state + new order flow (phone lookup, customer
      and address create/pick, items, fee, payment mode, cash change).
- [x] 6. Operator dispatch and close: courier assignment, out for delivery, delivered,
      failed with reason, re-dispatch, cancel; prepaid and cash-on-delivery payments.
- [x] 7. Admin: couriers screen, default delivery fee, role assignable to staff.
- [x] 8. Kitchen, cashier and admin views stop assuming a table; DOMICILIO label; kitchen
      marks delivery orders ready.
- [x] 9. Printing: kitchen ticket and invoice carry delivery data (TS + Python parity,
      additive payload).
- [x] 10. Staff accounts from the app: Supabase Edge Function `create-staff-account` (service
      role) callable only by an admin; tenant taken from the caller's profile; roles waiter,
      kitchen, cashier, delivery_operator (never admin); the auth user carries role and
      restaurant in app metadata so handle_new_user creates the profile; staff form uses it;
      seed a local delivery operator account.
- [ ] 11. Docs and full verification.

## Decisions (user, 2026-10-07)

- Staff accounts are created from the app through a server-side function (Edge Function).

## Known follow-ups (out of scope)

- Delivery board: "Entregado" has no confirmation and cannot be undone; two server refusals (already paid, not payable) are shown untranslated.
- The register store keeps a register closed after login; pay_order then refuses with its own message.

- create_delivery_order prices items from the menu without promotions (promotions live at order level today).

- Profile PINs default empty and are never loaded from the database (pre-existing for every role).
- Staff accounts created before task 10 have no auth user (shown as "Sin acceso"); recreate them from Personal.
- create-staff-account: a database error reading the caller's profile answers 403 instead of 500; the rollback delete does not report its error (the user stays banned).
- Kitchen command is a fire-and-forget broadcast: if the print listener is offline it is lost (pre-existing); the success toast does not prove delivery to the printer.
- The suggested delivery fee card lives in Configuracion > Repartidores (BusinessConfigForm is not mounted anywhere; the live settings screen is ConfigurationPanel).

- WhatsApp integration (separate feature, builds on the customer registry).
- Delivery zones and per-zone fees.

## Evidence log

| Task | Commit | Evidence |
|------|--------|----------|
| 1 | `fdec08a` | lib/auth/roles.ts single source of roles (APP_ROLES, roleLabel, isAppRole, viewForRole); RED: module missing; GREEN 7 tests. Router switch on viewForRole, DeliveryView placeholder, profile tile/PIN prefix, staff form role select (waiter / delivery_operator), Header label from roleLabel. Vitest 15 files / 249; typecheck 0; build OK. |
| 1 RDD | review-8ced532e9a3b247f | risk admitted; resilience refused (unknown field) then admitted with readability; reliability failed natively -> escalated (unknown_causality) on 6 findings. Verified: empty/unloaded PINs and the invalid-role screen are pre-existing for every role; WaiterForm role union and PIN prefix are maintainability notes (staff screen revisited in task 7). No defect introduced. |
| 2 | `0f39265` | Migration 20261007100000: couriers (admin writes), customers (phone ^[0-9]{7,15}$ unique per tenant) and customer_addresses (one default) for admin/cashier/delivery_operator, orders.order_type + delivery-without-table CHECK, order_deliveries 1:1 (snapshot, fee, payment mode, cash_change_for only COD, courier, status, failure_reason required when failed) readable by admin/cashier/delivery_operator/kitchen and write-guarded (42501) like payments; deferred tenant-consistency triggers; realtime publication. RED: 102/109 failed; GREEN pgTAP 12 files / 670 (parent re-run). |
| 2 RDD | review-585e424223b279c8 + `ae29db9` | Medium tier, reliability admitted; refuter corroborated one BLOCKER (cross-tenant courier test probes RLS, not the trigger). Verified false: the block runs as postgres (role reset at the previous RESET ROLE) and RLS would raise 42501, while the test asserts and gets 23514 from the trigger. Still clarified in ae29db9 (8-line plan): the foreign courier is seeded outside the checked block. pgTAP 670 PASS. Targeted validator refused twice (unbound result, invalid JSON) -> retry spent, lineage left in correction_required. |
| 3 | `4d0552a` | Migration 20261007110000: create_delivery_order (atomic customer/address/order/items/delivery, menu prices server-side, admin/delivery_operator), set_delivery_status state machine (same-state replays raise P0001; cancel rejected once a payment exists), pay_order adds the delivery fee and admits delivery_operator, register_summary readable by the operator, split_order rejects delivery orders. Parent check: pay_order/split_order/register_summary bodies differ from the originals only in those lines (plus trimmed comments). Parent fix: p_notes was accepted and discarded -> new order_deliveries.notes (<=300) stored (RED: test 12 failed; GREEN). RED: 98 planned / 2 ran; GREEN pgTAP 13 files / 746. |
| 3 RDD | review-7d8d23dda22585bd | Medium tier, reliability refused twice (repeated finding id; multiple JSON objects) -> retry spent, lineage left in reviewing. Rejected payloads read: most claims self-refute; one real: cancel checked for payments before locking the order. Two-session probe (A: pay_order held open 4 s; B: cancel) ended with order.status=cancelled and 1 payment -> fixed in the next commit. |
| 3 fix | `cacf01f` | set_delivery_status cancel locks the order before the payment check and also refuses an order already marked paid. Same two-session probe after the fix: B waits for A, then fails with "already has a payment"; final order.status=paid, delivery=received, 1 payment. pgTAP 13 files / 746 after db reset. |
| 3 fix RDD | review-2eab9446b01a8059 | Medium tier, reliability failed natively then escalated (unknown_causality) on 2 findings: the lock move is called "correct in intent" but fragile because it relies on pay_order locking the order (documented and true; proven by the two-session probe); "served/closed" order states do not exist (status CHECK: active, kitchen, delivered, cancelled, paid) and the delivery state machine already limits cancel to received/preparing/ready/failed. No defect. |
| 4 | `067199d` | lib/delivery: state machine mirroring the 11 server transitions and the role matrix, Spanish status labels, phone normalization (+57/57 stripped only for a 10-digit mobile starting with 3; 7..15 digits), fee/total/change-for helpers, address formatting, strict parsers; lib/supabase/delivery-service.ts (findCustomerByPhone, listCouriers, createDeliveryOrder, setDeliveryStatus, listActiveDeliveries hides delivered/cancelled rows not updated today) with DeliveryServiceError. RED per file; GREEN Vitest 21 files / 362; typecheck 0. |
| 4 RDD | review-f0a003ad61a7726b | Medium tier, reliability admitted -> APPROVED; acknowledgement burned authority. Advisory only: same-state replays intentionally unmapped (server raises P0001). |
| 5 | `c4e66b7` | Operator board (columns by status, realtime via a per-hook channel on order_deliveries and orders, cards with customer/address/payment mode/notes/elapsed; start_preparing and mark_ready only) and Nuevo domicilio dialog (phone lookup with saved addresses, new customer/address with save flag, menu picker, cart, suggested fee from business_config.delivery_default_fee, payment mode, cash change for, notes, totals estimate) on a pure lib/delivery/order-draft.ts reducer (37 tests). Worker crashed before reporting: RED for order-draft was NOT observed. Parent fixes: per-form single-flight gate instead of a module-level one, submit state drives the button (isRunning() never re-rendered), rejected submits no longer leave an unhandled promise, the form mounts only after the suggested fee loads (it seeded the draft with 0), config read failure falls back to 0, unused import removed. Vitest 22 files / 399; typecheck 0; build OK. |
| 5 RDD | review-d6de6e3575ebf9cf + `43574ec` | First capture failed with 429 (Token Plan limit); after the reset the reliability lens was admitted -> correction_required on 2 real defects: a phone edit after a lookup kept the previous customer/address (plus stale responses and submit during lookup), and an existing customer with no saved address could not place an order. Fixed in 43574ec within the 170-line plan (119 lines): reducer drops the lookup when the number changes, clears saved-address choices on a new lookup, validates the typed phone and address ownership (RED 4/6 new tests failed; GREEN Vitest 22 files / 405); form ignores stale lookups, clears on error, disables submit during lookup, offers Otra direccion. Targeted validator: invalid JSON, then relay timeout (898 s) -> retry spent, lineage left in correction_required. |
| 6 | `e392734` | Board actions from allowedActions: Despachar/Reenviar (active courier picker, warn-only for unpaid prepaid), Entregado, Fallido (reason 1..200), Cancelar (server refusal shown); per-card gate; Pagado/Pendiente badges from orders.status; Registrar pago opens PaymentMethodDialog with the delivery fee in the amount due (pay_order charges it) on the open register, or explains there is none. lib/delivery/card-actions.ts (9 tests), draft amount due + fee (3 tests), isPaid parsing. RED: expected 11900 to be 16900, missing module, isPaid undefined; GREEN Vitest 23 files / 419; typecheck 0; build OK. |
| 6 RDD | review-c516da256c29514d | High tier, 4 lenses admitted on the first run -> APPROVED; acknowledgement burned authority. Advisory: register load failure shows "No hay caja abierta" (loadCurrentRegister catches internally, so nothing is unhandled); duplicated reason limit; board orchestration has no component test. |
| 7 | `5092794` | Admin Repartidores sub-tab: CouriersManager (create/edit/activate, no delete, single-flight, query key ['couriers'] covers the dispatch picker) on lib/delivery/courier-admin.ts (16 tests) and createCourier/updateCourier (+10 tests); suggested fee card persisting business_config.delivery_default_fee (no seed row; first save inserts). Staff screen renamed Personal, lists waiters and delivery operators with a role badge; WaiterForm stops writing the dropped profiles.password column (dropped in 20250917090007, so every create failed) and keeps the current role on edit (it reset operators to waiter). RED: missing module / createCourier not a function / parseDefaultFeeInput not a function; GREEN Vitest 24 files / 445; typecheck 0; build OK. |
| 7 RDD | review-a623788466fddbca | Medium tier, reliability admitted -> APPROVED; acknowledgement burned authority. Advisory: couriers load failure renders the empty state, fee save trusts the service result, RLS on update maps to not-found, WaiterForm fix has no component test. |
| 8 | `24c4eed` | lib/delivery/kitchen.ts (17 tests: headings, place text, mark-ready rule, place filter, dine-in grouping, pending delivery payments; RED: module missing). Kitchen: DOMICILIO banner + card heading with the customer, Domicilios filter, no table update for delivery orders, marks the delivery ready when the last item is served (failure toast, never blocks). Cashier: delivery orders out of the table grid, Domicilios por cobrar panel (unpaid, not cancelled, any day) paying through PaymentMethodDialog with the fee. Admin: no table update and a Domicilio toast for delivery orders. Parent: OrderCard heading prop (no Mesa ? on delivery cards). Vitest 25 files / 462; typecheck 0; build OK. |
| 8 RDD | review-40973b5bd40faaf0 | Medium tier, reliability -> APPROVED, burned. Advisory acted on in `9f9cbbb`: ready toast before mark_ready outcome; panel error unmounting the payment dialog. Left: banner loading on error, orchestration untested. |
| 8 fix | `9f9cbbb` | servedOrderMessage (3 tests, RED: not a function); completeOrder awaits mark_ready and reports the confirmed outcome; cashier panel keeps list/dialog on refetch error. Vitest 25/465; typecheck 0; build OK. RDD review-c343dad8d498d870 APPROVED, burned (advisory: kitchen now awaits the transition; error toast precedes the served toast). |
| 9 | `2dc6db1` | Delivery orders created on the board now send the kitchen command once after create_delivery_order succeeds (before: never printed in the kitchen). Additive `delivery` block on CommandPayload/PrintableInvoice (lib/delivery/print.ts, tests). Kitchen ticket COMANDA — DOMICILIO + Cliente + NOTAS; invoice CLIENTE/TEL/DIRECCION instead of MESA/MESERO, DOMICILIO fee line inside TOTAL SIN PROPINA, CAMBIO PARA for COD; TS and Python parity. Dine-in goldens written and passing on the old code first (Python invoice SHA-256, TS line snapshots), still passing. RED TS 6 + Python 6; parent label normalization RED 2+2. Vitest 26/479; Python 22 OK; typecheck 0; build OK. |
| 9 RDD | review-7222f76632805ecd | Medium tier, reliability -> APPROVED, burned. Advisory (follow-ups): the sync try/catch around sendCommand never sees the async broadcast failure (realtimeService toasts on its own, same as WaiterView) and the success toast claims the kitchen got it; broadcast is fire-and-forget with no persistence if the listener is offline (pre-existing design); invoice waiter is a raw waiter_id (pre-existing). |
| 10 | `b49bde7` | Edge Function create-staff-account (verify_jwt): caller must be an active admin (401/403), tenant always from the caller's profile, roles waiter/kitchen/cashier/delivery_operator (admin -> 400). Fail closed: user created banned, profile role/tenant/name applied explicitly (GoTrue writes app_metadata after handle_new_user runs), read back, then unbanned; any later failure deletes the user (stays banned if delete fails); top-level 500 guard; duplicate by code -> 409, weak_password -> 400. Logic in handler.ts/validate.ts (Vitest), Deno only in index.ts. Client staff-service + WaiterForm (email/password/role; partial save warns instead of failing); WaiterList Sin acceso badge. Seed domicilios@restaurant.com / domicilios123. RED: modules missing, then 16 fail-closed/mapping tests + staff-service 400. Vitest 29/524; typecheck 0; eslint touched 0; build OK. Smoke (local stack): admin 201 cashier with correct role/tenant and the new user signs in; duplicate 409; non-admin 403; no auth 401; local GoTrue accepted '12345678' (no strength rule), 400 path unit-tested only; db reset after. |
| 10 RDD | review-c5af62d631afd22f | Medium tier, reliability -> APPROVED (first relay failed on a WSL I/O error reading managed settings; one retry), burned. Checked and not applicable: rollback leaves profile (FK ON DELETE CASCADE), edit role desync (effective role is profiles.role; the client never reads app_metadata). Follow-ups: caller-profile DB error answers 403 instead of 500 (fails closed); deleteUser swallows its error (user stays banned); partial-save path untested; one vacuous leak assertion. |
