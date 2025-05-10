create table public.dishes (
  id uuid not null default extensions.uuid_generate_v4 (),
  name character varying(100) not null,
  description text null,
  price numeric(10, 2) not null,
  category_id uuid null,
  image_url text null,
  active boolean not null default true,
  allow_comments boolean not null default false,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint dishes_pkey primary key (id),
  constraint dishes_category_id_fkey foreign KEY (category_id) references categories (id)
) TABLESPACE pg_default;

create index IF not exists idx_dishes_category on public.dishes using btree (category_id) TABLESPACE pg_default;