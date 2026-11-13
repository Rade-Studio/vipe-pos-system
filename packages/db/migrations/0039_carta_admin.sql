-- Carta admin, DB layer (odd/tasks/carta-digital.md T8, S17, L17 A3).
--
-- private.set_restaurant_slug(p_slug): an admin renames the slug of their own
-- restaurant, the name of the public link /c/<slug>. vipe_api has no write
-- policy on restaurants, so this SECURITY DEFINER function is the only write
-- path. Format: words of a-z0-9 joined by single dashes, 1-64 characters
-- (22023 slug_invalid); a slug another
-- restaurant uses is 23505 slug_taken (restaurants_slug_key). No CHECK on
-- restaurants.slug: the bootstrap derives slugs from names of up to 120
-- characters (seed/bootstrap/create-restaurant.sql), so existing rows may be
-- longer than 64.
CREATE FUNCTION private.set_restaurant_slug(p_slug text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_restaurant_id uuid := private.current_restaurant_id();
BEGIN
  IF v_restaurant_id IS NULL OR private.current_app_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'set_restaurant_slug: admin_required' USING ERRCODE = '42501';
  END IF;
  IF p_slug IS NULL OR length(p_slug) > 64 OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'set_restaurant_slug: slug_invalid' USING ERRCODE = '22023';
  END IF;
  BEGIN
    UPDATE public.restaurants r
       SET slug = p_slug, updated_at = now()
     WHERE r.id = v_restaurant_id AND r.slug IS DISTINCT FROM p_slug;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'set_restaurant_slug: slug_taken' USING ERRCODE = '23505';
  END;
  RETURN p_slug;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.set_restaurant_slug(text) IS 'Renames the slug of the caller''s restaurant (the public carta link /c/<slug>; printed QRs of the old slug stop resolving) and returns it. Admin only (42501 set_restaurant_slug: admin_required); format ^[a-z0-9]+(-[a-z0-9]+)*$, at most 64 characters (22023 slug_invalid); a slug of another restaurant is 23505 slug_taken.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.set_restaurant_slug(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.set_restaurant_slug(text) TO vipe_api;
