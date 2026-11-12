import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Clock } from '../common/clock';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/**
 * promociones T4 (S7, S8): manual discounts on a line or on the order, from a
 * manual / manual_pin promotion or free, with the supervisor authorization of
 * a supervisor (POST /auth/authorize, action apply_discount, bound to the order).
 */
const A = fixtures.restaurantA;
const ids = {
  postres: 'c4000000-0000-0000-0000-000000000001',
  platos: 'c4000000-0000-0000-0000-000000000002',
  tresLeches: 'd4000000-0000-0000-0000-000000000001',
  bandeja: 'd4000000-0000-0000-0000-000000000002',
  register: 'e4000000-0000-0000-0000-000000000001',
  tables: Array.from({ length: 20 }, (_, i) => `f4000000-0000-0000-0000-0000000000${String(i + 10)}`),
} as const;
const cashier = { email: fixtures.bcryptUser.email, profileId: fixtures.bcryptUser.profileId };
const PINS: Record<string, string> = { [fixtures.adminA.profileId]: '9157', [cashier.profileId]: '582046' };

/** Tuesday 2026-11-10 at HH:MM in America/Bogota (UTC-5). */
const bogota = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 10, 10, h + 5, m));
};

describe('manual discounts (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let cashMethod: string;
  const cookies: Record<string, string> = {};
  const promo: Record<string, string> = {};
  let tableIndex = 0;

  const as = (email: string) => {
    const server = request(app.getHttpServer());
    return {
      get: (url: string) => server.get(url).set('Cookie', cookies[email]),
      post: (url: string, body?: object) => server.post(url).set('Cookie', cookies[email]).send(body),
      put: (url: string, body?: object) => server.put(url).set('Cookie', cookies[email]).send(body),
      patch: (url: string, body?: object) => server.patch(url).set('Cookie', cookies[email]).send(body),
      delete: (url: string, body?: object) => server.delete(url).set('Cookie', cookies[email]).send(body),
    };
  };
  const admin = () => as(fixtures.adminA.email);
  const waiter = () => as(fixtures.waiterA.email);
  const cash = () => as(cashier.email);
  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) => superuserQuery<T>(database.superuserUrl, text, values);
  const send = async (items: { dishId: string; quantity: number }[]) => {
    const res = await waiter().post('/api/orders', { tableId: ids.tables[tableIndex++], items });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as { id: string; items: { id: string; dishId: string }[] };
  };
  /** The admin's PIN authorization requested by the cashier for this order (apply_discount; void_item for a void). */
  const authorize = async (orderId: string, caller = cash(), supervisor: string = fixtures.adminA.profileId, action = 'apply_discount') => {
    const res = await caller.post('/api/auth/authorize', { pin: PINS[supervisor], action, profileId: supervisor, targetType: 'order', targetId: orderId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.authorizationId as string;
  };
  const rows = (orderId: string) =>
    db<{ kind: string; source: string; label: string; amount: number; reason: string | null; created_by: string | null; authorized_by: string | null }>(
      `SELECT kind, source, label, amount::int AS amount, reason, created_by, authorized_by
         FROM order_discounts WHERE order_id = $1 ORDER BY created_at, id`,
      [orderId],
    );
  const bill = async (orderId: string) =>
    (await db<{ subtotal: number; total_discounts: number; total: number }>('SELECT subtotal::int AS subtotal, total_discounts::int AS total_discounts, total::int AS total FROM orders WHERE id = $1', [orderId]))[0];
  const createPromotion = async (body: object) => {
    const res = await admin().post('/api/catalog/promotions', { startDate: '2026-01-01', ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return (res.body as { id: string }).id;
  };

  beforeAll(async () => {
    database = await startTestDatabase();
    const q = db;
    await q(`INSERT INTO categories (id, name, icon, restaurant_id) VALUES ($1, 'Postres', 'cake', $3), ($2, 'Platos', 'soup', $3)`, [ids.postres, ids.platos, A]);
    await q(
      `INSERT INTO dishes (id, name, price, active, category_id, restaurant_id) VALUES
         ($1, 'Tres leches', 14000, true, $3, $5), ($2, 'Bandeja', 30000, true, $4, $5)`,
      [ids.tresLeches, ids.bandeja, ids.postres, ids.platos, A],
    );
    for (const [index, id] of ids.tables.entries()) {
      await q(`INSERT INTO tables (id, number, status, restaurant_id) VALUES ($1, $2, 'available', $3)`, [id, 400 + index, A]);
    }
    await q(`INSERT INTO cash_registers (id, restaurant_id, opening_timestamp, initial_cash, status) VALUES ($1, $2, now(), 50000, 'open')`, [ids.register, A]);
    [{ id: cashMethod }] = await q<{ id: string }>(`SELECT id FROM payment_methods WHERE restaurant_id = $1 AND code = 'cash'`, [A]);
    app = await createTestApp(database.apiUrl);
    for (const email of [fixtures.adminA.email, fixtures.waiterA.email, cashier.email]) {
      const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD });
      expect(res.status).toBe(200);
      cookies[email] = cookiePair(setCookies(res).vipe_access);
    }
    for (const [profileId, pin] of Object.entries(PINS)) {
      expect((await admin().put(`/api/staff/${profileId}/pin`, { pin })).status).toBe(204);
    }
    vi.spyOn(app.get(Clock), 'now').mockReturnValue(bogota('12:00'));
    promo.birthday = await createPromotion({
      name: 'Cortesía de cumpleaños',
      kind: 'product_discount',
      mode: 'manual_pin',
      discountType: 'percentage',
      discountValue: 100,
      maxUsesPerOrder: 1,
      targets: { dishIds: [], categoryIds: [ids.postres], subcategoryIds: [] },
    });
    promo.house = await createPromotion({
      name: 'Postre de la casa',
      kind: 'product_discount',
      mode: 'manual',
      discountType: 'fixed_amount',
      discountValue: 2000,
      targets: { dishIds: [], categoryIds: [ids.postres], subcategoryIds: [] },
    });
    promo.combo = await createPromotion({
      name: 'Menú manual',
      kind: 'combo',
      mode: 'manual',
      comboPrice: 10000,
      comboGroups: [{ name: 'Postre', dishIds: [ids.tresLeches] }],
    });
    promo.billMin = await createPromotion({
      name: 'Cliente VIP',
      kind: 'bill_discount',
      mode: 'manual',
      discountType: 'percentage',
      discountValue: 10,
      minSubtotal: 40000,
    });
  });

  beforeEach(() => {
    vi.spyOn(app.get(Clock), 'now').mockReturnValue(bogota('12:00'));
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
    await database?.stop();
  });

  describe('POST /orders/:id/discounts', () => {
    it('applies "Cortesía de cumpleaños" (manual_pin, 100%) to a Tres leches line with the PIN, once per order', async () => {
      const order = await send([{ dishId: ids.tresLeches, quantity: 1 }, { dishId: ids.bandeja, quantity: 1 }]);
      const line = order.items.find((item) => item.dishId === ids.tresLeches)!.id;
      const body = { orderItemId: line, promotionId: promo.birthday, reason: '  Cumpleaños de Ana  ' };

      const without = await cash().post(`/api/orders/${order.id}/discounts`, body);
      expect(without.status).toBe(403);
      expect(without.body.code).toBe('authorization_required');
      const wrong = await cash().post(`/api/orders/${order.id}/discounts`, { ...body, authorizationId: crypto.randomUUID() });
      expect(wrong.status).toBe(403);
      expect(wrong.body.code).toBe('authorization_invalid');
      const badPin = await cash().post('/api/auth/authorize', { pin: '0000', action: 'void_item', profileId: fixtures.adminA.profileId, targetType: 'order', targetId: order.id });
      expect(badPin.status).toBeGreaterThanOrEqual(400);
      expect(await rows(order.id)).toEqual([]);

      const res = await cash().post(`/api/orders/${order.id}/discounts`, { ...body, authorizationId: await authorize(order.id) });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body).toMatchObject({ grossSubtotal: 44000, totalDiscounts: 14000, subtotal: 30000 });
      const item = res.body.items.find((i: { id: string }) => i.id === line);
      expect(item.discounts).toEqual([
        expect.objectContaining({
          kind: 'manual_item',
          source: 'manual',
          label: 'Cortesía de cumpleaños',
          amount: 14000,
          promotionId: promo.birthday,
          orderItemId: line,
          reason: 'Cumpleaños de Ana',
          authorizedBy: { id: fixtures.adminA.profileId, name: 'Admin A' },
        }),
      ]);
      expect(await rows(order.id)).toEqual([
        { kind: 'manual_item', source: 'manual', label: 'Cortesía de cumpleaños', amount: 14000, reason: 'Cumpleaños de Ana', created_by: cashier.profileId, authorized_by: fixtures.adminA.profileId },
      ]);

      const again = await cash().post(`/api/orders/${order.id}/discounts`, { ...body, authorizationId: await authorize(order.id) });
      expect(again.status).toBe(422);
      expect(again.body.code).toBe('promotion_max_uses');
      expect(await rows(order.id)).toHaveLength(1);
    });

    it('applies a manual promotion without PIN (authorized by the caller) and never above what is left on the line', async () => {
      const order = await send([{ dishId: ids.tresLeches, quantity: 1 }]);
      const line = order.items[0].id;
      const house = await cash().post(`/api/orders/${order.id}/discounts`, { orderItemId: line, promotionId: promo.house, reason: 'Cliente frecuente' });
      expect(house.status, JSON.stringify(house.body)).toBe(201);
      expect(house.body.discounts).toEqual([expect.objectContaining({ amount: 2000, authorizedBy: { id: cashier.profileId, name: 'Legacy A' } })]);
      const free = await cash().post(`/api/orders/${order.id}/discounts`, {
        orderItemId: line,
        discountType: 'fixed_amount',
        discountValue: 50000,
        reason: 'Reclamo',
        authorizationId: await authorize(order.id),
      });
      expect(free.status, JSON.stringify(free.body)).toBe(201);
      expect((await rows(order.id)).map((r) => [r.label, r.amount])).toEqual([
        ['Postre de la casa', 2000],
        ['Descuento manual', 12000],
      ]);
      const nothing = await cash().post(`/api/orders/${order.id}/discounts`, { orderItemId: line, promotionId: promo.house, reason: 'Otra vez' });
      expect(nothing.status).toBe(422);
      expect(nothing.body.code).toBe('discount_nothing_left');
    });

    it('applies a free 10% on the order from the net subtotal; a short reason or a combo promotion is refused and nothing is stored', async () => {
      const order = await send([{ dishId: ids.tresLeches, quantity: 1 }, { dishId: ids.bandeja, quantity: 1 }]);
      const line = order.items.find((item) => item.dishId === ids.tresLeches)!.id;
      expect((await cash().post(`/api/orders/${order.id}/discounts`, { orderItemId: line, promotionId: promo.house, reason: 'Cliente frecuente' })).status).toBe(201);

      const short = await cash().post(`/api/orders/${order.id}/discounts`, { discountType: 'percentage', discountValue: 10, reason: ' ab ', authorizationId: await authorize(order.id) });
      expect(short.status).toBe(422);
      expect(short.body.code).toBe('discount_reason_invalid');
      const combo = await cash().post(`/api/orders/${order.id}/discounts`, { promotionId: promo.combo, reason: 'No aplica' });
      expect(combo.status).toBe(422);
      expect(combo.body.code).toBe('promotion_kind_unsupported');
      expect(await rows(order.id)).toHaveLength(1);

      const res = await cash().post(`/api/orders/${order.id}/discounts`, { discountType: 'percentage', discountValue: 10, reason: 'Demora en cocina', authorizationId: await authorize(order.id) });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      // Net subtotal 44.000 − 2.000 = 42.000 → 10% = 4.200.
      expect(res.body.discounts.at(-1)).toMatchObject({ kind: 'manual_bill', label: 'Descuento manual', amount: 4200, orderItemId: null, reason: 'Demora en cocina' });
      expect(await bill(order.id)).toMatchObject({ subtotal: 37800, total_discounts: 6200 });
    });

    it('keeps manual discounts when items are added and when another line is voided, and the preview counts them', async () => {
      const order = await send([{ dishId: ids.tresLeches, quantity: 1 }, { dishId: ids.bandeja, quantity: 1 }]);
      const line = order.items.find((item) => item.dishId === ids.tresLeches)!.id;
      const other = order.items.find((item) => item.dishId === ids.bandeja)!.id;
      expect(
        (await cash().post(`/api/orders/${order.id}/discounts`, { orderItemId: line, promotionId: promo.birthday, reason: 'Cumpleaños', authorizationId: await authorize(order.id) })).status,
      ).toBe(201);
      expect((await waiter().post(`/api/orders/${order.id}/items`, { items: [{ dishId: ids.bandeja, quantity: 1 }] })).status).toBe(201);
      const voided = await waiter().post(`/api/orders/${order.id}/items/void`, {
        items: [{ itemId: other, quantity: 1 }],
        reason: 'waiter_error',
        authorizationId: await authorize(order.id, waiter(), fixtures.adminA.profileId, 'void_item'),
      });
      expect(voided.status, JSON.stringify(voided.body)).toBe(200);
      expect(await rows(order.id)).toEqual([expect.objectContaining({ kind: 'manual_item', amount: 14000 })]);
      expect(await bill(order.id)).toMatchObject({ subtotal: 30000, total_discounts: 14000 });

      const preview = await waiter().post('/api/orders/pricing-preview', { channel: 'dine_in', orderId: order.id, lines: [] });
      expect(preview.status, JSON.stringify(preview.body)).toBe(200);
      expect(preview.body).toMatchObject({ grossSubtotal: 44000, totalDiscounts: 14000, netSubtotal: 30000 });
      expect(preview.body.lines.find((l: { orderItemId: string }) => l.orderItemId === line).discounts).toEqual([
        expect.objectContaining({ kind: 'manual_item', label: 'Cortesía de cumpleaños', amount: 14000 }),
      ]);
    });

    it('refuses a void_item authorization for a discount and an apply_discount one for a void', async () => {
      const order = await send([{ dishId: ids.tresLeches, quantity: 1 }]);
      const line = order.items[0].id;
      const voidAuth = await authorize(order.id, cash(), fixtures.adminA.profileId, 'void_item');
      const discount = await cash().post(`/api/orders/${order.id}/discounts`, { orderItemId: line, promotionId: promo.birthday, reason: 'Cumpleaños', authorizationId: voidAuth });
      expect(discount.status).toBe(403);
      expect(discount.body.code).toBe('authorization_invalid');
      expect(await rows(order.id)).toEqual([]);

      const voided = await cash().post(`/api/orders/${order.id}/items/void`, { items: [{ itemId: line, quantity: 1 }], reason: 'waiter_error', authorizationId: await authorize(order.id) });
      expect(voided.status).toBe(403);
      expect(voided.body.code).toBe('authorization_invalid');
      expect((await db<{ quantity: number }>('SELECT quantity FROM order_items WHERE id = $1', [line]))[0].quantity).toBe(1);
    });

    it('pays a fully discounted order with one 0 cash tender', async () => {
      const order = await send([{ dishId: ids.tresLeches, quantity: 1 }]);
      expect(
        (await cash().post(`/api/orders/${order.id}/discounts`, { orderItemId: order.items[0].id, promotionId: promo.birthday, reason: 'Cumpleaños', authorizationId: await authorize(order.id) }))
          .status,
      ).toBe(201);
      expect(await bill(order.id)).toMatchObject({ subtotal: 0, total: 0 });
      const paid = await cash().post('/api/payments', {
        orderId: order.id,
        cashRegisterId: ids.register,
        tipAmount: 0,
        tenders: [{ paymentMethodId: cashMethod, amount: 0, cashReceived: 0 }],
        idempotencyKey: crypto.randomUUID(),
      });
      expect(paid.status, JSON.stringify(paid.body)).toBe(200);
      expect(paid.body).toMatchObject({ status: 'paid', amountDue: 0 });
      expect((await db<{ status: string }>('SELECT status FROM orders WHERE id = $1', [order.id]))[0].status).toBe('paid');
      expect(
        await db('SELECT t.amount::int AS amount, t.cash_received::int AS cash_received FROM payment_tenders t JOIN payments p ON p.id = t.payment_id WHERE p.order_id = $1', [order.id]),
      ).toEqual([{ amount: 0, cash_received: 0 }]);
    });

    it('refuses a paid order with order_closed and stores nothing', async () => {
      const order = await send([{ dishId: ids.bandeja, quantity: 1 }]);
      await db(`UPDATE orders SET status = 'paid' WHERE id = $1`, [order.id]);
      const res = await cash().post(`/api/orders/${order.id}/discounts`, { discountType: 'percentage', discountValue: 10, reason: 'Demora', authorizationId: await authorize(order.id) });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('order_closed');
      expect(await rows(order.id)).toEqual([]);
    });

    it('is not for waiters', async () => {
      const order = await send([{ dishId: ids.bandeja, quantity: 1 }]);
      expect((await waiter().post(`/api/orders/${order.id}/discounts`, { promotionId: promo.house, reason: 'Hola' })).status).toBe(403);
    });
  });

  describe('DELETE /orders/:id/discounts/:discountId', () => {
    it('removes a manual_pin discount only with the PIN and recomputes the bill; an automatic row cannot be removed', async () => {
      const order = await send([{ dishId: ids.tresLeches, quantity: 1 }, { dishId: ids.bandeja, quantity: 1 }]);
      const line = order.items.find((item) => item.dishId === ids.tresLeches)!.id;
      const added = await cash().post(`/api/orders/${order.id}/discounts`, { orderItemId: line, promotionId: promo.birthday, reason: 'Cumpleaños', authorizationId: await authorize(order.id) });
      const discountId = added.body.discounts[0].id as string;

      const without = await cash().delete(`/api/orders/${order.id}/discounts/${discountId}`);
      expect(without.status).toBe(403);
      expect(without.body.code).toBe('authorization_required');
      expect(await rows(order.id)).toHaveLength(1);

      const res = await cash().delete(`/api/orders/${order.id}/discounts/${discountId}`, { authorizationId: await authorize(order.id) });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({ totalDiscounts: 0, subtotal: 44000, discounts: [] });
      expect(await bill(order.id)).toMatchObject({ subtotal: 44000, total_discounts: 0 });

      const house = await cash().post(`/api/orders/${order.id}/discounts`, { orderItemId: line, promotionId: promo.house, reason: 'Cliente frecuente' });
      expect((await cash().delete(`/api/orders/${order.id}/discounts/${house.body.discounts[0].id}`)).status).toBe(200);

      const [auto] = await db<{ id: string }>(
        `INSERT INTO order_discounts (order_id, order_item_id, kind, source, label, amount, restaurant_id)
         VALUES ($1, $2, 'promotion_item', 'automatic', 'Auto', 1000, $3) RETURNING id`,
        [order.id, line, A],
      );
      const refused = await cash().delete(`/api/orders/${order.id}/discounts/${auto.id}`, { authorizationId: await authorize(order.id) });
      expect(refused.status).toBe(422);
      expect(refused.body.code).toBe('discount_not_manual');
    });
  });

  describe('correction T4 (L24)', () => {
    const add = (orderId: string, body: object) => cash().post(`/api/orders/${orderId}/discounts`, body);
    const voidItem = async (orderId: string, itemId: string, quantity: number) => {
      const res = await waiter().post(`/api/orders/${orderId}/items/void`, {
        items: [{ itemId, quantity }],
        reason: 'waiter_error',
        authorizationId: await authorize(orderId, waiter(), fixtures.adminA.profileId, 'void_item'),
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    };
    const gross = async (orderId: string) =>
      (await db<{ gross: number }>(`SELECT coalesce(sum(round(price * quantity)), 0)::int AS gross FROM order_items WHERE order_id = $1 AND status IS DISTINCT FROM 'cancelled'`, [orderId]))[0].gross;

    it('D1: refuses a line discount when a 100% bill discount left nothing, and the rows never exceed the gross subtotal', async () => {
      const order = await send([{ dishId: ids.tresLeches, quantity: 1 }]);
      const all = await add(order.id, { discountType: 'percentage', discountValue: 100, reason: 'Cortesía total', authorizationId: await authorize(order.id) });
      expect(all.status, JSON.stringify(all.body)).toBe(201);
      const line = await add(order.id, { orderItemId: order.items[0].id, discountType: 'percentage', discountValue: 50, reason: 'Mitad', authorizationId: await authorize(order.id) });
      expect(line.status).toBe(422);
      expect(line.body).toMatchObject({ code: 'discount_nothing_left', message: 'No queda valor por descontar' });
      expect((await rows(order.id)).map((r) => [r.kind, r.amount])).toEqual([['manual_bill', 14000]]);
      expect(await bill(order.id)).toMatchObject({ subtotal: 0, total_discounts: 14000 });
    });

    it('D2: lowers a manual bill discount that exceeds the base left after a void', async () => {
      const order = await send([{ dishId: ids.bandeja, quantity: 2 }]);
      expect((await add(order.id, { discountType: 'fixed_amount', discountValue: 50000, reason: 'Reclamo', authorizationId: await authorize(order.id) })).status).toBe(201);
      await voidItem(order.id, order.items[0].id, 1);
      const stored = await rows(order.id);
      expect(stored.map((r) => [r.kind, r.amount])).toEqual([['manual_bill', 30000]]);
      expect(stored.reduce((sum, r) => sum + r.amount, 0)).toBeLessThanOrEqual(await gross(order.id));
      expect(await bill(order.id)).toMatchObject({ subtotal: 0, total_discounts: 30000 });
    });

    it('D3: rescales a manual line discount on a partial void (10% of 2 units becomes 10% of 1)', async () => {
      const order = await send([{ dishId: ids.tresLeches, quantity: 2 }]);
      expect((await add(order.id, { orderItemId: order.items[0].id, discountType: 'percentage', discountValue: 10, reason: 'Demora', authorizationId: await authorize(order.id) })).status).toBe(201);
      expect((await rows(order.id)).map((r) => r.amount)).toEqual([2800]);
      await voidItem(order.id, order.items[0].id, 1);
      expect((await rows(order.id)).map((r) => r.amount)).toEqual([1400]);
      expect(await bill(order.id)).toMatchObject({ subtotal: 12600, total_discounts: 1400 });
    });

    it('D4: a discount added under manual_pin still needs the PIN after the promotion becomes manual', async () => {
      const pinned = await createPromotion({
        name: 'Cortesía del chef',
        kind: 'product_discount',
        mode: 'manual_pin',
        discountType: 'fixed_amount',
        discountValue: 1000,
        targets: { dishIds: [], categoryIds: [ids.postres], subcategoryIds: [] },
      });
      const order = await send([{ dishId: ids.tresLeches, quantity: 1 }]);
      const added = await add(order.id, { orderItemId: order.items[0].id, promotionId: pinned, reason: 'Chef', authorizationId: await authorize(order.id) });
      expect(added.status, JSON.stringify(added.body)).toBe(201);
      expect((await admin().patch(`/api/catalog/promotions/${pinned}`, { mode: 'manual' })).status).toBe(200);
      const res = await cash().delete(`/api/orders/${order.id}/discounts/${added.body.discounts[0].id}`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('authorization_required');
      expect(await rows(order.id)).toHaveLength(1);
    });

    it('D5a: a manual bill promotion checks its minimum on the gross subtotal minus product discounts', async () => {
      const order = await send([{ dishId: ids.tresLeches, quantity: 1 }, { dishId: ids.bandeja, quantity: 1 }]);
      expect((await add(order.id, { discountType: 'fixed_amount', discountValue: 5000, reason: 'Demora', authorizationId: await authorize(order.id) })).status).toBe(201);
      // Net 39.000 is under the 40.000 minimum; gross minus product discounts is 44.000.
      const res = await add(order.id, { promotionId: promo.billMin, reason: 'Cliente VIP' });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect((await rows(order.id)).map((r) => [r.label, r.amount])).toEqual([
        ['Descuento manual', 5000],
        ['Cliente VIP', 3900],
      ]);
      // A 5.000 line discount leaves 39.000 after product discounts: under the minimum.
      const small = await send([{ dishId: ids.bandeja, quantity: 1 }, { dishId: ids.tresLeches, quantity: 1 }]);
      const smallLine = small.items.find((item) => item.dishId === ids.bandeja)!.id;
      expect((await add(small.id, { orderItemId: smallLine, discountType: 'fixed_amount', discountValue: 5000, reason: 'Demora', authorizationId: await authorize(small.id) })).status).toBe(201);
      const refused = await add(small.id, { promotionId: promo.billMin, reason: 'Cliente VIP' });
      expect(refused.status).toBe(422);
      expect(refused.body.code).toBe('promotion_min_subtotal');
      expect(await rows(small.id)).toHaveLength(1);
    });

    it('refuses an apply_discount authorization used twice and one for another order', async () => {
      const order = await send([{ dishId: ids.bandeja, quantity: 1 }]);
      const other = await send([{ dishId: ids.bandeja, quantity: 1 }]);
      const body = { discountType: 'fixed_amount', discountValue: 1000, reason: 'Demora' };
      const authorizationId = await authorize(order.id);
      expect((await add(order.id, { ...body, authorizationId })).status).toBe(201);
      const reused = await add(order.id, { ...body, authorizationId });
      expect(reused.status).toBe(403);
      expect(reused.body.code).toBe('authorization_invalid');
      expect(await rows(order.id)).toHaveLength(1);
      const foreign = await add(other.id, { ...body, authorizationId: await authorize(order.id) });
      expect(foreign.status).toBe(403);
      expect(foreign.body.code).toBe('authorization_invalid');
      expect(await rows(other.id)).toEqual([]);
    });

    it('refuses a cashier authorizing their own discount while allow_self_authorization is off', async () => {
      const order = await send([{ dishId: ids.bandeja, quantity: 1 }]);
      const own = await authorize(order.id, cash(), cashier.profileId);
      const res = await add(order.id, { discountType: 'fixed_amount', discountValue: 1000, reason: 'Demora', authorizationId: own });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('self_authorization_not_allowed');
      expect(await rows(order.id)).toEqual([]);
    });

    it('refuses a cancelled order with order_closed and stores nothing', async () => {
      const order = await send([{ dishId: ids.bandeja, quantity: 1 }]);
      await db(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [order.id]);
      const res = await add(order.id, { discountType: 'percentage', discountValue: 10, reason: 'Demora', authorizationId: await authorize(order.id) });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('order_closed');
      expect(await rows(order.id)).toEqual([]);
    });

    it('removes a manual-mode discount without authorization, and refuses a waiter', async () => {
      const order = await send([{ dishId: ids.tresLeches, quantity: 1 }]);
      const house = await add(order.id, { orderItemId: order.items[0].id, promotionId: promo.house, reason: 'Cliente frecuente' });
      const discountId = house.body.discounts[0].id as string;
      const refused = await waiter().delete(`/api/orders/${order.id}/discounts/${discountId}`);
      expect(refused.status).toBe(403);
      expect(await rows(order.id)).toHaveLength(1);
      const res = await cash().delete(`/api/orders/${order.id}/discounts/${discountId}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await rows(order.id)).toEqual([]);
    });
  });
});
