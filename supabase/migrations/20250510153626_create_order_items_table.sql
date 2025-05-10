create table public.order_items (
  id uuid not null default extensions.uuid_generate_v4 (),
  order_id uuid null,
  dish_id uuid null,
  name character varying(100) not null,
  price numeric(10, 2) not null,
  quantity integer not null,
  comments text null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  status character varying(20) null default 'kitchen'::character varying,
  added_at timestamp with time zone null default now(),
  constraint order_items_pkey primary key (id),
  constraint order_items_dish_id_fkey foreign KEY (dish_id) references dishes (id),
  constraint order_items_order_id_fkey foreign KEY (order_id) references orders (id)
) TABLESPACE pg_default;

create index IF not exists idx_order_items_order on public.order_items using btree (order_id) TABLESPACE pg_default;

create index IF not exists idx_order_items_order_id on public.order_items using btree (order_id) TABLESPACE pg_default;

create index IF not exists idx_order_items_status on public.order_items using btree (status) TABLESPACE pg_default;