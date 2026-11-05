import { runMigrations } from './migrator';

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
  await runMigrations(url);
  console.log('migrations applied');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
