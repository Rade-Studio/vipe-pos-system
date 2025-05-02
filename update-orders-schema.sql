-- Add status column to order_items if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'order_items' AND column_name = 'status') THEN
        ALTER TABLE order_items ADD COLUMN status TEXT DEFAULT 'kitchen' CHECK (status IN ('kitchen', 'served', 'paid'));
    END IF;
END$$;

-- Update orders table status constraint if needed
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('active', 'cancelled', 'paid'));
