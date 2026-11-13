# UX: carta digital (admin + pública) y vista del mesero

Branch `feat/ux-carta-mesero` (worktree `../vipe-pos-system-worktrees/ux-carta-mesero`, from `origin/dev` fe652f3).
Visual/UX pass on four existing surfaces: admin Carta digital settings, public carta `/c/[slug]`, waiter takeaway list, waiter floor plan.

## Specs

- **S1 — Admin "Carta digital" organized in tabs.** User: "la primera es carta digital, tiene una cantidad de cosas que a modo de verticalidad es mucho organizalo por tabs o secciones, porque son muchas cosas".
- **S2 — Public carta responsive.** User: "de paso la carta digital solo tiene diseÑo de mobile, no tiene otros tamaños, debe ser responsive para computador y tablet."
- **S3 — Waiter takeaway orders in a list.** User: "y en el mesero, las cosas para llevar estan horrible se van acomulando arriba coloco en alguna lista o algo, ahi se ve muy feo y comienza a manchar todo el diseño".
- **S4 — Carta notifications shown on the table in the floor layout.** User: "lo de la carta cuando comienzan a llegar notificaciones, deberias colocar tambien la alerta en el layout de la mesa".
- **S5 — Table states must not overlap.** User: "cuando las mesas estan juntas los estados se suporponen, puedes crearte algo para que no se superpongan  o no es necessario mencionar el estado, ni el tiempo, ya que de alguna manera con los colores se puede entender y si entramos ya vemos el estado. Entonces siento que no es tan necesario eso a menos que encuentres una forma mas comoda de mostrarlo sin que se superpongan".
- **S6 — Waiter view usable on mobile and tablet.** User: "necesito mejorar estas visuales para mobile, tratar que los layout aunque se crean sean responsivos para que sean utiles en tablet y mobiles".

## Tasks

- [x] T1 — S1 — worker A — admin carta tabs (`components/admin/carta/**`) — commit: 55a94aa
- [x] T2 — S2 — worker B — public carta responsive md/lg (`components/carta/**`, `app/c/**`) — commit: 1cb4541
- [x] T3 — S3, S6 — worker C — takeaway list sheet + waiter header/toolbar on mobile (`WaiterView.tsx`, `components/layout/Header*`, `components/takeaway/**`) — commit: "feat(waiter): takeaway orders in a sheet…" (this commit)
- [x] T4 — S4, S5, S6 — worker D — floor: no overlapping pills, legend, carta alert per table (`components/floor/**`, `lib/floor/**`, `components/carta-inbox/**`, `components/pos/TablesSection.tsx`) — commit: 063a0bf
- [x] T5 — all — parent — typecheck, full vitest, lint; risk line — evidence: tsc exit 0; vitest 264 files, 2929 passed / 1 skipped; eslint 0 errors (12 pre-existing warnings)

## Log

- **L1 (user request, verbatim):** "Necesito mejorar varias visuales que esteticamente y UX de usuario estan mal, la primera es carta digital, tiene una cantidad de cosas que a modo de verticalidad es mucho [Image#1] organizalo por tabs o secciones, porque son muchas cosas, de paso la carta digital solo tiene diseÑo de mobile, no tiene otros tamaños, debe ser responsive para computador y tablet. y en el mesero, las cosas para llevar estan horrible [Image#2] se van acomulando arriba coloco en alguna lista o algo, ahi se ve muy feo y comienza a manchar todo el diseño, lo de la carta cuando comienzan a llegar notificaciones, deberias colocar tambien la alerta en el layout de la mesa, de paso, cuando las mesas estan juntas los estados se suporponen, puedes crearte algo para que no se superpongan  o no es necessario mencionar el estado, ni el tiempo, ya que de alguna manera con los colores se puede entender y si entramos ya vemos el estado. Entonces siento que no es tan necesario eso a menos que encuentres una forma mas comoda de mostrarlo sin que se superpongan, [Image#3] necesito mejorar estas visuales para mobile, tratar que los layout aunque se crean sean responsivos para que sean utiles en tablet y mobiles [Image#4]"
- **L2 (screenshots, described):** Image#1 admin Carta digital: 8 numbered stacked cards (Publicación, Identidad, Redes y contacto, Horarios y franjas, Pedidos, Platos y etiquetas, Idiomas, QR de las mesas) under anchor chips, live phone preview on the right. Image#2 waiter desktop: chips "Para llevar · Mauricio Téllez En cocina $230.040" piled above the zone tabs; status pills under tables 1–3 ("En cocina · 8 h 2…") overlap. Image#3 waiter on iPhone 16 (393px): header buttons cut off ("Salir"), takeaway chips stacked full width, pills unreadable and overlapping. Image#4 public carta on desktop: single 480px column centered with a bottom tab bar.
- **L3 (decisions, parent):**
  - S1: page-level tabs grouping the 8 cards into 5 tabs — "Publicación" (Publicación + Idiomas), "Marca" (Identidad + Redes y contacto), "Horarios" (Horarios y franjas), "Pedidos y platos" (Pedidos + Platos y etiquetas), "QR" (QR de las mesas). All panels stay mounted (toggle `hidden`) so unsaved edits (global draft, dish drafts, DaypartsEditor local state) survive switching; the shared SaveBar and live preview stay outside the tabs. Pattern: `components/admin/production/ProductionPage.tsx` tablist (roving tabindex, arrows/Home/End).
  - S2: mobile unchanged; md (tablet) widens content and lays dishes in a 2-column card grid, sheets become centered dialogs; lg (desktop) adds a sticky vertical category nav and 3-column grid at xl; the bottom tab bar stays in the DOM (tests) but floats centered and compact on md+.
  - S3: the takeaway chips leave the floor. The "Para llevar" toolbar button shows a count badge and opens a side sheet listing active takeaway orders (name, status, total, tap opens the flow) with "Nuevo pedido para llevar" at the top — same pattern as the Carta inbox button.
  - S5: the floor no longer prints status/elapsed pills under tables (state = table colour; full text stays in the accessible name and in the table panel). A compact colour legend under the floor removes colour-only ambiguity. The ≥12 h old-order warning stays as an icon-only badge on the table.
  - S4: each table with pending carta inbox items (proposal / bill / waiter call) gets an attention badge on its top-right corner (pulsing, icon by kind), added to its accessible name; matched by zone + table number (inbox has no tableId). Waiter floor only.
- **L4 (evidence, parent):** T4 removed the floor pill, so WaiterView T22 "draws the minutes since the open order started on its table" now asserts the time only in the accessible name (committed with 063a0bf). Inbox matching is zone name + number because `Table` exposes no open orderId. No browser/visual check was run; breakpoints and badge look remain to be verified by eye.
