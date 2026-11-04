-- Table numbers are unique per restaurant (odd/tasks/migracion-backend-nestjs.md,
-- T8a verification defect 5). The baseline kept Supabase's single-tenant
-- tables_number_key UNIQUE (number), so a second restaurant could not number
-- its own tables from 1.
ALTER TABLE public.tables DROP CONSTRAINT tables_number_key;
--> statement-breakpoint
ALTER TABLE public.tables ADD CONSTRAINT tables_restaurant_id_number_key UNIQUE (restaurant_id, number);
