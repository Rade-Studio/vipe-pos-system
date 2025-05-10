create table public.cash_transactions (
  id uuid not null default extensions.uuid_generate_v4 (),
  amount numeric(10, 2) not null,
  type character varying(20) not null,
  description text null,
  timestamp timestamp with time zone not null default now(),
  cash_register_id uuid not null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint cash_transactions_pkey primary key (id),
  constraint cash_transactions_cash_register_id_fkey foreign KEY (cash_register_id) references cash_registers (id),
  constraint cash_transactions_type_check check (
    (
      (type)::text = any (
        (
          array[
            'deposit'::character varying,
            'withdrawal'::character varying
          ]
        )::text[]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_cash_transactions_cash_register_id on public.cash_transactions using btree (cash_register_id) TABLESPACE pg_default;

create index IF not exists idx_cash_transactions_timestamp on public.cash_transactions using btree ("timestamp") TABLESPACE pg_default;