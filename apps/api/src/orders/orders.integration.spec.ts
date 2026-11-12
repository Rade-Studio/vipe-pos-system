import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/** Rows seeded as the superuser for this spec only. */
const o = {
  kitchenUser: '10000000-0000-0000-0000-0000000000c1',
  kitchenProfile: '20000000-0000-0000-0000-0000000000c1',
  kitchenEmail: 'kitchen@a.test',
  arepa: 'd8000000-0000-0000-0000-000000000001',
  jugo: 'd8000000-0000-0000-0000-000000000002',
  retired: 'd8000000-0000-0000-0000-000000000003',
  otherDish: 'd8000000-0000-0000-0000-0000000000b1',
  t1: 'f8000000-0000-0000-0000-000000000001',
  t2: 'f8000000-0000-0000-0000-000000000002',
  t3: 'f8000000-0000-0000-0000-000000000003',
  t4: 'f8000000-0000-0000-0000-000000000004',
  t5: 'f8000000-0000-0000-0000-000000000005',
  t6: 'f8000000-0000-0000-0000-000000000006',
  t7: 'f8000000-0000-0000-0000-000000000007',
  t8: 'f8000000-0000-0000-0000-000000000008',
  t9: 'f8000000-0000-0000-0000-000000000009',
  t10: 'f8000000-0000-0000-0000-000000000010',
  promo: 'd8000000-0000-0000-0000-000000000004',
  t9a: '88000000-0000-0000-0000-000000000091',
  t9b: '88000000-0000-0000-0000-000000000092',
  paidOrder: '88000000-0000-0000-0000-000000000101',
  paidItem: '88000000-0000-0000-0000-000000000111',
  otherTable: 'f8000000-0000-0000-0000-0000000000b1',
  flour: '98000000-0000-0000-0000-000000000001',
} as const;

const ORDER_KEYS = [
  'createdAt', 'discounts', 'grossSubtotal', 'guests', 'id', 'isPartialOrder', 'items', 'notes', 'orderNumber', 'orderType', 'parentOrderId', 'status',
  'subtotal', 'tableId', 'tax', 'taxPercentage', 'tip', 'tipPercentage', 'total', 'totalDiscounts', 'updatedAt', 'waiterId',
];
const ITEM_KEYS = [
  'addedAt', 'comboId', 'comments', 'createdAt', 'discounts', 'dishId', 'id', 'modifiers', 'name', 'orderId', 'price', 'promotionId', 'promotionName', 'quantity',
  'stationId', 'stationSource', 'status', 'updatedAt',
];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('orders endpoints (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    database = await startTestDatabase();
    await seedOrders(database.superuserUrl);
    app = await createTestApp(database.apiUrl);
    for (const email of [fixtures.adminA.email, fixtures.waiterA.email, fixtures.adminB.email, o.kitchenEmail]) {
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
      delete: (url: string) => server.delete(url).set('Cookie', cookie),
    };
  };
  const adminA = () => as(fixtures.adminA.email);
  const waiterA = () => as(fixtures.waiterA.email);
  const adminB = () => as(fixtures.adminB.email);
  const kitchenA = () => as(o.kitchenEmail);
  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    superuserQuery<T>(database.superuserUrl, text, values);
  const tableRow = async (id: string) =>
    (await db<{ status: string; waiter_id: string | null }>('SELECT status, waiter_id FROM tables WHERE id = $1', [id]))[0];
  const ordersOf = (tableId: string) => db('SELECT id FROM orders WHERE table_id = $1', [tableId]);
  const stockSnapshot = async () =>
    (
      await db<{ lots: string; movements: string }>(
        `SELECT (SELECT coalesce(sum(quantity), 0) FROM inventory_lots WHERE ingredient_id = $1)::text AS lots,
                (SELECT count(*) FROM inventory_movements)::text AS movements`,
        [o.flour],
      )
    )[0];
  const setInventoryControl = (enabled: boolean) =>
    db(
      `INSERT INTO business_config (restaurant_id, key, value) VALUES ($1, 'inventory_control_enabled', $2)
       ON CONFLICT (restaurant_id, key) DO UPDATE SET value = excluded.value`,
      [fixtures.restaurantA, String(enabled)],
    );
  const createOrder = (tableId: string, extra: object = {}) =>
    waiterA().post('/api/orders', {
      tableId,
      items: [
        { dishId: o.arepa, quantity: 2, unitPrice: 5000, comments: 'sin sal' },
        { dishId: o.jugo, quantity: 1, unitPrice: 3000 },
      ],
      ...extra,
    });

  it('answers 401 without the access cookie', async () => {
    expect((await request(app.getHttpServer()).get('/api/orders')).status).toBe(401);
  });

  describe('POST /orders', () => {
    it('creates the order with its items in kitchen, the bill from recompute_order_bill and the table in kitchen', async () => {
      const res = await createOrder(o.t1);
      expect(res.status).toBe(201);
      expect(Object.keys(res.body).sort()).toEqual(ORDER_KEYS);
      expect(res.body).toMatchObject({
        tableId: o.t1,
        waiterId: fixtures.waiterA.profileId,
        status: 'kitchen',
        orderType: 'dine_in',
        subtotal: 13000,
        taxPercentage: 10,
        tax: 1300,
        tipPercentage: 10,
        tip: 1300,
        total: 15600,
        totalDiscounts: 0,
        isPartialOrder: false,
        parentOrderId: null,
        createdAt: expect.stringMatching(ISO),
      });
      expect(res.body.items).toHaveLength(2);
      expect(Object.keys(res.body.items[0]).sort()).toEqual(ITEM_KEYS);
      expect(res.body.items.map((item: { name: string; status: string; price: number; quantity: number; comments: string | null }) =>
        [item.name, item.status, item.price, item.quantity, item.comments],
      )).toEqual([
        ['Arepa', 'kitchen', 5000, 2, 'sin sal'],
        ['Jugo', 'kitchen', 3000, 1, null],
      ]);
      expect(await tableRow(o.t1)).toEqual({ status: 'kitchen', waiter_id: fixtures.waiterA.profileId });
      const [stored] = await db<{ restaurant_id: string; total: string }>(
        'SELECT restaurant_id, total::text FROM orders WHERE id = $1',
        [res.body.id],
      );
      expect(stored).toEqual({ restaurant_id: fixtures.restaurantA, total: '15600.00' });
    });

    it('takes the tip percentage from the body when given', async () => {
      const res = await createOrder(o.t6, { tipPercentage: 0 });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ subtotal: 13000, tax: 1300, tip: 0, tipPercentage: 0, total: 14300 });
    });

    it('rejects the kitchen role with 403 and stores nothing', async () => {
      const res = await kitchenA().post('/api/orders', {
        tableId: o.t2,
        items: [{ dishId: o.arepa, quantity: 1, unitPrice: 5000 }],
      });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ statusCode: 403, error: 'Forbidden', message: 'Insufficient role' });
      expect(await ordersOf(o.t2)).toHaveLength(0);
    });

    it('answers 422 for a dish of another restaurant, a retired dish, a foreign table and unknown fields', async () => {
      const foreignDish = await waiterA().post('/api/orders', {
        tableId: o.t2,
        items: [{ dishId: o.otherDish, quantity: 1, unitPrice: 9000 }],
      });
      expect(foreignDish.status).toBe(422);
      expect(foreignDish.body.message).toBe('Unknown dish');
      const retired = await waiterA().post('/api/orders', {
        tableId: o.t2,
        items: [{ dishId: o.retired, quantity: 1, unitPrice: 1000 }],
      });
      expect(retired.status).toBe(422);
      expect(retired.body.message).toBe('Dish not active');
      const foreignTable = await waiterA().post('/api/orders', {
        tableId: o.otherTable,
        items: [{ dishId: o.arepa, quantity: 1, unitPrice: 5000 }],
      });
      expect(foreignTable.status).toBe(422);
      expect(foreignTable.body.message).toBe('Unknown table');
      const unknownField = await waiterA().post('/api/orders', {
        tableId: o.t2,
        total: 1,
        items: [{ dishId: o.arepa, quantity: 1, unitPrice: 5000 }],
      });
      expect(unknownField.status).toBe(422);
      expect(unknownField.body.message).toContain('total');
      expect(await ordersOf(o.t2)).toHaveLength(0);
      expect(await tableRow(o.t2)).toEqual({ status: 'available', waiter_id: null });
    });

    it('rolls the order back when an item insert fails', async () => {
      await db(`CREATE FUNCTION public.t8a_fail_item() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN IF NEW.comments = 'boom' THEN RAISE EXCEPTION 'item insert failed'; END IF; RETURN NEW; END $$`);
      await db(`CREATE TRIGGER t8a_fail_item BEFORE INSERT ON public.order_items
                FOR EACH ROW EXECUTE FUNCTION public.t8a_fail_item()`);
      try {
        const res = await waiterA().post('/api/orders', {
          tableId: o.t3,
          items: [
            { dishId: o.arepa, quantity: 1, unitPrice: 5000 },
            { dishId: o.jugo, quantity: 1, unitPrice: 3000, comments: 'boom' },
          ],
        });
        expect(res.status).toBe(422);
        expect(res.body.message).toBe('item insert failed');
      } finally {
        await db('DROP TRIGGER t8a_fail_item ON public.order_items');
        await db('DROP FUNCTION public.t8a_fail_item()');
      }
      expect(await ordersOf(o.t3)).toHaveLength(0);
      expect(await tableRow(o.t3)).toEqual({ status: 'available', waiter_id: null });
    });

    it('answers 409 with the shortages and changes nothing when stock is short, unless force is true', async () => {
      await setInventoryControl(true);
      try {
        const before = await stockSnapshot();
        const short = await waiterA().post('/api/orders', {
          tableId: o.t4,
          items: [{ dishId: o.arepa, quantity: 2, unitPrice: 5000 }],
        });
        expect(short.status).toBe(409);
        expect(short.body).toEqual({
          statusCode: 409,
          error: 'Conflict',
          message: 'Insufficient stock',
          shortages: [{ ingredientId: o.flour, name: 'Harina', unit: 'g', required: 200, available: 150, missing: 50 }],
        });
        expect(await ordersOf(o.t4)).toHaveLength(0);
        expect(await stockSnapshot()).toEqual(before);
        expect(await tableRow(o.t4)).toEqual({ status: 'available', waiter_id: null });

        const forced = await waiterA().post('/api/orders', {
          tableId: o.t4,
          items: [{ dishId: o.arepa, quantity: 2, unitPrice: 5000 }],
          force: true,
        });
        expect(forced.status).toBe(201);
        expect(await ordersOf(o.t4)).toHaveLength(1);
        const after = await stockSnapshot();
        expect(Number(after.lots)).toBe(Number(before.lots) - 200);
        expect(Number(after.movements)).toBeGreaterThan(Number(before.movements));
        const stamped = await db('SELECT 1 FROM order_items WHERE order_id = $1 AND stock_consumed_at IS NOT NULL', [
          forced.body.id,
        ]);
        expect(stamped).toHaveLength(1);
        expect(await tableRow(o.t4)).toMatchObject({ status: 'kitchen' });
      } finally {
        await setInventoryControl(false);
      }
    });
  });

  describe('reads', () => {
    it('lists orders by status, newest first, with items embedded, and never across restaurants', async () => {
      const res = await adminA().get('/api/orders?status=kitchen,delivered');
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(3);
      expect(res.body.every((order: { status: string }) => ['kitchen', 'delivered'].includes(order.status))).toBe(true);
      const created = res.body.map((order: { createdAt: string }) => order.createdAt);
      expect([...created].sort().reverse()).toEqual(created);
      const first = res.body.find((order: { tableId: string }) => order.tableId === o.t1);
      expect(first.items).toHaveLength(2);
      expect(first).not.toHaveProperty('tableNumber');
      expect((await adminB().get('/api/orders?status=kitchen,delivered')).body).toEqual([]);
    });

    it('adds tableNumber and waiterName with include=table,waiter', async () => {
      const res = await adminA().get('/api/orders?status=kitchen&include=items,table,waiter');
      const first = res.body.find((order: { tableId: string }) => order.tableId === o.t1);
      expect(first).toMatchObject({ tableNumber: 1, waiterName: 'Waiter A' });
    });

    it('answers 422 for an unknown status filter', async () => {
      expect((await adminA().get('/api/orders?status=kitchen,bogus')).status).toBe(422);
    });

    it('reads one order by id; restaurant B gets 404', async () => {
      const [{ id }] = await ordersOf(o.t1);
      const res = await waiterA().get(`/api/orders/${String(id)}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id, tableId: o.t1, total: 15600 });
      expect(res.body.items).toHaveLength(2);
      expect((await adminB().get(`/api/orders/${String(id)}`)).status).toBe(404);
    });
  });

  describe('status, items and served', () => {
    it('moves kitchen -> delivered and serves the table; rejects paid and cancelled with 422', async () => {
      const [{ id }] = await ordersOf(o.t6);
      const paid = await kitchenA().patch(`/api/orders/${String(id)}/status`, { status: 'paid' });
      expect(paid.status).toBe(422);
      expect((await kitchenA().patch(`/api/orders/${String(id)}/status`, { status: 'cancelled' })).status).toBe(422);
      const res = await kitchenA().patch(`/api/orders/${String(id)}/status`, { status: 'delivered' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('delivered');
      expect(await tableRow(o.t6)).toMatchObject({ status: 'served' });
      const again = await kitchenA().patch(`/api/orders/${String(id)}/status`, { status: 'delivered' });
      expect(again.status).toBe(409);
      expect(again.body.message).toBe('Order is not in kitchen');
    });

    it('adds items: recomputes the bill, puts the order and the table back in kitchen', async () => {
      const [{ id }] = await ordersOf(o.t6);
      const res = await waiterA().post(`/api/orders/${String(id)}/items`, {
        items: [{ dishId: o.jugo, quantity: 2, unitPrice: 3000, comments: 'frío' }],
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'kitchen', subtotal: 19000, tax: 1900, tip: 0, total: 20900 });
      expect(res.body.items).toHaveLength(3);
      expect(await tableRow(o.t6)).toMatchObject({ status: 'kitchen' });
      expect((await kitchenA().post(`/api/orders/${String(id)}/items`, { items: [{ dishId: o.jugo, quantity: 1, unitPrice: 1 }] })).status).toBe(403);
      expect((await adminB().post(`/api/orders/${String(id)}/items`, { items: [{ dishId: o.jugo, quantity: 1, unitPrice: 1 }] })).status).toBe(404);
    });

    it('serves items; the last kitchen item flips the order to delivered and the table to served', async () => {
      const [{ id }] = await ordersOf(o.t1);
      const items = await db<{ id: string }>('SELECT id FROM order_items WHERE order_id = $1 ORDER BY name', [id]);
      expect((await waiterA().post(`/api/orders/${String(id)}/items/served`, { itemIds: [items[0].id] })).status).toBe(403);
      const first = await kitchenA().post(`/api/orders/${String(id)}/items/served`, { itemIds: [items[0].id] });
      expect(first.status).toBe(200);
      expect(first.body.status).toBe('kitchen');
      expect(await tableRow(o.t1)).toMatchObject({ status: 'kitchen' });
      const last = await kitchenA().post(`/api/orders/${String(id)}/items/served`, { itemIds: [items[1].id] });
      expect(last.status).toBe(200);
      expect(last.body.status).toBe('delivered');
      expect(last.body.items.map((item: { status: string }) => item.status)).toEqual(['served', 'served']);
      expect(await tableRow(o.t1)).toMatchObject({ status: 'served' });
    });

    it('answers 422 for an item of another order', async () => {
      const [{ id }] = await ordersOf(o.t4);
      const [{ id: foreignItem }] = await db<{ id: string }>(
        'SELECT oi.id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.table_id = $1 LIMIT 1',
        [o.t1],
      );
      const res = await kitchenA().post(`/api/orders/${String(id)}/items/served`, { itemIds: [foreignItem] });
      expect(res.status).toBe(422);
      expect(res.body.message).toBe('Unknown item');
    });
  });

  describe('server pricing and order guards (verification batch)', () => {
    it('prices items from the catalog when unitPrice is absent', async () => {
      const res = await waiterA().post('/api/orders', {
        tableId: o.t7,
        items: [{ dishId: o.arepa, quantity: 3 }],
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ subtotal: 15000 });
      expect(res.body.items[0].price).toBe(5000);
    });

    it('answers 409 Price changed with the server prices and writes nothing when unitPrice differs', async () => {
      const res = await waiterA().post('/api/orders', {
        tableId: o.t8,
        items: [{ dishId: o.arepa, quantity: 3, unitPrice: 1 }, { dishId: o.jugo, quantity: 1, unitPrice: 1 }],
      });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        statusCode: 409,
        error: 'Conflict',
        message: 'Price changed',
        prices: [{ dishId: o.arepa, price: 5000 }, { dishId: o.jugo, price: 3000 }],
      });
      expect(await ordersOf(o.t8)).toHaveLength(0);
      expect(await tableRow(o.t8)).toEqual({ status: 'available', waiter_id: null });
    });

    it('stores the list price of a dish with an active promotion and the discount as its own row', async () => {
      const res = await waiterA().post('/api/orders', {
        tableId: o.t8,
        items: [{ dishId: o.promo, quantity: 1, unitPrice: 10000 }],
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ subtotal: 9000, totalDiscounts: 1000, grossSubtotal: 10000 });
      expect(res.body.items[0]).toMatchObject({ price: 10000, promotionName: 'Diez' });
      expect(res.body.items[0].discounts).toEqual([expect.objectContaining({ kind: 'promotion_item', label: 'Diez', amount: 1000 })]);
    });

    it('applies server prices and the 409 to POST /orders/:id/items', async () => {
      const [{ id }] = await ordersOf(o.t7);
      const mismatch = await waiterA().post(`/api/orders/${String(id)}/items`, {
        items: [{ dishId: o.jugo, quantity: 1, unitPrice: 1 }],
      });
      expect(mismatch.status).toBe(409);
      expect(mismatch.body.prices).toEqual([{ dishId: o.jugo, price: 3000 }]);
      expect(await db('SELECT 1 FROM order_items WHERE order_id = $1', [id])).toHaveLength(1);
      const ok = await waiterA().post(`/api/orders/${String(id)}/items`, { items: [{ dishId: o.jugo, quantity: 1 }] });
      expect(ok.status).toBe(201);
      expect(ok.body.subtotal).toBe(18000);
    });

    it('accepts only dine_in orders until delivery moves to the API', async () => {
      const res = await waiterA().post('/api/orders', {
        orderType: 'delivery',
        items: [{ dishId: o.arepa, quantity: 1 }],
      });
      expect(res.status).toBe(422);
      expect(await db("SELECT 1 FROM orders WHERE order_type = 'delivery'")).toHaveLength(0);
    });

    it('answers 409 Table has an open order with its id', async () => {
      const [{ id }] = await ordersOf(o.t7);
      const res = await waiterA().post('/api/orders', { tableId: o.t7, items: [{ dishId: o.arepa, quantity: 1 }] });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ statusCode: 409, error: 'Conflict', message: 'Table has an open order', orderId: id });
      expect(await ordersOf(o.t7)).toHaveLength(1);
    });

    it('answers 422 when the waiterId is not a waiter or admin profile', async () => {
      const res = await waiterA().post('/api/orders', {
        tableId: o.t5,
        waiterId: o.kitchenProfile,
        items: [{ dishId: o.arepa, quantity: 1 }],
      });
      expect(res.status).toBe(422);
      expect(res.body.message).toBe('Unknown waiter');
      expect(await ordersOf(o.t5)).toHaveLength(0);
    });

    it('add-items shortage without force adds no items and moves no stock', async () => {
      const [{ id }] = await ordersOf(o.t7);
      await setInventoryControl(true);
      try {
        const before = await stockSnapshot();
        const items = await db('SELECT 1 FROM order_items WHERE order_id = $1', [id]);
        const res = await waiterA().post(`/api/orders/${String(id)}/items`, { items: [{ dishId: o.arepa, quantity: 9 }] });
        expect(res.status).toBe(409);
        expect(res.body.message).toBe('Insufficient stock');
        expect(await db('SELECT 1 FROM order_items WHERE order_id = $1', [id])).toHaveLength(items.length);
        expect(await stockSnapshot()).toEqual(before);
      } finally {
        await setInventoryControl(false);
      }
    });

    it('refuses add-items and served on a paid or cancelled order with 409 Order is closed', async () => {
      const add = await waiterA().post(`/api/orders/${o.paidOrder}/items`, { items: [{ dishId: o.jugo, quantity: 1 }] });
      expect(add.status).toBe(409);
      expect(add.body.message).toBe('Order is closed');
      const served = await kitchenA().post(`/api/orders/${o.paidOrder}/items/served`, { itemIds: [o.paidItem] });
      expect(served.status).toBe(409);
      expect(served.body.message).toBe('Order is closed');
      await db("UPDATE orders SET status = 'cancelled' WHERE id = $1", [o.paidOrder]);
      expect((await waiterA().post(`/api/orders/${o.paidOrder}/items`, { items: [{ dishId: o.jugo, quantity: 1 }] })).status).toBe(409);
      await db("UPDATE orders SET status = 'paid' WHERE id = $1", [o.paidOrder]);
      const [item] = await db<{ status: string }>('SELECT status FROM order_items WHERE id = $1', [o.paidItem]);
      expect(item.status).toBe('kitchen');
    });

    it('answers 404 to another restaurant on status and served', async () => {
      const [{ id }] = await ordersOf(o.t7);
      const [{ id: itemId }] = await db<{ id: string }>('SELECT id FROM order_items WHERE order_id = $1 LIMIT 1', [id]);
      expect((await adminB().patch(`/api/orders/${String(id)}/status`, { status: 'delivered' })).status).toBe(404);
      expect((await adminB().post(`/api/orders/${String(id)}/items/served`, { itemIds: [itemId] })).status).toBe(404);
      const [order] = await db<{ status: string }>('SELECT status FROM orders WHERE id = $1', [id]);
      expect(order.status).toBe('kitchen');
    });

    it('rejects the kitchen role on assign and release with 403', async () => {
      expect((await kitchenA().post(`/api/tables/${o.t5}/assign`, { waiterId: fixtures.waiterA.profileId })).status).toBe(403);
      expect((await kitchenA().post(`/api/tables/${o.t5}/release`, {})).status).toBe(403);
      expect(await tableRow(o.t5)).toEqual({ status: 'available', waiter_id: null });
    });

    it('keeps the table when another open order remains, and refuses to cancel a paid order', async () => {
      const res = await adminA().delete(`/api/orders/${o.t9a}`);
      expect(res.status).toBe(204);
      expect(await tableRow(o.t9)).toEqual({ status: 'kitchen', waiter_id: fixtures.waiterA.profileId });
      const paid = await adminA().delete(`/api/orders/${o.paidOrder}`);
      expect(paid.status).toBe(409);
      expect(paid.body).toMatchObject({ message: 'La orden ya está pagada: anula primero el pago', code: 'order_paid' });
      expect(await db('SELECT 1 FROM orders WHERE id = $1', [o.paidOrder])).toHaveLength(1);
      expect(await tableRow(o.t10)).toMatchObject({ status: 'served' });
    });
  });

  describe('DELETE /orders/:id (F1: the audited cancellation, never a delete)', () => {
    it('answers 403 authorization_required without an authorization for an order with sent items, also for the waiter', async () => {
      const [{ id }] = await ordersOf(o.t4);
      for (const caller of [waiterA(), adminA()]) {
        const res = await caller.delete(`/api/orders/${String(id)}`);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('authorization_required');
      }
      expect(await db('SELECT status FROM orders WHERE id = $1', [id])).toEqual([{ status: 'kitchen' }]);
    });

    it('with a reason and a supervisor authorization cancels the order, keeps it and its items and frees the table', async () => {
      const [{ id }] = await ordersOf(o.t4);
      expect((await adminB().delete(`/api/orders/${String(id)}`)).status).toBe(404);
      const [auth] = await db<{ id: string }>(
        `INSERT INTO supervisor_authorizations
           (restaurant_id, action, supervisor_profile_id, requested_by_profile_id, target_type, target_id, created_at, expires_at)
         VALUES ($1, 'cancel_order', $2, $3, 'order', $4, now(), now() + interval '2 minutes') RETURNING id`,
        [fixtures.restaurantA, fixtures.bcryptUser.profileId, fixtures.adminA.profileId, id],
      );
      const res = await adminA().delete(`/api/orders/${String(id)}`).send({ reason: 'customer_left', authorizationId: auth.id });
      expect(res.status).toBe(204);
      expect(await db('SELECT status FROM orders WHERE id = $1', [id])).toEqual([{ status: 'cancelled' }]);
      expect((await db('SELECT 1 FROM order_items WHERE order_id = $1', [id])).length).toBeGreaterThan(0);
      expect(await tableRow(o.t4)).toEqual({ status: 'available', waiter_id: null });
      expect(await db('SELECT event_type, authorized_by_profile_id FROM audit_log WHERE order_id = $1', [id])).toEqual([
        { event_type: 'order_cancelled', authorized_by_profile_id: fixtures.bcryptUser.profileId },
      ]);
    });
  });
});

async function seedOrders(superuserUrl: string) {
  const A = fixtures.restaurantA;
  const B = fixtures.restaurantB;
  const q = (text: string, values: unknown[] = []) => superuserQuery(superuserUrl, text, values);
  await q(
    `INSERT INTO users (id, email, password_hash, password_algo)
       SELECT $1, $2, password_hash, password_algo FROM users WHERE email = $3`,
    [o.kitchenUser, o.kitchenEmail, fixtures.adminA.email],
  );
  await q(
    `INSERT INTO profiles (id, user_id, full_name, email, role, restaurant_id) VALUES ($1, $2, 'Kitchen A', $3, 'kitchen', $4)`,
    [o.kitchenProfile, o.kitchenUser, o.kitchenEmail, A],
  );
  await q(
    `INSERT INTO dishes (id, name, price, active, restaurant_id) VALUES
       ($1, 'Arepa', 5000, true, $5), ($2, 'Jugo', 3000, true, $5), ($3, 'Retirado', 1000, false, $5),
       ($4, 'Otro plato', 9000, true, $6), ($7, 'Promo', 10000, true, $5)`,
    [o.arepa, o.jugo, o.retired, o.otherDish, A, B, o.promo],
  );
  await q(
    `INSERT INTO tables (id, number, status, restaurant_id) VALUES
       ($1, 1, 'available', $8), ($2, 2, 'available', $8), ($3, 3, 'available', $8), ($4, 4, 'available', $8),
       ($5, 5, 'available', $8), ($6, 6, 'available', $8), ($7, 101, 'available', $9)`,
    [o.t1, o.t2, o.t3, o.t4, o.t5, o.t6, o.otherTable, A, B],
  );
  await q(
    `INSERT INTO tables (id, number, status, waiter_id, restaurant_id) VALUES
       ($1, 7, 'available', NULL, $5), ($2, 8, 'available', NULL, $5), ($3, 9, 'kitchen', $6, $5), ($4, 10, 'served', $6, $5)`,
    [o.t7, o.t8, o.t9, o.t10, A, fixtures.waiterA.profileId],
  );
  await q(
    `INSERT INTO orders (id, table_id, waiter_id, status, subtotal, tax, tax_percentage, total, restaurant_id) VALUES
       ($1, $4, $6, 'kitchen', 10, 0, 0, 10, $7), ($2, $4, $6, 'kitchen', 10, 0, 0, 10, $7),
       ($3, $5, $6, 'paid', 10, 0, 0, 10, $7)`,
    [o.t9a, o.t9b, o.paidOrder, o.t9, o.t10, fixtures.waiterA.profileId, A],
  );
  await q(
    `INSERT INTO order_items (id, order_id, dish_id, name, price, quantity, status, restaurant_id)
       VALUES ($1, $2, $3, 'Jugo', 3000, 1, 'kitchen', $4)`,
    [o.paidItem, o.paidOrder, o.jugo, A],
  );
  await q(
    `WITH p AS (INSERT INTO promotions (name, discount_type, discount_value, start_date, end_date, active, restaurant_id)
                VALUES ('Diez', 'percentage', 10, now() - interval '1 day', now() + interval '1 day', true, $2) RETURNING id)
     INSERT INTO promotion_dishes (promotion_id, dish_id, restaurant_id) SELECT id, $1, $2 FROM p`,
    [o.promo, A],
  );
  // One arepa takes 100 g of flour; the default location holds 150 g.
  await q(`INSERT INTO ingredients (id, name, unit, restaurant_id) VALUES ($1, 'Harina', 'g', $2)`, [o.flour, A]);
  await q(
    `WITH r AS (INSERT INTO recipes (dish_id, restaurant_id) VALUES ($1, $2) RETURNING id)
     INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, restaurant_id) SELECT id, $3, 100, $2 FROM r`,
    [o.arepa, A, o.flour],
  );
  await q(
    `INSERT INTO inventory_lots (restaurant_id, ingredient_id, location_id, quantity)
       SELECT $1, $2, private.ensure_default_inventory_location($1), 150`,
    [A, o.flour],
  );
}
