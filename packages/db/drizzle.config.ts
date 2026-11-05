import { defineConfig } from 'drizzle-kit';

// Migrations are plain SQL files under ./migrations, generated with
// `drizzle-kit generate --custom` and applied by `src/migrate.ts`.
// The baseline schema (squashed from the Supabase era) arrives in task T4 of
// odd/tasks/migracion-backend-nestjs.md.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/vipe_pos',
  },
  strict: true,
  verbose: true,
});
