import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Clock } from '../common/clock';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/** 10:00 in Bogota (UTC-5) on 2026-11-04. */
const NOW = '2026-11-04T15:00:00.000Z';
const AJIACO = 'd1200000-0000-0000-0000-000000000001';
const AREPA = 'd1200000-0000-0000-0000-000000000002';

interface SeedOrder {
  status: string;
  total: number;
  createdAt: string;
  restaurant?: string;
  items?: { name: string; quantity: number; dishId?: string }[];
}

/**
 * Orders of restaurant A around the Bogota day and month boundaries; the
 * UTC instant of each is what a UTC grouping would get wrong.
 */
const ORDERS: SeedOrder[] = [
  // 2026-11-01 00:30 Bogota: inside the month and on Nov 1.
  { status: 'paid', total: 1000, createdAt: '2026-11-01T05:30:00Z', items: [
    { name: 'Ajiaco', quantity: 2, dishId: AJIACO },
    { name: 'Jugo', quantity: 1 },
  ] },
  // 2026-10-31 23:30 Bogota (already Nov 1 in UTC): previous month, Oct 31.
  { status: 'paid', total: 2000, createdAt: '2026-11-01T04:30:00Z', items: [{ name: 'Ajiaco', quantity: 1, dishId: AJIACO }] },
  // Today.
  { status: 'paid', total: 500, createdAt: '2026-11-04T14:00:00Z', items: [
    { name: 'Arepa', quantity: 5, dishId: AREPA },
    ...Array.from({ length: 10 }, (_, i) => ({ name: `Plato ${String(i + 1).padStart(2, '0')}`, quantity: 1 })),
  ] },
  // 2026-10-05 00:30 Bogota: first day of the 30-day window.
  { status: 'paid', total: 400, createdAt: '2026-10-05T05:30:00Z', items: [{ name: 'Jugo', quantity: 3 }] },
  // 2026-10-04 23:59 Bogota: one minute before the window.
  { status: 'paid', total: 300, createdAt: '2026-10-05T04:59:00Z', items: [{ name: 'Arepa', quantity: 100, dishId: AREPA }] },
  // Not paid: never counted as sales nor popular.
  { status: 'cancelled', total: 9999, createdAt: '2026-11-02T15:00:00Z', items: [{ name: 'Ajiaco', quantity: 50, dishId: AJIACO }] },
  { status: 'delivered', total: 7777, createdAt: '2026-11-03T15:00:00Z', items: [{ name: 'Ajiaco', quantity: 50, dishId: AJIACO }] },
  { status: 'kitchen', total: 10, createdAt: '2026-11-04T13:00:00Z' },
  { status: 'kitchen', total: 10, createdAt: '2026-10-01T13:00:00Z' },
  // Restaurant B.
  { status: 'paid', total: 100000, createdAt: '2026-11-04T14:00:00Z', restaurant: fixtures.restaurantB, items: [
    { name: 'Ajiaco', quantity: 500 },
  ] },
  { status: 'kitchen', total: 10, createdAt: '2026-11-04T13:00:00Z', restaurant: fixtures.restaurantB },
];

describe('dashboard summary (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    database = await startTestDatabase();
    const db = (text: string, values: unknown[] = []) => superuserQuery(database.superuserUrl, text, values);
    await db(
      `INSERT INTO public.dishes (id, name, price, restaurant_id) VALUES ($1, 'Ajiaco', 28000, $3), ($2, 'Arepa', 5000, $3)`,
      [AJIACO, AREPA, fixtures.restaurantA],
    );
    for (const order of ORDERS) {
      const restaurant = order.restaurant ?? fixtures.restaurantA;
      const [row] = await superuserQuery<{ id: string }>(
        database.superuserUrl,
        `INSERT INTO public.orders (status, subtotal, tax, tax_percentage, total, created_at, restaurant_id)
         VALUES ($1, $2, 0, 0, $2, $3, $4) RETURNING id`,
        [order.status, order.total, order.createdAt, restaurant],
      );
      for (const item of order.items ?? []) {
        await db(
          `INSERT INTO public.order_items (order_id, dish_id, name, price, quantity, restaurant_id) VALUES ($1, $2, $3, 1, $4, $5)`,
          [row.id, item.dishId ?? null, item.name, item.quantity, restaurant],
        );
      }
    }
    app = await createTestApp(database.apiUrl);
    for (const user of [fixtures.adminA, fixtures.waiterA, fixtures.adminB]) {
      const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
      cookies[user.email] = cookiePair(setCookies(res).vipe_access);
    }
  });

  beforeEach(() => {
    vi.spyOn(app.get(Clock), 'now').mockReturnValue(new Date(NOW));
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    await database?.stop();
  });

  const get = (user: { email: string }, url: string) =>
    request(app.getHttpServer()).get(url).set('Cookie', cookies[user.email]);

  it('computes the four aggregates in the restaurant timezone (30 days by default)', async () => {
    const res = await get(fixtures.adminA, '/api/dashboard/summary');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['dailySales', 'kitchenOrders', 'monthSales', 'popularDishes']);
    // Paid since 2026-11-01 00:00 Bogota: 1000 + 500 (the 2000 is Oct 31 in Bogota).
    expect(res.body.monthSales).toBe(1500);
    expect(res.body.kitchenOrders).toBe(2);
    // Days with paid sales since local midnight 30 days back (2026-10-05), by Bogota date, oldest first.
    expect(res.body.dailySales).toEqual([
      { date: '2026-10-05', amount: 400 },
      { date: '2026-10-31', amount: 2000 },
      { date: '2026-11-01', amount: 1000 },
      { date: '2026-11-04', amount: 500 },
    ]);
    // Summed quantities of paid items in the same window, by dish name, top 10.
    expect(res.body.popularDishes).toEqual([
      { id: AREPA, name: 'Arepa', count: 5 },
      { id: null, name: 'Jugo', count: 4 },
      { id: AJIACO, name: 'Ajiaco', count: 3 },
      ...Array.from({ length: 7 }, (_, i) => ({ id: null, name: `Plato ${String(i + 1).padStart(2, '0')}`, count: 1 })),
    ]);
  });

  it('bounds the series and the popular dishes by ?days=', async () => {
    const res = await get(fixtures.adminA, '/api/dashboard/summary?days=3');
    expect(res.status).toBe(200);
    expect(res.body.monthSales).toBe(1500);
    expect(res.body.dailySales).toEqual([
      { date: '2026-11-01', amount: 1000 },
      { date: '2026-11-04', amount: 500 },
    ]);
    expect(res.body.popularDishes.slice(0, 3)).toEqual([
      { id: AREPA, name: 'Arepa', count: 5 },
      { id: AJIACO, name: 'Ajiaco', count: 2 },
      { id: null, name: 'Jugo', count: 1 },
    ]);
  });

  it('follows the restaurant timezone, not UTC', async () => {
    await superuserQuery(database.superuserUrl, `UPDATE public.restaurants SET timezone = 'UTC' WHERE id = $1`, [
      fixtures.restaurantA,
    ]);
    try {
      const res = await get(fixtures.adminA, '/api/dashboard/summary');
      // In UTC the 04:30Z order is Nov 1, so it joins the month.
      expect(res.body.monthSales).toBe(3500);
      expect(res.body.dailySales).toContainEqual({ date: '2026-11-01', amount: 3000 });
    } finally {
      await superuserQuery(database.superuserUrl, `UPDATE public.restaurants SET timezone = 'America/Bogota' WHERE id = $1`, [
        fixtures.restaurantA,
      ]);
    }
  });

  it("isolates tenants: B sees only B's numbers", async () => {
    const res = await get(fixtures.adminB, '/api/dashboard/summary');
    expect(res.body).toEqual({
      monthSales: 100000,
      kitchenOrders: 1,
      dailySales: [{ date: '2026-11-04', amount: 100000 }],
      popularDishes: [{ id: null, name: 'Ajiaco', count: 500 }],
    });
  });

  it('is admin only and validates ?days=', async () => {
    expect((await get(fixtures.waiterA, '/api/dashboard/summary')).status).toBe(403);
    for (const days of ['0', '367', 'abc', '1.5']) {
      expect((await get(fixtures.adminA, `/api/dashboard/summary?days=${days}`)).status).toBe(422);
    }
    expect((await get(fixtures.adminA, '/api/dashboard/summary?other=1')).status).toBe(422);
  });

  it('surfaces database errors instead of zeros', async () => {
    await superuserQuery(database.superuserUrl, `UPDATE public.restaurants SET timezone = 'Not/AZone' WHERE id = $1`, [
      fixtures.restaurantA,
    ]);
    try {
      const res = await get(fixtures.adminA, '/api/dashboard/summary');
      // An unknown timezone is Postgres 22023, mapped by the shared filter with its generic message.
      expect(res.status).toBe(422);
      expect(res.body).toEqual({ statusCode: 422, error: 'Unprocessable Entity', message: 'Invalid data', code: '22023' });
    } finally {
      await superuserQuery(database.superuserUrl, `UPDATE public.restaurants SET timezone = 'America/Bogota' WHERE id = $1`, [
        fixtures.restaurantA,
      ]);
    }
  });
});
