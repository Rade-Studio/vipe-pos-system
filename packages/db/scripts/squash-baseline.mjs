#!/usr/bin/env node
// Turn a Supabase-era pg_dump into the plain-Postgres baseline migration.
//
// Input: `pg_dump --schema-only --no-owner --schema=public --schema=private`
// of a database where every supabase/migrations/*.sql file was applied. The
// dump keeps privileges on purpose: the grants that `authenticated` held are
// the exact list of tables and RPCs the web uses today, and they become the
// grants of `vipe_api`. Every other grant is dropped.
//
// Usage: node scripts/squash-baseline.mjs dump.sql > migrations/0000_baseline.sql
// The removal counts are printed to stderr for the task log.
//
// Design: odd/tasks/migracion-backend-nestjs.md, "Design: T4 plain-Postgres
// baseline", steps 1-5. Tables are never edited beyond these rewrites.

import { readFileSync } from 'node:fs';

// Own identity table, replacing auth.users (design step 3). Placed before the
// dumped objects so profiles.user_id can reference it.
const USERS = `--
-- Name: citext; Type: EXTENSION; Schema: public; Owner: -
--

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email public.citext NOT NULL,
    password_hash text NOT NULL,
    password_algo text DEFAULT 'argon2id'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_pkey PRIMARY KEY (id),
    CONSTRAINT users_email_key UNIQUE (email)
);


--
-- Name: TABLE users; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.users IS 'Login identities owned by the API (replaces Supabase auth.users). profiles.user_id links a user to its tenant and role; the API creates both rows.';

`;

// Caller identity for RLS and the RPCs (design step 4): the API runs
// SET LOCAL app.user_id = '<uuid>' at the start of every request transaction.
const CURRENT_USER_ID = `--
-- Name: current_user_id(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.current_user_id() RETURNS uuid
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT NULLIF(pg_catalog.current_setting('app.user_id', true), '')::uuid
$$;


--
-- Name: FUNCTION current_user_id(); Type: COMMENT; Schema: private; Owner: -
--

COMMENT ON FUNCTION private.current_user_id() IS 'Caller of the current transaction, read from the app.user_id setting the API sets with SET LOCAL. NULL when the setting is absent or empty, so every tenant helper and RLS predicate matches nothing.';


`;

// Objects that need the dumped functions, and the grants the dump cannot carry.
const TRAILER = `--
-- Name: users set_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: vipe_api grants outside the dump; Type: ACL; Schema: -; Owner: -
--

REVOKE ALL ON FUNCTION private.current_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.current_user_id() TO vipe_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.users TO vipe_api;

ALTER DEFAULT PRIVILEGES FOR ROLE vipe_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vipe_api;
ALTER DEFAULT PRIVILEGES FOR ROLE vipe_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO vipe_api;
`;

const input = readFileSync(process.argv[2], 'utf8');
const counts = {};
const count = (key, n = 1) => {
  counts[key] = (counts[key] ?? 0) + n;
};

// pg_dump separates objects with a "-- Name: ...; Type: ...; Schema: ..." header.
const parts = input.split(/\n(?=--\n-- Name: )/);
const preamble = parts.shift();
const header = (block) => /^--\n-- Name: (.*?); Type: (.*?); Schema: (.*?); Owner:/.exec(block);

const out = [];
for (const block of parts) {
  const h = header(block);
  if (!h) throw new Error(`unexpected block:\n${block.slice(0, 200)}`);
  const [, name, type, schema] = h;

  // Supabase Auth hook: profile creation moves to the API (T12).
  if (/\bhandle_new_user\(\)/.test(name)) {
    count(`dropped ${type} handle_new_user()`);
    continue;
  }
  // The public schema already exists on plain Postgres.
  if (schema === '-' && type !== 'ACL' && /^(public|SCHEMA public)$/.test(name)) {
    count(`dropped ${type} ${name}`);
    continue;
  }
  if (type === 'DEFAULT ACL') {
    count('dropped DEFAULT ACL (Supabase roles)');
    continue;
  }
  if (type === 'ACL') {
    out.push(rewriteAcl(block, name));
    continue;
  }
  out.push(block);
}

let sql = [rewritePreamble(preamble), ...out].join('\n');

// Line-level rewrites across functions, policies, defaults and constraints.
const rewrites = [
  ['extensions.uuid_generate_v4()', 'gen_random_uuid()'],
  ['auth.uid()', 'private.current_user_id()'],
  ['REFERENCES auth.users(id)', 'REFERENCES public.users(id)'],
  ['auth_user_id', 'user_id'],
  [/ TO authenticated (USING|WITH CHECK)/g, ' TO vipe_api $1'],
  // SECURITY DEFINER functions run as their owner. On Supabase the owner was
  // postgres; here it is vipe_migrator, so the RPC bypass in the guard
  // triggers must recognise it, and the Supabase-only roles go away.
  ["current_user IN ('postgres', 'service_role', 'supabase_admin')", "current_user IN ('postgres', 'vipe_migrator')"],
  ['postgres/service_role/supabase_admin', 'postgres/vipe_migrator'],
  ["WHEN current_user = 'authenticated' THEN", "WHEN current_user = 'vipe_api' THEN"],
];
for (const [from, to] of rewrites) {
  const re = typeof from === 'string' ? new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : from;
  const n = (sql.match(re) ?? []).length;
  if (n === 0) throw new Error(`rewrite matched nothing: ${from}`);
  count(`rewrote ${from}`, n);
  sql = sql.replace(re, to);
}

// The tenant helpers resolve the caller from the API session setting.
sql = sql.replace(
  /\n(?=--\n-- Name: current_app_role\(\); Type: FUNCTION; Schema: private)/,
  () => `\n${CURRENT_USER_ID}`,
);

for (const leftover of ['auth.', 'storage.', 'extensions.', 'graphql', 'supabase_realtime', 'pgsodium', 'vault.', 'service_role', 'supabase_admin', ' TO authenticated', ' TO anon']) {
  const lines = sql.split('\n').filter((l) => l.includes(leftover) && !l.startsWith('COMMENT ON') && !l.trimStart().startsWith('--'));
  if (lines.length) throw new Error(`leftover reference ${leftover}:\n${lines.join('\n')}`);
}

process.stdout.write(`${sql.trimEnd()}\n\n${TRAILER}`);
for (const [k, v] of Object.entries(counts)) process.stderr.write(`${String(v).padStart(4)}  ${k}\n`);

function rewritePreamble(text) {
  const lines = text.split('\n').filter((line) => {
    // psql meta-commands and PG17-only settings do not run through the
    // Drizzle migrator on Postgres 16.
    if (/^\\(un)?restrict /.test(line) || /^SET transaction_timeout/.test(line)) {
      count('dropped preamble line (psql meta / PG17 setting)');
      return false;
    }
    return !/^-- Dumped (from|by)/.test(line);
  });
  return `${lines.join('\n').trimEnd()}\n\n${USERS}`;
}

function rewriteAcl(block, name) {
  const body = block.split('\n').map((line) => {
    if (!/^(GRANT|REVOKE) /.test(line)) return line;
    if (/^REVOKE ALL ON .* FROM PUBLIC;$/.test(line)) return line;
    const m = /^GRANT (?:ALL|USAGE) ON (TABLE|FUNCTION|SCHEMA) (.*) TO authenticated;$/.exec(line);
    if (m) {
      const [, kind, object] = m;
      count(`translated GRANT ON ${kind} authenticated -> vipe_api`);
      const privilege = { TABLE: 'SELECT, INSERT, UPDATE, DELETE', FUNCTION: 'EXECUTE', SCHEMA: 'USAGE' }[kind];
      return `GRANT ${privilege} ON ${kind} ${object} TO vipe_api;`;
    }
    const role = /(?:TO|FROM) (\w+);$/.exec(line)?.[1] ?? 'unknown';
    count(`dropped ${line.split(' ')[0]} for role ${role}`);
    return null;
  });
  const kept = body.filter((line) => line !== null);
  if (!kept.some((line) => /^(GRANT|REVOKE) /.test(line))) {
    count(`dropped empty ACL block`);
    return '';
  }
  return kept.join('\n');
}
