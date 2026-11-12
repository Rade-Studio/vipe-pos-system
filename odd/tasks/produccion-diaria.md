# Producción: tabla compacta y producción diaria

Implements the chosen artboard `design/produccion-minimal/04-produccion-diaria.html` ("Tabla compacta + producción diaria") in admin › Inventario › Producción. Branch `feat/produccion-diaria` from `dev` (e2f3130), in the worktree `vipe-pos-system-worktrees/produccion-diaria`.

## Specs

- S1 (L1, L2): the Producción page has three tabs: "Preparaciones (N)", "Registrar producción del día" and "Lotes". It replaces today's grid of large cards and the lots table below them.
- S2 (L2): Preparaciones is a compact table, one row per active preparation:
  - columns: name and code, status (Agotada / Baja / OK from `itemStockStatus`), a stock bar against what can be produced, and the cost per unit;
  - a small "Producir" per row opens the existing quick produce form inline (quantity with ×1/×2/×3, bodega, lote automático, cost preview, ingredient check);
  - a search over all preparations by name or code;
  - filter chips Todas · Agotadas · Bajas · OK with counts; Agotadas and Bajas sort first;
  - a sticky header;
  - a preparation without a formula shows "Sin fórmula" with a link to create it.
- S3 (L2): "Registrar producción del día" registers many preparations at once:
  - **Context bar:** "Fecha · responsable · bodega" with "Cambiar". The fecha is hoy, or ayer for a late report. The responsable is a staff member. The bodega is an active location, defaulting to the default one.
  - **Sheet:** a table of every preparation with a quantity input in its unit. It has the same search and filters. Enter or ↓ moves to the next input.
  - **Per-row validation:** each row shows the max producible at the chosen bodega and turns red when exceeded. A row with a quantity shows its line cost.
  - **Footer:** a sticky footer reads "N preparaciones · costo total $ X · M con ingredientes insuficientes" and has "Revisar y registrar".
  - **Summary dialog:** it lists the lots to create, the total cost, the top ingredients consumed and the warnings, and has "Registrar N lotes". It is blocked while any row exceeds its ingredients, with "Volver y corregir".
  - **Atomic save:** all lots are created in one transaction, or none are (422 with the shortages per preparation).
- S4 (L2): "Llenar cantidades ▾" fills quantities without saving:
  - "Repetir producción de ayer", taken from yesterday's batches;
  - the saved templates;
  - "Guardar como plantilla", which saves the current quantities under a name;
  - "Importar desde reporte (CSV)", with "Descargar plantilla (CSV)": `codigo;preparacion;unidad;cantidad` listing every preparation, read by header name, with empty quantities ignored and unknown codes reported.
- S5 (L2): Lotes tab:
  - search by preparation or lot;
  - a date range (default the last 7 days);
  - a preparation filter and "Vence pronto";
  - rows grouped by day, with the day's lots and cost;
  - columns hora, preparación, cantidad, lote, vence, responsable and total;
  - "Exportar CSV" of the filtered rows.
- S6 (L2, server): production accepts a business date and a responsible person. A batch of "ayer" stores that day:
  - `production_batches` gets `produced_on` (date) and `produced_by` (staff profile). `created_by` stays the caller.
  - The lot's expiry is `produced_on + shelf_life_days`.
  - The batch list filters by `from` / `to` on `produced_on` and by preparation.
  - The production route stays admin-only.

## Tasks

- [x] T1. S3 (save), S4 (template storage), S6: migration 0025, `produce_preparations` (atomic, netted shortages) + `POST /inventory/production/bulk`, `produce_preparation_on` for dated single production, produced_on / produced_by, batches `from`/`to`, production templates CRUD, OpenAPI, lib/api wrappers. Route: worker. Commit: see git log. RED: inventory spec 10 failed, lib 4 failed (pgTAP 360 written after the migration). GREEN: API 59 files / 827; lib 301; test:db 45 / 2087; typecheck, api typecheck, api lint clean. Independent verify: S3-save, S4-storage, S6 PASS (no blockers; backfill checked across timezones, all-or-nothing hashes unchanged after 11 rejections, 24 concurrent opposite-order requests without deadlock).
- [x] T2. S1–S5 UI: tabs, compact table, daily sheet, fill menu, CSV import/template, summary dialog, lots tab. Route: worker (after T1). Commit: see git log. RED: lib modules missing, hooks 6, ProductionPage 16/16. GREEN: production + lib/inventory + hooks/inventory + lib/api/inventory 16 files / 294; typecheck and eslint clean. Max producible per bodega from each ingredient's lots at the chosen bodega (useStockAtLocation), total stock as fallback while loading. Not checked in a browser.

## Log

- L1 (user, 2026-11-11): "Este diseño de produccion no me gusta, siento que ocupa mucho espacio y se puede mejorar, esas preparaciones rapidas, se puede dieseñar de otra forma mas minimalista"; "en esa lista de preparaciones que pasa si hay mas preparaciones, unas 20, se listan las 20?"; "Pasa que no estamos teniendo en cuenta, que hay restaurante que pasan un reporte de lo produccido y deben registrar la produccion diaria masiva, por mas de una preparacion, uno y dos me gustaria esos lotes en un tap separado a las prepaciones para tener un buscador tambien en todas las preparaciones, me gusto el diseño de tabla compacta por accion pero piensa en lo que te dije"; "y como se descarga una plantilla para importar, porque creo que no saben despues como es"
- L2 (user, 2026-11-11): handoff "Implement the design artboard design/produccion-minimal/04-produccion-diaria.html" (Tabla compacta + producción diaria).
- L3 (evidence, 2026-11-11), explorer map of the current module:
  - Today the page is components/admin/production/ProductionPage.tsx: cards, the lots table and a ProduceForm sheet.
  - `POST /api/inventory/production` is admin only and atomic per batch: `produce_preparation` (0000_baseline.sql:2961) checks shortage per location and returns 422 P0001 with a details array.
  - `GET /api/inventory/batches?itemId=&limit=` is newest first and has no date filter.
  - Expiry is `current_date + shelf_life_days`. The lot code is `PB-YYYYMMDD-HH24MISS`. `created_by` is the caller, and there is no backdating.
  - "Se puede producir" and the unit cost are computed client-side (lib/inventory/formula.ts) from total stock, not per location.
  - `min_stock` exists, so "Baja" comes from `itemStockStatus`.
  - Staff come from `GET /api/staff`. There are no templates anywhere.
- L4 (decision, 2026-11-11):
  - The bulk save is all or nothing: a half-registered daily report is worse than a refused one.
  - Templates live in a new table, not business_config: business_config is scalar text up to 255 characters.
  - Max producible is per chosen bodega, because the server checks per location. When several preparations share an ingredient, the summary nets their combined demand before saving, and the server's atomic check is final.
  - Migration numbering: feat/caja-cierres already uses 0025–0026 and is not merged. This branch uses the next free number at PR time with a later journal `when`, because drizzle skips a migration whose `when` is older than the last applied one.
- L5 (evidence, 2026-11-12): T1. pgTAP 130 pins `produce_preparation`'s 5-argument signature and the count of inventory RPCs, so dated single production uses a new `produce_preparation_on` instead of an overload; it keeps the `produce_preparation:` error prefix. The default lot code time now uses the restaurant timezone. When one line's output is another line's ingredient, the netted check ignores the first line's output and may refuse a report that would fit.
- L6 (evidence, 2026-11-12): independent verify of T1, no blockers. Advisories being fixed before the merge: (1) the netted check rounds the summed demand once, while produce_batch rounds each line, so an edge case fails inside produce_batch with flat details instead of the per-line shape; (2) template names ignore case and outer spaces but not inner ones. Kept as is: unknown preparation or bodega answers the generic "Not found" (existing behavior); the migration takes a full-table lock on production_batches (fine at expected size). Migration collision with feat/caja-cierres 0025 (same `when`): renumber at PR time (L4).
- L7 (evidence, 2026-11-12): final checks on feat/produccion-diaria (7d7cd70): web 208 files / 2329 passed, 1 skipped; typecheck 0; lint 0 errors; API 60 files / 830 passed. Not checked in a browser. Before the PR: renumber migration 0025 if feat/caja-cierres merges first (L4).
