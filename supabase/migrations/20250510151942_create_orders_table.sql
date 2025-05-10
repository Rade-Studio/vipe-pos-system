create table public.orders (
  id uuid not null default extensions.uuid_generate_v4 (),
  table_id uuid null,
  waiter_id uuid null,
  status text not null default ''::text,
  subtotal numeric(10, 2) not null,
  tax numeric(10, 2) not null,
  tax_percentage numeric(5, 2) not null,
  tip numeric(10, 2) not null default 0,
  tip_percentage numeric(5, 2) not null default 0,
  total numeric(10, 2) not null,
  is_partial_order boolean not null default false,
  parent_order_id uuid null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  items_json jsonb null,
  total_discounts numeric(10, 2) null default 0,
  constraint orders_pkey primary key (id),
  constraint orders_parent_order_id_fkey foreign KEY (parent_order_id) references orders (id) on delete set null,
  constraint orders_table_id_fkey foreign KEY (table_id) references tables (id) on delete set null,
  constraint orders_waiter_id_fkey foreign KEY (waiter_id) references profiles (id) on delete set null,
  constraint orders_status_check check (
    (
      status = any (
        array['active'::text, 'cancelled'::text, 'paid'::text]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_orders_table on public.orders using btree (table_id) TABLESPACE pg_default;

create index IF not exists idx_orders_waiter on public.orders using btree (waiter_id) TABLESPACE pg_default;

create index IF not exists idx_orders_table_id on public.orders using btree (table_id) TABLESPACE pg_default;

create index IF not exists idx_orders_status on public.orders using btree (status) TABLESPACE pg_default;