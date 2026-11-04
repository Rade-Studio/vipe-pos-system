import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import * as schema from './schema';

/**
 * Create a Drizzle client over a `pg` pool.
 *
 * The connection string must belong to the application role: never a
 * superuser and never a role with BYPASSRLS, because row level security is
 * the second line of defense behind the API's own guards.
 */
export function createDb(connectionString: string, poolConfig: Omit<PoolConfig, 'connectionString'> = {}) {
  const pool = new Pool({ connectionString, ...poolConfig });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

/**
 * Bind a Drizzle client to one checked-out connection, so every query runs in
 * the transaction (and the `app.user_id` setting) opened on that connection.
 */
export function bindDb(client: PoolClient) {
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof bindDb>;
