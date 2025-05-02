-- Crear tabla para categorías de ingredientes
CREATE TABLE IF NOT EXISTS ingredient_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Crear tabla para transacciones de ingredientes
CREATE TABLE IF NOT EXISTS ingredient_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ingredient_id UUID REFERENCES ingredients(id),
  quantity DECIMAL(10, 2) NOT NULL,
  total_cost DECIMAL(10, 2) NOT NULL,
  unit_cost DECIMAL(10, 2) NOT NULL,
  transaction_type VARCHAR(20) NOT NULL, -- 'entrada', 'salida', 'ajuste'
  payment_status VARCHAR(20) NOT NULL DEFAULT 'pagado', -- 'pagado', 'pendiente'
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Agregar campo de costo a la tabla de ingredientes si no existe
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS cost DECIMAL(10, 2) DEFAULT 0;

-- Crear índices para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS idx_ingredient_transactions_ingredient ON ingredient_transactions(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_ingredient_transactions_type ON ingredient_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_ingredient_transactions_status ON ingredient_transactions(payment_status);
