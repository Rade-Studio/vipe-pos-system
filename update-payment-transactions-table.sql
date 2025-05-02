-- Verificar si las columnas ya existen antes de agregarlas
DO $$
BEGIN
    -- Verificar si la columna waiter_id existe
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'payment_transactions' 
        AND column_name = 'waiter_id'
    ) THEN
        -- Agregar la columna waiter_id
        ALTER TABLE payment_transactions ADD COLUMN waiter_id UUID REFERENCES profiles(id);
    END IF;

    -- Verificar si la columna tip_amount existe
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'payment_transactions' 
        AND column_name = 'tip_amount'
    ) THEN
        -- Agregar la columna tip_amount
        ALTER TABLE payment_transactions ADD COLUMN tip_amount DECIMAL(10, 2) DEFAULT 0;
    END IF;
END
$$;

-- Crear índice para mejorar el rendimiento de las consultas por waiter_id
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE indexname = 'idx_payment_transactions_waiter_id'
    ) THEN
        CREATE INDEX idx_payment_transactions_waiter_id ON payment_transactions(waiter_id);
    END IF;
END
$$;
