create table public.ingredient_transactions (
  id uuid not null default extensions.uuid_generate_v4 (),
  ingredient_id uuid null,
  quantity numeric(10, 2) not null,
  total_cost numeric(10, 2) not null,
  unit_cost numeric(10, 2) not null,
  transaction_type character varying(20) not null,
  payment_status character varying(20) not null default 'pagado'::character varying,
  notes text null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint ingredient_transactions_pkey primary key (id),
  constraint ingredient_transactions_ingredient_id_fkey foreign KEY (ingredient_id) references ingredients (id)
) TABLESPACE pg_default;

create index IF not exists idx_ingredient_transactions_ingredient on public.ingredient_transactions using btree (ingredient_id) TABLESPACE pg_default;

create index IF not exists idx_ingredient_transactions_type on public.ingredient_transactions using btree (transaction_type) TABLESPACE pg_default;

create index IF not exists idx_ingredient_transactions_status on public.ingredient_transactions using btree (payment_status) TABLESPACE pg_default;