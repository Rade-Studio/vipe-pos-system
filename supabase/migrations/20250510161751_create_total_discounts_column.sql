alter table public.payment_transactions
  add column total_discounts numeric(10, 2) null default 0;
