# Inventario: Compras, Transferencias, Movimientos y Conteos

Redesign of the admin Inventory screens following the approved design `design/inventario-compras-movimientos/` (01 Compras, 02 Movimientos, 03 Transferencias, 04 Conteos), in the Producción style (`design/produccion-minimal/04`). Order agreed with the user: Compras → Transferencias → Movimientos → Conteos. Each task ships as small PRs (≤ ~1,300 changed lines) to dev, then to staging.

## Specs

- S1 (Compras, design 01): "Sugerencia de compra" becomes a compact table with one row per supplier and its own "Crear borrador" button. Purchase orders awaiting receipt come first, with "Recibir" in the row, and receiving opens a dialog. Filters: "Buscar orden…", estado and proveedor.
- S2 (Transferencias screen, design 03): an item of its own under INVENTARIO, listing transfers by status, with a route, items, who and when, and "Recibir" per transfer. User comment (cl7r664v): "Estos botones estan fuera de la tabla". The action buttons must stay inside the table or card at every width. "Nueva transferencia" moves several items at once from one bodega to another, shows the stock available in the origin and blocks quantities above it. User comment (ypn4kjxz): "No quiero que sea un modal, ya que van a meter demasiados datos, si le dan click afuera se puede perder todo el progreso que llebaban". It is a full page inside the admin shell, with a draft and a confirmation before leaving with unsaved changes.
- S3 (transfer model): "las transferencia deben quedar en transito hasta que se confirme y se mueve el stock al instante, teniendo en cuenta que debe haber un lugar congelado para que no se cuente en la misma bodega porque ya salio, pero tampoco en la otra bodega porque no se ha aceptado".
  - Sending takes the stock out of the origin at once.
  - The stock then sits in a frozen in-transit place: not available, not usable, and not counted in either bodega.
  - Receiving at the destination adds the received quantity.
  - A shortfall is recorded as merma en tránsito, with a reason.
  - Cancelling before receipt returns the stock to the origin.
  - Statuses: Borrador, En tránsito, Recibida, Recibida con faltante, Anulada.
- S4 (Movimientos, design 02): totals for the filtered range on one line, in place of the "(página)" KPI cards.
  - Rows are grouped by day and show the time only.
  - The type is shown as filter chips and as a chip on each row.
  - The origin of each row is a link to its document: venta/orden, OC, conteo, producción, TR.
  - Export CSV stays.
- S5 (Conteos, design 04): "no entiendo tampoco mucho el proceso de hacer el conteo a inventario o a una bodega especifica quien lo hace, y alguna impresion de todo, algo que sea mas sencillo de entender".
  - A visible flow: Preparar · Contar · Revisar diferencias · Aplicar ajuste.
  - Scope: one bodega, all items or by category.
  - An assigned counter, who may be a non-admin employee, and an approving admin, who must be a different person.
  - Blind counting on a phone: the counter never receives the expected stock.
  - "Recontar" per line, and a required reason for large differences.
  - Applying creates count_adjustment movements.
  - Printable "Hoja de conteo" and "Acta de ajuste" (US Letter).
  - Stock in transit is never counted.

## Tasks

- [x] T1. S1: Compras redesign (web only, existing API). Route: worker. RED: purchasing 10/20 failed (6 new + 4 editor tests behind the Borradores chip). GREEN: 20/20; components/admin+lib+hooks+views 906 passed. Proveedores tab and receive dialog unchanged (API lacks per-supplier month/payable totals). Commit: 7606d9b, PR #187.
- [ ] T2. S3: transfer documents with lines, statuses and the in-transit place (migration, API, availability and counts exclude in-transit stock). Route: worker. Commit: -
- [ ] T3. S2, S3: Transferencias screen, list and new-transfer page (web). Route: worker (after T2). Commit: -
- [ ] T4. S4: Movimientos API additions (range totals, document labels, author names) and redesign. Route: worker. Commit: -
- [ ] T5. S5: Conteos backend (counter and approver roles, statuses, blind read, recount, line reason, in-transit exclusion). Route: worker. Commit: -
- [ ] T6. S5: Conteos screens, mobile counting and printable sheets. Route: worker (after T5). Commit: -

## Log

- L1 (user, 2026-11-12): "Ya que estas terminando esto, necesito que vayas trabajando en paralelo unos nuevos diseños de esto [Image#1] [Image#2] que sean similar a como hicimos produccion, el otro orquestador sabe o ahi tienes los diseños y adicional en temas de inventarios no veo en alguna parte el transferir entre bodegas, por si tengo mas sucursales, etc" (screenshots of Inventario › Compras and Inventario › Movimientos on staging).
- L2 (user, 2026-11-12, design comments on 03): cl7r664v "Estos botones estan fuera de la tabla"; ypn4kjxz "No quiero que sea un modal, ya que van a meter demasiados datos, si le dan click afuera se puede perder todo el progreso que llebaban".
- L3 (user, 2026-11-12): "En este dise;o puedes agregarme el rework del diseño de conteo, ya que no entiendo tampoco mucho el proceso de hacer el conteo a inventario o a una bodega especifica quien lo hace, y alguna impresion de todo, algo que sea mas sencillo de entender".
- L4 (user, 2026-11-12): "sobre tus preguntas, recomiendame el orden, las transferencia deben quedar en transito hasta que se confirme y se mueve el stock al instante, teniendo en cuenta que debe haber un lugar congelado para que no se cuente en la misma bodega porque ya salio, pero tampoco en la otra bodega porque no se ha aceptado".
- L5 (decision, 2026-11-12): recommended order Compras → Transferencias → Movimientos → Conteos. Non-admin employees may count, and an admin approves. User: "Si, esta perfecto. Vamos a la implementacion luego de terminado todo lo demas, o si ya terminamos todo vamos ahora con esta implementacion hasta staging".
- L6 (evidence, 2026-11-12): today POST /inventory/transfer moves one item instantly (FEFO lots, transfer_out/transfer_in movements) and is reachable only from an item's detail sheet (components/admin/stock/StockActionDialog.tsx). Counts are admin-only, single bodega or category, with statuses open/applied/cancelled. The expected stock is hidden only in the UI, there is no counter or approver, and the line `notes` field cannot be written. Movements have referenceType/referenceId but no readable label, and createdBy is an id. Dev migrations end at 0029_z_reports. 0030 is reserved by vipepos-promociones ("Para llevar"), and carta-digital may take the next free one.
- L7 (coordination, 2026-11-12): migration numbers agreed with vipepos-promociones and carta-digital: 0030 takeaway_orders (promociones), 0031 public_carta (carta-digital), inventory transfers take the next free number at merge time (0032 today), always with a journal `when` greater than dev's last. Whoever merges later renumbers.
