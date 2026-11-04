-- One open cash register per restaurant (odd/tasks/migracion-backend-nestjs.md,
-- T9 design step 4). The web only guarded a second open register in the browser
-- store, so live data can hold several open registers of one restaurant.
-- Deduplicate first: the register with the latest activity (newest payment or
-- cash movement, else opening_timestamp, then created_at, then id) stays open,
-- because that is the drawer in use; every other one is closed at migration
-- time and recorded in private.migration_0009_closed_registers. final_cash is
-- left untouched (NULL when never closed): the migration does not invent a
-- drawer count, and register_summary still reports those registers in full.
CREATE TABLE private.migration_0009_closed_registers (
  cash_register_id uuid PRIMARY KEY,
  restaurant_id uuid,
  closed_at timestamptz DEFAULT now()
);
--> statement-breakpoint
COMMENT ON TABLE private.migration_0009_closed_registers IS 'Audit of migration 0009: open cash registers it closed so one open register per restaurant remains. No grant to vipe_api.';
--> statement-breakpoint
WITH activity AS (
  SELECT cr.id, cr.restaurant_id,
         coalesce(greatest((SELECT max(p.created_at) FROM public.payments p WHERE p.cash_register_id = cr.id),
                           (SELECT max(ct."timestamp") FROM public.cash_transactions ct WHERE ct.cash_register_id = cr.id)),
                  cr.opening_timestamp) AS last_activity,
         cr.opening_timestamp, cr.created_at
    FROM public.cash_registers cr
   WHERE cr.status = 'open'
), ranked AS (
  SELECT id, restaurant_id,
         row_number() OVER (PARTITION BY restaurant_id
                            ORDER BY last_activity DESC, opening_timestamp DESC, created_at DESC NULLS LAST, id DESC) AS rank
    FROM activity
), closed AS (
  UPDATE public.cash_registers cr
     SET status = 'closed',
         closing_timestamp = coalesce(cr.closing_timestamp, now()),
         updated_at = now()
    FROM ranked
   WHERE cr.id = ranked.id
     AND ranked.rank > 1
  RETURNING cr.id, cr.restaurant_id
)
INSERT INTO private.migration_0009_closed_registers (cash_register_id, restaurant_id)
SELECT id, restaurant_id FROM closed;
--> statement-breakpoint
CREATE UNIQUE INDEX one_open_register_per_restaurant ON public.cash_registers (restaurant_id) WHERE status = 'open';
--> statement-breakpoint
COMMENT ON INDEX public.one_open_register_per_restaurant IS 'At most one open cash register per restaurant. POST /registers/open answers 409 A register is already open on its 23505.';
