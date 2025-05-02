-- Crear tabla de transacciones de pago
CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  order_id uuid NOT NULL,
  table_id uuid NOT NULL,
  amount numeric(10, 2) NOT NULL,
  method character varying(20) NOT NULL,
  cash_received numeric(10, 2) NULL,
  cash_change numeric(10, 2) NULL,
  timestamp timestamp with time zone NOT NULL,
  cash_register_id uuid NOT NULL,
  created_at timestamp with time zone NULL DEFAULT now(),
  updated_at timestamp with time zone NULL DEFAULT now(),
  CONSTRAINT payment_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT payment_transactions_cash_register_id_fkey FOREIGN KEY (cash_register_id)
    REFERENCES public.cash_registers (id) ON DELETE CASCADE
);

-- Crear índices para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS payment_transactions_cash_register_id_idx ON public.payment_transactions (cash_register_id);
CREATE INDEX IF NOT EXISTS payment_transactions_order_id_idx ON public.payment_transactions (order_id);
