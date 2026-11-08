# Menú: platos y promociones

Redesign the dish list and the dish create/edit dialog in Admin → Menú (the last admin screens without a design rework), and move promotions to their own section.
Branch `feat/menu-platos` from `dev` after #159. UI copy in Spanish, code and docs in English. Designs first (design/menu-platos/), chosen on the canvas.

## Specs

- S1. "Lo que si podemos arreglar en seguida es esto ... esa informacion aparece en menu y modificaciones y de eso se ve feo": the "Todos los platos" table and the "Promociones y descuentos" table must not show under both Menú tabs (Categorías y platos, Modificadores); each piece belongs to one place.
- S2. "es lo unico que no le hemos hecho absolutamente ningun rework de diseño, ni al modal de editar, crear nuevo plato ... ahora mismo quiero el diseño de menu bien en esa seccion": the dish list and the dish create/edit dialog get a design rework (designed first, chosen by the user), in the style of the rest of the redesigned admin.
- S3. "Temas de promociones deberian tener su propia seccion para configurar, pero solo separemos": promotions move to their own admin section with the same behaviour they have today (no new promotion features now).
- S4. "y despues creamos un plan para identificar los problemas o mejoras que toca hacer con las promociones": a separate promotions review is planned later; not part of this feature.
- S5. Light and dark at 390/768/1024/1440, no overflow, targets ≥ 44 px (phase rule S6); nothing invented beyond what the API returns.

## Tasks

- [ ] T0. Designs for the Menú page layout, dish list and dish dialog (S1, S2, S5). Route: design worker; the user chooses on the canvas. Commit: none (design/ is not committed).
- [x] T1. Promotions as their own section, Catálogo → Promociones, same UI moved out of Menú (S1, S3, S5). Route: worker. Commit: pending. Evidence: section `promotions` (Catálogo, after Menú, BadgePercent icon) renders `PromotionsPage` = PageHeader + unchanged `PromotionList`; removed from MenuPage; RED 4 failing → GREEN; `vitest run components/admin lib/admin` 46 files / 424 tests pass, typecheck and lint clean; /tmp/promo-qa 390x844 + 1440x900 light/dark overflow=0.
- [ ] T2. Build the chosen Menú design: page layout, dish list, dish dialog (S1, S2, S5). Route: worker. Commit: pending.

## Log

- L1 (user, 2026-11-07, with two screenshots of Admin → Menú: the "Todos los platos" table with Fórmula/edit/delete buttons and pagination, and "Promociones y descuentos" below it): "Lo que si podemos arreglar en seguida es esto esa informacion aparece en menu y modificaciones y de eso se ve feo, es lo unico que no le hemos hecho absolutamente ningun rework de diseño, ni al modal de editar, crear nuevo plato. Temas de promociones deberian tener su propia seccion para configurar, pero solo separemos y despues creamos un plan para identificar los problemas o mejoras que toca hacer con las promociones, ahora mismo quiero el diseño de menu bien en esa seccion".
- L2 (decision, 2026-11-07): the user lifted the pause for this item only ("Lo que si podemos arreglar en seguida"); F5c and F8+ stay paused. T1 needs no design (the existing promotions UI moves unchanged to a new nav entry); T0 and T2 follow the designs-first rule.
- L3 (worker, 2026-11-07): T1 built. New `components/admin/admin-pages/PromotionsPage.tsx`; nav entry `promotions` "Promociones" after Menú; Menú description now "Categorías, platos y modificadores."; PromotionList unmounted from MenuPage. Tests: navigation, AdminView (section renders PromotionList), MenuPage (no promotions block). Open point for the user: the moved list keeps its own "Promociones y descuentos" sub-header under the new page header (kept unchanged per S3).
- L4 (decision, 2026-11-07): on the new Promociones page the list repeated the page header ("Promociones y descuentos" with the same description), so the list keeps only its "Nueva Promoción" action, right-aligned, 44 px. Behaviour and API calls are unchanged.
