# Feature: admin-dashboard-inventario

Branch `feat/admin-dashboard` (from `origin/dev` 7ff88e7) in worktree `../vipe-pos-admin-dashboard`.
Engram mirror: `odd/admin-dashboard-inventario/tasks`. Baseline: `pnpm typecheck` clean, `pnpm test` 75 files / 982 tests green.
Redesign the admin role as a shadcn-style dashboard, remove per-role passwords, add formulas with batch-produced sub-formulas, and add full SKU inventory logistics with its dashboard.

## Specs

- **S1** Admin as dashboard: "Necesito mejorar el diseño de todo el usuario administrativo, esta actualmente como aplicacion, necesito que se piense mas como una dashboard, tipo shadcdn, minimalista, sencilla de usar y de configurar todo"
- **S2** Per-role passwords: "dejaron de aparecer tambien las configuraciones de cambiar contraseña de cada rol, identifica si ya no se necesita y eliminemos esa funcionalidad por completo"
- **S3** Formulas and sub-formulas: "de paso quiero mejorar el como se realiza las formulas de cada producto, debemos poder hacer formulas, subformulas, porque hay formulas que necesitan primero crear una formula y esa se necesita en otra formula de un producto, ejemplo una salsa o un pico de gallo". Decision (L2): "Preparación por lotes con stock propio" — "Se produce un lote (ej. 2 L de salsa): descuenta la materia prima al producir y la venta del plato descuenta de la salsa. Tiene costo por unidad y rendimiento."
- **S4** Interactive formula builder: "tambien necesito que sea interactivo para que no esten escribiendo tanto y se les complique crear formulas de productos, que sea full interactivo y rapido se creativo con eso"
- **S5** Inventory logistics: "necesito mejorar el tema de inventarios, necesito crear toda una logistica completa de inventarios con SKU y tener dashboard bien hecha con respecto a eso". Modules (L2): "Proveedores y órdenes de compra", "Conteo físico y mermas", "Lotes y vencimientos", "Varias bodegas o ubicaciones".
- **S6** Replace old components: "si quieres recrear componentes nuevos hazlo y elimina todo lo viejo y mal hecho"
- **S7** Settings and responsiveness: "Pero si quiero que quede bastante profesional y minimalista la parte de configuraciones, y tambien responsivo en varios dispositivos"

## Design

### S2 finding
Role PINs were removed from `business_config` in P2 (`a1783b2`): the role now comes from the Supabase session.
`useConfigStore.*Password` are always `""`, so `PasswordDialog` compares against an empty string and protects nothing.
Remove `PasswordDialog`, the store password fields and setter, `Profile.hasPassword`, and every reference/test fixture.
`ProfileSelection` selects directly.

### Admin shell (S1, S7)
- shadcn `Sidebar` (`components/ui/sidebar.tsx`), collapsible to icons on desktop, a `Sheet` on mobile. Top bar: sidebar trigger, breadcrumb, `⌘K` command palette (jump to any section/action), theme toggle, profile menu (change profile for admin, sign out).
- Section routing via URL hash (`#inventory/items`), so reload/back keep the section. No Next `useSearchParams`.
- Groups: **General** (Resumen, Órdenes, Mesas, Caja) · **Catálogo** (Menú, Fórmulas) · **Inventario** (Resumen, Artículos, Movimientos, Compras, Producción, Conteos, Bodegas) · **Configuración** (Negocio, Impuestos y propinas, Inventario, Métodos de pago, Domicilios, Personal).
- Shared primitives in `components/admin/shell/` and `components/admin/common/`: `PageHeader` (title, description, actions), `StatCard`, `DataTable` (search, filters, pagination, row→card on mobile), `EmptyState`, `SettingsSection`/`SettingsRow` (label+description left, control right), `SaveBar` (sticky, shows only when dirty).
- Neutral palette, thin borders, no colored card backgrounds; one accent; every page usable at 360 px, 768 px, 1280 px.

### Data model (S3, S5) — migrations `20261019100000_inventory_logistics.sql`, `20261019110000_inventory_rpcs.sql`
Conventions: same as `20261007100000_delivery_schema.sql` — `restaurant_id DEFAULT private.default_restaurant_id()`, RLS through `private.current_restaurant_id()` / `private.current_app_role()`, `public.set_updated_at()` triggers, SECURITY DEFINER RPCs with `search_path = ''`, errors 22023 (bad input) / P0002 (missing or cross-tenant) / 42501 (role) / P0001 (business rule), anon gets nothing.

- `ingredients` (kept as the inventory item table): add `sku` (unique per restaurant, auto `MP-0001` raw / `PR-0001` prep from a row-locked counter table, uppercase `^[A-Z0-9][A-Z0-9-]{1,31}$`), `kind` (`raw`|`prep`, default raw), `barcode`, `max_stock`, `purchase_unit` + `purchase_factor` (1 purchase unit = factor base units), `default_supplier_id`, `track_lots`, `shelf_life_days`, `is_active`; widen `stock`/`min_stock` to numeric(14,3), `cost` to numeric(14,4). `stock` stays the total across locations, written only by the inventory RPCs. Backfill SKUs.
- `inventory_locations` (name, code unique per restaurant, `is_default` — one per restaurant, `is_active`). Seed "Bodega principal" for every restaurant and on restaurant insert.
- `suppliers` (name, tax_id, contact_name, phone, email, lead_time_days, notes, is_active).
- `inventory_lots` (ingredient, location, `lot_code` null, `expires_on` null, quantity numeric(14,3), unit_cost numeric(14,4), received_at). One general lot (null code, null expiry) per item+location; only the general lot may go negative (sale shortage).
- `inventory_movements` ledger: ingredient, location, lot, `movement_type` ∈ opening, purchase, sale, production_consume, production_output, adjustment, waste, transfer_out, transfer_in, count_adjustment; signed non-zero quantity, unit_cost, total_cost, reason, notes, reference_type/reference_id, created_by, created_at.
- `purchase_orders` (per-restaurant `number`, supplier, location, status draft|ordered|partially_received|received|cancelled, expected_on, payment_status pending|paid, notes, ordered_at, received_at) + `purchase_order_lines` (ingredient, quantity and unit_cost in base units, received_quantity).
- `inventory_counts` (per-restaurant `number`, location, status open|applied|cancelled, notes, applied_at) + `inventory_count_lines` (ingredient, expected_quantity snapshot, counted_quantity null).
- `production_batches` (prep ingredient, location, output quantity, lot, unit_cost, expires_on, notes, created_by).
- `recipes`: `dish_id` nullable, add `ingredient_id` (prep output, unique), `yield_quantity` (>0, default 1), `notes`; exactly one of dish_id/ingredient_id; output must be `kind='prep'`. `recipe_ingredients.quantity` → numeric(14,4). Trigger rejects self-reference and cycles (prep A uses prep B uses A).
- `order_items.stock_consumed_at` timestamptz null (idempotent sale consumption).
- Backfill: every ingredient with stock ≠ 0 gets a general lot at the default location and one `opening` movement. Old `ingredient_transactions` / `ingredient_transactions_orders` stay untouched (no new writes); dropping them is a later user decision.
- RLS: `inventory_locations` read by the tenant, written by admin. `suppliers`, `purchase_orders(+lines)`, `inventory_counts(+lines)`, `inventory_movements` admin only. `inventory_lots`, `production_batches` read by admin and kitchen. Lots, movements, batches have no write policy (RPC only). `ingredients`, `recipes`, `recipe_ingredients` writes become admin only (reads stay tenant-wide for the menu stock check).
- RPCs: `inventory_adjust` (opening/adjustment/waste, admin; waste also kitchen), `inventory_transfer` (FEFO, admin), `save_formula` (atomic replace of a dish or prep formula, admin), `receive_purchase_order` (lots + purchase movements + moving weighted-average cost, partial receipts), `open_inventory_count` / `apply_inventory_count` (final balance = counted), `produce_preparation` (consumes the prep formula ×(qty/yield) FEFO, output lot with computed unit cost and expiry = today + shelf_life_days, insufficient stock → P0001 listing shortages; admin, kitchen), `consume_order_stock(order_id)` (reads order_items server-side, skips consumed items, no-op when `inventory_control_enabled` is false, FEFO at the default location, shortage goes negative on the general lot; waiter/cashier/admin/delivery_operator), `check_dishes_stock(items)` (pre-send shortage report), `inventory_overview(days)` (KPIs, daily in/out/waste series, value by category, top consumed, admin).

### Formula builder (S3, S4)
Split view: list of dishes and preparations (status chip: sin fórmula / costo / margen) and an editor.
Add ingredients through a keyboard-first combobox (`/` focuses, typing filters, Enter adds, quantity focuses, Enter returns); quantities accept units (`1.5 kg` into a g item converts); steppers and preset chips per unit.
Typing a name that does not exist offers "Crear preparación «…»", which opens the new preparation nested (breadcrumb `Hamburguesa › Salsa roja`) and, on save, returns to the parent with it added.
Live cost per line, total, per portion, margin, suggested price (`priceSuggestion`); expandable tree of sub-formulas; duplicate a formula from another product; `Ctrl+S` saves, dirty indicator.

## Tasks

| ID | Specs | Task | Route | Commit |
|----|-------|------|-------|--------|
| T1 | S2 | Remove per-role passwords (dialog, store fields, `hasPassword`, tests) | inline | 8e602f7 ✅ |
| T2 | S1, S7 | Admin shell: sidebar, top bar, ⌘K, hash routing, primitives, responsive | worker | c96cee3, 0ce6a99 ✅ |
| T3 | S1, S7 | Settings pages: Negocio, Impuestos y propinas, Inventario, Métodos de pago, Domicilios, Personal | worker | ab09673 ✅ |
| T4 | S3, S5 | DB schema + RPCs + pgTAP for inventory logistics and formulas | worker + verify | 62bdc4a, b4ac2be ✅ |
| T5 | S3–S5 | Regenerate types; pure libs (units, formula costing, inventory math) with tests; services + React Query hooks | worker | e6cd4f2, 013c3bc ✅ |
| T6 | S3, S4 | Formula builder with nested preparations | — | — |
| T7 | S5 | Items catalog (SKU) + item detail (lots, movements) + adjust/waste/transfer + locations | — | — |
| T8 | S5 | Suppliers + purchase orders + receiving | — | — |
| T9 | S3, S5 | Production of preparations | — | — |
| T10 | S5 | Physical counts | — | — |
| T11 | S5 | Inventory dashboard | — | — |
| T12 | S3, S5 | Sale consumption and pre-send check through RPCs (waiter + delivery) | — | — |
| T13 | S1, S7 | Restyle Resumen, Órdenes, Mesas, Caja, Menú inside the shell | worker | see L8 ✅ |
| T14 | S6 | Delete old inventory/recipe/config components, dead admin files, old services; docs | — | — |
| T15 | all | Final verification: typecheck, vitest, pgTAP, build, responsive check | — | — |

## Log

- **L1** (user, 2026-10-19): "Necesito mejorar el diseño de todo el usuario administrativo, esta actualmente como aplicacion, necesito que se piense mas como una dashboard, tipo shadcdn, minimalista, sencilla de usar y de configurar todo, dejaron de aparecer tambien las configuraciones de cambiar contraseña de cada rol, identifica si ya no se necesita y eliminemos esa funcionalidad por completo, de paso quiero mejorar el como se realiza las formulas de cada producto, debemos poder hacer formulas, subformulas, porque hay formulas que necesitan primero crear una formula y esa se necesita en otra formula de un producto, ejemplo una salsa o un pico de gallo, tambien necesito que sea interactivo para que no esten escribiendo tanto y se les complique crear formulas de productos, que sea full interactivo y rapido se creativo con eso, necesito mejorar el tema de inventarios, necesito crear toda una logistica completa de inventarios con SKU y tener dashboard bien hecha con respecto a eso, si quieres recrear componentes nuevos hazlo y elimina todo lo viejo y mal hecho. Pero si quiero que quede bastante profesional y minimalista la parte de configuraciones, y tambien responsivo en varios dispositivos"
- **L2** (user answers, 2026-10-19): sub-formulas → "Preparación por lotes con stock propio (Recomendado)"; inventory modules → "Proveedores y órdenes de compra, Conteo físico y mermas, Lotes y vencimientos, Varias bodegas o ubicaciones".
- **L3** (evidence): main checkout is on an old branch with uncommitted landing work; feature cut from `origin/dev` in a separate worktree to leave it untouched.
- **L4** (evidence): T1 RED `ProfileSelection.test.tsx` (only Mesero selected, others opened the PIN dialog) → GREEN; typecheck clean; 17 affected files / 127 tests green. Workers: T4 `mvfdmk35-1-y6j2`, T2+T3 `mvfdmk39-2-xwvp`, T5 libs `mvfdpf5k-3-hacq`.
- **L5** (evidence): T5 pure libs (worker `mvfdpf5k-3-hacq`) RED 136/136 failing on stubs → GREEN 136/136; parent re-ran `pnpm vitest run lib/inventory` 136 passed; typecheck clean. Committed separately from services/hooks (still pending on T4 signatures).
- **L6** (delivery): slice 1 closed at `9026d18` (plan, T1, T5 pure libs; the libs commit is ~885 lines, ~60% tests, kept whole as one work unit). Later slices: shell+settings, DB layer, services+formula builder, inventory UI, sale consumption, restyle+cleanup. Push/PR remain the user's decision; chained PRs per slice recommended.
- **L7** (evidence): T2+T3 (worker `mvfdmk39-2-xwvp`) RED navigation + settings-draft (module not found) → GREEN 16; component tests shell/⌘K 7, SaveBar 4; AdminView 8 read-gate invariants kept. Parent verified: typecheck clean, `pnpm test` 83 files / 1146 tests green. Known gaps: config LOAD error no longer toasts (save errors do); useIsMobile shows desktop layout for one frame on mobile. Slice 2 closed at `ab09673` (shell + settings). Risk: none (UI only; read gates pinned by AdminView tests).
- **L8** (evidence): T13 (worker `mvfdz2rf-4-6gfd`) no new rule → no RED; existing AdminView/CashRegisterSummary/CompletedOrdersTable/TableManagementPanel/CategoryList suites unchanged and green. Parent verified typecheck clean, 83 files / 1146 tests. Gaps: layouts checked by class names only (browser check in T15); CashRegisterSummary keeps inner tabs pinned by its tests. Slice 3 closed (restyle). Risk: none (markup only).
- **L9** (evidence): T4 worker done (pgTAP 120: 62, 130: 75). Parent: 001 count 40→42, removed dead `waiterService.create/update` (wrote non-existent `profiles.password`), RecipeManager type; added up-front id-ordered ingredient locks in consume_order_stock and receive_purchase_order. pgTAP 15 files / 883 PASS, vitest 1146. Independent verify `mvfehapt-5-pey8`: S3/S5 partial — B1 document write guard always bypassed (SECURITY DEFINER current_user), B2 admin can write ingredients.stock/cost directly, B3 cross-tenant recipe_ingredients insert; should-fix: produce vs consume lock order, save_formula cycle race; note: default location can be unset. Fix round sent to the T4 worker (test-first).
- **L10** (evidence): verifier fix round (worker `mvfemgnr-7-77y3`): B1/B2/B3 closed with SECURITY INVOKER guards that pass only for postgres/service_role/supabase_admin (RPCs are SECURITY DEFINER owned by postgres); recipes/recipe_ingredients RPC-only; produce lock order, save_formula advisory lock, default-location guard. RED 15 new assertions → GREEN. Parent: cascade probe as admin (delete ingredient/dish cascades recipe lines, lots, recipes) OK; db reset + pgTAP 15 files / 902 PASS; typecheck clean; vitest 86 / 1179. T5 services/hooks (worker `mvfehzf6-6-itsi`) RED module-not-found → GREEN 190 in scope. Known breakage until T6/T7/T12 land: old IngredientForm cost update, StockTransactionForm stock update, inventory-control-service.reduceStock, RecipeManager writes (42501). Slice 4 closed at `013c3bc` (DB + services). Risk: items 1 (data backfill, column widening), 2 (RLS/guards), 3 (non-admin writers lose ingredients/recipes writes), 4 (lock ordering).
