-- Rows whose foreign key points at nothing, for every foreign key of the
-- public and private schemas. The import loads with
-- session_replication_role = replica, which also skips the foreign-key
-- triggers, so import.sql and verify.sql both run this explicitly.
-- Fills pg_temp.orphan_findings (fk, orphans) with one row per foreign key.
CREATE TEMP TABLE IF NOT EXISTS orphan_findings (fk text PRIMARY KEY, orphans bigint NOT NULL);
TRUNCATE orphan_findings;
DO $$
DECLARE
  fk record;
  n bigint;
BEGIN
  FOR fk IN
    SELECT c.conname, c.conrelid::regclass AS child, c.confrelid::regclass AS parent,
           (SELECT string_agg(format('c.%I IS NOT NULL', a.attname), ' AND ' ORDER BY k.ord)
              FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS not_null,
           (SELECT string_agg(format('p.%I = c.%I', pa.attname, ca.attname), ' AND ' ORDER BY k.ord)
              FROM unnest(c.conkey, c.confkey) WITH ORDINALITY k(child_att, parent_att, ord)
              JOIN pg_attribute ca ON ca.attrelid = c.conrelid AND ca.attnum = k.child_att
              JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = k.parent_att) AS join_on
      FROM pg_constraint c
     WHERE c.contype = 'f'
       AND c.connamespace IN ('public'::regnamespace, 'private'::regnamespace)
  LOOP
    EXECUTE format('SELECT count(*) FROM %s c WHERE %s AND NOT EXISTS (SELECT 1 FROM %s p WHERE %s)',
                   fk.child, fk.not_null, fk.parent, fk.join_on)
       INTO n;
    INSERT INTO orphan_findings VALUES (format('%s.%s -> %s', fk.child, fk.conname, fk.parent), n);
  END LOOP;
END $$;
