import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client';

/** Folder holding the SQL migrations and the Drizzle journal (src/ and dist/ both sit next to it). */
export const migrationsFolder = path.resolve(__dirname, '..', 'migrations');

/**
 * Apply every pending SQL migration. The connection string must belong to the
 * migration owner (vipe_migrator), never to the runtime application role.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  const { db, pool } = createDb(connectionString, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}
