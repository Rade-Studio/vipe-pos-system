-- Table reservations with a name (odd/tasks/reservas-mesas.md T1, S1-S3, S5, L4, L5).
--
-- 1. public.tables gains reservation_name (trimmed 1..80), an optional
--    reservation_arrival_at, reserved_by (the profile that reserved; SET NULL
--    when the profile is deleted) and reserved_at.
-- 2. tables_reservation_check: reservation_name is set exactly when status is
--    'reserved'. Leaving 'reserved' (release, seating, admin PATCH) clears the
--    reservation fields in the API.
-- 3. Existing rows: tables already 'reserved' (set by the admin PATCH, no
--    name) are backfilled with reservation_name 'Sin nombre' before the CHECK
--    is added, so the CHECK is fully validated. A NOT VALID CHECK was not
--    used: Postgres checks it on every later UPDATE of the row, so any write
--    to a legacy reserved table (renumbering it, moving it) would fail.
--    reserved_at of the backfilled rows is their updated_at.
--
-- Errors: 23514 tables_reservation_name_check (blank or longer than 80) and
-- tables_reservation_check (name without 'reserved' or 'reserved' without a
-- name); 23503 tables_reserved_by_fkey. Grants are unchanged (vipe_api has
-- table-level SELECT, INSERT, UPDATE, DELETE on public.tables).
ALTER TABLE public.tables
    ADD COLUMN reservation_name text,
    ADD COLUMN reservation_arrival_at timestamp with time zone,
    ADD COLUMN reserved_by uuid,
    ADD COLUMN reserved_at timestamp with time zone;
--> statement-breakpoint
ALTER TABLE public.tables
    ADD CONSTRAINT tables_reserved_by_fkey FOREIGN KEY (reserved_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
UPDATE public.tables
   SET reservation_name = 'Sin nombre', reserved_at = coalesce(updated_at, now())
 WHERE status = 'reserved' AND reservation_name IS NULL;
--> statement-breakpoint
ALTER TABLE public.tables
    ADD CONSTRAINT tables_reservation_name_check CHECK (length(btrim(reservation_name)) BETWEEN 1 AND 80);
--> statement-breakpoint
ALTER TABLE public.tables
    ADD CONSTRAINT tables_reservation_check CHECK ((status = 'reserved') = (reservation_name IS NOT NULL));
--> statement-breakpoint
COMMENT ON COLUMN public.tables.reservation_name IS 'Name the table is reserved under; set exactly when status = reserved (tables_reservation_check). Legacy reserved rows were backfilled with Sin nombre (0022).';
--> statement-breakpoint
COMMENT ON COLUMN public.tables.reservation_arrival_at IS 'Optional expected arrival of the reservation.';
--> statement-breakpoint
COMMENT ON COLUMN public.tables.reserved_by IS 'Profile that made the reservation; NULL after the profile is deleted.';
