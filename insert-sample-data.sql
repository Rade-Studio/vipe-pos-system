-- Insertar categorías de ejemplo
INSERT INTO categories (name, icon, active, created_at, updated_at)
VALUES 
  ('Entradas', 'utensils', true, NOW(), NOW()),
  ('Platos Principales', 'pizza', true, NOW(), NOW()),
  ('Postres', 'icecream', true, NOW(), NOW()),
  ('Bebidas', 'water', true, NOW(), NOW()),
  ('Café', 'coffee', true, NOW(), NOW());

-- Insertar platos de ejemplo
INSERT INTO dishes (name, description, price, category_id, image_url, active, created_at, updated_at)
VALUES 
  -- Entradas
  ('Ensalada César', 'Lechuga romana, crutones, queso parmesano y aderezo César', 25000, (SELECT id FROM categories WHERE name = 'Entradas' LIMIT 1), '/placeholder.svg?height=80&width=80', true, NOW(), NOW()),
  ('Nachos con Queso', 'Totopos con queso cheddar derretido, jalapeños y guacamole', 18000, (SELECT id FROM categories WHERE name = 'Entradas' LIMIT 1), '/placeholder.svg?height=80&width=80', true, NOW(), NOW()),
  ('Alitas de Pollo', 'Alitas de pollo bañadas en salsa BBQ o búfalo', 22000, (SELECT id FROM categories WHERE name = 'Entradas' LIMIT 1), '/placeholder.svg?height=80&width=80', true, NOW(), NOW()),
  
  -- Platos Principales
  ('Hamburguesa', 'Carne de res, queso cheddar, lechuga, tomate y cebolla', 28000, (SELECT id FROM categories WHERE name = 'Platos Principales' LIMIT 1), '/placeholder.svg?height=80&width=80', true, NOW(), NOW()),
  ('Pizza Margarita', 'Salsa de tomate, mozzarella y albahaca', 35000, (SELECT id FROM categories WHERE name = 'Platos Principales' LIMIT 1), '/placeholder.svg?height=80&width=80', true, NOW(), NOW()),
  ('Pasta Alfredo', 'Fettuccine con salsa cremosa de queso parmesano', 30000, (SELECT id FROM categories WHERE name = 'Platos Principales' LIMIT 1), '/placeholder.svg?height=80&width=80', true, NOW(), NOW()),
  
  -- Postres
  ('Tarta de Chocolate', 'Tarta de chocolate con helado de vainilla', 15000, (SELECT id FROM categories WHERE name = 'Postres' LIMIT 1), '/placeholder.svg?height=80&width=80', true, NOW(), NOW()),
  ('Helado de Vainilla', 'Helado cremoso de vainilla con salsa de chocolate', 12000, (SELECT id FROM categories WHERE name = 'Postres' LIMIT 1), '/placeholder.svg?height=80&width=80', true, NOW(), NOW()),
  
  -- Bebidas
  ('Agua Mineral', 'Agua mineral con o sin gas', 5000, (SELECT id FROM categories WHERE name = 'Bebidas' LIMIT 1), '/placeholder.svg?height=80&width=80', true, NOW(), NOW()),
  ('Refresco', 'Coca-Cola, Sprite, Fanta', 6000, (SELECT id FROM categories WHERE name = 'Bebidas' LIMIT 1), '/placeholder.svg?height=80&width=80', true, NOW(), NOW()),
  
  -- Café
  ('Café Americano', 'Café negro recién hecho', 8000, (SELECT id FROM categories WHERE name = 'Café' LIMIT 1), '/placeholder.svg?height=80&width=80', true, NOW(), NOW()),
  ('Cappuccino', 'Espresso con leche vaporizada y espuma de leche', 10000, (SELECT id FROM categories WHERE name = 'Café' LIMIT 1), '/placeholder.svg?height=80&width=80', true, NOW(), NOW());

-- Insertar mesas de ejemplo si no existen
INSERT INTO tables (number, status, created_at, updated_at)
SELECT generate_series(1, 8), 'available', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM tables LIMIT 1);

-- Insertar un mesero de ejemplo si no existe
INSERT INTO profiles (full_name, username, email, password, role, active, created_at, updated_at)
SELECT 'Juan Pérez', 'jperez', 'jperez@example.com', 'password123', 'waiter', true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE role = 'waiter' LIMIT 1);
