# Encabezado de la comanda: mesero y número de pedido

Printed kitchen comandas must name the real waiter and carry the order number.
Branch `fix/comanda-header` from `dev` after #156. Code in English, ticket text in Spanish.

## Specs

- S1. "esta perfecto la separacion 2 comandas diferentes impresoras, pero el nombre del mesero no aparece": the comanda's "Mesero:" line shows the real name of the staff member who sent it (on a shared terminal, the person identified with the PIN), never the placeholder "Mesero".
- S2. "y tampoco tenemos un numero de pedido o numero de comanda": every comanda shows the order number (the database `orders.order_number`), e.g. "COMANDA #130 — Mesa 1" and "COMANDA #131 — DOMICILIO".
- S3. The station split stays exactly as it is; when the restaurant has stations each ticket also says which one ("Estación: Cocina"), so two tickets of one send can be told apart.
- S4. Every renderer prints the same header: the VIPE desktop app (desktop/core), the legacy pos/ listener and the browser print view (lib/print). Restaurants without stations and old stored jobs without the new fields still print (backward compatible).

## Tasks

- [ ] T1. Server-filled waiter and order number in command payloads, header in the three renderers, golden fixtures, tests (S1–S4). Route: worker. Commit: pending.
- [ ] T2. Windows installer with the new renderer, PR, staging (S4). Route: parent. Commit: none.

## Log

- L1 (user, 2026-11-07, with a screenshot of two comandas of Mesa 1 printed on two printers, both "Mesero: Mesero" and no number): "mira como estan saliendo las comandas, esta perfecto la separacion 2 comandas diferentes impresoras, pero el nombre del mesero no aparece y tampoco tenemos un numero de pedido o numero de comanda".
- L2 (evidence, 2026-11-07): WaiterView builds the comanda with `waiter: waiters.find((p) => p.id === waiterId)?.name || "Mesero"` (components/views/WaiterView.tsx:813), so any sender missing from that list prints "Mesero"; it also computes the order number into `invoiceNumber`, but the API replaces `invoiceNumber` with the print job id (apps/api/src/print/print.dto.ts:24-34), so no renderer has the order number. desktop/core/src/escpos/render.rs:20-45 and pos/print_renderer.py print "COMANDA — Mesa {table}" and "Mesero: {waiter}" only. Deliveries already take the waiter from the caller server-side (apps/api/src/delivery/delivery.service.ts:220).
- L3 (decision, 2026-11-07): the API fills `waiter` from the authenticated (acting) profile's name and `orderNumber` from the order the comanda belongs to, so the client can no longer print a wrong name or number; the request carries the order id, and the server refuses an order of another restaurant. Payloads gain optional `orderNumber`; renderers print "COMANDA #<n> — Mesa <t>" / "COMANDA #<n> — DOMICILIO" and, when the job has a station, "Estación: <name>"; without the new fields they print exactly as today.
