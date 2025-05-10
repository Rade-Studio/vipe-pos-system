create table public.recipes (
  id uuid not null default extensions.uuid_generate_v4 (),
  dish_id uuid not null,
  created_at timestamp with time zone null default now(),
  constraint recipes_pkey primary key (id),
  constraint recipes_dish_id_key unique (dish_id),
  constraint recipes_dish_id_fkey foreign KEY (dish_id) references dishes (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_recipes_dish_id on public.recipes using btree (dish_id) TABLESPACE pg_default;