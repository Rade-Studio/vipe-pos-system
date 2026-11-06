-- Development data for the plain-Postgres stack (`pnpm db:dev`).
--
-- Loaded as the superuser after the migrations, into the dev database
-- vipe_pos only (never the test database, never production). Idempotent:
-- every row has a fixed id and `ON CONFLICT (id)`, so running it again keeps
-- one copy and resets the dev passwords.
--
-- Accounts (password for all of them: vipe-dev-2026, documented in README):
--   admin@vipe.local    admin
--   mesero@vipe.local   waiter
--   caja@vipe.local     cashier
--   cocina@vipe.local   kitchen
--   domicilios@vipe.local delivery_operator
--
-- Printer token for the printing service (pos/app.py --dev), documented in
-- README: VIPE_PRINTER_TOKEN=vpt_dev-printer-token-2026. Only its sha256 is stored.
--
-- The hash is argon2id, generated with the API's `argon2` dependency:
--   node -e "require('argon2').hash('vipe-dev-2026',{type:require('argon2').argon2id}).then(console.log)"

BEGIN;

-- One restaurant. Its AFTER INSERT triggers install the default payment
-- methods and the default inventory location.
INSERT INTO public.restaurants (id, slug, name, timezone, currency)
VALUES ('a0eebc99-0000-0000-0000-000000000000', 'default', 'VIPE Dev', 'America/Bogota', 'COP')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, email, password_hash, password_algo, is_active) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'admin@vipe.local',
   '$argon2id$v=19$m=65536,p=4,t=3$gana0wGt7Bl1cmPanKhinA$KlHg+MbfzpiZZOs0ftzlg2lGgWJk9S0hs90FzKwatp4', 'argon2id', true),
  ('d0000000-0000-0000-0000-000000000002', 'mesero@vipe.local',
   '$argon2id$v=19$m=65536,p=4,t=3$gana0wGt7Bl1cmPanKhinA$KlHg+MbfzpiZZOs0ftzlg2lGgWJk9S0hs90FzKwatp4', 'argon2id', true),
  ('d0000000-0000-0000-0000-000000000003', 'caja@vipe.local',
   '$argon2id$v=19$m=65536,p=4,t=3$gana0wGt7Bl1cmPanKhinA$KlHg+MbfzpiZZOs0ftzlg2lGgWJk9S0hs90FzKwatp4', 'argon2id', true),
  ('d0000000-0000-0000-0000-000000000004', 'cocina@vipe.local',
   '$argon2id$v=19$m=65536,p=4,t=3$gana0wGt7Bl1cmPanKhinA$KlHg+MbfzpiZZOs0ftzlg2lGgWJk9S0hs90FzKwatp4', 'argon2id', true),
  ('d0000000-0000-0000-0000-000000000005', 'domicilios@vipe.local',
   '$argon2id$v=19$m=65536,p=4,t=3$gana0wGt7Bl1cmPanKhinA$KlHg+MbfzpiZZOs0ftzlg2lGgWJk9S0hs90FzKwatp4', 'argon2id', true)
ON CONFLICT (id) DO UPDATE
  SET password_hash = EXCLUDED.password_hash, password_algo = EXCLUDED.password_algo, is_active = true;

INSERT INTO public.profiles (id, user_id, full_name, username, email, role, active, restaurant_id) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Admin Dev', 'admin', 'admin@vipe.local', 'admin', true, 'a0eebc99-0000-0000-0000-000000000000'),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'Mesero Dev', 'mesero', 'mesero@vipe.local', 'waiter', true, 'a0eebc99-0000-0000-0000-000000000000'),
  ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003', 'Caja Dev', 'caja', 'caja@vipe.local', 'cashier', true, 'a0eebc99-0000-0000-0000-000000000000'),
  ('e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000004', 'Cocina Dev', 'cocina', 'cocina@vipe.local', 'kitchen', true, 'a0eebc99-0000-0000-0000-000000000000'),
  ('e0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000005', 'Domicilios Dev', 'domicilios', 'domicilios@vipe.local', 'delivery_operator', true, 'a0eebc99-0000-0000-0000-000000000000')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.categories (id, name, description, icon, active, restaurant_id) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'Entradas', 'Para empezar', 'salad', true, 'a0eebc99-0000-0000-0000-000000000000'),
  ('c0000000-0000-0000-0000-000000000002', 'Platos fuertes', 'Especialidades de la casa', 'utensils', true, 'a0eebc99-0000-0000-0000-000000000000'),
  ('c0000000-0000-0000-0000-000000000003', 'Bebidas', 'Frías y calientes', 'coffee', true, 'a0eebc99-0000-0000-0000-000000000000')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.dishes (id, name, description, price, category_id, active, allow_comments, restaurant_id) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'Empanadas', 'Tres empanadas de carne', 9000, 'c0000000-0000-0000-0000-000000000001', true, true, 'a0eebc99-0000-0000-0000-000000000000'),
  ('f0000000-0000-0000-0000-000000000002', 'Patacones', 'Con hogao', 8000, 'c0000000-0000-0000-0000-000000000001', true, false, 'a0eebc99-0000-0000-0000-000000000000'),
  ('f0000000-0000-0000-0000-000000000003', 'Bandeja paisa', 'Plato completo', 32000, 'c0000000-0000-0000-0000-000000000002', true, true, 'a0eebc99-0000-0000-0000-000000000000'),
  ('f0000000-0000-0000-0000-000000000004', 'Ajiaco', 'Con pollo y alcaparras', 28000, 'c0000000-0000-0000-0000-000000000002', true, true, 'a0eebc99-0000-0000-0000-000000000000'),
  ('f0000000-0000-0000-0000-000000000005', 'Limonada', 'Natural', 6000, 'c0000000-0000-0000-0000-000000000003', true, false, 'a0eebc99-0000-0000-0000-000000000000'),
  ('f0000000-0000-0000-0000-000000000006', 'Café', 'Tinto', 3000, 'c0000000-0000-0000-0000-000000000003', true, false, 'a0eebc99-0000-0000-0000-000000000000')
ON CONFLICT (id) DO NOTHING;

-- On a dev database migrated before this seed, 0012 already created
-- "Salón principal": any conflict keeps it, and tables resolve zones by name.
INSERT INTO public.zones (id, restaurant_id, name, aspect, sort_order, labels) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'a0eebc99-0000-0000-0000-000000000000', 'Salón principal', 1.6, 0, '[{"text": "Entrada", "side": "bottom"}]'),
  ('b0000000-0000-0000-0000-000000000002', 'a0eebc99-0000-0000-0000-000000000000', 'Barra', 2.2, 1, '[]')
ON CONFLICT DO NOTHING;

INSERT INTO public.tables (id, number, status, restaurant_id, zone_id, x, y, w, h, shape, seats)
SELECT l.id::uuid, l.n, 'available', z.restaurant_id, z.id, l.x, l.y, l.w, l.h, l.shape, l.seats
  FROM (VALUES
    ('b1000000-0000-0000-0000-000000000001', 1, 'Salón principal', 0.2, 0.3, 0.11, 0.11, 'round', 4),
    ('b1000000-0000-0000-0000-000000000002', 2, 'Salón principal', 0.5, 0.3, 0.11, 0.11, 'square', 4),
    ('b1000000-0000-0000-0000-000000000003', 3, 'Salón principal', 0.8, 0.3, 0.22, 0.11, 'rect', 6),
    ('b1000000-0000-0000-0000-000000000004', 4, 'Salón principal', 0.3, 0.72, 0.11, 0.11, 'round', 2),
    ('b1000000-0000-0000-0000-000000000005', 5, 'Salón principal', 0.7, 0.72, 0.11, 0.11, 'square', 4),
    ('b1000000-0000-0000-0000-000000000006', 6, 'Barra', 0.5, 0.5, 0.5, 0.09, 'bar', 0)
  ) AS l(id, n, zone, x, y, w, h, shape, seats)
  JOIN public.zones z ON z.restaurant_id = 'a0eebc99-0000-0000-0000-000000000000' AND z.name = l.zone
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.printer_tokens (id, restaurant_id, name, token_hash) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'a0eebc99-0000-0000-0000-000000000000', 'Impresoras dev',
   encode(sha256(convert_to('vpt_dev-printer-token-2026', 'UTF8')), 'hex'))
ON CONFLICT (id) DO UPDATE SET token_hash = EXCLUDED.token_hash, revoked_at = NULL;

COMMIT;
