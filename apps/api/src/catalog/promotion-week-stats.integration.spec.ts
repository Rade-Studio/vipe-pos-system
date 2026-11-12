import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';
import { Clock } from '../common/clock';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

const A = fixtures.restaurantA;
const B = fixtures.restaurantB;
/** Wednesday 2026-11-11 15:00 in Bogotá (UTC-5): the business week starts Monday 2026-11-09. */
const NOW = new Date('2026-11-11T20:00:00Z');

// [status, subtotal (net), total_discounts, created_at (Bogotá), restaurant]; a discount row when total_discounts > 0.
const ORDERS: [string, number, number, string, string][] = [
  ['paid', 18000, 2000, '2026-11-10 12:00-05', A], // this week, promotion
  ['paid', 30000, 0, '2026-11-10 13:00-05', A], // this week, no promotion
  ['paid', 9000, 1000, '2026-11-09 10:00-05', A], // this week (Monday after the cut-off), promotion
  ['active', 5000, 500, '2026-11-10 14:00-05', A], // unpaid
  ['cancelled', 8000, 800, '2026-11-10 15:00-05', A], // unpaid
  ['paid', 12000, 1200, '2026-11-12 10:00-05', A], // after now
  ['paid', 40000, 4000, '2026-11-05 12:00-05', A], // last week
  ['paid', 7000, 700, '2026-11-08 23:00-05', A], // Sunday 23:00
  ['paid', 6000, 600, '2026-11-09 00:30-05', A], // Monday 00:30, before the 04:00 cut-off
  ['paid', 1000, 100, '2026-11-10 12:00-05', B], // other restaurant
];

describe('GET /catalog/promotions/stats/week (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    database = await startTestDatabase();
    const db = (text: string, values: unknown[] = []) => superuserQuery(database.superuserUrl, text, values);
    await db(`UPDATE restaurants SET timezone = 'America/Bogota' WHERE id IN ($1, $2)`, [A, B]);
    for (const [status, subtotal, discounts, createdAt, restaurant] of ORDERS) {
      const [order] = await db(
        `INSERT INTO orders (status, subtotal, tax, tax_percentage, total, total_discounts, created_at, restaurant_id, order_type)
         VALUES ($1, $2, 0, 0, $2, $3, $4, $5, 'dine_in') RETURNING id`,
        [status, subtotal, discounts, createdAt, restaurant],
      );
      if (discounts > 0) {
        await db(
          `INSERT INTO order_discounts (order_id, kind, source, label, amount, restaurant_id) VALUES ($1, 'promotion_bill', 'automatic', 'Promo', $2, $3)`,
          [order.id, discounts, restaurant],
        );
      }
    }
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

  const week = (user: { email: string }, now = NOW) => {
    vi.spyOn(app.get(Clock), 'now').mockReturnValue(now);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    return request(app.getHttpServer()).get('/api/catalog/promotions/stats/week').set('Cookie', cookies[user.email]);
  };

  it('sums the paid orders from Monday at the 04:00 cut-off through now', async () => {
    const res = await week(fixtures.adminA);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      weekStart: '2026-11-09T09:00:00.000Z',
      now: '2026-11-11T20:00:00.000Z',
      discountGranted: 3000,
      salesGross: 60000,
      discountPercent: 5,
      salesWithPromotion: 30000,
      billsWithPromotion: 2,
    });
  });

  it('with cut-off 0 the week starts Monday 00:00: Monday 00:30 counts, Sunday 23:00 does not', async () => {
    const db = (text: string, values: unknown[] = []) => superuserQuery(database.superuserUrl, text, values);
    await db(`INSERT INTO business_config (key, value, restaurant_id) VALUES ('business_day_cutoff_hour', '0', $1)`, [A]);
    onTestFinished(async () => {
      await db(`DELETE FROM business_config WHERE key = 'business_day_cutoff_hour' AND restaurant_id = $1`, [A]);
    });
    const res = await week(fixtures.adminA);
    expect(res.body).toEqual({
      weekStart: '2026-11-09T05:00:00.000Z',
      now: '2026-11-11T20:00:00.000Z',
      discountGranted: 3600,
      salesGross: 66600,
      discountPercent: 5.4,
      salesWithPromotion: 36600,
      billsWithPromotion: 3,
    });
  });

  it('on Monday before the cut-off the business week is still the previous one', async () => {
    const res = await week(fixtures.adminA, new Date('2026-11-09T06:00:00Z')); // Monday 01:00 Bogotá
    expect(res.body).toMatchObject({ weekStart: '2026-11-02T09:00:00.000Z', discountGranted: 5300, salesGross: 58300, discountPercent: 9.1, salesWithPromotion: 58300, billsWithPromotion: 3 });
  });

  it('answers zeros for a week without sales', async () => {
    const res = await week(fixtures.adminA, new Date('2026-01-07T20:00:00Z'));
    expect(res.body).toEqual({
      weekStart: '2026-01-05T09:00:00.000Z',
      now: '2026-01-07T20:00:00.000Z',
      discountGranted: 0,
      salesGross: 0,
      discountPercent: 0,
      salesWithPromotion: 0,
      billsWithPromotion: 0,
    });
  });

  it("counts only the caller's restaurant", async () => {
    const res = await week(fixtures.adminB);
    expect(res.body).toMatchObject({ discountGranted: 100, salesGross: 1100, discountPercent: 9.1, salesWithPromotion: 1100, billsWithPromotion: 1 });
  });

  it('is admin only', async () => {
    const res = await week(fixtures.waiterA);
    expect(res.status).toBe(403);
  });
});
