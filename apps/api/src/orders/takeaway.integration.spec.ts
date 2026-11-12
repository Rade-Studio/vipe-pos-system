import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Clock } from '../common/clock';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/**
 * "Para llevar" (odd/tasks/promociones-mejoras.md M5, S8): orderType takeaway
 * with the customer's name (required, 2..60 after trim) and an optional phone,
 * no table; paid like a dine_in order; the takeaway channel for promotions,
 * the preview and the terminal strip; the comanda header names the customer.
 */
const A = fixtures.restaurantA;
const ids = {
  hamburguesa: 'd5000000-0000-0000-0000-000000000001',
  limonada: 'd5000000-0000-0000-0000-000000000002',
  table: 'f5000000-0000-0000-0000-000000000001',
  register: 'e5000000-0000-0000-0000-000000000001',
} as const;
const cashier = { email: fixtures.bcryptUser.email, profileId: fixtures.bcryptUser.profileId };
const LINES = [{ dishId: ids.hamburguesa, quantity: 1 }];

/** Tuesday 2026-11-10 at HH:MM in America/Bogota (UTC-5). */
const bogota = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 10, 10, h + 5, m));
};

describe('takeaway orders (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let cashMethod: string;
  let promoId: string;
  const cookies: Record<string, string> = {};

  const as = (email: string) => {
    const server = request(app.getHttpServer());
    return {
      get: (url: string) => server.get(url).set('Cookie', cookies[email]),
      post: (url: string, body?: object) => server.post(url).set('Cookie', cookies[email]).send(body),
    };
  };
  const admin = () => as(fixtures.adminA.email);
  const waiter = () => as(fixtures.waiterA.email);
  const cash = () => as(cashier.email);
  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) => superuserQuery<T>(database.superuserUrl, text, values);
  const orderCount = async () => (await db<{ n: number }>('SELECT count(*)::int AS n FROM orders'))[0].n;

  beforeAll(async () => {
    database = await startTestDatabase();
    await db(`INSERT INTO dishes (id, name, price, active, restaurant_id) VALUES ($1, 'Hamburguesa', 20000, true, $3), ($2, 'Limonada', 6000, true, $3)`, [
      ids.hamburguesa,
      ids.limonada,
      A,
    ]);
    await db(`INSERT INTO tables (id, number, status, restaurant_id) VALUES ($1, 50, 'available', $2)`, [ids.table, A]);
    await db(`INSERT INTO cash_registers (id, restaurant_id, opening_timestamp, initial_cash, status) VALUES ($1, $2, now(), 50000, 'open')`, [ids.register, A]);
    [{ id: cashMethod }] = await db<{ id: string }>(`SELECT id FROM payment_methods WHERE restaurant_id = $1 AND code = 'cash'`, [A]);
    app = await createTestApp(database.apiUrl);
    for (const email of [fixtures.adminA.email, fixtures.waiterA.email, cashier.email]) {
      const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD });
      expect(res.status).toBe(200);
      cookies[email] = cookiePair(setCookies(res).vipe_access);
    }
    vi.spyOn(app.get(Clock), 'now').mockReturnValue(bogota('12:00'));
    const promo = await admin().post('/api/catalog/promotions', {
      name: 'Para llevar 10 %',
      startDate: '2026-01-01',
      kind: 'product_discount',
      discountType: 'percentage',
      discountValue: 10,
      channels: ['takeaway'],
      targets: { dishIds: [ids.hamburguesa], categoryIds: [], subcategoryIds: [] },
    });
    expect(promo.status, JSON.stringify(promo.body)).toBe(201);
    promoId = promo.body.id;
  });

  afterAll(async () => {
    await app?.close();
    await database?.stop();
  });

  describe('POST /orders with orderType takeaway', () => {
    it('the waiter creates it with the trimmed name and the normalised phone, no table, in kitchen', async () => {
      const res = await waiter().post('/api/orders', {
        orderType: 'takeaway',
        customerName: '  Ana María  ',
        customerPhone: '+57 315 000 1122',
        items: [{ dishId: ids.limonada, quantity: 2 }],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body).toMatchObject({
        orderType: 'takeaway',
        customerName: 'Ana María',
        customerPhone: '3150001122',
        tableId: null,
        status: 'kitchen',
        waiterId: fixtures.waiterA.profileId,
        subtotal: 12000,
      });
      expect(await db('SELECT order_type, customer_name, customer_phone, table_id FROM orders WHERE id = $1', [res.body.id])).toEqual([
        { order_type: 'takeaway', customer_name: 'Ana María', customer_phone: '3150001122', table_id: null },
      ]);
    });

    it('the cashier creates it without a phone (customerPhone null)', async () => {
      const res = await cash().post('/api/orders', { orderType: 'takeaway', customerName: 'Jo', items: [{ dishId: ids.limonada, quantity: 1 }] });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body).toMatchObject({ orderType: 'takeaway', customerName: 'Jo', customerPhone: null, tableId: null, waiterId: cashier.profileId });
    });

    it('a dine_in order keeps customerName and customerPhone null', async () => {
      const res = await waiter().post('/api/orders', { tableId: ids.table, items: [{ dishId: ids.limonada, quantity: 1 }] });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body).toMatchObject({ orderType: 'dine_in', tableId: ids.table, customerName: null, customerPhone: null });
    });

    it.each([
      ['without a name', { orderType: 'takeaway' }, 'customerName', 'El nombre del cliente debe tener entre 2 y 60 caracteres'],
      ['with a 1-character name', { orderType: 'takeaway', customerName: ' A ' }, 'customerName', 'El nombre del cliente debe tener entre 2 y 60 caracteres'],
      ['with a 61-character name', { orderType: 'takeaway', customerName: 'a'.repeat(61) }, 'customerName', 'El nombre del cliente debe tener entre 2 y 60 caracteres'],
      ['with a short phone', { orderType: 'takeaway', customerName: 'Ana', customerPhone: '315' }, 'customerPhone', 'El teléfono debe tener entre 7 y 15 dígitos'],
      ['with a table', { orderType: 'takeaway', customerName: 'Ana', tableId: ids.table }, 'tableId', 'Un pedido para llevar no tiene mesa'],
      ['dine_in without a table', { orderType: 'dine_in' }, 'tableId', 'Elige la mesa del pedido'],
      ['with a one-emoji name', { orderType: 'takeaway', customerName: '👍' }, 'customerName', 'El nombre del cliente debe tener entre 2 y 60 caracteres'],
      ['dine_in with a customer', { tableId: ids.table, customerName: 'Ana' }, 'customerName', 'Solo un pedido para llevar lleva el nombre del cliente'],
      ['dine_in with a phone', { tableId: ids.table, customerPhone: '3001234567' }, 'customerPhone', undefined],
      ['delivery', { orderType: 'delivery', customerName: 'Ana' }, 'orderType', undefined],
    ])('answers 422 %s and stores nothing', async (_label, body, path, message) => {
      const before = await orderCount();
      const res = await waiter().post('/api/orders', { items: LINES, ...body });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body.message).toContain(message ? `${path}: ${message}` : `${path}: `);
      expect(await orderCount()).toBe(before);
    });
  });

  describe('promotions on the takeaway channel', () => {
    it('tags a takeaway line with a takeaway-only promotion and leaves a dine_in line alone', async () => {
      const takeaway = await waiter().post('/api/orders', { orderType: 'takeaway', customerName: 'Luis', items: LINES });
      expect(takeaway.status, JSON.stringify(takeaway.body)).toBe(201);
      expect(takeaway.body).toMatchObject({ grossSubtotal: 20000, totalDiscounts: 2000, subtotal: 18000 });
      expect(takeaway.body.items[0]).toMatchObject({ promotionId: promoId, promotionName: 'Para llevar 10 %' });
      const dineIn = await waiter().post(`/api/orders`, { tableId: ids.table, items: LINES });
      // The table already has the open dine_in order of the previous test.
      expect(dineIn.status).toBe(409);
      const added = await waiter().post(`/api/orders/${dineIn.body.orderId}/items`, { items: LINES });
      expect(added.status, JSON.stringify(added.body)).toBe(201);
      expect(added.body.totalDiscounts).toBe(0);
    });

    it('the pricing preview on channel takeaway applies it; on dine_in it does not', async () => {
      const takeaway = await waiter().post('/api/orders/pricing-preview', { channel: 'takeaway', lines: LINES });
      expect(takeaway.status, JSON.stringify(takeaway.body)).toBe(200);
      expect(takeaway.body).toMatchObject({ channel: 'takeaway', totalDiscounts: 2000 });
      const dineIn = await waiter().post('/api/orders/pricing-preview', { channel: 'dine_in', lines: LINES });
      expect(dineIn.body).toMatchObject({ channel: 'dine_in', totalDiscounts: 0 });
    });

    it('GET /catalog/promotions/today?channel=takeaway lists it as active; dine_in lists it as other_channel', async () => {
      const takeaway = await waiter().get('/api/catalog/promotions/today?channel=takeaway');
      expect(takeaway.status, JSON.stringify(takeaway.body)).toBe(200);
      expect(takeaway.body.channel).toBe('takeaway');
      expect(takeaway.body.active.map((p: { promotion: { id: string } }) => p.promotion.id)).toContain(promoId);
      const dineIn = await waiter().get('/api/catalog/promotions/today?channel=dine_in');
      expect(dineIn.body.others).toEqual(expect.arrayContaining([expect.objectContaining({ promotion: expect.objectContaining({ id: promoId }), reason: 'other_channel' })]));
    });

    it('the dishes and the menu tree compute the promotion fields on channel takeaway', async () => {
      const dishes = await waiter().get('/api/catalog/dishes?pricing=promotions&channel=takeaway');
      expect(dishes.status, JSON.stringify(dishes.body)).toBe(200);
      const burger = (dishes.body as { id: string; promotionId?: string }[]).find((d) => d.id === ids.hamburguesa);
      expect(burger?.promotionId).toBe(promoId);
      const dineIn = await waiter().get('/api/catalog/dishes?pricing=promotions&channel=dine_in');
      expect((dineIn.body as { id: string; promotionId?: string }[]).find((d) => d.id === ids.hamburguesa)?.promotionId).toBeUndefined();
      const tree = await waiter().get('/api/catalog/menu/tree?channel=takeaway');
      expect(tree.status, JSON.stringify(tree.body)).toBe(200);
      expect(JSON.stringify(tree.body)).toContain(promoId);
    });
  });

  describe('list, pay and print', () => {
    it('GET /orders lists takeaway orders with their customer', async () => {
      const res = await cash().get('/api/orders?status=kitchen');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(expect.arrayContaining([expect.objectContaining({ orderType: 'takeaway', customerName: 'Ana María', customerPhone: '3150001122' })]));
    });

    it('the cashier pays a takeaway order exactly like a dine_in one', async () => {
      const order = await cash().post('/api/orders', { orderType: 'takeaway', customerName: 'Pago', items: [{ dishId: ids.limonada, quantity: 1 }] });
      expect(order.status).toBe(201);
      const paid = await cash().post('/api/payments', {
        orderId: order.body.id,
        cashRegisterId: ids.register,
        tipAmount: 0,
        tenders: [{ paymentMethodId: cashMethod, amount: order.body.subtotal + order.body.tax, cashReceived: 10000 }],
        idempotencyKey: crypto.randomUUID(),
      });
      expect(paid.status, JSON.stringify(paid.body)).toBe(200);
      expect(paid.body).toMatchObject({ status: 'paid' });
      expect((await db<{ status: string }>('SELECT status FROM orders WHERE id = $1', [order.body.id]))[0].status).toBe('paid');
    });

    it('adds items to a sent takeaway order on the takeaway channel, keeping its customer (M5b)', async () => {
      const order = await waiter().post('/api/orders', { orderType: 'takeaway', customerName: 'Rita', items: [{ dishId: ids.limonada, quantity: 1 }] });
      expect(order.status).toBe(201);
      const added = await cash().post(`/api/orders/${order.body.id}/items`, { items: [{ dishId: ids.hamburguesa, quantity: 1 }] });
      expect(added.status, JSON.stringify(added.body)).toBe(201);
      expect(added.body).toMatchObject({ orderType: 'takeaway', customerName: 'Rita', tableId: null, status: 'kitchen', subtotal: 6000 + 18000 });
      expect(added.body.items.find((item: { dishId: string }) => item.dishId === ids.hamburguesa)).toMatchObject({ promotionId: promoId });
    });

    it('the comanda of a takeaway order carries the customer instead of a table', async () => {
      const order = await waiter().post('/api/orders', { orderType: 'takeaway', customerName: 'Marta', items: LINES });
      const job = await waiter().post('/api/print/commands', { orderId: order.body.id, items: [{ name: 'Hamburguesa', quantity: 1 }], table: 7 });
      expect(job.status, JSON.stringify(job.body)).toBe(201);
      const [{ payload }] = await db<{ payload: Record<string, unknown> }>('SELECT payload FROM print_jobs WHERE id = $1', [job.body.id]);
      expect(payload.takeaway).toEqual({ customerName: 'Marta', label: 'PARA LLEVAR · Marta' });
      expect(payload).not.toHaveProperty('table');
    });
  });
});
