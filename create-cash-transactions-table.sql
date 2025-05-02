-- Crear tabla para transacciones de efectivo
CREATE TABLE IF NOT EXISTS cash_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  amount DECIMAL(10, 2) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('deposit', 'withdrawal')),
  description TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cash_register_id UUID NOT NULL REFERENCES cash_registers(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Crear índices para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS idx_cash_transactions_cash_register_id ON cash_transactions(cash_register_id);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_timestamp ON cash_transactions(timestamp);
