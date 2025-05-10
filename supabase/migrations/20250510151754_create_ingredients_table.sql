create table public.ingredients (
  id uuid not null default extensions.uuid_generate_v4 (),
  name character varying(100) not null,
  description text null,
  stock numeric(10, 2) not null default 0,
  unit character varying(20) not null,
  min_stock numeric(10, 2) not null default 0,
  category_id uuid null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  cost numeric(10, 2) null default 0,
  constraint ingredients_pkey primary key (id),
  constraint ingredients_category_fkey foreign KEY (category_id) references ingredient_categories (id) on update CASCADE on delete set null
) TABLESPACE pg_default;