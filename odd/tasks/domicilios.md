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
- [ ] 2. Schema: `couriers`, `customers`, `customer_addresses`, `orders.order_type` +
      `order_deliveries` (1:1), RLS per role, realtime publication, default fee config.
- [ ] 3. RPCs: atomic `create_delivery_order`, delivery state machine RPC (ready,
      dispatch with courier, delivered, failed, re-dispatch, cancel), `pay_order` amount
      due includes the delivery fee, `split_order` rejects delivery orders.
- [ ] 4. `lib/delivery` pure logic (state machine mirror, fee, phone normalization,
      address formatting) + typed service.
- [ ] 5. Operator view: delivery board by state + new order flow (phone lookup, customer
      and address create/pick, items, fee, payment mode, cash change).
- [ ] 6. Operator dispatch and close: courier assignment, out for delivery, delivered,
      failed with reason, re-dispatch, cancel; prepaid and cash-on-delivery payments.
- [ ] 7. Admin: couriers screen, default delivery fee, role assignable to staff.
- [ ] 8. Kitchen, cashier and admin views stop assuming a table; DOMICILIO label; kitchen
      marks delivery orders ready.
- [ ] 9. Printing: kitchen ticket and invoice carry delivery data (TS + Python parity,
      additive payload).
- [ ] 10. Docs and full verification.

## Known follow-ups (out of scope)

- Profile PINs default empty and are never loaded from the database (pre-existing for every role).
- Staff list (WaiterList) filters role = waiter, so operators created there are not listed; WaiterForm still writes the dropped `password` column (pre-existing). Task 7 revisits the staff screen.

- WhatsApp integration (separate feature, builds on the customer registry).
- Delivery zones and per-zone fees.

## Evidence log

| Task | Commit | Evidence |
|------|--------|----------|
| 1 | `fdec08a` | lib/auth/roles.ts single source of roles (APP_ROLES, roleLabel, isAppRole, viewForRole); RED: module missing; GREEN 7 tests. Router switch on viewForRole, DeliveryView placeholder, profile tile/PIN prefix, staff form role select (waiter / delivery_operator), Header label from roleLabel. Vitest 15 files / 249; typecheck 0; build OK. |
| 1 RDD | review-8ced532e9a3b247f | risk admitted; resilience refused (unknown field) then admitted with readability; reliability failed natively -> escalated (unknown_causality) on 6 findings. Verified: empty/unloaded PINs and the invalid-role screen are pre-existing for every role; WaiterForm role union and PIN prefix are maintainability notes (staff screen revisited in task 7). No defect introduced. |
