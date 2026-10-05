-- Schema smoke test.
--
-- Proves the pgTAP harness works and that the core tables this project depends
-- on exist in the public schema of the running database.
--
-- The runner wraps this file in a transaction that is rolled back.

SELECT plan(10);

-- pgtap itself is usable (the runner creates the extension inside the
-- transaction, so it is never left installed).
SELECT has_extension('public', 'pgtap', 'pgtap extension is available');
SELECT ok(true, 'pgTAP assertions run inside the test transaction');

-- Core tables.
SELECT has_table('public', 'orders', 'table orders exists');
SELECT has_table('public', 'order_items', 'table order_items exists');
SELECT has_table('public', 'tables', 'table tables exists');
SELECT has_table('public', 'payment_transactions', 'table payment_transactions exists');
SELECT has_table('public', 'cash_registers', 'table cash_registers exists');
SELECT has_table('public', 'profiles', 'table profiles exists');
SELECT has_table('public', 'restaurants', 'table restaurants exists');
SELECT has_table('public', 'business_config', 'table business_config exists');