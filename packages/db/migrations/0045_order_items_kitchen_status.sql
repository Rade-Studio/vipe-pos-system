-- H-057 (odd/tasks/qa-noviembre-2026.md T14, S4): the kitchen marks each line
-- "en preparación" or "listo" and the waiter sees it on the table, with no
-- notice. The line's lifecycle column `status` (kitchen | served | cancelled)
-- keeps its meaning for every existing flow; kitchen_status is the cooking
-- step of a line while it is still `kitchen`: pending -> preparing -> ready.
-- The NOT NULL DEFAULT fills every existing row with 'pending' (no rewrite:
-- a constant default), so old lines and clients that never send it stay valid.
-- A served or cancelled line keeps whatever step it had; readers show `served`.
ALTER TABLE public.order_items
  ADD COLUMN kitchen_status text NOT NULL DEFAULT 'pending'
  CONSTRAINT order_items_kitchen_status_check CHECK (kitchen_status IN ('pending', 'preparing', 'ready'));
--> statement-breakpoint
COMMENT ON COLUMN public.order_items.kitchen_status IS 'H-057: cooking step of a line still in the kitchen (status = kitchen): pending, preparing or ready. Set by the kitchen (POST /orders/:id/items/kitchen-status); no notice is sent. Meaningless once the line is served or cancelled.';
