# Promociones: mejoras posteriores a la entrega

Follow-up of `odd/tasks/promociones.md` (delivered to dev in PR #176, 7180922). Closes the non-blocking review advisories and the known gaps listed at delivery. Branch `feat/promociones-mejoras` from dev (c07bac1), worktree `../vipe-pos-system-worktrees/promociones`. Product-dependent items ("Para llevar" channel, weekly promotion stats) wait for the user's decision and are not specified here yet.

## Specs

- S1 (void-aware preview, closes L23 of promociones.md): `POST /orders/pricing-preview` accepts optional `voids: [{ orderItemId, quantity }]` (quantity ≥ 1 and ≤ the line's quantity; the item must belong to `orderId`; a combo component voids its whole combo, as the void endpoint does) and returns the order's discounts, bill discount and totals as if those quantities were voided now (manual line discounts rescaled per line_quantity as recompute does). No writes. The cashier void sheet shows, for orders with discounts, the recomputed discount total and new total before confirming, e.g. "Si anulas 1 Mojito, el 2x1 se recalcula." with "Descuentos: −$24.000 · Total: $79.000"; when the preview fails it falls back to the generic note "Las promociones se recalculan al anular".
- S2 (delivery invoice): the delivery payment dialog (`components/cashier/PaymentMethodDialog.tsx`) builds the invoice with the order's bill-level discounts, `bill.grossSubtotal` and each item's discounts, exactly like `PaymentPanel` does, so delivery invoices print the discount lines; an order without discounts prints the same payload as before.
- S3 (orders advisories, approved review of 2db6796): combos with options: option prices of combo components are charged on top of the combo price (the combo discount is Σ component list prices without options − comboPrice), documented in the API and tested; preview combo expansion capped (at most 20 combo lines and 6 groups per request, 422 otherwise); add-items with combos tested; the empty-lines validation message is clear Spanish; `grossSubtotal` derivation in the mapper tested against order_discounts; preview of a combo success path tested; preview uses the order's own channel when `orderId` is given (the body channel is ignored then) and this is tested; preview draft lines reject unknown fields (strict); the promotions integration spec no longer depends on test order.
- S4 (payments advisories, approved review of 5291806): the short-cash refine applies only to cash lines (a line is cash by its payment method kind, not by the presence of cashReceived), tested; split + recompute run in one transaction and a failing recompute rolls the split back (tested with a forced failure); the split response shape is documented and tested; the zero-tender happy path through the API is tested.
- S5 (cashier advisories, approved review of 888faaf): DiscountSheet never submits silently (every path shows success or an error), its uncovered branches are tested; the invoice discount layout matches `renderKitchenOrder`/ESC/POS (same totals rows in the same order) and is tested; a failed order-discounts read shows an error with "Reintentar" instead of stale data; the payment panel re-seeds its amounts when the order's discounts change (tested); the zero-total close is decided from the server bill, never from a client draft (tested).
- S6 (records): append the delivery entry to `odd/tasks/promociones.md` (PR #176 merged as 7180922, migration 0028, staging deploy run 43265205758 success).

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| M1 API: void-aware preview, orders and payments advisories | S1 (API), S3, S4 | worker | — |
| M2 Web: void sheet preview, delivery invoice, cashier advisories | S1 (web), S2, S5 | worker | — |
| M3 Records | S6 | inline | — |

## Log

- L1 (user): "y porque no haces esas mejoras pendientes?"
- L2 (decision): the clear items start now; the "Para llevar" channel (needs a new order type) and weekly promotion stats (needs a reporting definition) wait for the user's answer. Tax on the discounted value stays with the user's accountant.
