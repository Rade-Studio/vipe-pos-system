import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema';

export type Database = ReturnType<typeof createDb>['db'];

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

export { schema };
