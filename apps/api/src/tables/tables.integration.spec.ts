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
  cancelledOnly: 'f9000000-0000-0000-0000-000000000007',
  otherTable: 'f9000000-0000-0000-0000-0000000000b1',
  hall: 'f9100000-0000-0000-0000-000000000001',
  terrace: 'f9100000-0000-0000-0000-000000000002',
  zoneB: 'f9100000-0000-0000-0000-0000000000b1',
} as const;

const TABLE_KEYS = [
  'createdAt',
  'h',
  'id',
  'isActive',
  'number',
  'rotation',
  'seats',
  'shape',
  'status',
  'updatedAt',
  'w',
  'waiterId',
  'waiterName',
  'x',
  'y',
  'zoneId',
];

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
      put: (url: string, body?: object) => server.put(url).set('Cookie', cookie).send(body),
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
      expect(res.body[0]).toMatchObject({ zoneId: t.hall, x: 0.0625, y: 0.0625, w: 0.1, h: 0.1, shape: 'round', rotation: 0, seats: 4 });
      expect(res.body[2]).toMatchObject({ zoneId: null, x: null, y: null, w: null, h: null, shape: 'square', rotation: 0, seats: null });
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

    it('deletes a table whose orders are all paid or cancelled (F1: cancelled orders are kept, not deleted)', async () => {
      await db(`INSERT INTO tables (id, number, status, restaurant_id) VALUES ($1, 61, 'available', $2)`, [t.cancelledOnly, fixtures.restaurantA]);
      await db(
        `INSERT INTO orders (table_id, status, subtotal, tax, tax_percentage, total, restaurant_id) VALUES
           ($1, 'cancelled', 10, 0, 0, 10, $2), ($1, 'paid', 10, 0, 0, 10, $2)`,
        [t.cancelledOnly, fixtures.restaurantA],
      );
      const res = await adminA().delete(`/api/tables/${t.cancelledOnly}`);
      expect(res.status).toBe(204);
      expect(await tableRow(t.cancelledOnly)).toBeUndefined();
      expect(await db('SELECT status FROM orders WHERE table_id IS NULL AND status = $1', ['cancelled'])).toHaveLength(1);
    });

    it('deletes a table whose orders are all paid', async () => {
      const res = await adminA().delete(`/api/tables/${t.paidOnly}`);
      expect(res.status).toBe(204);
      expect(await tableRow(t.paidOnly)).toBeUndefined();
      expect((await waiterA().delete(`/api/tables/${t.free}`)).status).toBe(403);
    });
  });

  describe('floor plan layout', () => {
    const layout = (id: string, over: Record<string, unknown> = {}) => ({
      id,
      zoneId: t.terrace,
      x: 0.25,
      y: 0.75,
      w: 0.2,
      h: 0.1,
      shape: 'rect',
      rotation: 90,
      seats: 6,
      ...over,
    });
    const layoutRow = async (id: string) =>
      (
        await db(
          `SELECT zone_id, x::float8 AS x, y::float8 AS y, w::float8 AS w, h::float8 AS h, shape,
                  rotation::float8 AS rotation, seats FROM tables WHERE id = $1`,
          [id],
        )
      )[0];

    it('places a new table without layout on the first zone, next free grid slot', async () => {
      // Slot 0 holds table 1 and slot 1 the table 7 created above; 8 x 8 cells of 1/8.
      const res = await adminA().post('/api/tables', { number: 20 });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ zoneId: t.hall, x: 0.3125, y: 0.0625, w: 0.1, h: 0.1, shape: 'square', rotation: 0, seats: null });
    });

    it('creates and patches a table with its layout; 422 for a zone of another restaurant or partial coordinates', async () => {
      const created = await adminA().post('/api/tables', { number: 30, ...layout(t.free), id: undefined });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ number: 30, zoneId: t.terrace, x: 0.25, y: 0.75, w: 0.2, h: 0.1, shape: 'rect', rotation: 90, seats: 6 });
      const patched = await adminA().patch(`/api/tables/${created.body.id}`, { seats: null, shape: 'bar', rotation: 0 });
      expect(patched.status).toBe(200);
      expect(patched.body).toMatchObject({ seats: null, shape: 'bar', rotation: 0, x: 0.25 });
      expect((await adminA().patch(`/api/tables/${created.body.id}`, { zoneId: t.zoneB })).status).toBe(422);
      expect((await adminA().post('/api/tables', { number: 31, x: 0.5 })).status).toBe(422);
      expect((await adminA().post('/api/tables', { number: 31, shape: 'oval' })).status).toBe(422);
      expect((await adminA().post('/api/tables', { number: 31, rotation: 360 })).status).toBe(422);
      expect((await adminA().post('/api/tables', { number: 31, seats: 21 })).status).toBe(422);
      expect(await db('SELECT 1 FROM tables WHERE number = 31')).toHaveLength(0);
      expect(await layoutRow(created.body.id)).toMatchObject({ zone_id: t.terrace, seats: null, shape: 'bar' });
    });

    it('saves the whole layout in one request and returns every table', async () => {
      const res = await adminA().put('/api/tables/layout', {
        tables: [layout(t.busy), layout(t.kitchen, { x: 0.5, seats: null, shape: 'round', rotation: 45.5 })],
      });
      expect(res.status).toBe(200);
      expect(res.body.map((row: { number: number }) => row.number)).toEqual(
        (await db<{ number: number }>('SELECT number FROM tables WHERE restaurant_id = $1 ORDER BY number, id', [fixtures.restaurantA])).map(
          (row) => row.number,
        ),
      );
      expect(await layoutRow(t.busy)).toEqual({ zone_id: t.terrace, x: 0.25, y: 0.75, w: 0.2, h: 0.1, shape: 'rect', rotation: 90, seats: 6 });
      expect(await layoutRow(t.kitchen)).toMatchObject({ x: 0.5, seats: null, shape: 'round', rotation: 45.5 });
    });

    it('is all or nothing: one bad row leaves every table unchanged', async () => {
      const before = await db('SELECT id, zone_id, x, y, w, h, shape, rotation, seats FROM tables ORDER BY id');
      const move = layout(t.busy, { zoneId: t.hall, x: 0.9 });
      for (const [body, status, message] of [
        [{ tables: [move, layout(t.kitchen, { zoneId: t.zoneB })] }, 422, 'Invalid data'],
        [{ tables: [move, layout(t.otherTable)] }, 422, 'Unknown table'],
        [{ tables: [move, layout(t.kitchen, { x: 1.5 })] }, 422, undefined],
        [{ tables: [move, layout(t.kitchen, { w: null })] }, 422, undefined],
        [{ tables: [move, move] }, 422, undefined],
        [{ tables: [move], extra: true }, 422, undefined],
      ] as const) {
        const res = await adminA().put('/api/tables/layout', body);
        expect(res.status).toBe(status);
        if (message) expect(res.body.message).toBe(message);
      }
      expect((await waiterA().put('/api/tables/layout', { tables: [move] })).status).toBe(403);
      expect((await adminB().put('/api/tables/layout', { tables: [move] })).status).toBe(422);
      expect(await db('SELECT id, zone_id, x, y, w, h, shape, rotation, seats FROM tables ORDER BY id')).toEqual(before);
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

  describe('inactive tables', () => {
    const insertOrder = (tableId: string) =>
      db(`INSERT INTO orders (table_id, status, subtotal, tax, tax_percentage, total, restaurant_id) VALUES ($1, 'active', 0, 0, 0, 0, $2)`, [
        tableId,
        fixtures.restaurantA,
      ]);

    it('lets the admin deactivate a table with PATCH; lists keep it, flagged', async () => {
      const res = await adminA().patch(`/api/tables/${t.reserved}`, { isActive: false });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: t.reserved, isActive: false, status: 'reserved', number: 5 });
      const list = await waiterA().get('/api/tables');
      expect(list.body.find((row: { id: string }) => row.id === t.reserved)).toMatchObject({ isActive: false });
      expect(list.body.filter((row: { isActive: boolean }) => row.isActive).length).toBe(list.body.length - 1);
      await expect(insertOrder(t.reserved)).rejects.toMatchObject({ code: '23514' });
    });

    it('keeps the flag on a PATCH without isActive and turns it back on', async () => {
      expect((await adminA().patch(`/api/tables/${t.reserved}`, { seats: 6 })).body).toMatchObject({ isActive: false, seats: 6 });
      expect((await adminA().patch(`/api/tables/${t.reserved}`, { isActive: true })).body.isActive).toBe(true);
    });

    it('refuses the toggle from a waiter and a non-boolean value', async () => {
      expect((await waiterA().patch(`/api/tables/${t.free}`, { isActive: false })).status).toBe(403);
      expect((await adminA().patch(`/api/tables/${t.free}`, { isActive: 'no' })).status).toBe(422);
      expect(await db('SELECT is_active FROM tables WHERE id = $1', [t.free])).toEqual([{ is_active: true }]);
    });

    it('creates a table inactive on request and active by default', async () => {
      const off = await adminA().post('/api/tables', { number: 77, isActive: false });
      expect(off.status).toBe(201);
      expect(off.body.isActive).toBe(false);
      const on = await adminA().post('/api/tables', { number: 78 });
      expect(on.body.isActive).toBe(true);
      await adminA().delete(`/api/tables/${off.body.id}`);
      await adminA().delete(`/api/tables/${on.body.id}`);
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
    `INSERT INTO zones (id, name, sort_order, restaurant_id) VALUES
       ($1, 'Salón', 0, $4), ($2, 'Terraza', 1, $4), ($3, 'Zona B', 0, $5)`,
    [t.hall, t.terrace, t.zoneB, A, B],
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
    `UPDATE tables SET zone_id = $2, x = 0.0625, y = 0.0625, w = 0.1, h = 0.1, shape = 'round', seats = 4 WHERE id = $1`,
    [t.free, t.hall],
  );
  await q(
    `INSERT INTO orders (table_id, status, subtotal, tax, tax_percentage, total, restaurant_id) VALUES
       ($1, 'kitchen', 10, 0, 0, 10, $3), ($2, 'paid', 10, 0, 0, 10, $3)`,
    [t.kitchen, t.paidOnly, A],
  );
}
