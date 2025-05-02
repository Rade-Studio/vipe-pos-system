-- Crear tabla para configuraciones del negocio
CREATE TABLE IF NOT EXISTS business_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key VARCHAR(100) NOT NULL UNIQUE,
  value TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insertar configuraciones iniciales si no existen
INSERT INTO business_config (key, value)
VALUES 
  ('tax_percentage', '10'),
  ('tip_percentage', '10'),
  ('business_name', 'Mi Restaurante'),
  ('business_address', 'Dirección del Restaurante'),
  ('business_phone', '123-456-7890'),
  ('business_nit', '123456789')
ON CONFLICT (key) DO NOTHING;

-- Trigger para actualizar el campo updated_at
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_business_config_timestamp ON business_config;
CREATE TRIGGER update_business_config_timestamp
BEFORE UPDATE ON business_config
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();
