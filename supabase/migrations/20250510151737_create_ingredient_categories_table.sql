create table public.ingredient_categories (
  id uuid not null default extensions.uuid_generate_v4 (),
  name character varying(100) not null,
  description text null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint ingredient_categories_pkey primary key (id)
) TABLESPACE pg_default;