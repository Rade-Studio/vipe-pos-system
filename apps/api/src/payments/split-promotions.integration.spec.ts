import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Clock } from '../common/clock';
import { OrderDiscountsService } from '../promotions/order-discounts.service';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/** promociones T3b (S2–S4, S6): split and undo split recompute the automatic discounts on each side. */
const A = fixtures.restaurantA;
const ids = {
  cocteles: 'c4000000-0000-0000-0000-000000000001',
  platos: 'c4000000-0000-0000-0000-000000000002',
  margarita: 'd4000000-0000-0000-0000-000000000001',
  mojito: 'd4000000-0000-0000-0000-000000000002',
  sopa: 'd4000000-0000-0000-0000-000000000003',
  bandeja: 'd4000000-0000-0000-0000-000000000004',
  jugo: 'd4000000-0000-0000-0000-000000000005',
  tables: Array.from({ length: 10 }, (_, i) => `f4000000-0000-0000-0000-0000000000${String(i + 10)}`),
} as const;

/** Tuesday 2026-11-10 at HH:MM in America/Bogota (UTC-5). */
const bogota = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 10, 10, h + 5, m));
};

describe('split and undo split with promotions (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};
  const promo: Record<string, string> = {};
  let tableIndex = 0;

  const as = (email: string) => {
    const server = request(app.getHttpServer());
    return {
      get: (url: string) => server.get(url).set('Cookie', cookies[email]),
      post: (url: string, body?: object) => server.post(url).set('Cookie', cookies[email]).send(body),
      patch: (url: string, body?: object) => server.patch(url).set('Cookie', cookies[email]).send(body),
    };
  };
  const admin = () => as(fixtures.adminA.email);
  const waiter = () => as(fixtures.waiterA.email);
  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) => superuserQuery<T>(database.superuserUrl, text, values);
  const at = (hhmm: string) => vi.spyOn(app.get(Clock), 'now').mockReturnValue(bogota(hhmm));
  const line = (dishId: string, quantity: number, unitPrice: number) => ({ dishId, quantity, unitPrice });
  const send = (body: object) => waiter().post('/api/orders', { tableId: ids.tables[tableIndex++], ...body });
  type Line = { id: string; dishId: string; quantity: number };
  const itemOf = (order: { items: Line[] }, dishId: string) => order.items.find((item) => item.dishId === dishId)!;
  const discountsOf = (orderId: string) =>
    db<{ kind: string; amount: number; dish_id: string | null }>(
      `SELECT d.kind, d.amount::int AS amount, oi.dish_id FROM order_discounts d
         LEFT JOIN order_items oi ON oi.id = d.order_item_id
        WHERE d.order_id = $1 ORDER BY d.kind, d.amount`,
      [orderId],
    );
  const bill = async (orderId: string) =>
    (await db<{ subtotal: number; total_discounts: number }>('SELECT subtotal::int, total_discounts::int FROM orders WHERE id = $1', [orderId]))[0];
  const createPromotion = async (body: object) => {
    const res = await admin().post('/api/catalog/promotions', { startDate: '2026-01-01', ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return (res.body as { id: string }).id;
  };

  beforeAll(async () => {
    database = await startTestDatabase();
    await seed(database.superuserUrl);
    app = await createTestApp(database.apiUrl);
    for (const email of [fixtures.adminA.email, fixtures.waiterA.email]) {
      const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD });
      cookies[email] = cookiePair(setCookies(res).vipe_access);
    }
    at('12:00');
    promo.hh = await createPromotion({
      name: 'Happy hour 2x1',
      kind: 'buy_x_pay_y',
      buyQuantity: 2,
      payQuantity: 1,
      timeWindows: [{ from: '17:00', to: '19:00' }],
      channels: ['dine_in'],
      targets: { dishIds: [], categoryIds: [ids.cocteles], subcategoryIds: [] },
    });
    promo.menu = await createPromotion({
      name: 'Menú ejecutivo',
      kind: 'combo',
      comboPrice: 24000,
      channels: ['dine_in'],
      comboGroups: [
        { name: 'Sopa', dishIds: [ids.sopa] },
        { name: 'Plato', dishIds: [ids.bandeja] },
        { name: 'Bebida', dishIds: [ids.jugo] },
      ],
    });
  });

  beforeEach(() => {
    at('18:00');
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    await database?.stop();
  });

  it('2x1: the child takes the pair, the lone Mojito keeps nothing, undo restores −24.000', async () => {
    const order = await send({ items: [line(ids.mojito, 2, 24000), line(ids.margarita, 1, 26000)] });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    expect(order.body).toMatchObject({ grossSubtotal: 74000, totalDiscounts: 24000 });

    const split = await admin().post(`/api/orders/${order.body.id}/split`, {
      items: [
        { orderItemId: itemOf(order.body, ids.mojito).id, quantity: 1 },
        { orderItemId: itemOf(order.body, ids.margarita).id, quantity: 1 },
      ],
    });
    expect(split.status, JSON.stringify(split.body)).toBe(200);
    const child = split.body.childOrderId as string;
    expect(await discountsOf(child)).toEqual([{ kind: 'promotion_item', amount: 24000, dish_id: ids.mojito }]);
    expect(await discountsOf(order.body.id)).toEqual([]);
    expect(await bill(child)).toEqual({ subtotal: 26000, total_discounts: 24000 });
    expect(await bill(order.body.id)).toEqual({ subtotal: 24000, total_discounts: 0 });
    expect(split.body.child).toMatchObject({ orderId: child, subtotal: 26000 });
    expect(split.body.parent).toMatchObject({ orderId: order.body.id, subtotal: 24000 });

    const undo = await admin().post(`/api/orders/${child}/undo-split`);
    expect(undo.status, JSON.stringify(undo.body)).toBe(200);
    expect(undo.body.parent).toMatchObject({ orderId: order.body.id, subtotal: 50000 });
    expect(await bill(order.body.id)).toEqual({ subtotal: 50000, total_discounts: 24000 });
    expect((await discountsOf(order.body.id)).reduce((sum, d) => sum + d.amount, 0)).toBe(24000);
  });

  // split_order refuses delivery orders, so the bill discount is a dine-in one here (paused afterwards).
  it('the bill discount is removed from the parent when a split drops it below the minimum, and back on undo', async () => {
    const bills = await createPromotion({
      name: '10% salón desde $80.000',
      kind: 'bill_discount',
      discountType: 'percentage',
      discountValue: 10,
      minSubtotal: 80000,
      channels: ['dine_in'],
    });
    try {
      const order = await send({ items: [line(ids.bandeja, 5, 17000)] });
      expect(order.status, JSON.stringify(order.body)).toBe(201);
      const orderId = order.body.id as string;
      expect(await bill(orderId)).toEqual({ subtotal: 76500, total_discounts: 8500 });

      const split = await admin().post(`/api/orders/${orderId}/split`, { items: [{ orderItemId: itemOf(order.body, ids.bandeja).id, quantity: 1 }] });
      expect(split.status, JSON.stringify(split.body)).toBe(200);
      expect(await bill(orderId)).toEqual({ subtotal: 68000, total_discounts: 0 });
      expect(await discountsOf(orderId)).toEqual([]);
      expect(await bill(split.body.childOrderId)).toEqual({ subtotal: 17000, total_discounts: 0 });
      expect(split.body.parent).toMatchObject({ orderId, subtotal: 68000 });

      const undo = await admin().post(`/api/orders/${split.body.childOrderId}/undo-split`);
      expect(undo.status, JSON.stringify(undo.body)).toBe(200);
      expect(await bill(orderId)).toEqual({ subtotal: 76500, total_discounts: 8500 });
      expect(await discountsOf(orderId)).toEqual([{ kind: 'promotion_bill', amount: 8500, dish_id: null }]);
      expect(undo.body.parent).toMatchObject({ orderId, subtotal: 76500 });
    } finally {
      await admin().patch(`/api/catalog/promotions/${bills}`, { active: false });
    }
  });

  it('answers both bills after the recompute, in the documented shape', async () => {
    const order = await send({ items: [line(ids.mojito, 2, 24000), line(ids.margarita, 1, 26000)] });
    const split = await admin().post(`/api/orders/${order.body.id}/split`, { items: [{ orderItemId: itemOf(order.body, ids.mojito).id, quantity: 1 }] });
    expect(split.status, JSON.stringify(split.body)).toBe(200);
    expect(Object.keys(split.body).sort()).toEqual(['child', 'childOrderId', 'parent']);
    const stored = async (orderId: string) =>
      (await db<{ orderId: string; subtotal: number; tax: number; tip: number; total: number }>(
        `SELECT id AS "orderId", subtotal::int, tax::int, tip::int, total::int FROM orders WHERE id = $1`,
        [orderId],
      ))[0];
    expect(split.body.parent).toEqual(await stored(order.body.id));
    expect(split.body.child).toEqual(await stored(split.body.childOrderId));
    // Parent: Margarita + Mojito keep the 2x1; child: the lone Mojito.
    expect(split.body.parent).toMatchObject({ subtotal: 26000 });
    expect(split.body.child).toMatchObject({ orderId: split.body.childOrderId, subtotal: 24000 });
  });

  it('rolls the split back when a recompute fails (one transaction)', async () => {
    const order = await send({ items: [line(ids.mojito, 2, 24000), line(ids.margarita, 1, 26000)] });
    const snapshot = async () => ({
      orders: await db('SELECT count(*)::int AS n FROM orders'),
      items: await db('SELECT id, order_id, quantity FROM order_items WHERE order_id = $1 ORDER BY id', [order.body.id]),
      discounts: await discountsOf(order.body.id),
      bill: await bill(order.body.id),
    });
    const before = await snapshot();
    const discounts = app.get(OrderDiscountsService);
    const recompute = discounts.recompute.bind(discounts);
    let calls = 0;
    const spy = vi.spyOn(discounts, 'recompute').mockImplementation(async (orderId, now) => {
      calls += 1;
      // The parent is recomputed, then the child fails.
      if (calls === 2) throw new Error('forced recompute failure');
      return recompute(orderId, now);
    });
    try {
      const res = await admin().post(`/api/orders/${order.body.id}/split`, { items: [{ orderItemId: itemOf(order.body, ids.mojito).id, quantity: 1 }] });
      expect(res.status).toBe(500);
      expect(calls).toBe(2);
    } finally {
      spy.mockRestore();
    }
    expect(await snapshot()).toEqual(before);
  });

  it('pays a fully discounted order through POST /payments with one 0 cash tender', async () => {
    const order = await send({ items: [line(ids.bandeja, 1, 17000)] });
    expect(order.status).toBe(201);
    const registerId = crypto.randomUUID();
    await db(`INSERT INTO cash_registers (id, opening_timestamp, initial_cash, status, restaurant_id) VALUES ($1, now(), 0, 'open', $2)`, [registerId, A]);
    // A courtesy for the whole bill (as POST /orders/:id/discounts stores it); the bill base is now 0.
    await db(
      `INSERT INTO order_discounts (order_id, kind, source, label, amount, reason, requires_authorization, restaurant_id)
       VALUES ($1, 'manual_bill', 'manual', 'Cortesía', 17000, 'Cortesía de la casa', false, $2)`,
      [order.body.id, A],
    );
    const res = await admin().post('/api/payments', {
      orderId: order.body.id,
      cashRegisterId: registerId,
      tipAmount: 0,
      tenders: [{ paymentMethodId: (await db<{ id: string }>(`SELECT id FROM payment_methods WHERE restaurant_id = $1 AND code = 'cash'`, [A]))[0].id, amount: 0, cashReceived: 0 }],
      idempotencyKey: crypto.randomUUID(),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'paid', alreadyPaid: false, amountDue: 0, tipAmount: 0, totalCharged: 0, changeGiven: 0, tenders: [{ lineNo: 1, methodCode: 'cash', amount: 0, cashReceived: 0 }] });
    expect(await db('SELECT status FROM orders WHERE id = $1', [order.body.id])).toEqual([{ status: 'paid' }]);
  });

  it('separating a combo is 422 combo_split_not_allowed and changes nothing', async () => {
    const groups = (await admin().get('/api/catalog/promotions')).body.find((p: { id: string }) => p.id === promo.menu).comboGroups.map(
      (g: { id: string }) => g.id,
    );
    const order = await send({
      items: [line(ids.margarita, 1, 26000)],
      combos: [{ comboPromotionId: promo.menu, choices: [ids.sopa, ids.bandeja, ids.jugo].map((dishId, i) => ({ groupId: groups[i], dishId })) }],
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const snapshot = async () => ({
      orders: await db('SELECT count(*)::int AS n FROM orders'),
      items: await db('SELECT id, order_id, quantity FROM order_items WHERE order_id = $1 ORDER BY id', [order.body.id]),
      discounts: await discountsOf(order.body.id),
      bill: await bill(order.body.id),
    });
    const before = await snapshot();

    const res = await admin().post(`/api/orders/${order.body.id}/split`, { items: [{ orderItemId: itemOf(order.body, ids.bandeja).id, quantity: 1 }] });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'Un menú se mueve completo: pasa todos sus productos juntos',
      code: 'combo_split_not_allowed',
    });
    expect(await snapshot()).toEqual(before);
  });
});

async function seed(superuserUrl: string) {
  const q = (text: string, values: unknown[] = []) => superuserQuery(superuserUrl, text, values);
  await q(`INSERT INTO categories (id, name, icon, restaurant_id) VALUES ($1, 'Cócteles', 'wine', $3), ($2, 'Platos', 'soup', $3)`, [ids.cocteles, ids.platos, A]);
  await q(
    `INSERT INTO dishes (id, name, price, active, category_id, restaurant_id) VALUES
       ($1, 'Margarita', 26000, true, $6, $8), ($2, 'Mojito', 24000, true, $6, $8),
       ($3, 'Sopa', 9000, true, $7, $8), ($4, 'Bandeja', 17000, true, $7, $8), ($5, 'Jugo', 7000, true, $7, $8)`,
    [ids.margarita, ids.mojito, ids.sopa, ids.bandeja, ids.jugo, ids.cocteles, ids.platos, A],
  );
  for (const [index, id] of ids.tables.entries()) {
    await q(`INSERT INTO tables (id, number, status, restaurant_id) VALUES ($1, $2, 'available', $3)`, [id, 400 + index, A]);
  }
}
