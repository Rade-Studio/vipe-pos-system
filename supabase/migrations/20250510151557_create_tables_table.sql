create table public.tables (
  id uuid not null default extensions.uuid_generate_v4 (),
  number integer not null,
  status character varying(20) not null default 'available'::character varying,
  waiter_id uuid null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint tables_pkey primary key (id),
  constraint tables_number_key unique (number),
  constraint tables_waiter_id_fkey foreign KEY (waiter_id) references profiles (id)
) TABLESPACE pg_default;

create index IF not exists idx_tables_status on public.tables using btree (status) TABLESPACE pg_default;