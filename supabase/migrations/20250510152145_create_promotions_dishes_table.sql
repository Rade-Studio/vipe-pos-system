create table public.promotion_dishes (
  id uuid not null default extensions.uuid_generate_v4 (),
  promotion_id uuid not null,
  dish_id uuid not null,
  created_at timestamp with time zone null default now(),
  constraint promotion_dishes_pkey primary key (id),
  constraint promotion_dishes_promotion_id_dish_id_key unique (promotion_id, dish_id),
  constraint promotion_dishes_dish_id_fkey foreign KEY (dish_id) references dishes (id) on delete CASCADE,
  constraint promotion_dishes_promotion_id_fkey foreign KEY (promotion_id) references promotions (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_promotion_dishes_dish_id on public.promotion_dishes using btree (dish_id) TABLESPACE pg_default;