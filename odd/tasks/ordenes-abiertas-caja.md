# Open orders across cash register cycles

Orders stay open for days (tables "En cocina · 145 h") while the cash register is closed and reopened, and nothing surfaces or resolves them. Branch `fix/ordenes-abiertas-caja` from `dev` (b96674f). Follows odd/tasks/qa-mesas-ordenes.md.

## Specs

- S1 (L1): closing the register with open orders (status `active`, `kitchen` or `delivered`, dine-in or delivery) is not silent. `POST /registers/:id/close` answers 409 `{ code: "open_orders", count, message: "Hay N órdenes abiertas. Cóbralas o cancélalas, o confirma que pasan a la siguiente caja." }` unless the body carries `leaveOpenOrders: true`; the register stays open. Without open orders the close works as today (no body needed). An already closed register keeps answering as today.
- S2 (L1): the "Cerrar Caja" dialog lists the open orders (mesa or domicilio, mesero, total, age such as "hace 6 d 1 h") before closing. Each row has "Cancelar orden", which opens the existing audited cancel flow (VoidFlow) for that order; the list refreshes after a cancel. With open orders left, "Cerrar Caja" stays disabled until the cashier checks "Dejar N órdenes abiertas para la siguiente caja", and the close sends `leaveOpenOrders: true`.
- S3 (L1): an order open for 12 hours or more is flagged as old: the floor chip shows days past 24 h ("6 d 1 h" instead of "145 h 27") with a warning tone, and the admin Órdenes page shows a banner "N órdenes llevan abiertas más de 12 horas" listing them with their table and age.
- S4 (qa-mesas-ordenes L10): the 0024 repair test covers a `delivered` table status, an available table with a `kitchen` order, a kept waiter, a delivery order, an occupied table with an open order and a second restaurant.

## Tasks

- [ ] T1. S1, S2: API close gate, store, CloseRegisterDialog with open orders and cancel. Route: worker. Commit: -
- [ ] T2. S3: old-order flag on the floor chip and the admin Órdenes banner. Route: worker. Commit: -
- [x] T3. S4: extra pgTAP probes for 0024 (6 assertions: delivered table status, available + kitchen order, kept waiter, delivery order, occupied with an open order, second restaurant). Route: inline. Commit: see git log. `pnpm test:db` (isolated compose project): Files=44, Tests=2056, PASS. No RED: the migration is already applied, the probes pin its behavior.

## Log

- L1 (user, 2026-11-11): "Bueno haz todo lo que esta en tus manos y recomiendes, porque tambien el tema de las ordenes abiertas aun pedidos abierto y la caja ya cerro y abrio como 2 veces, debemos darle una solucioon tambien, soluciona todo lo pendiente"
- L2 (evidence, 2026-11-11): explorer map. `close_register` (0000_baseline.sql:987-1061) never reads orders; orders have no register link (only payments.cash_register_id at pay time), so an open order carries over silently. One open register per restaurant (0009). Cancel is per order and audited (`POST /orders/:id/cancel`, reason codes waiter_error, customer_left, dish_returned, duplicate_charge, wrong_payment_method, other; supervisor authorization when the order has lines or payments; deliveries only admin or delivery_operator). Floor age chip: lib/floor/live.ts:22-27 `elapsedLabel` "N h MM", unbounded. Close dialog: components/cashier/CloseRegisterDialog.tsx:70,146; store store/use-cash-register-store.ts:192-199.
- L3 (decision, 2026-11-11): a hard block of the close was rejected: one forgotten table, a delivery the cashier cannot cancel, or a missing supervisor would leave the register unclosable (L2 risks). The close is a soft gate enforced on the server (S1): open orders are listed and cancellable, and leaving them needs an explicit confirmation. No automatic or bulk cancellation: each cancel stays audited. The waiter still cannot free a table with an open order (qa-mesas-ordenes L3); old orders are resolved in caja.
