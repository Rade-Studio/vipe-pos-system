import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/** Reserving a table under a name (odd/tasks/reservas-mesas.md T1, S1-S3, S5). */
const r = {
  kitchen: { userId: '1c000000-0000-0000-0000-000000000001', profileId: '2c000000-0000-0000-0000-000000000001', email: 'kitchen@a.test' },
  delivery: { userId: '1c000000-0000-0000-0000-000000000002', profileId: '2c000000-0000-0000-0000-000000000002', email: 'delivery@a.test' },
  cashier: fixtures.bcryptUser,
  free: ['fa000000-0000-0000-0000-000000000001', 'fa000000-0000-0000-0000-000000000002', 'fa000000-0000-0000-0000-000000000003'],
  spare: 'fa000000-0000-0000-0000-000000000004',
  busy: 'fa000000-0000-0000-0000-000000000005',
  openOrder: 'fa000000-0000-0000-0000-000000000006',
  other: 'fa000000-0000-0000-0000-0000000000b1',
} as const;
const RESERVATION_NULLS = { reservationName: null, reservationArrivalAt: null, reservedAt: null, reservedByName: null };

describe('table reservations (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};
  const users = { admin: fixtures.adminA, waiter: fixtures.waiterA, cashier: r.cashier, kitchen: r.kitchen, delivery: r.delivery, adminB: fixtures.adminB };

  beforeAll(async () => {
    database = await startTestDatabase();
    await seed(database.superuserUrl);
    app = await createTestApp(database.apiUrl);
    for (const [key, user] of Object.entries(users)) {
      const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
      cookies[key] = cookiePair(setCookies(res).vipe_access);
    }
  });

  afterAll(async () => {
    await app?.close();
    await database?.stop();
  });

  const post = (who: keyof typeof users, url: string, body: object = {}) =>
    request(app.getHttpServer()).post(url).set('Cookie', cookies[who]).send(body);
  const patch = (url: string, body: object) => request(app.getHttpServer()).patch(url).set('Cookie', cookies.admin).send(body);
  const row = async (id: string) =>
    (
      await superuserQuery<Record<string, unknown>>(
        database.superuserUrl,
        'SELECT status, waiter_id, reservation_name, reservation_arrival_at, reserved_by, reserved_at FROM tables WHERE id = $1',
        [id],
      )
    )[0];
  const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

  describe('POST /tables/:id/reserve', () => {
    it.each([
      ['admin', 0, 'Admin A'],
      ['waiter', 1, 'Waiter A'],
      ['cashier', 2, 'Legacy A'],
    ] as const)('lets the %s reserve a free table under a trimmed name', async (who, index, name) => {
      const res = await post(who, `/api/tables/${r.free[index]}/reserve`, { name: '  Familia Pérez  ' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: r.free[index], status: 'reserved', reservationName: 'Familia Pérez', reservationArrivalAt: null, reservedByName: name });
      expect(Date.parse(res.body.reservedAt)).toBeGreaterThan(Date.now() - 60_000);
      expect(await row(r.free[index])).toMatchObject({ status: 'reserved', reservation_name: 'Familia Pérez', reserved_by: users[who].profileId });
    });

    it('stores the optional arrival time and lists the reservation', async () => {
      const arrivalAt = inMinutes(120);
      const res = await post('waiter', `/api/tables/${r.spare}/reserve`, { name: 'Ana', arrivalAt });
      expect(res.status).toBe(200);
      expect(res.body.reservationArrivalAt).toBe(arrivalAt);
      const list = await request(app.getHttpServer()).get('/api/tables').set('Cookie', cookies.cashier);
      expect(list.body.find((table: { id: string }) => table.id === r.spare)).toMatchObject({ reservationName: 'Ana', reservationArrivalAt: arrivalAt });
      expect(list.body.find((table: { id: string }) => table.id === r.busy)).toMatchObject(RESERVATION_NULLS);
    });

    it.each(['kitchen', 'delivery'] as const)('answers 403 to the %s role and keeps the table', async (who) => {
      expect((await post(who, `/api/tables/${r.openOrder}/reserve`, { name: 'Ana' })).status).toBe(403);
      expect(await row(r.openOrder)).toMatchObject({ status: 'available', reservation_name: null });
    });

    it.each([
      ['an occupied table', r.busy, 'occupied'],
      ['an available table with an open order', r.openOrder, 'available'],
      ['a reserved table', r.spare, 'reserved'],
    ])('answers 409 table_not_available for %s', async (_label, id, status) => {
      const res = await post('waiter', `/api/tables/${id}/reserve`, { name: 'Otro' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('table_not_available');
      expect(await row(id)).toMatchObject({ status });
    });

    it.each([
      ['a name longer than 80 characters', { name: 'a'.repeat(81) }, undefined],
      ['a blank name', { name: '   ' }, undefined],
      ['no name', {}, undefined],
      ['an invalid arrival time', { name: 'Ana', arrivalAt: 'mañana' }, undefined],
      ['an unknown field', { name: 'Ana', guests: 4 }, undefined],
      ['an arrival more than 5 minutes ago', { name: 'Ana', arrivalAt: inMinutes(-10) }, 'arrival_in_past'],
    ])('answers 422 for %s and keeps the table free', async (_label, body, code) => {
      const res = await post('admin', `/api/tables/${r.openOrder}/reserve`, body);
      expect(res.status).toBe(422);
      if (code) expect(res.body.code).toBe(code);
      expect(await row(r.openOrder)).toMatchObject({ status: 'available', reservation_name: null });
    });

    it('accepts an 80-character name and an arrival up to 5 minutes ago', async () => {
      const res = await post('admin', `/api/tables/${r.free[0]}/release`);
      expect(res.status).toBe(200);
      const again = await post('admin', `/api/tables/${r.free[0]}/reserve`, { name: 'b'.repeat(80), arrivalAt: inMinutes(-2) });
      expect(again.status).toBe(200);
      expect(again.body.reservationName).toBe('b'.repeat(80));
    });

    it('answers 404 for a table of another restaurant', async () => {
      expect((await post('admin', `/api/tables/${r.other}/reserve`, { name: 'Ana' })).status).toBe(404);
      expect((await post('adminB', `/api/tables/${r.free[1]}/reserve`, { name: 'Ana' })).status).toBe(404);
      expect(await row(r.other)).toMatchObject({ status: 'available', reservation_name: null });
    });
  });

  describe('cancelling and seating', () => {
    it.each(['waiter', 'cashier'] as const)('lets the %s release a reserved table: the reservation is cancelled', async (who) => {
      const id = who === 'waiter' ? r.free[1] : r.free[2];
      const res = await post(who, `/api/tables/${id}/release`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'available', waiterId: null, ...RESERVATION_NULLS });
      expect(await row(id)).toMatchObject({ status: 'available', reservation_name: null, reserved_by: null, reserved_at: null });
    });

    it('seats a reserved table through assign: occupied, reservation cleared', async () => {
      const res = await post('cashier', `/api/tables/${r.spare}/assign`, { waiterId: fixtures.waiterA.profileId });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'occupied', waiterId: fixtures.waiterA.profileId, ...RESERVATION_NULLS });
      expect(await row(r.spare)).toMatchObject({ reservation_name: null, reservation_arrival_at: null, reserved_by: null, reserved_at: null });
    });
  });

  describe('admin PATCH', () => {
    it('refuses status reserved without a name (422 reservation_name_required) and keeps the table', async () => {
      const res = await patch(`/api/tables/${r.free[1]}`, { status: 'reserved' });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('reservation_name_required');
      expect(await row(r.free[1])).toMatchObject({ status: 'available' });
      expect((await patch(`/api/tables/${r.free[1]}`, { reservationName: 'Ana' })).status).toBe(422);
    });

    it('reserves with reservationName and clears it when another status is set', async () => {
      const arrivalAt = inMinutes(30);
      const res = await patch(`/api/tables/${r.free[1]}`, { status: 'reserved', reservationName: ' Ana ', reservationArrivalAt: arrivalAt });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'reserved', reservationName: 'Ana', reservationArrivalAt: arrivalAt, reservedByName: 'Admin A' });
      expect((await patch(`/api/tables/${r.free[1]}`, { number: 299 })).body).toMatchObject({ number: 299, reservationName: 'Ana' });
      const freed = await patch(`/api/tables/${r.free[1]}`, { status: 'available' });
      expect(freed.body).toMatchObject({ status: 'available', ...RESERVATION_NULLS });
    });
  });

  describe('unchanged behaviour', () => {
    it('PATCH of another status still sets it and keeps available clearing the waiter', async () => {
      const occupied = await patch(`/api/tables/${r.free[2]}`, { status: 'occupied', waiterId: fixtures.waiterA.profileId });
      expect(occupied.body).toMatchObject({ status: 'occupied', waiterId: fixtures.waiterA.profileId, ...RESERVATION_NULLS });
      expect((await patch(`/api/tables/${r.free[2]}`, { status: 'available' })).body).toMatchObject({ status: 'available', waiterId: null });
    });

    it('assign on a free table and release of an occupied table still work, with no reservation', async () => {
      const seated = await post('waiter', `/api/tables/${r.free[2]}/assign`, { waiterId: fixtures.waiterA.profileId });
      expect(seated.body).toMatchObject({ status: 'occupied', waiterName: 'Waiter A', ...RESERVATION_NULLS });
      await superuserQuery(database.superuserUrl, "UPDATE tables SET status = 'kitchen' WHERE id = $1", [r.free[2]]);
      expect((await post('waiter', `/api/tables/${r.free[2]}/release`, { force: true })).status).toBe(409);
      expect((await post('admin', `/api/tables/${r.free[2]}/release`, { force: true })).body).toMatchObject({ status: 'available', waiterId: null });
    });
  });
});

async function seed(url: string) {
  const A = fixtures.restaurantA;
  const q = (text: string, values: unknown[] = []) => superuserQuery(url, text, values);
  await q(
    `INSERT INTO users (id, email, password_hash, password_algo, is_active)
     SELECT v.id::uuid, v.email, u.password_hash, u.password_algo, true
       FROM users u, (VALUES ($1, $2), ($3, $4)) AS v(id, email) WHERE u.id = $5`,
    [r.kitchen.userId, r.kitchen.email, r.delivery.userId, r.delivery.email, fixtures.waiterA.userId],
  );
  await q(
    `INSERT INTO profiles (id, user_id, full_name, email, role, restaurant_id) VALUES
       ($1, $2, 'Kitchen A', $3, 'kitchen', $7), ($4, $5, 'Delivery A', $6, 'delivery_operator', $7)`,
    [r.kitchen.profileId, r.kitchen.userId, r.kitchen.email, r.delivery.profileId, r.delivery.userId, r.delivery.email, A],
  );
  await q(
    `INSERT INTO tables (id, number, status, waiter_id, restaurant_id) VALUES
       ($1, 201, 'available', NULL, $8), ($2, 202, 'available', NULL, $8), ($3, 203, 'available', NULL, $8),
       ($4, 204, 'available', NULL, $8), ($5, 205, 'occupied', $9, $8), ($6, 206, 'available', NULL, $8),
       ($7, 207, 'available', NULL, $10)`,
    [...r.free, r.spare, r.busy, r.openOrder, r.other, A, fixtures.waiterA.profileId, fixtures.restaurantB],
  );
  await q(`INSERT INTO orders (table_id, status, subtotal, tax, tax_percentage, total, restaurant_id) VALUES ($1, 'active', 0, 0, 0, 0, $2)`, [
    r.openOrder,
    A,
  ]);
}
