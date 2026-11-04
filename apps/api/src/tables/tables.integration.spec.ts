import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/** Rows seeded as the superuser for this spec only. */
const t = {
  waiter2Profile: '20000000-0000-0000-0000-0000000000d2',
  retiredWaiter: '20000000-0000-0000-0000-0000000000d3',
  waiterB: '20000000-0000-0000-0000-0000000000db',
  free: 'f9000000-0000-0000-0000-000000000001',
  busy: 'f9000000-0000-0000-0000-000000000002',
  kitchen: 'f9000000-0000-0000-0000-000000000003',
  served: 'f9000000-0000-0000-0000-000000000004',
  reserved: 'f9000000-0000-0000-0000-000000000005',
  paidOnly: 'f9000000-0000-0000-0000-000000000006',
  otherTable: 'f9000000-0000-0000-0000-0000000000b1',
} as const;

const TABLE_KEYS = ['createdAt', 'id', 'number', 'status', 'updatedAt', 'waiterId', 'waiterName'];

describe('tables and waiters endpoints (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    database = await startTestDatabase();
    await seedTables(database.superuserUrl);
    app = await createTestApp(database.apiUrl);
    for (const user of [fixtures.adminA, fixtures.waiterA, fixtures.adminB]) {
      const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
      cookies[user.email] = cookiePair(setCookies(res).vipe_access);
    }
  });

  afterAll(async () => {
    await app?.close();
    await database?.stop();
  });

  const as = (user: { email: string }) => {
    const server = request(app.getHttpServer());
    const cookie = cookies[user.email];
    return {
      get: (url: string) => server.get(url).set('Cookie', cookie),
      post: (url: string, body?: object) => server.post(url).set('Cookie', cookie).send(body),
      patch: (url: string, body?: object) => server.patch(url).set('Cookie', cookie).send(body),
      delete: (url: string) => server.delete(url).set('Cookie', cookie),
    };
  };
  const adminA = () => as(fixtures.adminA);
  const waiterA = () => as(fixtures.waiterA);
  const adminB = () => as(fixtures.adminB);
  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    superuserQuery<T>(database.superuserUrl, text, values);
  const tableRow = async (id: string) =>
    (
      await db<{ status: string; waiter_id: string | null; number: number }>(
        'SELECT status, waiter_id, number FROM tables WHERE id = $1',
        [id],
      )
    )[0];

  it('answers 401 without the access cookie', async () => {
    expect((await request(app.getHttpServer()).get('/api/tables')).status).toBe(401);
  });

  describe('GET /tables', () => {
    it('lists the restaurant tables by number with the waiter name, for any role', async () => {
      const res = await waiterA().get('/api/tables');
      expect(res.status).toBe(200);
      expect(res.body.map((row: { number: number }) => row.number)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(Object.keys(res.body[0]).sort()).toEqual(TABLE_KEYS);
      expect(res.body[1]).toMatchObject({ id: t.busy, status: 'occupied', waiterId: fixtures.waiterA.profileId, waiterName: 'Waiter A' });
      expect(res.body[0]).toMatchObject({ id: t.free, waiterId: null, waiterName: null });
    });

    it("never shows restaurant A's tables to restaurant B", async () => {
      const res = await adminB().get('/api/tables');
      expect(res.body.map((row: { id: string }) => row.id)).toEqual([t.otherTable]);
    });
  });

  describe('admin writes', () => {
    it('creates a table (status available by default) and rejects the waiter with 403', async () => {
      const res = await adminA().post('/api/tables', { number: 7 });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ number: 7, status: 'available', waiterId: null, waiterName: null });
      const [row] = await db<{ restaurant_id: string }>('SELECT restaurant_id FROM tables WHERE id = $1', [res.body.id]);
      expect(row.restaurant_id).toBe(fixtures.restaurantA);
      expect((await waiterA().post('/api/tables', { number: 8 })).status).toBe(403);
      expect(await db('SELECT 1 FROM tables WHERE number = 8')).toHaveLength(0);
    });

    it('patches number, status and waiter with a server timestamp; 422 for a status outside the list', async () => {
      const [before] = await db<{ updated_at: Date }>('SELECT updated_at FROM tables WHERE id = $1', [t.reserved]);
      const res = await adminA().patch(`/api/tables/${t.reserved}`, { number: 50, waiterId: t.waiter2Profile });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ number: 50, status: 'reserved', waiterId: t.waiter2Profile, waiterName: 'Waiter Dos' });
      const [after] = await db<{ updated_at: Date }>('SELECT updated_at FROM tables WHERE id = $1', [t.reserved]);
      expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
      expect((await adminA().patch(`/api/tables/${t.reserved}`, { status: 'paid' })).status).toBe(422);
      expect((await adminA().patch(`/api/tables/${t.reserved}`, { updatedAt: new Date().toISOString() })).status).toBe(422);
      expect((await waiterA().patch(`/api/tables/${t.reserved}`, { number: 51 })).status).toBe(403);
      await adminA().patch(`/api/tables/${t.reserved}`, { number: 5 });
    });

    it('answers 422 for a waiter of another restaurant and 404 for a table of another restaurant', async () => {
      const foreign = await adminA().patch(`/api/tables/${t.reserved}`, { waiterId: t.waiterB });
      expect(foreign.status).toBe(422);
      expect(foreign.body.message).toBe('Unknown waiter');
      expect((await adminB().patch(`/api/tables/${t.reserved}`, { number: 99 })).status).toBe(404);
      expect((await adminB().delete(`/api/tables/${t.free}`)).status).toBe(404);
      expect(await tableRow(t.reserved)).toMatchObject({ number: 5, waiter_id: t.waiter2Profile });
    });

    it('answers 409 Table has open orders and keeps the table', async () => {
      const res = await adminA().delete(`/api/tables/${t.kitchen}`);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ statusCode: 409, error: 'Conflict', message: 'Table has open orders' });
      expect(await tableRow(t.kitchen)).toBeDefined();
    });

    it('deletes a table whose orders are all paid', async () => {
      const res = await adminA().delete(`/api/tables/${t.paidOnly}`);
      expect(res.status).toBe(204);
      expect(await tableRow(t.paidOnly)).toBeUndefined();
      expect((await waiterA().delete(`/api/tables/${t.free}`)).status).toBe(403);
    });
  });

  describe('assign and release', () => {
    it('assigns a waiter: the table becomes occupied', async () => {
      const res = await waiterA().post(`/api/tables/${t.free}/assign`, { waiterId: fixtures.waiterA.profileId });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: t.free, status: 'occupied', waiterId: fixtures.waiterA.profileId, waiterName: 'Waiter A' });
      expect(await tableRow(t.free)).toMatchObject({ status: 'occupied', waiter_id: fixtures.waiterA.profileId });
      const foreign = await waiterA().post(`/api/tables/${t.free}/assign`, { waiterId: t.waiterB });
      expect(foreign.status).toBe(422);
    });

    it('releases an occupied table: available and no waiter', async () => {
      const res = await waiterA().post(`/api/tables/${t.busy}/release`, {});
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'available', waiterId: null, waiterName: null });
      expect(await tableRow(t.busy)).toMatchObject({ status: 'available', waiter_id: null });
    });

    it.each([
      ['kitchen', t.kitchen],
      ['served', t.served],
      ['reserved', t.reserved],
    ])('answers 409 when releasing a %s table, even with force from a waiter', async (status, id) => {
      const res = await waiterA().post(`/api/tables/${id}/release`, { force: true });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        statusCode: 409,
        error: 'Conflict',
        message: `Table cannot be released while ${status}`,
      });
      expect(await tableRow(id)).toMatchObject({ status });
      expect((await adminA().post(`/api/tables/${id}/release`, {})).status).toBe(409);
    });

    it('answers 409 when releasing a table marked delivered', async () => {
      await db("UPDATE tables SET status = 'delivered' WHERE id = $1", [t.busy]);
      const res = await waiterA().post(`/api/tables/${t.busy}/release`, {});
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Table cannot be released while delivered');
    });

    it('lets an admin force the release', async () => {
      const res = await adminA().post(`/api/tables/${t.served}/release`, { force: true });
      expect(res.status).toBe(200);
      expect(await tableRow(t.served)).toEqual({ status: 'available', waiter_id: null, number: 4 });
    });

    it('answers 404 for a table of another restaurant', async () => {
      expect((await adminB().post(`/api/tables/${t.kitchen}/release`, { force: true })).status).toBe(404);
      expect(await tableRow(t.kitchen)).toMatchObject({ status: 'kitchen' });
    });
  });

  describe('GET /staff/waiters', () => {
    it('lists the active waiter profiles of the restaurant by name', async () => {
      const res = await waiterA().get('/api/staff/waiters');
      expect(res.status).toBe(200);
      // Like waiterService.getAll: profiles.active decides, not users.is_active
      // (the shared fixture "Inactive A" is a disabled login with an active profile).
      expect(res.body).toEqual([
        { id: fixtures.inactive.profileId, name: 'Inactive A', username: null },
        { id: fixtures.waiterA.profileId, name: 'Waiter A', username: null },
        { id: t.waiter2Profile, name: 'Waiter Dos', username: 'dos' },
      ]);
      expect((await adminB().get('/api/staff/waiters')).body).toEqual([
        { id: t.waiterB, name: 'Waiter B', username: null },
      ]);
    });
  });
});

async function seedTables(superuserUrl: string) {
  const A = fixtures.restaurantA;
  const B = fixtures.restaurantB;
  const q = (text: string, values: unknown[] = []) => superuserQuery(superuserUrl, text, values);
  await q(
    `INSERT INTO profiles (id, full_name, username, role, active, restaurant_id) VALUES
       ($1, 'Waiter Dos', 'dos', 'waiter', true, $4), ($2, 'Waiter Retirado', NULL, 'waiter', false, $4),
       ($3, 'Waiter B', NULL, 'waiter', true, $5)`,
    [t.waiter2Profile, t.retiredWaiter, t.waiterB, A, B],
  );
  await q(
    `INSERT INTO tables (id, number, status, waiter_id, restaurant_id, updated_at) VALUES
       ($1, 1, 'available', NULL, $9, now() - interval '1 hour'),
       ($2, 2, 'occupied', $8, $9, now() - interval '1 hour'),
       ($3, 3, 'kitchen', $8, $9, now() - interval '1 hour'),
       ($4, 4, 'served', $8, $9, now() - interval '1 hour'),
       ($5, 5, 'reserved', NULL, $9, now() - interval '1 hour'),
       ($6, 6, 'available', NULL, $9, now() - interval '1 hour'),
       ($7, 101, 'available', NULL, $10, now() - interval '1 hour')`,
    [t.free, t.busy, t.kitchen, t.served, t.reserved, t.paidOnly, t.otherTable, fixtures.waiterA.profileId, A, B],
  );
  await q(
    `INSERT INTO orders (table_id, status, subtotal, tax, tax_percentage, total, restaurant_id) VALUES
       ($1, 'kitchen', 10, 0, 0, 10, $3), ($2, 'paid', 10, 0, 0, 10, $3)`,
    [t.kitchen, t.paidOnly, A],
  );
}
