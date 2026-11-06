import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/** T17 (S8): orders.order_number, guests and notes (migration 0014) through the API. */
const d = {
  kitchenUser: '10000000-0000-0000-0000-0000000000d1',
  kitchenProfile: '20000000-0000-0000-0000-0000000000d1',
  kitchenEmail: 'kitchen-details@a.test',
  arepa: 'd9000000-0000-0000-0000-000000000001',
  t1: 'f9000000-0000-0000-0000-000000000001',
  t2: 'f9000000-0000-0000-0000-000000000002',
  t3: 'f9000000-0000-0000-0000-000000000003',
  t4: 'f9000000-0000-0000-0000-000000000004',
  t5: 'f9000000-0000-0000-0000-000000000005',
  t6: 'f9000000-0000-0000-0000-000000000006',
  t7: 'f9000000-0000-0000-0000-000000000007',
  t8: 'f9000000-0000-0000-0000-000000000008',
  t9: 'f9000000-0000-0000-0000-000000000009',
  paid: '89000000-0000-0000-0000-000000000001',
} as const;

const GUESTS_ERROR = 'guests: Los comensales deben ser un número entero entre 1 y 99';
const NOTES_ERROR = 'notes: La nota del pedido debe tener entre 1 y 300 caracteres';

describe('order number, guests and notes (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    database = await startTestDatabase();
    await seed(database.superuserUrl);
    app = await createTestApp(database.apiUrl);
    for (const email of [fixtures.adminA.email, fixtures.waiterA.email, fixtures.adminB.email, d.kitchenEmail]) {
      const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD });
      cookies[email] = cookiePair(setCookies(res).vipe_access);
    }
  });

  afterAll(async () => {
    await app?.close();
    await database?.stop();
  });

  const as = (email: string) => {
    const server = request(app.getHttpServer());
    const cookie = cookies[email];
    return {
      get: (url: string) => server.get(url).set('Cookie', cookie),
      post: (url: string, body?: object) => server.post(url).set('Cookie', cookie).send(body),
      patch: (url: string, body?: object) => server.patch(url).set('Cookie', cookie).send(body),
    };
  };
  const waiterA = () => as(fixtures.waiterA.email);
  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    superuserQuery<T>(database.superuserUrl, text, values);
  const row = async (id: string) =>
    (
      await db<{ order_number: number; guests: number | null; notes: string | null }>(
        'SELECT order_number, guests, notes FROM orders WHERE id = $1',
        [id],
      )
    )[0];
  const ordersOf = (tableId: string) => db('SELECT id FROM orders WHERE table_id = $1', [tableId]);
  const maxNumber = async () =>
    Number(
      (
        await db<{ max: number }>('SELECT max(order_number) AS max FROM orders WHERE restaurant_id = $1', [fixtures.restaurantA])
      )[0].max,
    );
  const create = (tableId: string, extra: object = {}) =>
    waiterA().post('/api/orders', { tableId, items: [{ dishId: d.arepa, quantity: 1, unitPrice: 5000 }], ...extra });

  describe('POST /orders', () => {
    it('stores guests and the trimmed note and answers them with the database order number', async () => {
      const before = await maxNumber();
      const res = await create(d.t1, { guests: 4, notes: '  sin picante  ' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ guests: 4, notes: 'sin picante', orderNumber: before + 1 });
      expect(await row(res.body.id)).toEqual({ order_number: before + 1, guests: 4, notes: 'sin picante' });
    });

    it('answers null guests and notes when not sent, and stores a blank note as null', async () => {
      const plain = await create(d.t2);
      expect(plain.status).toBe(201);
      expect(plain.body).toMatchObject({ guests: null, notes: null, orderNumber: expect.any(Number) });

      const blank = await create(d.t3, { notes: '   ' });
      expect(blank.status).toBe(201);
      expect(blank.body.notes).toBeNull();
      expect((await row(blank.body.id)).notes).toBeNull();
    });

    it('refuses a client orderNumber with 422 and stores nothing', async () => {
      const before = await maxNumber();
      const res = await create(d.t4, { orderNumber: 999 });
      expect(res.status).toBe(422);
      expect(res.body.message).toBe('Unrecognized key: "orderNumber"');
      expect(await ordersOf(d.t4)).toEqual([]);
      expect(await maxNumber()).toBe(before);
    });

    it.each([
      ['guests 0', { guests: 0 }, GUESTS_ERROR],
      ['guests 100', { guests: 100 }, GUESTS_ERROR],
      ['fractional guests', { guests: 2.5 }, GUESTS_ERROR],
      ['a note of 301 characters', { notes: 'x'.repeat(301) }, NOTES_ERROR],
    ])('answers 422 for %s with the Spanish message and stores nothing', async (_case, extra, message) => {
      const res = await create(d.t4, extra);
      expect(res.status).toBe(422);
      expect(res.body.message).toBe(message);
      expect(await ordersOf(d.t4)).toEqual([]);
    });

    it('accepts the bounds: 1 and 99 guests, a 300-character note', async () => {
      const res = await create(d.t4, { guests: 99, notes: ` ${'n'.repeat(300)} ` });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ guests: 99, notes: 'n'.repeat(300) });
      const one = await create(d.t5, { guests: 1 });
      expect(one.body.guests).toBe(1);
    });
  });

  describe('inactive tables (T22, 0015 trigger)', () => {
    it('answers 409 La mesa está inactiva on a new order and stores nothing', async () => {
      await db('UPDATE tables SET is_active = false WHERE id = $1', [d.t8]);
      const before = await maxNumber();
      const res = await create(d.t8, { guests: 2 });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ statusCode: 409, message: 'La mesa está inactiva' });
      expect(await ordersOf(d.t8)).toEqual([]);
      expect(await maxNumber()).toBe(before);
      const [table] = await db<{ status: string }>('SELECT status FROM tables WHERE id = $1', [d.t8]);
      expect(table.status).toBe('available');
    });

    it('keeps adding items to an order opened before the table was deactivated', async () => {
      const opened = await create(d.t9);
      expect(opened.status).toBe(201);
      await db('UPDATE tables SET is_active = false WHERE id = $1', [d.t9]);
      const res = await waiterA().post(`/api/orders/${opened.body.id}/items`, {
        items: [{ dishId: d.arepa, quantity: 1, unitPrice: 5000 }],
      });
      expect(res.status).toBe(201);
      expect(res.body.items).toHaveLength(2);
    });
  });

  describe('reads', () => {
    it('GET /orders, its include variants, GET /orders/:id and /orders/completed carry the three fields', async () => {
      const [created] = await db<{ id: string }>('SELECT id FROM orders WHERE table_id = $1', [d.t1]);
      const expected = { orderNumber: expect.any(Number), guests: 4, notes: 'sin picante' };
      const plain = await waiterA().get('/api/orders?status=kitchen');
      expect(plain.body.find((order: { id: string }) => order.id === created.id)).toMatchObject(expected);
      const included = await waiterA().get('/api/orders?status=kitchen&include=items,table,waiter');
      expect(included.body.find((order: { id: string }) => order.id === created.id)).toMatchObject({
        ...expected,
        tableNumber: 901,
      });
      expect((await waiterA().get(`/api/orders/${created.id}?include=table`)).body).toMatchObject(expected);

      const today = (await db<{ day: string }>("SELECT to_char(now() AT TIME ZONE timezone, 'YYYY-MM-DD') AS day FROM restaurants WHERE id = $1", [fixtures.restaurantA]))[0].day;
      const completed = await waiterA().get(`/api/orders/completed?date=${today}`);
      expect(completed.status).toBe(200);
      expect(completed.body.find((order: { id: string }) => order.id === d.paid)).toMatchObject({
        orderNumber: expect.any(Number),
        guests: 2,
        notes: 'pagada',
      });
    });
  });

  describe('POST /orders/:id/items', () => {
    it('sets guests and notes when sent and keeps them when omitted', async () => {
      const [order] = await db<{ id: string }>('SELECT id FROM orders WHERE table_id = $1', [d.t2]);
      const items = [{ dishId: d.arepa, quantity: 1 }];
      const set = await waiterA().post(`/api/orders/${order.id}/items`, { items, guests: 6, notes: 'cumpleaños' });
      expect(set.status).toBe(201);
      expect(set.body).toMatchObject({ guests: 6, notes: 'cumpleaños' });
      const kept = await waiterA().post(`/api/orders/${order.id}/items`, { items });
      expect(kept.body).toMatchObject({ guests: 6, notes: 'cumpleaños' });
      expect(await row(order.id)).toMatchObject({ guests: 6, notes: 'cumpleaños' });
    });

    it('answers 422 for invalid guests or orderNumber and adds no item', async () => {
      const [order] = await db<{ id: string }>('SELECT id FROM orders WHERE table_id = $1', [d.t2]);
      const count = async () => (await db('SELECT id FROM order_items WHERE order_id = $1', [order.id])).length;
      const before = await count();
      const items = [{ dishId: d.arepa, quantity: 1 }];
      const guests = await waiterA().post(`/api/orders/${order.id}/items`, { items, guests: 0 });
      expect(guests.status).toBe(422);
      expect(guests.body.message).toBe(GUESTS_ERROR);
      const number = await waiterA().post(`/api/orders/${order.id}/items`, { items, orderNumber: 1 });
      expect(number.status).toBe(422);
      expect(await count()).toBe(before);
    });
  });

  describe('PATCH /orders/:id', () => {
    const orderOn = async (tableId: string) => (await db<{ id: string }>('SELECT id FROM orders WHERE table_id = $1', [tableId]))[0].id;

    it('lets the waiter set and clear guests and the note on an open order', async () => {
      const id = await orderOn(d.t3);
      const before = await row(id);
      const set = await waiterA().patch(`/api/orders/${id}`, { guests: 3, notes: ' sin hielo ' });
      expect(set.status).toBe(200);
      expect(set.body).toMatchObject({ id, guests: 3, notes: 'sin hielo', orderNumber: before.order_number });

      const notesOnly = await waiterA().patch(`/api/orders/${id}`, { notes: null });
      expect(notesOnly.body).toMatchObject({ guests: 3, notes: null });
      const blank = await waiterA().patch(`/api/orders/${id}`, { guests: null, notes: '  ' });
      expect(blank.status).toBe(200);
      expect(await row(id)).toEqual({ order_number: before.order_number, guests: null, notes: null });
    });

    it.each([
      ['an empty body', {}, 'Send guests or notes'],
      ['guests 100', { guests: 100 }, GUESTS_ERROR],
      ['a long note', { notes: 'x'.repeat(301) }, NOTES_ERROR],
    ])('answers 422 for %s and changes nothing', async (_case, body, message) => {
      const id = await orderOn(d.t5);
      const before = await row(id);
      const res = await waiterA().patch(`/api/orders/${id}`, body);
      expect(res.status).toBe(422);
      expect(res.body.message).toBe(message);
      expect(await row(id)).toEqual(before);
    });

    it('refuses orderNumber with 422 and keeps the number', async () => {
      const id = await orderOn(d.t5);
      const before = await row(id);
      const res = await waiterA().patch(`/api/orders/${id}`, { orderNumber: 1, guests: 2 });
      expect(res.status).toBe(422);
      expect(await row(id)).toEqual(before);
    });

    it('answers 403 to the kitchen role and changes nothing', async () => {
      const id = await orderOn(d.t5);
      const before = await row(id);
      const res = await as(d.kitchenEmail).patch(`/api/orders/${id}`, { guests: 5 });
      expect(res.status).toBe(403);
      expect(await row(id)).toEqual(before);
    });

    it("answers 404 for another restaurant's order and changes nothing", async () => {
      const id = await orderOn(d.t5);
      const before = await row(id);
      const res = await as(fixtures.adminB.email).patch(`/api/orders/${id}`, { guests: 5 });
      expect(res.status).toBe(404);
      expect(await row(id)).toEqual(before);
    });

    it('answers 409 Order is closed for a paid order and changes nothing', async () => {
      const before = await row(d.paid);
      const res = await waiterA().patch(`/api/orders/${d.paid}`, { guests: 5 });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Order is closed');
      expect(await row(d.paid)).toEqual(before);
    });
  });
});

async function seed(superuserUrl: string) {
  const A = fixtures.restaurantA;
  const q = (text: string, values: unknown[] = []) => superuserQuery(superuserUrl, text, values);
  await q(
    `INSERT INTO users (id, email, password_hash, password_algo)
       SELECT $1, $2, password_hash, password_algo FROM users WHERE email = $3`,
    [d.kitchenUser, d.kitchenEmail, fixtures.adminA.email],
  );
  await q(
    `INSERT INTO profiles (id, user_id, full_name, email, role, restaurant_id) VALUES ($1, $2, 'Kitchen D', $3, 'kitchen', $4)`,
    [d.kitchenProfile, d.kitchenUser, d.kitchenEmail, A],
  );
  await q(`INSERT INTO dishes (id, name, price, active, restaurant_id) VALUES ($1, 'Arepa', 5000, true, $2)`, [d.arepa, A]);
  await q(
    `INSERT INTO tables (id, number, status, restaurant_id) VALUES
       ($1, 901, 'available', $8), ($2, 902, 'available', $8), ($3, 903, 'available', $8), ($4, 904, 'available', $8),
       ($5, 905, 'available', $8), ($6, 906, 'available', $8), ($7, 907, 'served', $8),
       ($9, 908, 'available', $8), ($10, 909, 'available', $8)`,
    [d.t1, d.t2, d.t3, d.t4, d.t5, d.t6, d.t7, A, d.t8, d.t9],
  );
  await q(
    `INSERT INTO orders (id, table_id, waiter_id, status, subtotal, tax, tax_percentage, total, guests, notes, restaurant_id)
       VALUES ($1, $2, $3, 'paid', 10, 0, 0, 10, 2, 'pagada', $4)`,
    [d.paid, d.t7, fixtures.waiterA.profileId, A],
  );
}
