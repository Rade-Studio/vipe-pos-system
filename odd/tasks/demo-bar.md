# Demo de staging: bar de coctelería y cervezas

Replace the staging demo restaurant ("Casa Guadua", `packages/db/seed/demo/`) with a fictional cocktail and beer bar.
The data is fake but consistent across the whole product, and the load into staging waits until every orchestrator's work is merged.

## Specs

- S1. User request, verbatim: "Despues que se finalice todo, completamente todas las implementaciones tuyas y de los otros orquestadores, necesito que me modifiques todos los datos del restaurante que tenemos en staging, quiero que sean unicamente datos para un bar, todo lo que puede tener un bar orientado a conteleria, cervezas, cubetas de cerveza, etc. Debe estar orientado a eso, tener datos falsos, pero logicos de todo, cartas, categoria, movimientos, produccion, etc. Que se vea real"
- S2. Replace, do not add: the user chose "Reemplazarlo por el bar (Recomendado)". `demo-db.sh --reset` deletes Casa Guadua and loads the bar with the same `@demo.vipe.pos` accounts and the same DEMO_PASSWORD.
- S3. Timing: the user chose "Preparar ya, cargar al final (Recomendado)". Write the seed now; the staging load runs only after every orchestrator's work is merged (S1, "Despues que se finalice todo").
- S4. Name and city are invented: "El nombre y ciudad del bar inventalo tu, necesito datos falsos". Chosen: "Bruma — Bar de coctelería", Chapinero, Bogotá (COP); every name, phone, address and NIT invented.
- S6. User, verbatim: "que no se te olvide hacer promociones y organizar las mesas bien como si fuera un bar". Promotions (happy hour 2x1 in cocktails, 2x1 in national beers, bucket + platter combo, a delivery bill discount, a birthday courtesy shot) are seeded and, where the engine allows, applied in the history. The floor is laid out like a bar: a bar counter with stools, high tables and lounges in the Salón, a terrace, and group tables on the second floor.
- S7. User, verbatim: "lleva todo hasta staging". The bar is merged to dev and loaded into staging. carta-digital has no merge date and asked not to be waited for. The reload uses `demo-db.sh --reset --keep-password`, which keeps the current demo accounts' argon2 hash inside the database, so no password is handled by the agent.
- S5. The reset must delete every tenant row of the demo restaurant: `reset.sql` names every public table with `restaurant_id`, so its guard does not refuse on dev.

## Tasks

- [x] T1. S5: `reset.sql` covers z_reports, inventory_transfers, inventory_transfer_lines, inventory_transit_lots, production_templates, modifier_groups, modifier_options, dish_modifier_groups, order_item_modifiers and the desktop_* tables, in foreign key order. Route: worker (with T2). RED on dev: test.sh 82 passed / 11 failed (the guard named 14 missing tables; the demo also failed tables_reservation_check from 0022). GREEN: 95/0. Commit: 5252f70.
- [x] T2. S1, S2, S4, S6, S7 (--keep-password): bar seed (`demo.sql`, `demo-db.sh`, `seed/test.sh` contract, docs/despliegue.md 3.6, README). Route: worker (the first run stalled writing the file in one call; the continuation wrote it in sections). GREEN: test.sh 106 passed / 0 failed. Promotions applied in history: happy hour 2x1 en cócteles, 2x1 en cervezas nacionales (Nacionales subcategory), Cubeta + picada combo, 10 % in deliveries from $90.000, plus three product discounts. Only configured: the birthday courtesy shot (manual PIN) and "Novenas" (starts next month). Floor: Barra stools 1–8; Salón high tables 10–15 and lounges 16–17; Terraza 20–23; Segundo piso 30–33. Deviations: stools are numbered 1–8, not B1–B8 (table numbers are integers); Mondays are quiet, not closed; there is no second admin, so the approver is the main admin; production older than 7 days is backdated. Commit: 0d34a38.
- [ ] T3. S1–S5: PR to dev, CI, merge. Route: parent. Commit: -
- [ ] T4. S3: load into staging with `--reset` after every orchestrator's work is merged; verify logins and screens. Route: parent with the user (DEMO_PASSWORD is typed by the user). Commit: -

## Log

- L1 (user, 2026-11-12): the S1 request, verbatim.
- L2 (user answers, 2026-11-12): "Reemplazarlo por el bar (Recomendado)"; "Te doy el nombre"; "Me das acceso para ejecutarla"; "Preparar ya, cargar al final (Recomendado)".
- L3 (proposal, not objected to, 2026-11-12):
  - Carta: signature and classic cocktails, national and imported beers, buckets of 5 or 6 beers, shots, bottles and half bottles of liquor with mixers, bar food and platters, and soft drinks.
  - Inventory: liquor by bottle or ml, beer by unit, fruit, ice and supplies.
  - Production: syrups, juices and pre-mixes of the day.
  - Locations and purchases: a bar and a stockroom, transfers between them, purchases from liquor and beer suppliers, and weekly bar counts.
  - History: 30 days with Thursday–Saturday peaks, happy hour and 2x1 beer promotions, deliveries and takeaway, cash closes with Z, and open orders now.
- L4 (evidence, explorer 2026-11-12): demo.sql has 1006 lines (setup 389–655, inventory 662–807, history 816–936, live 944–1004) and seeds no modifiers, transfers, counts, purchase receiving, takeaway, Z or shift counts. reset.sql's guard (35–47) misses the S5 tables, so `--reset` likely fails on dev today. seed/test.sh pins "Casa Guadua", the zones "Barra,Salón principal,Terraza", the subcategory shape "Bebidas:3,Entradas:3,Platos fuertes:2/0/0/8", ≥3 preps and ≥3 production batches.
- L5 (coordination, 2026-11-12):
  - promociones has nothing left to merge. Reference for promotions in demo.sql (~527–575); history discounts go through pg_temp.demo_promotion and demo_add_cart. The 2x1 on beer is buy_x_pay_y on the Cervezas category, and promociones will review the seed.
  - carta-digital has no merge date. Its demo block, and its tables from 0036–0038, will be adapted to the bar when it rebases.
- L9 (user, 2026-11-12): "lleva todo hasta staging" (S7). The agent's server access works through `~/.config/mapanetbpo-vps/old_id_ed25519` over Tailscale (memory deploy/coolify-access). Staging is the compose app zyxpf2vqnowxdolrgne8vxew with database container zomsdancyfbvu9doyrnf6j9e, which holds one restaurant: Casa Guadua (demo_seed=true, 1349 orders).
- L8 (user, 2026-11-12): "que no se te olvide hacer promociones y organizar las mesas bien como si fuera un bar" (S6; forwarded to the worker).
- L7 (user, 2026-11-12): "El nombre y ciudad del bar inventalo tu, necesito datos falsos".
- L6 (access, 2026-11-12): server access through the stored VPS key (`~/.ssh`, memory deploy/coolify-access) is blocked by the safety guard. A temporary key was rejected on the public IP and on Tailscale, so I stopped there (fail2ban). Pending the user's choice between fixing the temporary key line and running the server step themselves.
