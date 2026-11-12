# Informe X: impresora térmica o vista en modal

The cashier's "Informe X" button opens the browser print dialog. It must print on the thermal printer when the restaurant has one configured, and otherwise show the report in a well-presented modal. Branch `feat/informe-x-termico` from dev, worktree `../vipe-pos-system-worktrees/promociones`. The X report area belongs to vipepos-caja, which handed this task over (L2).

## Specs

- S1 (L1): when a thermal print station is configured for the restaurant (the same condition the invoice uses to send a print job instead of the browser dialog), "Informe X" sends a print job of a new kind (`x_report`) carrying the report exactly as the Informe X endpoint returns it (no client recalculation, L2), and the cashier sees a confirmation toast ("Informe X enviado a la impresora") or a clear error with a fallback action to view it on screen. The desktop station (desktop/core ESC/POS) and the pos Python printer render it with the same content and order as the current slip (business header, "INFORME X", "Parcial · No reinicia contadores", cajero, abierto, impreso, ventas por método with counts, Ventas, Base, impuesto label and value, Tiquetes, efectivo en caja block, propinas aparte with "No son ingreso del restaurante.", "Este informe no cierra el turno.") at 80 mm and 58 mm.
- S2 (L1): when no thermal station is configured, or the cashier chooses to view it, "Informe X" opens a modal ("Informe X · parcial") showing the same data professionally (sections with headings, aligned amounts, totals emphasised, the "no cierra el turno" note), with "Imprimir" (browser print of the current slip, optional) and "Cerrar". No browser print dialog opens by itself.
- S3 (L2): ShiftCloseSlip and ZReportSlip keep their current behaviour, even if they share the print helper.

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| X1 API kind + desktop/pos renderers + cashier routing and modal | S1–S3 | worker | — |

## Log

- L1 (user): "Cuando le doy click a informe x me manda a imprimir en el navegador, deveria imprimir en la impresora termica si la tienen o mostrar una visual tipo modal para ver esos datos profesionalmente"
- L2 (coordination, vipepos-caja 365b86a0): caja hands this over; it is not editing XReportSlip, ShiftCloseSlip, ZReportSlip, the shift close or printer sending. Do not change ShiftCloseSlip/ZReportSlip behaviour unless the user asks; keep the X data exactly as the Informe X endpoint returns it. caja's #200 adds two lines under the Header in CashierView/DeliveryView/KitchenView/WaiterView; merge dev on top if CashierView conflicts.
