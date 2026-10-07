-- Schema smoke test.
--
-- Proves the pgTAP harness works and that the core tables this project depends
-- on exist in the public schema of the local database.
--
-- Self-contained on purpose: `supabase test db` runs this file through
-- pg_prove, which does not wrap anything for us, so the file opens its own
-- transaction and always rolls back.

BEGIN;

-- Supabase ships pgtap pre-installed in `extensions`; if it is ever missing a
-- bare CREATE EXTENSION lands in the first schema of the search_path. Cover
-- both locations.
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;

SELECT plan(9);

-- pgtap itself is usable (created inside the transaction, so it is never left
-- behind when it was not installed before the run).
SELECT ok(
  EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgtap'),
  'pgtap extension is available'
);

-- Core tables.
SELECT has_table('public', 'orders', 'table orders exists');
SELECT has_table('public', 'order_items', 'table order_items exists');
SELECT has_table('public', 'tables', 'table tables exists');
SELECT has_table('public', 'payment_transactions', 'table payment_transactions exists');
SELECT has_table('public', 'cash_registers', 'table cash_registers exists');
SELECT has_table('public', 'profiles', 'table profiles exists');
SELECT has_table('public', 'restaurants', 'table restaurants exists');
SELECT has_table('public', 'business_config', 'table business_config exists');

SELECT * FROM finish();
ROLLBACK;