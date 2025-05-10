create table public.cash_registers (
  id uuid not null default extensions.uuid_generate_v4 (),
  opening_timestamp timestamp with time zone not null,
  closing_timestamp timestamp with time zone null,
  initial_cash numeric(10, 2) not null,
  final_cash numeric(10, 2) null,
  status character varying(20) not null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint cash_registers_pkey primary key (id)
) TABLESPACE pg_default;