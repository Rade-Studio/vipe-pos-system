-- Deletes every row of the restaurants the demo seed created, and only those
-- (odd/tasks/migracion-backend-nestjs.md, T16). A demo restaurant carries the
-- business_config marker demo_seed = 'true' (demo.sql). Run by
-- demo-db.sh --reset as vipe_migrator, inside the transaction that seeds
-- again, so a failure leaves the previous demo in place.
--
-- Payments, deliveries and formulas are immutable or RPC-only for the API
-- role; their guards let vipe_migrator delete. Children go first because
-- several foreign keys to restaurants, orders and profiles have no cascade.
--
-- The tenant tables are one ordered list. Before any delete, the reset fails
-- when a base table in public has a restaurant_id column the list does not
-- name: a new tenant table must be added here (in foreign key order) first.

CREATE TEMP TABLE demo_reset_restaurants ON COMMIT DROP AS
  SELECT bc.restaurant_id AS id FROM public.business_config bc
   WHERE bc.key = 'demo_seed' AND bc.value = 'true';

CREATE TEMP TABLE demo_reset_users ON COMMIT DROP AS
  SELECT p.user_id AS id FROM public.profiles p
   WHERE p.restaurant_id IN (SELECT id FROM demo_reset_restaurants) AND p.user_id IS NOT NULL;

DO $reset$
DECLARE
  -- Deleted in this order by restaurant_id; profiles go after the users.
  c_tables constant text[] := ARRAY[
    'menu_publications', 'payment_tenders', 'payments', 'payment_transactions', 'cash_transactions', 'order_deliveries',
    'order_items', 'orders', 'cash_registers', 'print_jobs', 'printer_tokens',
    'customer_addresses', 'customers', 'couriers', 'promotion_dishes', 'promotions',
    'recipe_ingredients', 'recipes', 'inventory_count_lines', 'inventory_counts', 'production_batches',
    'inventory_movements', 'inventory_lots', 'purchase_order_lines', 'purchase_orders',
    'ingredient_transactions', 'ingredients', 'ingredient_categories', 'suppliers', 'inventory_locations',
    'dishes', 'subcategories', 'categories', 'tables', 'zones', 'payment_methods', 'business_config'];
  v_missing text;
  v_table text;
BEGIN
  -- pg_catalog, not information_schema: the latter hides tables the current
  -- role has no privilege on.
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_missing
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attname = 'restaurant_id' AND NOT a.attisdropped
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
     AND c.relname <> ALL (c_tables || ARRAY['profiles', 'ingredient_transactions_orders']);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'reset.sql does not cover the tenant table(s) %; nothing was deleted', v_missing
      USING HINT = 'add them to c_tables in packages/db/seed/demo/reset.sql, children before parents';
  END IF;

  -- Rows by order, not by restaurant (it may have no restaurant_id).
  DELETE FROM public.ingredient_transactions_orders
   WHERE order_id IN (SELECT o.id FROM public.orders o WHERE o.restaurant_id IN (SELECT id FROM demo_reset_restaurants));
  FOREACH v_table IN ARRAY c_tables LOOP
    EXECUTE format('DELETE FROM public.%I WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants)', v_table);
  END LOOP;
  -- Users cascade to their profiles and sessions.
  DELETE FROM public.users WHERE id IN (SELECT id FROM demo_reset_users);
  DELETE FROM public.profiles WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
  DELETE FROM public.restaurants WHERE id IN (SELECT id FROM demo_reset_restaurants);
END
$reset$;
