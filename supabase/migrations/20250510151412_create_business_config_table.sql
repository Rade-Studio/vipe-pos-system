create table public.business_config (
  id uuid not null default extensions.uuid_generate_v4 (),
  key character varying(100) not null,
  value text not null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint business_config_pkey primary key (id),
  constraint business_config_key_key unique (key)
);