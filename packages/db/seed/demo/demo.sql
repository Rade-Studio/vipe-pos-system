-- Demo data for the public staging demo (odd/tasks/migracion-backend-nestjs.md,
-- T16, S6): one fictional Colombian restaurant with staff for every role, a
-- menu, tables, inventory, 30 days of history and live activity right now.
-- Every name, phone, address and NIT is invented.
--
-- Run by demo-db.sh as the superuser, in the same transaction and right after
-- seed/bootstrap/create-restaurant.sql, which created the restaurant and its
-- admin and left the id in the setting vipe.restaurant_id. psql variable:
--   demo_hash  argon2id hash of DEMO_PASSWORD, for every staff account
--
-- The data goes through the same functions the API calls, run as the staff
-- member who does it in the app (app.user_id, as the API sets it per request):
-- private.create_staff_user, inventory_adjust, save_formula, the order insert
-- of OrdersService followed by recompute_caller_order_bill and
-- consume_order_stock, create_delivery_order, set_delivery_status, pay_order
-- and close_register. Their timestamps are now(), so the history rows are
-- backdated afterwards (the superuser passes the immutability guards for that
-- UPDATE only; no trigger or constraint is disabled). No print job is queued.
--
-- Random choices use setseed, so a run on the same day gives the same shape.

SET LOCAL vipe.demo_hash = :'demo_hash';

-- ---------------------------------------------------------------------------
-- Working tables
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE demo_staff (role text, profile_id uuid, seq integer) ON COMMIT DROP;
CREATE TEMP TABLE demo_menu (dish_id uuid, grp text, weight numeric) ON COMMIT DROP;
CREATE TEMP TABLE demo_cart (dish_id uuid, quantity integer, comments text) ON COMMIT DROP;
CREATE TEMP TABLE demo_methods (code text, id uuid) ON COMMIT DROP;
CREATE TEMP TABLE demo_couriers (id uuid) ON COMMIT DROP;
CREATE TEMP TABLE demo_customers (
  phone text PRIMARY KEY, name text, address_line text, neighborhood text, reference text,
  weight numeric, customer_id uuid, address_id uuid
) ON COMMIT DROP;
CREATE TEMP TABLE demo_tables (number integer, id uuid) ON COMMIT DROP;
CREATE TEMP TABLE demo_od (LIKE public.order_deliveries) ON COMMIT DROP;

-- First profile of a role (demo_staff.seq = 1), or the n-th.
CREATE FUNCTION pg_temp.demo_profile(p_role text, p_seq integer DEFAULT 1) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT profile_id FROM demo_staff WHERE role = p_role AND seq = p_seq
$$;

-- ---------------------------------------------------------------------------
-- Helpers (session temp schema, gone when psql exits)
-- ---------------------------------------------------------------------------

-- Act as one staff member, as the API does with SET LOCAL app.user_id.
CREATE FUNCTION pg_temp.demo_as(p_profile uuid) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('app.user_id', (SELECT p.user_id::text FROM public.profiles p WHERE p.id = p_profile), true)
$$;

-- Local wall-clock time of the restaurant to timestamptz.
CREATE FUNCTION pg_temp.demo_at(p_day date, p_time interval) RETURNS timestamptz
LANGUAGE sql STABLE AS $$
  SELECT ((p_day + p_time)::timestamp AT TIME ZONE 'America/Bogota')
$$;

-- Catalog price at p_at with the best active promotion applied, the rule of
-- apps/api/src/catalog/promotion-pricing.ts (percentage rounds, fixed caps).
CREATE FUNCTION pg_temp.demo_price(p_dish uuid, p_at timestamptz) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT d.price - coalesce(max(CASE WHEN p.id IS NULL THEN 0
                                     WHEN p.discount_type = 'percentage'
                                     THEN round(d.price * p.discount_value / 100)
                                     ELSE least(d.price, p.discount_value) END), 0)
    FROM public.dishes d
    LEFT JOIN public.promotion_dishes pd ON pd.dish_id = d.id
    LEFT JOIN public.promotions p ON p.id = pd.promotion_id AND p.active
                                 AND p.start_date <= p_at AND p.end_date >= p_at
   WHERE d.id = p_dish
   GROUP BY d.price
$$;

-- Weighted random dish of one menu group (exponential race on the weights).
CREATE FUNCTION pg_temp.demo_pick(p_group text) RETURNS uuid
LANGUAGE sql VOLATILE AS $$
  SELECT m.dish_id FROM demo_menu m WHERE m.grp = p_group
   ORDER BY -ln(1 - random()) / m.weight LIMIT 1
$$;

-- Random time between two local hours, peaking in the middle.
CREATE FUNCTION pg_temp.demo_slot(p_from numeric, p_to numeric) RETURNS interval
LANGUAGE sql VOLATILE AS $$
  SELECT make_interval(secs => ((p_from + (p_to - p_from) * (random() + random()) / 2) * 3600)::integer)
$$;

-- The guests' cart for one dine-in order: a main and maybe a drink each,
-- shared starters, some desserts. Fills demo_cart (dish_id, quantity, comments).
CREATE FUNCTION pg_temp.demo_fill_cart(p_meal text, p_party integer) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_main text;
  v_r numeric;
  i integer;
BEGIN
  TRUNCATE demo_cart;
  FOR i IN 1..p_party LOOP
    v_r := random();
    IF p_meal = 'lunch' THEN
      v_main := CASE WHEN v_r < 0.50 THEN 'almuerzo' WHEN v_r < 0.65 THEN 'sopa'
                     WHEN v_r < 0.88 THEN 'fuerte' ELSE 'mar' END;
    ELSIF p_meal = 'dinner' THEN
      v_main := CASE WHEN v_r < 0.45 THEN 'fuerte' WHEN v_r < 0.70 THEN 'mar'
                     WHEN v_r < 0.80 THEN 'sopa' ELSE 'entrada' END;
    ELSE
      v_main := CASE WHEN v_r < 0.45 THEN 'entrada' WHEN v_r < 0.75 THEN 'postre' ELSE 'sopa' END;
    END IF;
    INSERT INTO demo_cart VALUES (pg_temp.demo_pick(v_main), 1,
      CASE WHEN random() < 0.10 THEN (ARRAY['Sin cebolla', 'Término medio', 'Salsa aparte', 'Sin picante',
                                            'Bien asado', 'Sin cilantro'])[1 + floor(random() * 6)::int] END);
    v_r := random();
    IF p_meal = 'dinner' AND v_r < 0.40 THEN
      INSERT INTO demo_cart VALUES (pg_temp.demo_pick('coctel'), 1, NULL);
    ELSIF v_r < (CASE p_meal WHEN 'afternoon' THEN 0.90 ELSE 0.85 END) THEN
      INSERT INTO demo_cart VALUES (pg_temp.demo_pick('bebida'), 1,
        CASE WHEN random() < 0.08 THEN 'Sin hielo' END);
    END IF;
    IF random() < (CASE p_meal WHEN 'dinner' THEN 0.25 ELSE 0.15 END) THEN
      INSERT INTO demo_cart VALUES (pg_temp.demo_pick('postre'), 1, NULL);
    END IF;
  END LOOP;
  IF p_meal <> 'afternoon' AND random() < (CASE p_meal WHEN 'dinner' THEN 0.50 ELSE 0.30 END) THEN
    INSERT INTO demo_cart VALUES (pg_temp.demo_pick('entrada'), greatest(1, p_party / 3), NULL);
  END IF;
END;
$$;

-- Adds demo_cart to an order as OrdersService.create / addItems do: catalog
-- name and price (promotions at p_at), items in kitchen, then the bill from
-- recompute_caller_order_bill and the stock from consume_order_stock.
CREATE FUNCTION pg_temp.demo_add_cart(p_order uuid, p_at timestamptz) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.order_items (order_id, dish_id, name, price, quantity, comments, status, added_at, restaurant_id)
  SELECT p_order, d.id, d.name, pg_temp.demo_price(d.id, p_at), c.quantity, CASE WHEN d.allow_comments THEN c.comments END,
         'kitchen', now() + (row_number() OVER ()) * interval '1 microsecond', d.restaurant_id
    FROM (SELECT dish_id, sum(quantity)::integer AS quantity, max(comments) AS comments
            FROM demo_cart GROUP BY dish_id) c
    JOIN public.dishes d ON d.id = c.dish_id;
  PERFORM private.recompute_caller_order_bill(p_order);
  PERFORM public.consume_order_stock(p_order);
END;
$$;

-- A dine-in order sent to the kitchen by a waiter (OrdersService.create).
CREATE FUNCTION pg_temp.demo_open_order(p_waiter uuid, p_table uuid, p_meal text, p_party integer, p_at timestamptz)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_order uuid;
BEGIN
  PERFORM pg_temp.demo_as(p_waiter);
  PERFORM pg_temp.demo_fill_cart(p_meal, p_party);
  INSERT INTO public.orders (table_id, waiter_id, status, order_type, subtotal, tax, tax_percentage, tip, tip_percentage, total)
  VALUES (p_table, p_waiter, 'kitchen', 'dine_in', 0, 0, 8, 0, 10, 0)
  RETURNING id INTO v_order;
  PERFORM pg_temp.demo_add_cart(v_order, p_at);
  UPDATE public.tables SET status = 'kitchen', waiter_id = coalesce(waiter_id, p_waiter), updated_at = now()
   WHERE id = p_table;
  RETURN v_order;
END;
$$;

-- Every item served: the order is delivered and its table served (serveItems).
CREATE FUNCTION pg_temp.demo_serve(p_order uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.order_items SET status = 'served', updated_at = now() WHERE order_id = p_order AND status = 'kitchen';
  UPDATE public.orders SET status = 'delivered', updated_at = now() WHERE id = p_order;
  UPDATE public.tables t SET status = 'served', updated_at = now()
    FROM public.orders o WHERE o.id = p_order AND t.id = o.table_id;
END;
$$;

-- Tenders for a bill: mostly one method, sometimes cash plus Nequi.
CREATE FUNCTION pg_temp.demo_tenders(p_total bigint, p_dine_in boolean) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_r numeric := random();
  v_cash bigint;
  v_half bigint;
  v_method text;
BEGIN
  IF v_r < 0.08 AND p_total > 40000 THEN
    v_half := (p_total / 2 / 1000) * 1000;
    v_cash := ceil(v_half / 10000.0) * 10000;
    RETURN jsonb_build_array(
      jsonb_build_object('payment_method_id', (SELECT id FROM demo_methods WHERE code = 'cash'),
                         'amount', v_half, 'cash_received', v_cash),
      jsonb_build_object('payment_method_id', (SELECT id FROM demo_methods WHERE code = 'nequi'),
                         'amount', p_total - v_half));
  END IF;
  v_method := CASE WHEN v_r < 0.42 THEN 'cash' WHEN v_r < 0.66 THEN 'bancolombia'
                   WHEN v_r < 0.88 THEN 'nequi' ELSE 'transfer' END;
  IF v_method = 'cash' THEN
    v_cash := CASE WHEN random() < 0.2 THEN p_total
                   WHEN random() < 0.5 THEN ceil(p_total / 10000.0) * 10000
                   ELSE ceil(p_total / 50000.0) * 50000 END;
    RETURN jsonb_build_array(jsonb_build_object(
      'payment_method_id', (SELECT id FROM demo_methods WHERE code = 'cash'),
      'amount', p_total, 'cash_received', v_cash));
  END IF;
  RETURN jsonb_build_array(jsonb_build_object(
    'payment_method_id', (SELECT id FROM demo_methods WHERE code = v_method), 'amount', p_total));
END;
$$;

-- pay_order as p_cashier, with the bill pay_order itself computes (food
-- subtotal + tax + delivery fee) and, for most tables, the suggested 10% tip.
CREATE FUNCTION pg_temp.demo_pay(p_cashier uuid, p_order uuid, p_register uuid, p_tenders jsonb DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_o public.orders%ROWTYPE;
  v_due bigint;
  v_tip bigint := 0;
BEGIN
  SELECT * INTO v_o FROM public.orders WHERE id = p_order;
  v_due := v_o.subtotal::bigint + round(v_o.subtotal * v_o.tax_percentage / 100)::bigint
         + coalesce((SELECT od.delivery_fee FROM public.order_deliveries od WHERE od.order_id = p_order), 0);
  IF v_o.order_type = 'dine_in' AND random() < 0.78 THEN
    v_tip := round(v_o.subtotal * 0.10)::bigint;
  END IF;
  PERFORM pg_temp.demo_as(p_cashier);
  PERFORM public.pay_order(p_order, p_register, v_tip,
                           coalesce(p_tenders, pg_temp.demo_tenders(v_due + v_tip, v_o.order_type = 'dine_in')),
                           gen_random_uuid());
END;
$$;

-- Moves an order's rows to its real times: taken at p_at, closed at p_closed.
CREATE FUNCTION pg_temp.demo_backdate(p_order uuid, p_at timestamptz, p_closed timestamptz) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.orders SET created_at = p_at, updated_at = p_closed WHERE id = p_order;
  UPDATE public.order_items
     SET created_at = p_at + (added_at - now()), added_at = p_at + (added_at - now()),
         updated_at = CASE WHEN status = 'served' THEN p_at + interval '18 minutes' ELSE p_at END,
         stock_consumed_at = CASE WHEN stock_consumed_at IS NOT NULL THEN p_at END
   WHERE order_id = p_order AND added_at >= now();
  UPDATE public.payments SET created_at = p_closed WHERE order_id = p_order;
END;
$$;

-- A delivery taken by the operator (create_delivery_order), prepared by the
-- kitchen and dispatched, delivered and collected by the operator
-- (set_delivery_status, pay_order). p_stage stops it early for live orders:
-- received | preparing | ready | out_for_delivery | delivered | cancelled | retried.
CREATE FUNCTION pg_temp.demo_delivery(p_stage text, p_at timestamptz, p_register uuid) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_c demo_customers%ROWTYPE;
  v_items jsonb;
  v_result jsonb;
  v_order uuid;
  v_courier uuid := (SELECT id FROM demo_couriers ORDER BY random() LIMIT 1);
  v_prepaid boolean := random() < 0.40;
  v_fee bigint := (SELECT CASE WHEN random() < 0.75 THEN 5000 ELSE 7000 END);
  v_estimate bigint;
  v_change bigint;
  v_due bigint;
  v_method text;
  v_meal text := CASE WHEN extract(hour FROM p_at AT TIME ZONE 'America/Bogota') < 16 THEN 'lunch' ELSE 'dinner' END;
BEGIN
  SELECT * INTO v_c FROM demo_customers ORDER BY -ln(1 - random()) / weight LIMIT 1;
  PERFORM pg_temp.demo_fill_cart(v_meal, 1 + floor(random() * 3)::int);
  SELECT jsonb_agg(jsonb_build_object('dish_id', dish_id, 'quantity', quantity)) INTO v_items
    FROM (SELECT dish_id, sum(quantity)::integer AS quantity FROM demo_cart GROUP BY dish_id) c;
  SELECT sum(d.price * c.quantity)::bigint INTO v_estimate FROM demo_cart c JOIN public.dishes d ON d.id = c.dish_id;
  v_change := CASE WHEN v_prepaid OR random() < 0.3 THEN NULL
                   ELSE ceil((v_estimate * 1.08 + v_fee) / 50000.0) * 50000 END;

  PERFORM pg_temp.demo_as(pg_temp.demo_profile('delivery_operator'));
  v_result := public.create_delivery_order(
    CASE WHEN v_c.customer_id IS NULL THEN jsonb_build_object('phone', v_c.phone, 'name', v_c.name)
         ELSE jsonb_build_object('id', v_c.customer_id) END,
    CASE WHEN v_c.address_id IS NULL
         THEN jsonb_build_object('address_line', v_c.address_line, 'neighborhood', v_c.neighborhood,
                                 'reference', v_c.reference, 'label', 'Casa', 'save', true)
         ELSE jsonb_build_object('id', v_c.address_id) END,
    v_items, v_fee, CASE WHEN v_prepaid THEN 'prepaid' ELSE 'cash_on_delivery' END, v_change,
    CASE WHEN random() < 0.25 THEN (ARRAY['Timbre dañado, llamar al llegar', 'Portería: dejar con el vigilante',
                                          'Llamar antes de llegar', 'Sin cubiertos, gracias'])[1 + floor(random() * 4)::int] END);
  v_order := (v_result ->> 'order_id')::uuid;
  UPDATE demo_customers SET customer_id = (v_result ->> 'customer_id')::uuid,
                            address_id = coalesce(address_id, (v_result ->> 'address_id')::uuid)
   WHERE phone = v_c.phone;

  SELECT o.subtotal::bigint + o.tax::bigint + v_fee INTO v_due FROM public.orders o WHERE o.id = v_order;
  IF v_prepaid AND p_stage <> 'cancelled' THEN
    v_method := CASE WHEN random() < 0.6 THEN 'nequi' ELSE 'transfer' END;
    PERFORM pg_temp.demo_pay(pg_temp.demo_profile('delivery_operator'), v_order, p_register,
      jsonb_build_array(jsonb_build_object('payment_method_id', (SELECT id FROM demo_methods WHERE code = v_method),
                                           'amount', v_due)));
  END IF;

  IF p_stage = 'cancelled' THEN
    PERFORM pg_temp.demo_as(pg_temp.demo_profile('delivery_operator'));
    PERFORM public.set_delivery_status(v_order, 'cancel', NULL, 'El cliente canceló por teléfono');
    RETURN v_order;
  END IF;
  IF p_stage = 'received' THEN RETURN v_order; END IF;
  PERFORM pg_temp.demo_as(pg_temp.demo_profile('kitchen'));
  PERFORM public.set_delivery_status(v_order, 'start_preparing');
  IF p_stage = 'preparing' THEN RETURN v_order; END IF;
  PERFORM public.set_delivery_status(v_order, 'mark_ready');
  IF p_stage = 'ready' THEN RETURN v_order; END IF;
  PERFORM pg_temp.demo_as(pg_temp.demo_profile('delivery_operator'));
  PERFORM public.set_delivery_status(v_order, 'dispatch', v_courier);
  IF p_stage = 'out_for_delivery' THEN RETURN v_order; END IF;
  IF p_stage = 'retried' THEN
    PERFORM public.set_delivery_status(v_order, 'fail', NULL, 'No contestan en la dirección');
    PERFORM public.set_delivery_status(v_order, 'dispatch', v_courier);
  END IF;
  PERFORM public.set_delivery_status(v_order, 'deliver');
  IF NOT v_prepaid THEN
    PERFORM pg_temp.demo_pay(pg_temp.demo_profile('delivery_operator'), v_order, p_register,
      jsonb_build_array(jsonb_build_object('payment_method_id', (SELECT id FROM demo_methods WHERE code = 'cash'),
                                           'amount', v_due, 'cash_received', greatest(v_due, coalesce(v_change, v_due)))));
  END IF;
  RETURN v_order;
END;
$$;

-- order_deliveries stamps updated_at = now() on every UPDATE (set_updated_at),
-- and GET /delivery/active lists the rows updated since local midnight. So the
-- row is rewritten with its real times: copied, deleted and inserted again
-- (an INSERT keeps the given updated_at; the superuser passes the
-- immutability guard and the deferred consistency trigger still checks it).
CREATE FUNCTION pg_temp.demo_backdate_delivery(p_order uuid, p_at timestamptz) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  -- Live deliveries keep every step in the past.
  PERFORM pg_temp.demo_backdate(p_order, p_at, least(now(), p_at + interval '50 minutes'));
  INSERT INTO demo_od SELECT * FROM public.order_deliveries WHERE order_id = p_order;
  UPDATE demo_od
     SET created_at = p_at,
         updated_at = least(now(), p_at + interval '50 minutes'),
         dispatched_at = CASE WHEN dispatched_at IS NOT NULL THEN least(now(), p_at + interval '25 minutes') END,
         delivered_at = CASE WHEN delivered_at IS NOT NULL THEN p_at + interval '50 minutes' END,
         failed_at = CASE WHEN failed_at IS NOT NULL THEN p_at + interval '40 minutes' END,
         cancelled_at = CASE WHEN cancelled_at IS NOT NULL THEN p_at + interval '6 minutes' END;
  UPDATE demo_od SET updated_at = cancelled_at WHERE cancelled_at IS NOT NULL;
  DELETE FROM public.order_deliveries WHERE order_id = p_order;
  INSERT INTO public.order_deliveries SELECT * FROM demo_od;
  TRUNCATE demo_od;
  UPDATE public.payments p SET created_at = CASE WHEN od.payment_mode = 'prepaid' THEN p_at + interval '2 minutes'
                                                 ELSE p_at + interval '50 minutes' END
    FROM public.order_deliveries od
   WHERE p.order_id = p_order AND od.order_id = p_order;
END;
$$;

-- ---------------------------------------------------------------------------
-- Restaurant settings, staff, menu, tables, couriers, customers
-- ---------------------------------------------------------------------------

DO $setup$
DECLARE
  v_rid uuid := current_setting('vipe.restaurant_id')::uuid;
  v_hash text := current_setting('vipe.demo_hash');
  v_admin uuid;
  v_cat uuid;
  v_dish uuid;
  v_promo uuid;
  r record;
  c record;
BEGIN
  PERFORM setseed(0.2026);

  SELECT p.id INTO v_admin FROM public.profiles p WHERE p.restaurant_id = v_rid AND p.role = 'admin';
  INSERT INTO demo_staff VALUES ('admin', v_admin, 1);

  -- The marker --reset uses to find demo restaurants, then the settings
  -- (impoconsumo 8 %, suggested tip 10 %).
  INSERT INTO public.business_config (restaurant_id, key, value) VALUES
    (v_rid, 'demo_seed', 'true'),
    (v_rid, 'tax_percentage', '8'),
    (v_rid, 'tip_percentage', '10'),
    (v_rid, 'business_address', 'Carrera 43 # 10-27, Medellín'),
    (v_rid, 'business_phone', '604 555 0142'),
    (v_rid, 'business_nit', '900000000-1'),
    (v_rid, 'delivery_default_fee', '5000');

  -- Staff through the same helper POST /staff uses, as the admin.
  PERFORM pg_temp.demo_as(v_admin);
  FOR r IN SELECT * FROM (VALUES
      ('waiter', 1, 'Andrés Felipe Osorio', 'mesero.andres@demo.vipe.pos'),
      ('waiter', 2, 'Valentina Cardona', 'mesera.valentina@demo.vipe.pos'),
      ('waiter', 3, 'Julián Arango', 'mesero.julian@demo.vipe.pos'),
      ('kitchen', 1, 'Luz Dary Montoya', 'cocina@demo.vipe.pos'),
      ('kitchen', 2, 'Óscar Zapata', 'cocina.oscar@demo.vipe.pos'),
      ('cashier', 1, 'Daniela Ríos', 'caja@demo.vipe.pos'),
      ('cashier', 2, 'Camilo Henao', 'caja.camilo@demo.vipe.pos'),
      ('delivery_operator', 1, 'Sebastián Muñoz', 'domicilios@demo.vipe.pos')
    ) AS s(role, seq, full_name, email)
  LOOP
    INSERT INTO demo_staff VALUES (r.role,
      private.create_staff_user(r.email::public.citext, v_hash, 'argon2id', r.full_name,
                                split_part(r.email, '@', 1), r.role, true),
      r.seq);
  END LOOP;

  -- Menu: 8 categories, 38 dishes, whole-peso COP prices.
  FOR c IN SELECT * FROM (VALUES
      (1, 'Entradas', 'Para compartir mientras llega el plato fuerte', 'salad', 'entrada'),
      (2, 'Sopas', 'Recetas de olla, como en casa de la abuela', 'soup', 'sopa'),
      (3, 'Almuerzo ejecutivo', 'De lunes a sábado: sopa del día, seco, jugo y postre', 'utensils', 'almuerzo'),
      (4, 'Platos fuertes', 'Carnes a la parrilla y clásicos colombianos', 'beef', 'fuerte'),
      (5, 'Del mar', 'Pescados y mariscos del Pacífico y el Caribe', 'fish', 'mar'),
      (6, 'Bebidas', 'Jugos naturales, bebidas frías y calientes', 'water', 'bebida'),
      (7, 'Cervezas y cócteles', 'Para acompañar la comida', 'cocktail', 'coctel'),
      (8, 'Postres', 'Dulces tradicionales hechos en casa', 'dessert', 'postre')
    ) AS t(ord, name, description, icon, grp)
    ORDER BY ord
  LOOP
    INSERT INTO public.categories (name, description, icon, active, restaurant_id)
    VALUES (c.name, c.description, c.icon, true, v_rid) RETURNING id INTO v_cat;
    FOR r IN SELECT * FROM (VALUES
        ('entrada', 'Empanadas de pipián', 'Tres empanadas crocantes con ají de la casa', 9500, false, 5),
        ('entrada', 'Patacón con hogao', 'Patacón pisao con hogao y queso costeño', 12000, false, 4),
        ('entrada', 'Arepa de chócolo con quesito', 'Arepa dulce de maíz tierno con quesito antioqueño', 11000, false, 3),
        ('entrada', 'Chicharrón con arepa', 'Chicharrón carnudo, arepa de maíz y limón', 16000, true, 3),
        ('entrada', 'Ceviche de camarón', 'Camarón en leche de tigre con mango y cebolla morada', 22000, true, 2),
        ('sopa', 'Ajiaco santafereño', 'Con pollo desmechado, mazorca, alcaparras y crema', 28000, true, 5),
        ('sopa', 'Sancocho trifásico', 'Res, cerdo y pollo con yuca y plátano; arroz y aguacate', 30000, true, 4),
        ('sopa', 'Mondongo antioqueño', 'Con chorizo, papa criolla y arroz blanco', 26000, true, 2),
        ('sopa', 'Crema de ahuyama', 'Con crutones y queso fresco', 14000, false, 2),
        ('almuerzo', 'Ejecutivo de res', 'Sopa del día, carne a la plancha, arroz, frijoles, ensalada y jugo', 21000, true, 5),
        ('almuerzo', 'Ejecutivo de pollo', 'Sopa del día, pechuga asada, arroz, papa salada y jugo', 19500, true, 5),
        ('almuerzo', 'Ejecutivo de cerdo', 'Sopa del día, lomo de cerdo, arroz, tajadas y jugo', 20500, true, 4),
        ('almuerzo', 'Ejecutivo vegetariano', 'Sopa del día, torta de lentejas, arroz integral y jugo', 18000, true, 2),
        ('fuerte', 'Bandeja paisa', 'Frijoles, arroz, carne molida, chicharrón, chorizo, huevo, arepa y aguacate', 36000, true, 6),
        ('fuerte', 'Churrasco 400 g', 'Corte a la parrilla con papa criolla y chimichurri', 48000, true, 4),
        ('fuerte', 'Sobrebarriga en salsa criolla', 'Cocida a fuego lento, con papa salada y arroz', 34000, true, 3),
        ('fuerte', 'Posta negra cartagenera', 'Res en salsa de panela y especias, arroz con coco y plátano', 38000, true, 2),
        ('fuerte', 'Lomo al trapo', 'Lomo fino asado en sal y tela, con yuca frita', 52000, true, 2),
        ('fuerte', 'Pechuga gratinada', 'Con champiñones, papas a la francesa y ensalada', 31000, true, 3),
        ('mar', 'Mojarra frita', 'Mojarra entera, patacones, arroz con coco y ensalada', 42000, true, 4),
        ('mar', 'Cazuela de mariscos', 'En leche de coco, con arroz blanco y patacón', 49000, true, 2),
        ('mar', 'Trucha al ajillo', 'Trucha arcoíris con papa salada y ensalada verde', 39000, true, 3),
        ('mar', 'Arroz de camarón', 'Arroz caldoso con camarón, pimentón y cilantro', 37000, true, 2),
        ('bebida', 'Limonada de coco', 'Limón, leche de coco y hielo frappé', 11000, true, 5),
        ('bebida', 'Jugo natural en agua', 'Mora, lulo, maracuyá o guanábana', 7000, true, 6),
        ('bebida', 'Jugo natural en leche', 'Mora, lulo, maracuyá o guanábana', 8500, true, 3),
        ('bebida', 'Gaseosa 400 ml', 'Sabores surtidos', 5500, false, 4),
        ('bebida', 'Agua con o sin gas', 'Botella de 600 ml', 4500, false, 2),
        ('bebida', 'Tinto', 'Café colombiano de origen', 3000, false, 3),
        ('bebida', 'Aguapanela con queso', 'Caliente, con queso campesino', 6500, false, 2),
        ('coctel', 'Cerveza nacional', 'Botella de 330 ml', 7500, false, 6),
        ('coctel', 'Cerveza artesanal', 'Rubia, roja o negra de cervecería local', 13000, false, 3),
        ('coctel', 'Michelada', 'Limón, sal y cerveza nacional', 12000, false, 3),
        ('coctel', 'Mojito de maracuyá', 'Ron blanco, hierbabuena y maracuyá', 24000, false, 2),
        ('postre', 'Postre de natas', 'Receta tradicional con brevas', 12000, false, 3),
        ('postre', 'Tres leches', 'Bizcocho húmedo con merengue', 11500, false, 4),
        ('postre', 'Arroz con leche', 'Con canela y uvas pasas', 9500, false, 2),
        ('postre', 'Brevas con arequipe', 'Con queso campesino', 10500, false, 2)
      ) AS d(grp, name, description, price, allow_comments, weight)
      WHERE d.grp = c.grp
    LOOP
      INSERT INTO public.dishes (name, description, price, category_id, active, allow_comments, restaurant_id)
      VALUES (r.name, r.description, r.price, v_cat, true, r.allow_comments, v_rid) RETURNING id INTO v_dish;
      INSERT INTO demo_menu VALUES (v_dish, r.grp, r.weight);
    END LOOP;
  END LOOP;

  -- Promotions (the schema has no modifiers or combos): two running, one
  -- coming, one finished.
  INSERT INTO public.promotions (name, description, discount_type, discount_value, start_date, end_date, active, restaurant_id)
  VALUES ('Hora feliz de cócteles', '20 % en cócteles y micheladas', 'percentage', 20,
          now() - interval '40 days', now() + interval '60 days', true, v_rid)
  RETURNING id INTO v_promo;
  INSERT INTO public.promotion_dishes (promotion_id, dish_id, restaurant_id)
  SELECT v_promo, d.id, v_rid FROM public.dishes d
   WHERE d.restaurant_id = v_rid AND d.name IN ('Michelada', 'Mojito de maracuyá');

  INSERT INTO public.promotions (name, description, discount_type, discount_value, start_date, end_date, active, restaurant_id)
  VALUES ('Ejecutivo con descuento', '2.000 pesos menos en el almuerzo ejecutivo de pollo', 'fixed_amount', 2000,
          now() - interval '15 days', now() + interval '30 days', true, v_rid)
  RETURNING id INTO v_promo;
  INSERT INTO public.promotion_dishes (promotion_id, dish_id, restaurant_id)
  SELECT v_promo, d.id, v_rid FROM public.dishes d WHERE d.restaurant_id = v_rid AND d.name = 'Ejecutivo de pollo';

  INSERT INTO public.promotions (name, description, discount_type, discount_value, start_date, end_date, active, restaurant_id)
  VALUES ('Mes del mar', '15 % en platos de mar durante el próximo mes', 'percentage', 15,
          now() + interval '10 days', now() + interval '40 days', true, v_rid)
  RETURNING id INTO v_promo;
  INSERT INTO public.promotion_dishes (promotion_id, dish_id, restaurant_id)
  SELECT v_promo, m.dish_id, v_rid FROM demo_menu m WHERE m.grp = 'mar';

  INSERT INTO public.promotions (name, description, discount_type, discount_value, start_date, end_date, active, restaurant_id)
  VALUES ('Semana del postre', '10 % en postres', 'percentage', 10,
          now() - interval '60 days', now() - interval '45 days', false, v_rid)
  RETURNING id INTO v_promo;
  INSERT INTO public.promotion_dishes (promotion_id, dish_id, restaurant_id)
  SELECT v_promo, m.dish_id, v_rid FROM demo_menu m WHERE m.grp = 'postre';

  -- 12 tables (the schema has no zones).
  INSERT INTO public.tables (number, status, restaurant_id)
  SELECT n, 'available', v_rid FROM generate_series(1, 12) n;
  INSERT INTO demo_tables SELECT t.number, t.id FROM public.tables t WHERE t.restaurant_id = v_rid;

  INSERT INTO demo_methods SELECT m.code, m.id FROM public.payment_methods m WHERE m.restaurant_id = v_rid;

  -- Couriers (no login) with clearly fictional numbers.
  INSERT INTO public.couriers (restaurant_id, name, phone) VALUES
    (v_rid, 'Brayan Gómez', '3000000101'),
    (v_rid, 'Yeison Quintero', '3000000102'),
    (v_rid, 'Kevin Ospina', '3000000103');
  INSERT INTO demo_couriers SELECT id FROM public.couriers WHERE restaurant_id = v_rid;

  -- Delivery customers: created by the first create_delivery_order that uses them.
  INSERT INTO demo_customers (phone, name, address_line, neighborhood, reference, weight)
  SELECT '30000010' || lpad(n::text, 2, '0'), nm, addr, hood, ref, 1 + (n % 4)
    FROM (VALUES
      (1, 'Carolina Vélez', 'Calle 33 # 76-41, apto 302', 'Laureles', 'Edificio de ladrillo, portería 24 horas'),
      (2, 'Santiago Echeverri', 'Carrera 80 # 30A-15', 'Belén', 'Casa de dos pisos, reja verde'),
      (3, 'Natalia Agudelo', 'Calle 10 # 32-60, torre 2 apto 1104', 'El Poblado', 'Unidad con portería'),
      (4, 'Mateo Londoño', 'Transversal 39 # 72-08', 'Laureles', NULL),
      (5, 'Isabella Correa', 'Calle 44 # 81-22, int. 201', 'Calasanz', 'Frente al parque'),
      (6, 'Juan Pablo Toro', 'Carrera 65 # 48-90', 'Estadio', 'Local de al lado es una panadería'),
      (7, 'Manuela Betancur', 'Calle 50 # 40-33, apto 501', 'Boston', NULL),
      (8, 'Alejandro Duque', 'Carrera 76 # 34-12', 'La América', 'Tocar el timbre de abajo'),
      (9, 'Sara Jaramillo', 'Calle 30 # 70-55, apto 803', 'Belén', 'Torre B'),
      (10, 'Tomás Mejía', 'Carrera 48 # 12 Sur-40', 'El Poblado', 'Oficina, preguntar en recepción'),
      (11, 'Mariana Posada', 'Calle 47D # 72-30', 'Florida Nueva', NULL),
      (12, 'Samuel Rendón', 'Carrera 70 # 1-52', 'Belén', 'Casa esquinera'),
      (13, 'Laura Salazar', 'Calle 52 # 47-18, apto 402', 'Boston', 'Edificio azul'),
      (14, 'David Hincapié', 'Circular 4 # 71-15', 'Laureles', NULL),
      (15, 'Paula Ochoa', 'Carrera 43A # 18 Sur-90, apto 1502', 'El Poblado', 'Unidad residencial, portería norte'),
      (16, 'Esteban Gallego', 'Calle 34 # 66B-20', 'Conquistadores', NULL),
      (17, 'Juliana Arboleda', 'Carrera 81 # 42-10', 'Calasanz', 'Segundo piso'),
      (18, 'Miguel Ángel Franco', 'Calle 49 # 35-77', 'Buenos Aires', 'Junto a la droguería'),
      (19, 'Daniela Bustamante', 'Carrera 73 # 39-05, apto 201', 'Laureles', NULL),
      (20, 'Felipe Uribe', 'Calle 9 # 43B-60', 'El Poblado', 'Casa blanca'),
      (21, 'Antonia Marín', 'Carrera 77 # 33-48', 'Belén', NULL),
      (22, 'Nicolás Castaño', 'Calle 35 # 64-21, apto 303', 'Conquistadores', 'Edificio con jardín'),
      (23, 'Gabriela Zuluaga', 'Carrera 52 # 48-33', 'Centro', 'Oficina 704'),
      (24, 'Emilio Cadavid', 'Calle 41 # 79-17', 'La América', NULL)
    ) AS c(n, nm, addr, hood, ref);
END
$setup$;

-- ---------------------------------------------------------------------------
-- Inventory: categories, suppliers, items with opening stock, dish formulas
-- ---------------------------------------------------------------------------

DO $inventory$
DECLARE
  v_rid uuid := current_setting('vipe.restaurant_id')::uuid;
  v_loc uuid := (SELECT id FROM public.inventory_locations WHERE restaurant_id = v_rid AND is_default);
  v_item uuid;
  v_po uuid;
  r record;
BEGIN
  PERFORM pg_temp.demo_as(pg_temp.demo_profile('admin'));

  INSERT INTO public.ingredient_categories (name, description, restaurant_id) VALUES
    ('Carnes', 'Res, cerdo y pollo', v_rid),
    ('Pescados y mariscos', 'Producto fresco y congelado', v_rid),
    ('Frutas y verduras', 'Plaza mayorista, dos veces por semana', v_rid),
    ('Lácteos y huevos', NULL, v_rid),
    ('Abarrotes', 'Granos, harinas y secos', v_rid),
    ('Bebidas', 'Cervezas, gaseosas y aguas', v_rid);

  INSERT INTO public.suppliers (restaurant_id, name, tax_id, contact_name, phone, email, lead_time_days) VALUES
    (v_rid, 'Carnes La Pradera S.A.S.', '900000000-2', 'Hernán Restrepo', '604 555 0171', 'pedidos@carneslapradera.example', 1),
    (v_rid, 'Distribuidora Mar Azul', '900000000-3', 'Lina Giraldo', '604 555 0188', 'ventas@marazul.example', 2),
    (v_rid, 'Frutas y Verduras El Campo', '900000000-4', 'Jorge Patiño', '604 555 0193', NULL, 1),
    (v_rid, 'Abastos del Valle', '900000000-5', 'Patricia Cano', '604 555 0120', 'abastos@delvalle.example', 3);

  -- name, category, unit, cost per unit, min stock, opening stock, supplier
  FOR r IN SELECT * FROM (VALUES
      ('Carne de res', 'Carnes', 'kg', 32000, 15, 38, 'Carnes La Pradera S.A.S.'),
      ('Lomo fino', 'Carnes', 'kg', 54000, 5, 9.5, 'Carnes La Pradera S.A.S.'),
      ('Pechuga de pollo', 'Carnes', 'kg', 17500, 12, 26, 'Carnes La Pradera S.A.S.'),
      ('Lomo de cerdo', 'Carnes', 'kg', 21000, 8, 14, 'Carnes La Pradera S.A.S.'),
      ('Chicharrón', 'Carnes', 'kg', 24000, 6, 4.2, 'Carnes La Pradera S.A.S.'),
      ('Chorizo antioqueño', 'Carnes', 'unidad', 2200, 40, 85, 'Carnes La Pradera S.A.S.'),
      ('Mojarra roja', 'Pescados y mariscos', 'unidad', 12500, 15, 22, 'Distribuidora Mar Azul'),
      ('Camarón', 'Pescados y mariscos', 'kg', 48000, 4, 2.6, 'Distribuidora Mar Azul'),
      ('Trucha', 'Pescados y mariscos', 'unidad', 11000, 10, 16, 'Distribuidora Mar Azul'),
      ('Plátano verde', 'Frutas y verduras', 'unidad', 900, 60, 140, 'Frutas y Verduras El Campo'),
      ('Papa criolla', 'Frutas y verduras', 'kg', 4200, 10, 18, 'Frutas y Verduras El Campo'),
      ('Aguacate', 'Frutas y verduras', 'unidad', 2500, 30, 12, 'Frutas y Verduras El Campo'),
      ('Limón', 'Frutas y verduras', 'kg', 3800, 8, 5.5, 'Frutas y Verduras El Campo'),
      ('Maracuyá', 'Frutas y verduras', 'kg', 5200, 6, 11, 'Frutas y Verduras El Campo'),
      ('Mora', 'Frutas y verduras', 'kg', 6800, 6, 9, 'Frutas y Verduras El Campo'),
      ('Queso costeño', 'Lácteos y huevos', 'kg', 19000, 5, 3.1, 'Abastos del Valle'),
      ('Huevos', 'Lácteos y huevos', 'unidad', 550, 90, 210, 'Abastos del Valle'),
      ('Leche entera', 'Lácteos y huevos', 'litro', 3900, 20, 34, 'Abastos del Valle'),
      ('Arroz', 'Abarrotes', 'kg', 4300, 25, 60, 'Abastos del Valle'),
      ('Frijol cargamanto', 'Abarrotes', 'kg', 11500, 10, 24, 'Abastos del Valle'),
      ('Harina de maíz', 'Abarrotes', 'kg', 4800, 8, 15, 'Abastos del Valle'),
      ('Aceite vegetal', 'Abarrotes', 'litro', 9500, 10, 22, 'Abastos del Valle'),
      ('Cerveza nacional 330 ml', 'Bebidas', 'unidad', 3100, 72, 168, 'Abastos del Valle'),
      ('Gaseosa 400 ml', 'Bebidas', 'unidad', 1900, 48, 96, 'Abastos del Valle')
    ) AS i(name, cat, unit, cost, min_stock, stock, supplier)
  LOOP
    INSERT INTO public.ingredients (name, unit, min_stock, category_id, default_supplier_id, restaurant_id, kind)
    VALUES (r.name, r.unit, r.min_stock,
            (SELECT id FROM public.ingredient_categories WHERE restaurant_id = v_rid AND name = r.cat),
            (SELECT id FROM public.suppliers WHERE restaurant_id = v_rid AND name = r.supplier),
            v_rid, 'raw')
    RETURNING id INTO v_item;
    PERFORM public.inventory_adjust(p_ingredient_id => v_item, p_location_id => v_loc, p_movement_type => 'opening',
                                    p_quantity => r.stock, p_unit_cost => r.cost, p_reason => 'Stock inicial');
  END LOOP;
  UPDATE public.inventory_movements SET created_at = now() - interval '31 days'
   WHERE restaurant_id = v_rid AND movement_type = 'opening';

  -- Formulas (one portion) for the dishes that carry the counted items.
  FOR r IN SELECT * FROM (VALUES
      ('Bandeja paisa', '[["Carne de res",0.15],["Chicharrón",0.12],["Chorizo antioqueño",1],["Huevos",1],["Aguacate",0.5],["Arroz",0.15],["Frijol cargamanto",0.12],["Plátano verde",0.5]]'),
      ('Churrasco 400 g', '[["Carne de res",0.4],["Papa criolla",0.2]]'),
      ('Lomo al trapo', '[["Lomo fino",0.35]]'),
      ('Pechuga gratinada', '[["Pechuga de pollo",0.3],["Queso costeño",0.05]]'),
      ('Ejecutivo de res', '[["Carne de res",0.18],["Arroz",0.15],["Frijol cargamanto",0.08]]'),
      ('Ejecutivo de pollo', '[["Pechuga de pollo",0.22],["Arroz",0.15]]'),
      ('Ejecutivo de cerdo', '[["Lomo de cerdo",0.2],["Arroz",0.15],["Plátano verde",0.5]]'),
      ('Mojarra frita', '[["Mojarra roja",1],["Plátano verde",1],["Arroz",0.15],["Aceite vegetal",0.1]]'),
      ('Trucha al ajillo', '[["Trucha",1],["Papa criolla",0.15]]'),
      ('Arroz de camarón', '[["Camarón",0.15],["Arroz",0.15]]'),
      ('Ceviche de camarón', '[["Camarón",0.12],["Limón",0.08]]'),
      ('Patacón con hogao', '[["Plátano verde",1],["Queso costeño",0.04]]'),
      ('Chicharrón con arepa', '[["Chicharrón",0.2],["Harina de maíz",0.08]]'),
      ('Cerveza nacional', '[["Cerveza nacional 330 ml",1]]'),
      ('Michelada', '[["Cerveza nacional 330 ml",1],["Limón",0.05]]'),
      ('Gaseosa 400 ml', '[["Gaseosa 400 ml",1]]'),
      ('Jugo natural en leche', '[["Mora",0.12],["Leche entera",0.25]]'),
      ('Limonada de coco', '[["Limón",0.1]]')
    ) AS f(dish, lines)
  LOOP
    PERFORM public.save_formula('dish',
      (SELECT id FROM public.dishes WHERE restaurant_id = v_rid AND name = r.dish), 1,
      (SELECT jsonb_agg(jsonb_build_object(
                'ingredient_id', (SELECT id FROM public.ingredients WHERE restaurant_id = v_rid AND name = l ->> 0),
                'quantity', (l ->> 1)::numeric))
         FROM jsonb_array_elements(r.lines::jsonb) l));
  END LOOP;

  -- A purchase order on the way for the items below their minimum.
  INSERT INTO public.purchase_orders (restaurant_id, supplier_id, location_id, status, expected_on, notes, ordered_at)
  VALUES (v_rid, (SELECT id FROM public.suppliers WHERE restaurant_id = v_rid AND name = 'Frutas y Verduras El Campo'),
          v_loc, 'ordered', current_date + 1, 'Reposición de aguacate y limón', now() - interval '3 hours')
  RETURNING id INTO v_po;
  INSERT INTO public.purchase_order_lines (restaurant_id, purchase_order_id, ingredient_id, quantity, unit_cost)
  SELECT v_rid, v_po, i.id, q, i.cost
    FROM (VALUES ('Aguacate', 60), ('Limón', 12)) AS l(name, q)
    JOIN public.ingredients i ON i.restaurant_id = v_rid AND i.name = l.name;
END
$inventory$;

-- ---------------------------------------------------------------------------
-- 30 days of service: one register a day, lunch and dinner peaks, weekends
-- busier, deliveries all day. Inventory control is off for the history (the
-- stock above is today's count), so consume_order_stock is a no-op here.
-- ---------------------------------------------------------------------------

DO $history$
DECLARE
  v_rid uuid := current_setting('vipe.restaurant_id')::uuid;
  v_today date := (now() AT TIME ZONE 'America/Bogota')::date;
  v_day date;
  v_dow integer;
  v_factor numeric;
  v_cashier uuid;
  v_register uuid;
  v_open timestamptz;
  v_close timestamptz;
  v_cutoff timestamptz;
  v_at timestamptz;
  v_order uuid;
  v_meal text;
  v_waiter uuid;
  v_r numeric;
  v_stage text;
  d integer;
  n integer;
  r record;
BEGIN
  FOR d IN REVERSE 30..0 LOOP
    v_day := v_today - d;
    v_dow := extract(isodow FROM v_day);
    v_factor := CASE v_dow WHEN 1 THEN 0.70 WHEN 2 THEN 0.80 WHEN 3 THEN 0.85 WHEN 4 THEN 0.95
                           WHEN 5 THEN 1.25 WHEN 6 THEN 1.50 ELSE 1.30 END;
    v_cashier := pg_temp.demo_profile('cashier', 1 + (d % 2));
    v_open := pg_temp.demo_at(v_day, interval '10 hours 30 minutes');
    v_close := pg_temp.demo_at(v_day, interval '22 hours 40 minutes');
    -- Today only the hours already gone are history.
    v_cutoff := CASE WHEN d = 0 THEN now() - interval '45 minutes' ELSE v_close END;
    IF d = 0 THEN
      v_open := least(v_open, now() - interval '3 hours');
    END IF;

    -- RegistersService.open, as the cashier of the day.
    PERFORM pg_temp.demo_as(v_cashier);
    INSERT INTO public.cash_registers (opening_timestamp, initial_cash, status)
    VALUES (now(), 200000, 'open') RETURNING id INTO v_register;

    -- Dine-in orders: lunch, afternoon and dinner, with Sunday lunch heavier
    -- and Sunday dinner lighter.
    FOR r IN
      SELECT m.meal, pg_temp.demo_at(v_day, pg_temp.demo_slot(m.h_from, m.h_to)) AS at
        FROM (VALUES ('lunch', 11.9, 14.8, 19 * CASE WHEN v_dow = 7 THEN 1.3 ELSE 1 END),
                     ('afternoon', 15.0, 18.5, 4),
                     ('dinner', 18.8, 22.0, 13 * CASE WHEN v_dow = 7 THEN 0.6 ELSE 1 END)) AS m(meal, h_from, h_to, base),
             LATERAL generate_series(1, round(m.base * v_factor * (0.85 + random() * 0.3))::integer)
       ORDER BY 2
    LOOP
      CONTINUE WHEN r.at > v_cutoff OR r.at < v_open;
      v_waiter := CASE WHEN r.meal = 'dinner' THEN pg_temp.demo_profile('waiter', 2 + floor(random() * 2)::int)
                       ELSE pg_temp.demo_profile('waiter', 1 + floor(random() * 2)::int) END;
      v_order := pg_temp.demo_open_order(v_waiter,
        (SELECT id FROM demo_tables ORDER BY random() LIMIT 1), r.meal,
        CASE WHEN r.meal = 'afternoon' THEN 1 + floor(random() * 2)::int ELSE 1 + floor(random() * 4)::int END, r.at);
      PERFORM pg_temp.demo_serve(v_order);
      PERFORM pg_temp.demo_pay(v_cashier, v_order, v_register);
      PERFORM pg_temp.demo_backdate(v_order, r.at, r.at + make_interval(mins => 40 + floor(random() * 50)::int));
    END LOOP;

    -- Deliveries: mostly delivered, a few cancelled or re-dispatched.
    FOR r IN
      SELECT pg_temp.demo_at(v_day, CASE WHEN random() < 0.5 THEN pg_temp.demo_slot(11.8, 14.5)
                                         ELSE pg_temp.demo_slot(18.5, 21.8) END) AS at
        FROM generate_series(1, round(7 * v_factor * (0.8 + random() * 0.4))::integer)
       ORDER BY 1
    LOOP
      CONTINUE WHEN r.at > v_cutoff - interval '50 minutes' OR r.at < v_open;
      v_r := random();
      v_stage := CASE WHEN v_r < 0.05 THEN 'cancelled' WHEN v_r < 0.08 THEN 'retried' ELSE 'delivered' END;
      v_order := pg_temp.demo_delivery(v_stage, r.at, v_register);
      PERFORM pg_temp.demo_backdate_delivery(v_order, r.at);
    END LOOP;

    -- An occasional drawer movement (RegistersService.addCashTransaction).
    IF random() < 0.35 THEN
      PERFORM pg_temp.demo_as(v_cashier);
      INSERT INTO public.cash_transactions (amount, type, description, cash_register_id, "timestamp")
      VALUES (CASE WHEN random() < 0.7 THEN 35000 ELSE 60000 END, 'withdrawal',
              (ARRAY['Compra de hielo', 'Pago domicilio de plaza', 'Compra de gas', 'Propinas repartidas'])[1 + floor(random() * 4)::int],
              v_register, least(v_cutoff, pg_temp.demo_at(v_day, interval '16 hours')));
    END IF;

    IF d > 0 THEN
      -- close_register computes the summary and final cash; then the real times.
      PERFORM pg_temp.demo_as(v_cashier);
      PERFORM public.close_register(v_register);
      UPDATE public.cash_registers
         SET opening_timestamp = v_open, closing_timestamp = v_close, created_at = v_open, updated_at = v_close
       WHERE id = v_register;
    ELSE
      UPDATE public.cash_registers SET opening_timestamp = v_open, created_at = v_open, updated_at = v_open
       WHERE id = v_register;
    END IF;
    UPDATE public.cash_transactions SET created_at = "timestamp", updated_at = "timestamp"
     WHERE cash_register_id = v_register;
  END LOOP;

  -- Customers and their addresses: first seen with their first order
  -- (set_updated_at keeps their updated_at at the seed time).
  UPDATE public.customers c
     SET created_at = s.first_at
    FROM (SELECT od.customer_id, min(od.created_at) AS first_at
            FROM public.order_deliveries od WHERE od.restaurant_id = v_rid GROUP BY od.customer_id) s
   WHERE c.id = s.customer_id;
  UPDATE public.customer_addresses a SET created_at = c.created_at
    FROM public.customers c WHERE a.customer_id = c.id AND c.restaurant_id = v_rid;
  -- Every table is free again after the last paid order.
  UPDATE public.tables SET status = 'available', waiter_id = NULL WHERE restaurant_id = v_rid;
END
$history$;

-- ---------------------------------------------------------------------------
-- Right now: inventory control on, tables in every state, kitchen tickets,
-- deliveries on the way and today's register still open.
-- ---------------------------------------------------------------------------

DO $live$
DECLARE
  v_rid uuid := current_setting('vipe.restaurant_id')::uuid;
  v_register uuid := (SELECT id FROM public.cash_registers WHERE restaurant_id = v_rid AND status = 'open');
  v_order uuid;
  v_at timestamptz;
BEGIN
  INSERT INTO public.business_config (restaurant_id, key, value) VALUES (v_rid, 'inventory_control_enabled', 'true');

  -- Table 2: just sent to the kitchen.
  v_at := now() - interval '4 minutes';
  v_order := pg_temp.demo_open_order(pg_temp.demo_profile('waiter', 1), (SELECT id FROM demo_tables WHERE number = 2), 'dinner', 2, v_at);
  PERFORM pg_temp.demo_backdate(v_order, v_at, v_at);

  -- Table 4: starters served, mains still cooking.
  v_at := now() - interval '22 minutes';
  v_order := pg_temp.demo_open_order(pg_temp.demo_profile('waiter', 2), (SELECT id FROM demo_tables WHERE number = 4), 'dinner', 4, v_at);
  UPDATE public.order_items SET status = 'served', updated_at = now()
   WHERE id IN (SELECT id FROM public.order_items WHERE order_id = v_order ORDER BY price LIMIT 2);
  PERFORM pg_temp.demo_backdate(v_order, v_at, v_at);

  -- Table 6: everything served, waiting for the bill.
  v_at := now() - interval '48 minutes';
  v_order := pg_temp.demo_open_order(pg_temp.demo_profile('waiter', 3), (SELECT id FROM demo_tables WHERE number = 6), 'dinner', 3, v_at);
  PERFORM pg_temp.demo_serve(v_order);
  PERFORM pg_temp.demo_backdate(v_order, v_at, v_at + interval '20 minutes');

  -- Table 8: first round 12 minutes ago, a second round of drinks just now
  -- (OrdersService.addItems).
  v_at := now() - interval '12 minutes';
  v_order := pg_temp.demo_open_order(pg_temp.demo_profile('waiter', 1), (SELECT id FROM demo_tables WHERE number = 8), 'dinner', 2, v_at);
  PERFORM pg_temp.demo_backdate(v_order, v_at, v_at);
  PERFORM pg_temp.demo_as(pg_temp.demo_profile('waiter', 1));
  TRUNCATE demo_cart;
  INSERT INTO demo_cart SELECT dish_id, 2, NULL FROM demo_menu WHERE grp = 'coctel' ORDER BY weight DESC LIMIT 1;
  PERFORM pg_temp.demo_add_cart(v_order, now());
  UPDATE public.orders SET status = 'kitchen' WHERE id = v_order;

  -- Table 10: served a while ago.
  v_at := now() - interval '65 minutes';
  v_order := pg_temp.demo_open_order(pg_temp.demo_profile('waiter', 2), (SELECT id FROM demo_tables WHERE number = 10), 'dinner', 2, v_at);
  PERFORM pg_temp.demo_serve(v_order);
  PERFORM pg_temp.demo_backdate(v_order, v_at, v_at + interval '25 minutes');

  -- Table 11 just seated, table 12 reserved for later.
  UPDATE public.tables SET status = 'occupied', waiter_id = pg_temp.demo_profile('waiter', 3)
   WHERE restaurant_id = v_rid AND number = 11;
  UPDATE public.tables SET status = 'reserved' WHERE restaurant_id = v_rid AND number = 12;

  -- Deliveries in progress, one per stage.
  v_order := pg_temp.demo_delivery('received', now() - interval '3 minutes', v_register);
  PERFORM pg_temp.demo_backdate_delivery(v_order, now() - interval '3 minutes');
  v_order := pg_temp.demo_delivery('preparing', now() - interval '14 minutes', v_register);
  PERFORM pg_temp.demo_backdate_delivery(v_order, now() - interval '14 minutes');
  v_order := pg_temp.demo_delivery('ready', now() - interval '24 minutes', v_register);
  PERFORM pg_temp.demo_backdate_delivery(v_order, now() - interval '24 minutes');
  v_order := pg_temp.demo_delivery('out_for_delivery', now() - interval '38 minutes', v_register);
  PERFORM pg_temp.demo_backdate_delivery(v_order, now() - interval '38 minutes');

  PERFORM set_config('app.user_id', '', true);
END
$live$;
