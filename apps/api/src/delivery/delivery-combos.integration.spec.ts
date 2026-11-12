import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Clock } from '../common/clock';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/** promociones-mejoras M8 (S7): combos in POST /delivery/orders, live for the delivery channel. */
const A = fixtures.restaurantA;
const ids = {
  platos: 'c8000000-0000-0000-0000-000000000001',
  sopa: 'd8000000-0000-0000-0000-000000000001',
  bandeja: 'd8000000-0000-0000-0000-000000000002',
  jugo: 'd8000000-0000-0000-0000-000000000003',
  arepa: 'd8000000-0000-0000-0000-000000000004',
} as const;

describe('delivery combos (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let cookie = '';
  const promo: Record<string, string> = {};
  const groups: Record<string, string[]> = {};

  const admin = () => {
    const server = request(app.getHttpServer());
    return {
      get: (url: string) => server.get(url).set('Cookie', cookie),
      post: (url: string, body?: object) => server.post(url).set('Cookie', cookie).send(body),
    };
  };
  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) => superuserQuery<T>(database.superuserUrl, text, values);
  const createPromotion = async (body: object) => {
    const res = await admin().post('/api/catalog/promotions', { startDate: '2026-01-01', ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  };
  const combo = (promotion: string, soup: string = ids.sopa) => ({
    comboPromotionId: promo[promotion],
    choices: [soup, ids.bandeja, ids.jugo].map((dishId, i) => ({ groupId: groups[promotion][i], dishId })),
  });
  const deliver = (body: object) =>
    admin().post('/api/delivery/orders', {
      customer: { phone: '3009876543', name: 'Luisa' },
      address: { addressLine: 'Calle 8', neighborhood: null, reference: null, label: null, save: false },
      items: [],
      deliveryFee: 4000,
      paymentMode: 'cash_on_delivery',
      cashChangeFor: null,
      notes: null,
      ...body,
    });
  const stored = async () => ({
    orders: (await db<{ n: number }>(`SELECT count(*)::int AS n FROM orders WHERE order_type = 'delivery'`))[0].n,
    items: (await db<{ n: number }>('SELECT count(*)::int AS n FROM order_items'))[0].n,
  });

  beforeAll(async () => {
    database = await startTestDatabase();
    const q = (text: string, values: unknown[] = []) => superuserQuery(database.superuserUrl, text, values);
    await q(`INSERT INTO categories (id, name, icon, restaurant_id) VALUES ($1, 'Platos', 'soup', $2)`, [ids.platos, A]);
    await q(
      `INSERT INTO dishes (id, name, price, active, category_id, restaurant_id) VALUES
         ($1, 'Sopa', 9000, true, $5, $6), ($2, 'Bandeja', 17000, true, $5, $6), ($3, 'Jugo', 7000, true, $5, $6),
         ($4, 'Arepa', 5000, true, $5, $6)`,
      [ids.sopa, ids.bandeja, ids.jugo, ids.arepa, ids.platos, A],
    );
    app = await createTestApp(database.apiUrl);
    const login = await request(app.getHttpServer()).post('/api/auth/login').send({ email: fixtures.adminA.email, password: PASSWORD });
    cookie = cookiePair(setCookies(login).vipe_access);
    // Tuesday 2026-11-10 12:00 in America/Bogota.
    vi.spyOn(app.get(Clock), 'now').mockReturnValue(new Date(Date.UTC(2026, 10, 10, 17, 0)));
    const comboGroups = [
      { name: 'Sopa', dishIds: [ids.sopa] },
      { name: 'Plato', dishIds: [ids.bandeja] },
      { name: 'Bebida', dishIds: [ids.jugo] },
    ];
    promo.menu = await createPromotion({ name: 'Menú ejecutivo', kind: 'combo', comboPrice: 24000, channels: ['delivery'], comboGroups });
    promo.salon = await createPromotion({ name: 'Menú salón', kind: 'combo', comboPrice: 20000, channels: ['dine_in'], comboGroups });
    const list = await admin().get('/api/catalog/promotions');
    for (const key of ['menu', 'salon']) {
      groups[key] = list.body.find((p: { id: string }) => p.id === promo[key]).comboGroups.map((g: { id: string }) => g.id);
    }
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    await database?.stop();
  });

  it('stores a Menú ejecutivo as 3 lines with one combo, one combo discount −9.000 and the bill', async () => {
    const res = await deliver({ items: [{ dishId: ids.arepa, quantity: 1 }], combos: [combo('menu')] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const orderId = res.body.orderId as string;
    const lines = await db<{ name: string; combo_id: string | null; promotion_id: string | null; snapshot_name: string | null }>(
      `SELECT name, combo_id, promotion_id, promotion_snapshot ->> 'name' AS snapshot_name FROM order_items WHERE order_id = $1 ORDER BY name`,
      [orderId],
    );
    const comboLines = lines.filter((line) => line.combo_id !== null);
    expect(comboLines.map((line) => [line.name, line.promotion_id, line.snapshot_name])).toEqual([
      ['Bandeja', promo.menu, 'Menú ejecutivo'],
      ['Jugo', promo.menu, 'Menú ejecutivo'],
      ['Sopa', promo.menu, 'Menú ejecutivo'],
    ]);
    expect(new Set(comboLines.map((line) => line.combo_id)).size).toBe(1);
    expect(lines.find((line) => line.name === 'Arepa')).toMatchObject({ combo_id: null, promotion_id: null });
    expect(
      await db('SELECT kind, label, amount::int AS amount, combo_id FROM order_discounts WHERE order_id = $1', [orderId]),
    ).toEqual([{ kind: 'combo', label: 'Menú ejecutivo', amount: 9000, combo_id: comboLines[0].combo_id }]);
    const [bill] = await db<{ subtotal: number; tax: number; total_discounts: number }>(
      'SELECT subtotal::int, tax::int, total_discounts::int FROM orders WHERE id = $1',
      [orderId],
    );
    // Arepa 5.000 + combo 33.000 − 9.000.
    expect(bill).toMatchObject({ subtotal: 29000, total_discounts: 9000 });
    const active = await admin().get('/api/delivery/active');
    const row = active.body.find((r: { delivery: { orderId: string } }) => r.delivery.orderId === orderId);
    expect(row).toMatchObject({ subtotal: 29000, tax: bill.tax, amountDue: 29000 + bill.tax, delivery: { deliveryFee: 4000 } });
  });

  it('accepts a delivery made only of a combo', async () => {
    const res = await deliver({ combos: [combo('menu')] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await db('SELECT subtotal::int, total_discounts::int FROM orders WHERE id = $1', [res.body.orderId])).toEqual([
      { subtotal: 24000, total_discounts: 9000 },
    ]);
  });

  it('answers 422 with the engine code and stores nothing for an inactive, unknown or invalid combo', async () => {
    const before = await stored();
    const cases: [object, string][] = [
      [combo('salon'), 'combo_inactive'],
      [{ ...combo('menu'), comboPromotionId: 'aa000000-0000-0000-0000-000000000001' }, 'combo_unknown'],
      [{ ...combo('menu'), choices: combo('menu').choices.slice(0, 2) }, 'combo_group_missing'],
      [combo('menu', ids.arepa), 'combo_choice_invalid'],
    ];
    for (const [body, code] of cases) {
      const res = await deliver({ items: [{ dishId: ids.arepa, quantity: 1 }], combos: [body] });
      expect([res.status, res.body.code]).toEqual([422, code]);
    }
    expect(await stored()).toEqual(before);
  });

  it('refuses more than 20 combos and unknown combo fields with 422', async () => {
    expect((await deliver({ combos: Array.from({ length: 21 }, () => combo('menu')) })).status).toBe(422);
    expect((await deliver({ combos: [{ ...combo('menu'), extra: true }] })).status).toBe(422);
  });
});
