import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb, runMigrations } from '@vipe/db';
import * as argon2 from 'argon2';
import { hash as bcryptHash } from 'bcryptjs';

const ROLES_SQL = path.resolve(__dirname, '../../../../packages/db/scripts/roles.sql');
const DATABASE = 'vipe_pos';
const MIGRATOR_PASSWORD = 'vipe_migrator';
const API_PASSWORD = 'vipe_api';

export const PASSWORD = 'correct horse battery staple';

/** Fixture ids shared by the integration specs. */
export const fixtures = {
  restaurantA: 'a0000000-0000-0000-0000-00000000000a',
  restaurantB: 'b0000000-0000-0000-0000-00000000000b',
  adminA: { userId: '10000000-0000-0000-0000-000000000001', profileId: '20000000-0000-0000-0000-000000000001', email: 'admin@a.test' },
  waiterA: { userId: '10000000-0000-0000-0000-000000000002', profileId: '20000000-0000-0000-0000-000000000002', email: 'waiter@a.test' },
  adminB: { userId: '10000000-0000-0000-0000-000000000003', profileId: '20000000-0000-0000-0000-000000000003', email: 'admin@b.test' },
  inactive: { userId: '10000000-0000-0000-0000-000000000004', profileId: '20000000-0000-0000-0000-000000000004', email: 'inactive@a.test' },
  noProfile: { userId: '10000000-0000-0000-0000-000000000005', email: 'noprofile@a.test' },
  bcryptUser: { userId: '10000000-0000-0000-0000-000000000006', profileId: '20000000-0000-0000-0000-000000000006', email: 'legacy@a.test' },
  ordersInA: 2,
  ordersInB: 1,
} as const;

export interface TestDatabase {
  /** Connection string of the API runtime role (vipe_api). */
  readonly apiUrl: string;
  /** Superuser connection string, for fixtures and assertions behind RLS. */
  readonly superuserUrl: string;
  stop(): Promise<void>;
}

/**
 * Start a throwaway Postgres 16 with the production layout: roles.sql as the
 * superuser, every migration applied as vipe_migrator through @vipe/db, the
 * fixtures above inserted as the superuser. The API connects as vipe_api.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase(DATABASE)
    .withUsername('postgres')
    .withPassword('postgres')
    .withCopyFilesToContainer([{ source: ROLES_SQL, target: '/tmp/roles.sql' }])
    .start();

  const roles = await container.exec([
    'psql', '-U', 'postgres', '-d', DATABASE, '-v', 'ON_ERROR_STOP=1', '-q',
    '-v', `migrator_password=${MIGRATOR_PASSWORD}`,
    '-v', `api_password=${API_PASSWORD}`,
    '-v', `db_name=${DATABASE}`,
    '-f', '/tmp/roles.sql',
  ]);
  if (roles.exitCode !== 0) {
    throw new Error(`roles.sql failed: ${roles.output}`);
  }

  const host = container.getHost();
  const port = container.getPort();
  await runMigrations(`postgres://vipe_migrator:${MIGRATOR_PASSWORD}@${host}:${port}/${DATABASE}`);

  const superuserUrl = container.getConnectionUri();
  await seed(superuserUrl);

  return {
    apiUrl: `postgres://vipe_api:${API_PASSWORD}@${host}:${port}/${DATABASE}`,
    superuserUrl,
    stop: async () => {
      await container.stop();
    },
  };
}

/** Run one query as the superuser (RLS does not apply). */
export async function superuserQuery<T = Record<string, unknown>>(url: string, text: string, values: unknown[] = []) {
  const { pool } = createDb(url, { max: 1 });
  try {
    return (await pool.query(text, values)).rows as T[];
  } finally {
    await pool.end();
  }
}

async function seed(superuserUrl: string) {
  const argonHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  const legacyHash = await bcryptHash(PASSWORD, 4);
  const f = fixtures;
  const { pool } = createDb(superuserUrl, { max: 1 });
  try {
    await pool.query(
      `INSERT INTO public.restaurants (id, slug, name) VALUES ($1, 'rest-a', 'Restaurant A'), ($2, 'rest-b', 'Restaurant B')`,
      [f.restaurantA, f.restaurantB],
    );
    await pool.query(
      `INSERT INTO public.users (id, email, password_hash, password_algo, is_active) VALUES
         ($1, $2, $13, 'argon2id', true),
         ($3, $4, $13, 'argon2id', true),
         ($5, $6, $13, 'argon2id', true),
         ($7, $8, $13, 'argon2id', false),
         ($9, $10, $13, 'argon2id', true),
         ($11, $12, $14, 'bcrypt', true)`,
      [
        f.adminA.userId, f.adminA.email, f.waiterA.userId, f.waiterA.email, f.adminB.userId, f.adminB.email,
        f.inactive.userId, f.inactive.email, f.noProfile.userId, f.noProfile.email, f.bcryptUser.userId,
        f.bcryptUser.email, argonHash, legacyHash,
      ],
    );
    await pool.query(
      `INSERT INTO public.profiles (id, user_id, full_name, email, role, restaurant_id) VALUES
         ($1, $2, 'Admin A', 'admin@a.test', 'admin', $11),
         ($3, $4, 'Waiter A', 'waiter@a.test', 'waiter', $11),
         ($5, $6, 'Admin B', 'admin@b.test', 'admin', $12),
         ($7, $8, 'Inactive A', 'inactive@a.test', 'waiter', $11),
         ($9, $10, 'Legacy A', 'legacy@a.test', 'cashier', $11)`,
      [
        f.adminA.profileId, f.adminA.userId, f.waiterA.profileId, f.waiterA.userId, f.adminB.profileId,
        f.adminB.userId, f.inactive.profileId, f.inactive.userId, f.bcryptUser.profileId, f.bcryptUser.userId,
        f.restaurantA, f.restaurantB,
      ],
    );
    await pool.query(
      `INSERT INTO public.orders (status, subtotal, tax, tax_percentage, total, restaurant_id) VALUES
         ('active', 10, 0, 0, 10, $1), ('active', 20, 0, 0, 20, $1), ('active', 30, 0, 0, 30, $2)`,
      [f.restaurantA, f.restaurantB],
    );
  } finally {
    await pool.end();
  }
}
