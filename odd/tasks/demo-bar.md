# Demo de staging: bar de coctelería y cervezas

Replace the staging demo restaurant ("Casa Guadua", `packages/db/seed/demo/`) with a fictional cocktail and beer bar.
The data is fake but consistent across the whole product, and the load into staging waits until every orchestrator's work is merged.

## Specs

- S1. User request, verbatim: "Despues que se finalice todo, completamente todas las implementaciones tuyas y de los otros orquestadores, necesito que me modifiques todos los datos del restaurante que tenemos en staging, quiero que sean unicamente datos para un bar, todo lo que puede tener un bar orientado a conteleria, cervezas, cubetas de cerveza, etc. Debe estar orientado a eso, tener datos falsos, pero logicos de todo, cartas, categoria, movimientos, produccion, etc. Que se vea real"
- S2. Replace, do not add: the user chose "Reemplazarlo por el bar (Recomendado)". `demo-db.sh --reset` deletes Casa Guadua and loads the bar with the same `@demo.vipe.pos` accounts and the same DEMO_PASSWORD.
- S3. Timing: the user chose "Preparar ya, cargar al final (Recomendado)". Write the seed now; the staging load runs only after every orchestrator's work is merged (S1, "Despues que se finalice todo").
- S4. Name and city are invented: "El nombre y ciudad del bar inventalo tu, necesito datos falsos". Chosen: "Bruma — Bar de coctelería", Chapinero, Bogotá (COP); every name, phone, address and NIT invented.
- S5. The reset must delete every tenant row of the demo restaurant: `reset.sql` names every public table with `restaurant_id`, so its guard does not refuse on dev.

## Tasks

- [ ] T1. S5: `reset.sql` covers z_reports, inventory_transfers, inventory_transfer_lines, inventory_transit_lots, production_templates, modifier_groups, modifier_options, dish_modifier_groups, order_item_modifiers and the desktop_* tables, in foreign key order. Route: worker (with T2). Commit: -
- [ ] T2. S1, S2: bar seed (`demo.sql`, `demo-db.sh`, `seed/test.sh` contract, docs/despliegue.md 3.6, README). Route: worker. Commit: -
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
- L7 (user, 2026-11-12): "El nombre y ciudad del bar inventalo tu, necesito datos falsos".
- L6 (access, 2026-11-12): server access through the stored VPS key (`~/.ssh`, memory deploy/coolify-access) is blocked by the safety guard. A temporary key was rejected on the public IP and on Tailscale, so I stopped there (fail2ban). Pending the user's choice between fixing the temporary key line and running the server step themselves.
