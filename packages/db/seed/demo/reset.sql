-- Deletes every row of the restaurants the demo seed created, and only those
-- (odd/tasks/migracion-backend-nestjs.md, T16). A demo restaurant carries the
-- business_config marker demo_seed = 'true' (demo.sql). Run by
-- demo-db.sh --reset as the superuser, inside the transaction that seeds
-- again, so a failure leaves the previous demo in place.
--
-- Payments, deliveries and formulas are immutable or RPC-only for the API
-- role; their guards let the superuser delete. Children go first because
-- several foreign keys to restaurants, orders and profiles have no cascade.

CREATE TEMP TABLE demo_reset_restaurants ON COMMIT DROP AS
  SELECT bc.restaurant_id AS id FROM public.business_config bc
   WHERE bc.key = 'demo_seed' AND bc.value = 'true';

CREATE TEMP TABLE demo_reset_users ON COMMIT DROP AS
  SELECT p.user_id AS id FROM public.profiles p
   WHERE p.restaurant_id IN (SELECT id FROM demo_reset_restaurants) AND p.user_id IS NOT NULL;

DELETE FROM public.payment_tenders WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.payments WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.payment_transactions WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.cash_transactions WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.order_deliveries WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.ingredient_transactions_orders
 WHERE order_id IN (SELECT o.id FROM public.orders o WHERE o.restaurant_id IN (SELECT id FROM demo_reset_restaurants));
DELETE FROM public.order_items WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.orders WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.cash_registers WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.print_jobs WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.printer_tokens WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.customer_addresses WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.customers WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.couriers WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.promotion_dishes WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.promotions WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.recipe_ingredients WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.recipes WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.inventory_count_lines WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.inventory_counts WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.production_batches WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.inventory_movements WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.inventory_lots WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.purchase_order_lines WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.purchase_orders WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.ingredient_transactions WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.ingredients WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.ingredient_categories WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.suppliers WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.inventory_locations WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.dishes WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.categories WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.tables WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.payment_methods WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.business_config WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
-- Users cascade to their profiles and sessions.
DELETE FROM public.users WHERE id IN (SELECT id FROM demo_reset_users);
DELETE FROM public.profiles WHERE restaurant_id IN (SELECT id FROM demo_reset_restaurants);
DELETE FROM public.restaurants WHERE id IN (SELECT id FROM demo_reset_restaurants);
