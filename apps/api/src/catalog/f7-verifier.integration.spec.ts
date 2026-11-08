import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/** Verifier probes for F7 (odd/tasks/modificadores.md S1, S3, S6, L4): money and contract edges. */
const v = {
  burger: 'e7000000-0000-0000-0000-000000000001',
  plain: 'e7000000-0000-0000-0000-000000000002',
  dishB: 'e7000000-0000-0000-0000-0000000000b1',
  doneness: 'e7100000-0000-0000-0000-000000000001',
  extras: 'e7100000-0000-0000-0000-000000000002',
  medium: 'e7200000-0000-0000-0000-000000000011',
  half: 'e7200000-0000-0000-0000-000000000021',
  tenth: 'e7200000-0000-0000-0000-000000000022',
  fifth: 'e7200000-0000-0000-0000-000000000023',
  bacon: 'e7200000-0000-0000-0000-000000000024',
  ingredientB: 'e7400000-0000-0000-0000-0000000000b1',
  tables: ['e7300000-0000-0000-0000-000000000001', 'e7300000-0000-0000-0000-000000000002', 'e7300000-0000-0000-0000-000000000003',
    'e7300000-0000-0000-0000-000000000004', 'e7300000-0000-0000-0000-000000000005', 'e7300000-0000-0000-0000-000000000006'],
} as const;
const opt = (...ids: string[]) => ids.map((optionId) => ({ optionId }));

describe('F7 verifier probes (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    database = await startTestDatabase();
    await seed(database.superuserUrl);
    app = await createTestApp(database.apiUrl);
    for (const email of [fixtures.adminA.email, fixtures.waiterA.email]) {
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
      put: (url: string, body?: object) => server.put(url).set('Cookie', cookie).send(body),
      patch: (url: string, body?: object) => server.patch(url).set('Cookie', cookie).send(body),
    };
  };
  const adminA = () => as(fixtures.adminA.email);
  const waiterA = () => as(fixtures.waiterA.email);
  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) => superuserQuery<T>(database.superuserUrl, text, values);
  const count = async (table: string) => Number((await db<{ n: string }>(`SELECT count(*) AS n FROM ${table}`))[0].n);
  const billMatchesLines = async (orderId: string) =>
    (await db<{ subtotal: string; lines: string }>(
      `SELECT o.subtotal::text, (SELECT sum(round(oi.price * oi.quantity))::numeric(12,2)::text FROM order_items oi WHERE oi.order_id = o.id) AS lines
         FROM orders o WHERE o.id = $1`, [orderId]))[0];
  const orderOn = (table: number, items: object[]) => waiterA().post('/api/orders', { tableId: v.tables[table], items });

  it('S1/L4: 0.50 option prices add to the unit price; the bill is sum(round(price x qty))', async () => {
    const res = await orderOn(0, [{ dishId: v.burger, quantity: 3, unitPrice: 20000.5, modifiers: opt(v.medium, v.half) }]);
    expect(res.status).toBe(201);
    expect(res.body.items[0].price).toBe(20000.5);
    expect(res.body.subtotal).toBe(60002);
    const bill = await billMatchesLines(res.body.id);
    expect(bill.subtotal).toBe(bill.lines);
  });

  it('L4: 0.10 + 0.20 options match a client unitPrice of 20000.30 without float drift', async () => {
    const res = await orderOn(1, [{ dishId: v.burger, quantity: 1, unitPrice: 20000.3, modifiers: opt(v.medium, v.tenth, v.fifth) }]);
    expect(res.status).toBe(201);
    expect(res.body.items[0].price).toBe(20000.3);
  });

  it('L4: a client cannot send an option price (unknown key is 422, nothing written)', async () => {
    const before = await count('order_items');
    const res = await orderOn(2, [{ dishId: v.burger, quantity: 1, modifiers: [{ optionId: v.medium }, { optionId: v.bacon, price: 0 }] }]);
    expect(res.status).toBe(422);
    expect(await count('order_items')).toBe(before);
    const delivery = await adminA().post('/api/delivery/orders', {
      customer: { phone: '3157770001', name: 'Eva' }, address: { addressLine: 'Calle 9' },
      items: [{ dishId: v.burger, quantity: 1, modifiers: [{ optionId: v.medium, price: 0 }] }], deliveryFee: 0, paymentMode: 'prepaid',
    });
    expect(delivery.status).toBe(422);
  });

  it('L4: a repriced option makes the price the client showed stale (409 with lines, nothing written)', async () => {
    await adminA().patch(`/api/catalog/modifier-options/${v.bacon}`, { price: 3500 });
    const before = await count('order_items');
    const res = await orderOn(2, [{ dishId: v.burger, quantity: 1, unitPrice: 23000, modifiers: opt(v.medium, v.bacon) }]);
    expect(res.status).toBe(409);
    expect(res.body.lines).toEqual([{ index: 0, dishId: v.burger, unitPrice: 23500 }]);
    expect(await count('order_items')).toBe(before);
    await adminA().patch(`/api/catalog/modifier-options/${v.bacon}`, { price: 3000 });
  });

  it('S3: a group detached from the dish after the cart was built answers 422 modifier_invalid', async () => {
    await adminA().put(`/api/catalog/dishes/${v.burger}/modifier-groups`, { groupIds: [v.doneness] });
    const res = await orderOn(3, [{ dishId: v.burger, quantity: 1, modifiers: opt(v.medium, v.bacon) }]);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('modifier_invalid');
    await adminA().put(`/api/catalog/dishes/${v.burger}/modifier-groups`, { groupIds: [v.doneness, v.extras] });
  });

  it('S6: two delivery lines of the same dish and options keep the bill equal to its lines', async () => {
    const res = await adminA().post('/api/delivery/orders', {
      customer: { phone: '3157770002', name: 'Leo' }, address: { addressLine: 'Calle 10' },
      items: [
        // Whole-peso options; with 0.50 options the grouped delivery subtotal is 40001 vs 40002 summed per line,
        // the same as a dish priced x.50 at the 0022 baseline (pre-existing, see the verifier report).
        { dishId: v.burger, quantity: 1, modifiers: opt(v.medium, v.bacon) },
        { dishId: v.burger, quantity: 1, modifiers: opt(v.medium, v.bacon), comments: 'Otra' },
      ],
      deliveryFee: 0, paymentMode: 'prepaid',
    });
    expect(res.status).toBe(201);
    const bill = await billMatchesLines(res.body.orderId);
    expect(bill.subtotal).toBe(bill.lines);
  });

  it('S3: a dish without groups ignores an empty modifiers list and answers modifiers []', async () => {
    const res = await orderOn(4, [{ dishId: v.plain, quantity: 2, unitPrice: 10000, modifiers: [] }]);
    expect(res.status).toBe(201);
    expect(res.body.items[0]).toMatchObject({ price: 10000, modifiers: [] });
  });

  it('S4: an option cannot take an ingredient of another restaurant (422, nothing written)', async () => {
    const before = await count('modifier_options');
    const res = await adminA().post(`/api/catalog/modifier-groups/${v.extras}/options`, { name: 'Robada', price: 1, ingredientId: v.ingredientB, ingredientQty: 1 });
    expect(res.status).toBe(422);
    expect(await count('modifier_options')).toBe(before);
  });

  it('S5: quickNotes is gone from the dish contract (unknown key is 422)', async () => {
    const res = await adminA().patch(`/api/catalog/dishes/${v.plain}`, { quickNotes: ['Sin hielo'] });
    expect(res.status).toBe(422);
    const dish = (await waiterA().get('/api/catalog/dishes')).body.find((d: { id: string }) => d.id === v.plain);
    expect(dish).not.toHaveProperty('quickNotes');
    expect(dish.modifierGroups).toEqual([]);
  });
});

async function seed(url: string) {
  const A = fixtures.restaurantA;
  const B = fixtures.restaurantB;
  const q = (text: string, values: unknown[] = []) => superuserQuery(url, text, values);
  await q(`INSERT INTO dishes (id, name, price, active, restaurant_id) VALUES ($1, 'Hamburguesa V', 20000, true, $4), ($2, 'Plato V', 10000, true, $4), ($3, 'Plato BV', 1000, true, $5)`,
    [v.burger, v.plain, v.dishB, A, B]);
  await q(`INSERT INTO ingredients (id, name, unit, restaurant_id) VALUES ($1, 'Harina B', 'g', $2)`, [v.ingredientB, B]);
  await q(`INSERT INTO modifier_groups (id, name, required, min_select, max_select, sort_order, is_active, restaurant_id) VALUES
             ($1, 'Término V', true, 1, 1, 0, true, $3), ($2, 'Adiciones V', false, 0, NULL, 1, true, $3)`, [v.doneness, v.extras, A]);
  await q(`INSERT INTO modifier_options (id, group_id, name, price, sort_order, is_active, restaurant_id) VALUES
             ($1, $6, 'Medio', 0, 0, true, $7), ($2, $8, 'Medio peso', 0.5, 0, true, $7), ($3, $8, 'Diez', 0.1, 1, true, $7),
             ($4, $8, 'Veinte', 0.2, 2, true, $7), ($5, $8, 'Tocineta', 3000, 3, true, $7)`,
    [v.medium, v.half, v.tenth, v.fifth, v.bacon, v.doneness, A, v.extras]);
  await q(`INSERT INTO dish_modifier_groups (dish_id, group_id, sort_order, restaurant_id) VALUES ($1, $2, 0, $4), ($1, $3, 1, $4)`,
    [v.burger, v.doneness, v.extras, A]);
  await q(`INSERT INTO tables (id, number, status, restaurant_id) SELECT t.id, 80 + t.n, 'available', $2 FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, n)`,
    [v.tables, A]);
}
