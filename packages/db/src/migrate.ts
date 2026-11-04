import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './index';

/**
 * Apply every pending SQL migration from ./migrations.
 *
 * Usage: DATABASE_URL=postgres://... pnpm --filter @vipe/db migrate
 * This connects as the migration owner (the role that owns the schema), not as
 * the runtime application role.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const { db, pool } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: path.resolve(__dirname, '..', 'migrations') });
    console.log('migrations applied');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
