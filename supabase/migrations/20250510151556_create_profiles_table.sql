create table public.profiles (
  id uuid not null default extensions.uuid_generate_v4 (),
  full_name character varying(100) not null,
  username character varying(50) null,
  email character varying(100) null,
  password text null,
  role character varying(20) not null,
  active boolean not null default true,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint profiles_pkey primary key (id),
  constraint profiles_email_key unique (email),
  constraint profiles_username_key unique (username)
) TABLESPACE pg_default;

create index IF not exists idx_profiles_role on public.profiles using btree (role) TABLESPACE pg_default;