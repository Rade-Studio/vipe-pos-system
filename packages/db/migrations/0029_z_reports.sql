-- Informe Z and tax type (odd/tasks/caja-cierres.md T4, S8, S9).
--
-- public.z_reports: the numbered close of a business day. number is a
-- consecutive per restaurant (1, 2, ...); the API takes max(number) + 1 under
-- a transaction advisory lock per restaurant, so concurrent emits cannot share
-- a number, and the unique keys below are the backstop. business_day gets one
-- Z per restaurant (a second emit returns the stored one). snapshot is the
-- day summary of GET /cash/days/:date at the emit plus taxes, order range,
-- discounts and tips by method; it never changes. emitted_by is the admin
-- (same restaurant, default the caller, ON DELETE SET NULL) and emitted_at
-- the server clock.
--
-- RLS: staff of the restaurant read its Zs; only an admin inserts. vipe_api
-- has no UPDATE or DELETE grant: a Z cannot be edited or removed through the
-- API, so a missing number is a visible gap.
--
-- business_config: tax_type is INC (impuesto nacional al consumo, the API
-- default when the key is missing) or IVA.
CREATE TABLE public.z_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid DEFAULT private.current_restaurant_id() NOT NULL,
    number integer NOT NULL,
    business_day date NOT NULL,
    snapshot jsonb NOT NULL,
    emitted_by uuid DEFAULT private.current_profile_id(),
    emitted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT z_reports_pkey PRIMARY KEY (id),
    CONSTRAINT z_reports_restaurant_id_number_key UNIQUE (restaurant_id, number),
    CONSTRAINT z_reports_restaurant_id_business_day_key UNIQUE (restaurant_id, business_day),
    CONSTRAINT z_reports_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id),
    CONSTRAINT z_reports_emitted_by_fkey FOREIGN KEY (restaurant_id, emitted_by) REFERENCES public.profiles(restaurant_id, id) ON DELETE SET NULL (emitted_by),
    CONSTRAINT z_reports_number_check CHECK (number >= 1),
    CONSTRAINT z_reports_snapshot_check CHECK (jsonb_typeof(snapshot) = 'object')
);
--> statement-breakpoint
COMMENT ON TABLE public.z_reports IS 'Informe Z: numbered, immutable snapshot of a closed business day; number consecutive per restaurant, one Z per business day.';
--> statement-breakpoint
COMMENT ON COLUMN public.z_reports.number IS 'Consecutive per restaurant from 1; the API takes max + 1 under a per-restaurant advisory lock.';
--> statement-breakpoint
COMMENT ON COLUMN public.z_reports.snapshot IS 'GET /cash/days/:date at the emit plus taxes (base and tax from salesNet), first/last order number, discounts and tips by method.';
--> statement-breakpoint
COMMENT ON COLUMN public.z_reports.emitted_by IS 'Admin who emitted the Z (default: the caller), of the same restaurant; NULL when the profile is deleted.';
--> statement-breakpoint
CREATE INDEX idx_z_reports_emitted_by ON public.z_reports USING btree (emitted_by);
--> statement-breakpoint
ALTER TABLE public.z_reports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY z_reports_select_policy ON public.z_reports FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY z_reports_insert_policy ON public.z_reports FOR INSERT TO vipe_api WITH CHECK (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
-- The default privileges of vipe_migrator grant every table to vipe_api; a Z is never edited or removed.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.z_reports FROM vipe_api;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.z_reports TO vipe_api;
--> statement-breakpoint
ALTER TABLE public.business_config
  ADD CONSTRAINT business_config_tax_type CHECK (key <> 'tax_type' OR value IN ('INC', 'IVA'));
