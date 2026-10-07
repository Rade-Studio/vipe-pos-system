-- Enable supabase_realtime WAL replication for tables, orders, order_items.
-- Without this migration, postgres_changes events never fire for these
-- tables regardless of how cleanly the client subscribes.
--
-- REPLICA IDENTITY FULL emits the full OLD row on UPDATE/DELETE,
-- not just the primary key. Required so the merge algorithm in the
-- client has access to all columns (e.g. updated_at) without a
-- separate SELECT.

ALTER TABLE public.tables REPLICA IDENTITY FULL;
ALTER TABLE public.orders REPLICA IDENTITY FULL;
ALTER TABLE public.order_items REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE
  public.tables,
  public.orders,
  public.order_items;
