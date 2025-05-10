create table public.payment_transactions (
  id uuid not null default extensions.uuid_generate_v4 (),
  order_id uuid not null,
  table_id uuid null,
  amount numeric(10, 2) not null,
  method character varying(20) not null,
  cash_received numeric(10, 2) null,
  cash_change numeric(10, 2) null,
  timestamp timestamp with time zone not null,
  cash_register_id uuid not null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  waiter_id uuid null,
  tip_amount numeric(10, 2) null default 0,
  constraint payment_transactions_pkey primary key (id),
  constraint payment_transactions_cash_register_id_fkey foreign KEY (cash_register_id) references cash_registers (id) on delete CASCADE,
  constraint payment_transactions_order_id_fkey foreign KEY (order_id) references orders (id) on delete set null,
  constraint payment_transactions_table_id_fkey foreign KEY (table_id) references tables (id) on delete set null,
  constraint payment_transactions_waiter_id_fkey foreign KEY (waiter_id) references profiles (id) on delete set null
) TABLESPACE pg_default;

create index IF not exists payment_transactions_cash_register_id_idx on public.payment_transactions using btree (cash_register_id) TABLESPACE pg_default;

create index IF not exists payment_transactions_order_id_idx on public.payment_transactions using btree (order_id) TABLESPACE pg_default;

create index IF not exists payment_transactions_waiter_id_idx on public.payment_transactions using btree (waiter_id) TABLESPACE pg_default;