# F7 · Modificadores con precio

Phase 3 item F7 (odd/tasks/fase3-operacion.md, S1 d): dishes take modifiers with price, from the admin editor to the waiter, kitchen, print and bill.
Branch `feat/f7-modificadores` from `dev` after #155; migration 0023. Code and docs in English, UI copy in Spanish. Designs first (design/modificadores/), then build.

## Specs

- S1. "Modifiers with price: DB, API, admin editor, waiter step 4, kitchen, print and bill." (fase3 F7). A modifier option has a price (0 or more) that is added to the dish line and to the bill.
- S2. Model, user's answer "Grupos reutilizables (Recomendado)": "Creas \"Adiciones de hamburguesa\" una vez y lo asignas a varios platos. Cambiar un precio lo cambia en todos."
- S3. Rules, user's answer "Obligatorio y mínimo/máximo (Recomendado)": "Ej.: \"Término\" obligatorio, elige 1; \"Adiciones\" opcional, hasta 3. El mesero no puede enviar sin lo obligatorio."
- S4. Inventory, user's answer "Sí, ligadas a un ingrediente": "Cada opción puede descontar una cantidad de un ingrediente."
- S5. Quick notes, user's answer: "en un principio no deberian estar, igual cada restaurante lo configurara. Actualmente tenemos todo ambiente de pruebas". The quick-note chips go away; restaurants configure what they need as modifiers (a $0 option covers "sin cebolla"). The free-text comment on a line stays.
- S6. Every place a line shows (waiter cart, kitchen ticket, comanda and invoice print, cashier bill, voids, delivery, admin orders) shows its modifiers and the price they add; totals stay server-computed (no client-trusted prices).
- S7. Light and dark at 390/768/1024/1440, no overflow, targets ≥ 44 px (phase rule S6); new screens designed first and chosen on the canvas.

## Tasks

- [ ] T0. Designs: admin group editor + dish assignment, waiter modifier picker in step 4, how a modified line reads on the kitchen ticket and the bill (S1–S3, S5–S7). Route: design worker; parent picks the recommended direction with the user. Commit: none (design/ is not committed).
- [ ] T1. DB + API (S1–S5): migration 0023 (groups, options with price and optional ingredient, dish links, per-line modifier snapshot, quick notes removed), catalog endpoints, server-side pricing and rule checks for table orders and deliveries, inventory deduction, print payloads. Route: worker; verify (item 1 money, item 3 contract). Commit: pending.
- [ ] T2. Admin editor (S2, S3, S4, S5, S7): Menú → modifier groups and their assignment in the dish form; quick-notes editor removed. Route: worker. Commit: pending.
- [ ] T3. Waiter and delivery ordering (S1, S3, S5, S7): modifier picker in step 4 and the delivery form; required groups block sending; cart lines keyed by dish + modifiers. Route: worker. Commit: pending.
- [ ] T4. Kitchen, print, cashier and voids display (S6, S7): kitchen ticket, pos/ and desktop renderers, invoice, cashier bill grouping, void sheets, admin orders. Route: worker. Commit: pending.

## Log

- L1 (user, 2026-11-07): after reservations shipped, asked "¿Qué sigue?" and chose "F7 modificadores con precio (Recomendado)".
- L2 (evidence, 2026-11-07): today dishes have only `quick_notes text[]` chips (0015) that append text to `order_items.comments`, no price; `order_items.price` is the catalog price snapshot set by `orders.service` `priceItems` (409 when the client price differs) and by `create_delivery_order` (0016) for deliveries; `private.recompute_order_bill` sums `round(price*quantity)`; voids copy `oi.price`; `consume_order_stock` deducts dish recipes only; kitchen ticket, pos/print_renderer.py and desktop/core render only `comments`. Latest migration 0022.
- L3 (user, 2026-11-07, answers): "¿Cómo se arman los modificadores?" → "Grupos reutilizables (Recomendado)"; "¿Qué reglas necesita un grupo?" → "Obligatorio y mínimo/máximo (Recomendado)"; "¿Las adiciones descuentan inventario?" → "Sí, ligadas a un ingrediente"; "¿Qué pasa con las notas rápidas de hoy?" → "en un principio no deberian estar, igual cada restaurante lo configurara. Actualmente tenemos todo ambiente de pruebas".
- L4 (decision, 2026-11-07): `order_items.price` stays the unit price the bill sums, now dish price (after promotion) plus the chosen options' prices, so bills, voids and payments keep working; each line also stores a snapshot of its chosen options (group name, option name, price, ingredient deducted). The server recomputes and validates options and rules; a stale client price answers 409 as today. Option ingredients are deducted with the dish recipe, once per unit. Since every environment is a test environment (L3), migration 0023 drops `dishes.quick_notes`.
