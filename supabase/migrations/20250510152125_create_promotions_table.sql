create table public.promotions (
  id uuid not null default extensions.uuid_generate_v4 (),
  name character varying(255) not null,
  description text null,
  discount_type character varying(20) not null,
  discount_value numeric(10, 2) not null,
  start_date timestamp with time zone not null,
  end_date timestamp with time zone not null,
  active boolean null default true,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint promotions_pkey primary key (id),
  constraint promotions_discount_type_check check (
    (
      (discount_type)::text = any (
        (
          array[
            'percentage'::character varying,
            'fixed_amount'::character varying
          ]
        )::text[]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_promotions_active on public.promotions using btree (active) TABLESPACE pg_default;

create index IF not exists idx_promotions_dates on public.promotions using btree (start_date, end_date) TABLESPACE pg_default;