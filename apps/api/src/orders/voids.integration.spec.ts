import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACTING_HEADER } from '../auth/terminal-access';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/**
 * F1 (odd/tasks/fase3-operacion.md): cancellations and voids are stored,
 * audited events; nothing is deleted. The supervisor authorization comes from
 * the real POST /auth/authorize (F2) with a PIN.
 */
const A = fixtures.restaurantA;
const ids = {
  cashier2User: '10000000-0000-0000-0000-0000000000f2',
  cashier2: '20000000-0000-0000-0000-0000000000f2',
  register: '30000000-0000-0000-0000-0000000000f1',
  dish: '30000000-0000-0000-0000-0000000000f2',
  flour: '30000000-0000-0000-0000-0000000000f3',
  tables: Array.from({ length: 40 }, (_, i) => `40000000-0000-0000-0000-00000000f${(0x100 + i).toString(16)}`),
};
const cashier = { email: fixtures.bcryptUser.email, profileId: fixtures.bcryptUser.profileId, name: 'Legacy A' };
const cashier2 = { email: 'cashier2@a.test', profileId: ids.cashier2, name: 'Cajero Dos' };
const PINS: Record<string, string> = {
  [fixtures.adminA.profileId]: '9157',
  [cashier.profileId]: '582046',
  [ids.cashier2]: '73914',
  [fixtures.waiterA.profileId]: '4829',
};

const MESSAGES = {
  required: 'Esta acción necesita la autorización de un supervisor',
  invalid: 'La autorización del supervisor no es válida, expiró o ya fue usada',
  self: 'Otra persona con rol de supervisor debe autorizar esta acción',
};

describe('audited cancellations and voids (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let today: string;
  let cashMethod: string;
  const cookies: Record<string, string> = {};

  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    superuserQuery<T>(database.superuserUrl, text, values);
  const server = () => request(app.getHttpServer());
  const as = (email: string) => ({
    get: (url: string) => server().get(url).set('Cookie', cookies[email]),
    post: (url: string, body?: object) => server().post(url).set('Cookie', cookies[email]).send(body),
    put: (url: string, body?: object) => server().put(url).set('Cookie', cookies[email]).send(body),
    delete: (url: string, body?: object) => {
      const req = server().delete(url).set('Cookie', cookies[email]);
      return body ? req.send(body) : req;
    },
  });
  const admin = () => as(fixtures.adminA.email);
  const waiter = () => as(fixtures.waiterA.email);
  const cash = () => as(cashier.email);
  const adminB = () => as(fixtures.adminB.email);
  /** A shared terminal session; with `acting` the request carries the identified staff member's claim. */
  const onTerminal = (cookie: string, acting?: string) => {
    const withClaim = <T extends request.Test>(req: T) => (acting ? req.set(ACTING_HEADER, acting) : req);
    return {
      post: (url: string, body?: object) => withClaim(server().post(url).set('Cookie', cookie)).send(body),
    };
  };

  /** A supervisor authorization from the real PIN flow. */
  /** Bound to one order (cancel_order, void_item) or payment (void_payment); the caller must be the one who then acts. */
  const authorize = async (action: string, supervisor: string, targetId: string, caller: string = fixtures.waiterA.email) => {
    const targetType = action === 'void_payment' ? 'payment' : 'order';
    const res = await as(caller).post('/api/auth/authorize', { pin: PINS[supervisor], action, profileId: supervisor, targetType, targetId });
    expect(res.status).toBe(201);
    return res.body.authorizationId as string;
  };

  let tableIndex = 0;
  /** An order in the kitchen with its lines (all sent: the server only holds sent lines), on a fresh table. */
  const newOrder = async (lines: { name: string; price: number; quantity: number; status?: string }[] = [], restaurant = A) => {
    const tableId = ids.tables[tableIndex++];
    const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
    await db(`INSERT INTO tables (id, number, status, waiter_id, restaurant_id) VALUES ($1, $2, 'kitchen', $3, $4)`, [
      tableId,
      200 + tableIndex,
      restaurant === A ? fixtures.waiterA.profileId : null,
      restaurant,
    ]);
    const [order] = await db<{ id: string }>(
      `INSERT INTO orders (table_id, waiter_id, status, subtotal, tax, tax_percentage, total, restaurant_id)
       VALUES ($1, $2, 'kitchen', $3, 0, 0, $3, $4) RETURNING id`,
      [tableId, restaurant === A ? fixtures.waiterA.profileId : null, subtotal, restaurant],
    );
    const items: string[] = [];
    for (const [index, line] of lines.entries()) {
      const [item] = await db<{ id: string }>(
        `INSERT INTO order_items (order_id, dish_id, name, price, quantity, status, restaurant_id, added_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + $8 * interval '1 second') RETURNING id`,
        [order.id, restaurant === A ? ids.dish : null, line.name, line.price, line.quantity, line.status ?? 'kitchen', restaurant, index],
      );
      items.push(item.id);
    }
    return { orderId: order.id, tableId, items };
  };
  const orderRow = async (id: string) =>
    (await db<{ status: string; subtotal: string; total: string }>('SELECT status, subtotal::text, total::text FROM orders WHERE id = $1', [id]))[0];
  const tableRow = async (id: string) =>
    (await db<{ status: string; waiter_id: string | null }>('SELECT status, waiter_id FROM tables WHERE id = $1', [id]))[0];
  const pay = (orderId: string, amount: number, key = crypto.randomUUID()) =>
    cash().post('/api/payments', {
      orderId,
      cashRegisterId: ids.register,
      tipAmount: 0,
      tenders: [{ paymentMethodId: cashMethod, amount, cashReceived: amount }],
      idempotencyKey: key,
    });

  beforeAll(async () => {
    database = await startTestDatabase();
    await db(
      `INSERT INTO users (id, email, password_hash, password_algo)
         SELECT $1, $2, password_hash, password_algo FROM users WHERE email = $3`,
      [ids.cashier2User, cashier2.email, fixtures.adminA.email],
    );
    await db(`INSERT INTO profiles (id, user_id, full_name, email, role, restaurant_id) VALUES ($1, $2, 'Cajero Dos', $3, 'cashier', $4)`, [
      ids.cashier2,
      ids.cashier2User,
      cashier2.email,
      A,
    ]);
    await db(`INSERT INTO dishes (id, name, price, active, restaurant_id) VALUES ($1, 'Arepa', 5000, true, $2)`, [ids.dish, A]);
    await db(`INSERT INTO cash_registers (id, restaurant_id, opening_timestamp, initial_cash, status) VALUES ($1, $2, now(), 50000, 'open')`, [
      ids.register,
      A,
    ]);
    [{ id: cashMethod }] = await db<{ id: string }>(`SELECT id FROM payment_methods WHERE restaurant_id = $1 AND code = 'cash'`, [A]);
    [{ today }] = await db<{ today: string }>(`SELECT to_char((now() AT TIME ZONE timezone)::date, 'YYYY-MM-DD') AS today FROM restaurants WHERE id = $1`, [A]);
    app = await createTestApp(database.apiUrl);
    for (const email of [fixtures.adminA.email, fixtures.waiterA.email, cashier.email, cashier2.email, fixtures.adminB.email]) {
      const res = await server().post('/api/auth/login').send({ email, password: PASSWORD });
      expect(res.status).toBe(200);
      cookies[email] = cookiePair(setCookies(res).vipe_access);
    }
    for (const [profileId, pin] of Object.entries(PINS)) {
      expect((await admin().put(`/api/staff/${profileId}/pin`, { pin })).status).toBe(204);
    }
  });

  afterAll(async () => {
    await app?.close();
    await database?.stop();
  });

  describe('POST /orders/:id/cancel', () => {
    it('cancels a sent order only with a supervisor authorization; the order and its lines stay, the table is freed', async () => {
      const { orderId, tableId } = await newOrder([
        { name: 'Arepa', price: 5000, quantity: 2 },
        { name: 'Jugo', price: 3000, quantity: 1, status: 'served' },
      ]);
      const refused = await waiter().post(`/api/orders/${orderId}/cancel`, { reason: 'customer_left' });
      expect(refused.status).toBe(403);
      expect(refused.body).toEqual({ statusCode: 403, error: 'Forbidden', message: MESSAGES.required, code: 'authorization_required' });
      expect(await orderRow(orderId)).toMatchObject({ status: 'kitchen' });

      const authorizationId = await authorize('cancel_order', cashier.profileId, orderId);
      const res = await waiter().post(`/api/orders/${orderId}/cancel`, { reason: 'customer_left', authorizationId });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: orderId, status: 'cancelled', total: 13000, tableId });
      expect(res.body.items).toHaveLength(2);
      expect(res.body.cancellation).toEqual({
        reason: 'customer_left',
        reasonLabel: 'El cliente se fue',
        reasonText: null,
        cancelledBy: { id: fixtures.waiterA.profileId, name: 'Waiter A' },
        authorizedBy: { id: cashier.profileId, name: cashier.name },
        selfAuthorized: false,
        previousStatus: 'kitchen',
        legacy: false,
        subtotal: 13000,
        tax: 0,
        tip: 0,
        total: 13000,
        sentItems: 2,
        cancelledAt: expect.any(String),
      });
      expect(await db('SELECT 1 FROM order_items WHERE order_id = $1', [orderId])).toHaveLength(2);
      expect(await tableRow(tableId)).toEqual({ status: 'available', waiter_id: null });

      const reuse = await newOrder([{ name: 'Arepa', price: 5000, quantity: 1 }]);
      const again = await waiter().post(`/api/orders/${reuse.orderId}/cancel`, { reason: 'customer_left', authorizationId });
      expect(again.status).toBe(403);
      expect(again.body.code).toBe('authorization_invalid');
      expect(await orderRow(reuse.orderId)).toMatchObject({ status: 'kitchen' });
    });

    it('drops the cancelled order from the kitchen, cashier and waiter views and lists it for admin with its amounts', async () => {
      const { orderId, tableId } = await newOrder([{ name: 'Arepa', price: 5000, quantity: 1 }]);
      const authorizationId = await authorize('cancel_order', cashier.profileId, orderId);
      expect((await waiter().post(`/api/orders/${orderId}/cancel`, { reason: 'other', reasonText: 'Mesa equivocada', authorizationId })).status).toBe(200);

      const kitchen = await admin().get('/api/orders?status=kitchen');
      const queue = await cash().get('/api/orders?status=active,kitchen,delivered');
      expect(kitchen.body.map((o: { id: string }) => o.id)).not.toContain(orderId);
      expect(queue.body.map((o: { id: string }) => o.id)).not.toContain(orderId);
      const tables = await waiter().get('/api/tables');
      expect(tables.body.find((t: { id: string }) => t.id === tableId)).toMatchObject({ status: 'available', waiterId: null });

      const cancelled = await admin().get(`/api/orders/cancelled?date=${today}`);
      expect(cancelled.status).toBe(200);
      const row = cancelled.body.find((o: { id: string }) => o.id === orderId);
      expect(row).toMatchObject({ status: 'cancelled', total: 5000, tableNumber: expect.any(Number), waiterName: 'Waiter A', delivery: null });
      expect(row.cancellation).toMatchObject({ reason: 'other', reasonLabel: 'Otro', reasonText: 'Mesa equivocada', total: 5000 });
      expect((await waiter().get(`/api/orders/cancelled?date=${today}`)).status).toBe(403);
      expect((await admin().get('/api/orders/cancelled?date=2026-13-01')).status).toBe(422);
    });

    it('refuses an authorization for another action, an expired one and a foreign one (403 authorization_invalid) without spending it', async () => {
      const { orderId } = await newOrder([{ name: 'Arepa', price: 5000, quantity: 1 }]);
      const wrongAction = await authorize('void_item', cashier.profileId, orderId);
      const wrong = await waiter().post(`/api/orders/${orderId}/cancel`, { reason: 'waiter_error', authorizationId: wrongAction });
      expect(wrong.status).toBe(403);
      expect(wrong.body).toMatchObject({ message: MESSAGES.invalid, code: 'authorization_invalid' });
      expect(await db('SELECT consumed_at FROM supervisor_authorizations WHERE id = $1', [wrongAction])).toEqual([{ consumed_at: null }]);

      const [expired] = await db<{ id: string }>(
        `INSERT INTO supervisor_authorizations (restaurant_id, action, supervisor_profile_id, created_at, expires_at)
         VALUES ($1, 'cancel_order', $2, now() - interval '5 minutes', now() - interval '3 minutes') RETURNING id`,
        [A, cashier.profileId],
      );
      expect((await waiter().post(`/api/orders/${orderId}/cancel`, { reason: 'waiter_error', authorizationId: expired.id })).body.code).toBe(
        'authorization_invalid',
      );
      const [fromB] = await db<{ id: string }>(
        `INSERT INTO supervisor_authorizations (restaurant_id, action, supervisor_profile_id, created_at, expires_at)
         VALUES ($1, 'cancel_order', $2, now(), now() + interval '2 minutes') RETURNING id`,
        [fixtures.restaurantB, fixtures.adminB.profileId],
      );
      expect((await waiter().post(`/api/orders/${orderId}/cancel`, { reason: 'waiter_error', authorizationId: fromB.id })).body.code).toBe(
        'authorization_invalid',
      );
      expect(await orderRow(orderId)).toMatchObject({ status: 'kitchen' });
      expect(await db('SELECT 1 FROM audit_log WHERE order_id = $1', [orderId])).toHaveLength(0);
    });

    it('validates the reason against the fixed list; "other" needs a text', async () => {
      const { orderId } = await newOrder([{ name: 'Arepa', price: 5000, quantity: 1 }]);
      const other = await waiter().post(`/api/orders/${orderId}/cancel`, { reason: 'other', reasonText: '  ' });
      expect(other.status).toBe(422);
      expect(other.body.message).toBe('reasonText: Escribe el motivo (entre 3 y 200 caracteres)');
      const unknown = await waiter().post(`/api/orders/${orderId}/cancel`, { reason: 'bored' });
      expect(unknown.status).toBe(422);
      expect(unknown.body.message).toBe('reason: Elige un motivo de la lista');
      expect((await waiter().post(`/api/orders/${orderId}/cancel`, { reason: 'waiter_error', extra: 1 })).status).toBe(422);
      expect(await orderRow(orderId)).toMatchObject({ status: 'kitchen' });
    });

    it('self-authorization is refused by default and flagged when the restaurant allows it (L14)', async () => {
      const { orderId } = await newOrder([{ name: 'Arepa', price: 5000, quantity: 1 }]);
      const own = await authorize('cancel_order', cashier.profileId, orderId, cashier.email);
      const refused = await cash().post(`/api/orders/${orderId}/cancel`, { reason: 'waiter_error', authorizationId: own });
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ message: MESSAGES.self, code: 'self_authorization_not_allowed' });

      expect((await waiter().get('/api/config')).body.allowSelfAuthorization).toBe(false);
      expect((await waiter().put('/api/config', { allowSelfAuthorization: true })).status).toBe(403);
      const on = await admin().put('/api/config', { allowSelfAuthorization: true });
      expect(on.status).toBe(200);
      expect(on.body.allowSelfAuthorization).toBe(true);
      expect((await waiter().get('/api/config')).body.allowSelfAuthorization).toBe(true);
      try {
        const own2 = await authorize('cancel_order', cashier.profileId, orderId, cashier.email);
        const res = await cash().post(`/api/orders/${orderId}/cancel`, { reason: 'waiter_error', authorizationId: own2 });
        expect(res.status).toBe(200);
        expect(res.body.cancellation).toMatchObject({ selfAuthorized: true, cancelledBy: { id: cashier.profileId }, authorizedBy: { id: cashier.profileId } });
        const flagged = await admin().get('/api/audit?selfAuthorized=true');
        expect(flagged.body.map((e: { orderId: string }) => e.orderId)).toEqual([orderId]);
      } finally {
        expect((await admin().put('/api/config', { allowSelfAuthorization: false })).status).toBe(200);
      }
    });

    it('a paid order is not cancelled (409 order_paid) and another restaurant gets 404', async () => {
      const { orderId } = await newOrder([{ name: 'Arepa', price: 5000, quantity: 1 }]);
      expect((await pay(orderId, 5000)).status).toBe(200);
      const authorizationId = await authorize('cancel_order', cashier.profileId, orderId);
      const paid = await waiter().post(`/api/orders/${orderId}/cancel`, { reason: 'waiter_error', authorizationId });
      expect(paid.status).toBe(409);
      expect(paid.body).toMatchObject({ message: 'La orden ya está pagada: anula primero el pago', code: 'order_paid' });

      const open = await newOrder([{ name: 'Arepa', price: 5000, quantity: 1 }]);
      const foreign = await adminB().post(`/api/orders/${open.orderId}/cancel`, { reason: 'waiter_error' });
      expect(foreign.status).toBe(404);
      expect(foreign.body.code).toBe('order_not_found');
      expect(await orderRow(open.orderId)).toMatchObject({ status: 'kitchen' });
    });
  });

  describe('DELETE /orders/:id (compatibility: the audited cancellation)', () => {
    it('without a body cancels an order with nothing on it and keeps the row', async () => {
      const { orderId, tableId } = await newOrder([]);
      const res = await admin().delete(`/api/orders/${orderId}`);
      expect(res.status).toBe(204);
      expect(await orderRow(orderId)).toMatchObject({ status: 'cancelled' });
      expect(await tableRow(tableId)).toEqual({ status: 'available', waiter_id: null });
      const [audit] = await db<{ reason_code: string; reason_text: string; authorized_by_name: string | null }>(
        'SELECT reason_code, reason_text, authorized_by_name FROM audit_log WHERE order_id = $1',
        [orderId],
      );
      expect(audit).toEqual({ reason_code: 'other', reason_text: 'Cancelada sin motivo indicado', authorized_by_name: null });
    });

    it('answers 403 authorization_required for an order with sent lines; with reason and authorization it cancels, never deletes', async () => {
      const { orderId, tableId } = await newOrder([{ name: 'Arepa', price: 5000, quantity: 2 }]);
      const refused = await admin().delete(`/api/orders/${orderId}`);
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe('authorization_required');
      expect(await orderRow(orderId)).toMatchObject({ status: 'kitchen' });

      const authorizationId = await authorize('cancel_order', cashier.profileId, orderId, fixtures.adminA.email);
      const res = await admin().delete(`/api/orders/${orderId}`, { reason: 'dish_returned', authorizationId });
      expect(res.status).toBe(204);
      expect(await orderRow(orderId)).toMatchObject({ status: 'cancelled', total: '10000.00' });
      expect(await db('SELECT 1 FROM order_items WHERE order_id = $1', [orderId])).toHaveLength(1);
      expect(await tableRow(tableId)).toEqual({ status: 'available', waiter_id: null });
      expect((await admin().delete(`/api/orders/${orderId}`)).body.code).toBe('order_cancelled');
    });
  });

  describe('POST /orders/:id/items/void', () => {
    it('voids units of a sent line only with an authorization; the bill drops, the line stays, the stock is not given back', async () => {
      const { orderId, items } = await newOrder([
        { name: 'Arepa', price: 5000, quantity: 3 },
        { name: 'Jugo', price: 2000, quantity: 1, status: 'served' },
      ]);
      const before = await db<{ n: string }>('SELECT count(*)::text AS n FROM inventory_movements');
      const refused = await waiter().post(`/api/orders/${orderId}/items/void`, { items: [{ itemId: items[0], quantity: 1 }], reason: 'dish_returned' });
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe('authorization_required');

      const wrongAction = await authorize('cancel_order', cashier.profileId, orderId);
      expect(
        (await waiter().post(`/api/orders/${orderId}/items/void`, { items: [{ itemId: items[0], quantity: 1 }], reason: 'dish_returned', authorizationId: wrongAction }))
          .body.code,
      ).toBe('authorization_invalid');

      const authorizationId = await authorize('void_item', cashier.profileId, orderId);
      const res = await waiter().post(`/api/orders/${orderId}/items/void`, { items: [{ itemId: items[0], quantity: 2 }], reason: 'dish_returned', authorizationId });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'kitchen', subtotal: 7000, total: 7000 });
      expect(res.body.items.map((i: { id: string; quantity: number }) => [i.id, i.quantity])).toEqual([
        [items[0], 1],
        [items[1], 1],
      ]);
      const [voided] = await db('SELECT quantity, remaining_quantity, unit_price::text, amount::text, sent_to_kitchen, voided_by, authorized_by FROM order_item_voids WHERE order_item_id = $1', [items[0]]);
      expect(voided).toEqual({
        quantity: 2,
        remaining_quantity: 1,
        unit_price: '5000.00',
        amount: '10000.00',
        sent_to_kitchen: true,
        voided_by: fixtures.waiterA.profileId,
        authorized_by: cashier.profileId,
      });
      expect(await db<{ n: string }>('SELECT count(*)::text AS n FROM inventory_movements')).toEqual(before);
    });

    it('a fully voided line leaves the order and the kitchen; bad quantities, unknown lines and closed orders are refused', async () => {
      const { orderId, items } = await newOrder([
        { name: 'Arepa', price: 5000, quantity: 1 },
        { name: 'Jugo', price: 2000, quantity: 1, status: 'served' },
      ]);
      const other = await newOrder([{ name: 'Arepa', price: 5000, quantity: 1 }]);
      const auth1 = await authorize('void_item', cashier.profileId, orderId);
      const tooMany = await waiter().post(`/api/orders/${orderId}/items/void`, { items: [{ itemId: items[0], quantity: 2 }], reason: 'waiter_error', authorizationId: auth1 });
      expect(tooMany.status).toBe(422);
      expect(tooMany.body).toMatchObject({ message: 'No puedes anular más unidades de las que tiene el producto', code: 'void_quantity_exceeded' });
      const foreignLine = await waiter().post(`/api/orders/${orderId}/items/void`, { items: [{ itemId: other.items[0], quantity: 1 }], reason: 'waiter_error', authorizationId: auth1 });
      expect(foreignLine.status).toBe(422);
      expect(foreignLine.body.code).toBe('item_not_found');
      expect(
        (await waiter().post(`/api/orders/${orderId}/items/void`, { items: [{ itemId: items[0], quantity: 1 }, { itemId: items[0], quantity: 1 }], reason: 'waiter_error' }))
          .status,
      ).toBe(422);

      const res = await waiter().post(`/api/orders/${orderId}/items/void`, { items: [{ itemId: items[0], quantity: 1 }], reason: 'waiter_error', authorizationId: auth1 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'delivered', subtotal: 2000 });
      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([items[1]]);
      expect(await db('SELECT quantity, status FROM order_items WHERE id = $1', [items[0]])).toEqual([{ quantity: 0, status: 'cancelled' }]);
      expect((await admin().get('/api/orders?status=kitchen')).body.map((o: { id: string }) => o.id)).not.toContain(orderId);

      const cancelAuth = await authorize('cancel_order', cashier.profileId, orderId);
      expect((await waiter().post(`/api/orders/${orderId}/cancel`, { reason: 'customer_left', authorizationId: cancelAuth })).status).toBe(200);
      const closed = await waiter().post(`/api/orders/${orderId}/items/void`, { items: [{ itemId: items[1], quantity: 1 }], reason: 'waiter_error', authorizationId: await authorize('void_item', cashier.profileId, orderId) });
      expect(closed.status).toBe(409);
      expect(closed.body.code).toBe('order_closed');
      expect((await adminB().post(`/api/orders/${other.orderId}/items/void`, { items: [{ itemId: other.items[0], quantity: 1 }], reason: 'waiter_error' })).status).toBe(404);
    });
  });

  describe('POST /payments/:id/void', () => {
    it('a voided payment counts nowhere (payments, Pagadas, register summary, paid orders, dashboard) and the order is paid again', async () => {
      const { orderId } = await newOrder([{ name: 'Bandeja', price: 8000, quantity: 1, status: 'served' }]);
      const paid = await pay(orderId, 8000);
      expect(paid.status).toBe(200);
      const paymentId = paid.body.paymentId as string;
      const snapshot = async () => {
        const summary = (await cash().get(`/api/registers/summary?ids=${ids.register}`)).body;
        const paidOrders = (await cash().get(`/api/registers/${ids.register}/paid-orders`)).body as { orderId: string }[];
        const completed = (await cash().get(`/api/orders/completed?date=${today}`)).body as { id: string }[];
        const payments = (await cash().get(`/api/payments?orderIds=${orderId}`)).body as unknown[];
        const dashboard = (await admin().get('/api/dashboard/summary')).body;
        return {
          paymentsCount: summary.paymentsCount as number,
          totalSales: summary.totalSales as number,
          listed: paidOrders.some((p) => p.orderId === orderId),
          completed: completed.some((o) => o.id === orderId),
          payments: payments.length,
          monthSales: dashboard.monthSales as number,
        };
      };
      const before = await snapshot();
      expect(before).toMatchObject({ listed: true, completed: true, payments: 1 });

      const refused = await cash().post(`/api/payments/${paymentId}/void`, { reason: 'duplicate_charge' });
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe('authorization_required');
      expect((await waiter().post(`/api/payments/${paymentId}/void`, { reason: 'duplicate_charge' })).status).toBe(403);

      const authorizationId = await authorize('void_payment', ids.cashier2, paymentId, cashier.email);
      const res = await cash().post(`/api/payments/${paymentId}/void`, { reason: 'wrong_payment_method', authorizationId });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        paymentId,
        orderId,
        cashRegisterId: ids.register,
        amountDue: 8000,
        totalCharged: 8000,
        methods: 'cash',
        reason: 'wrong_payment_method',
        reasonLabel: 'Método de pago equivocado',
        voidedBy: { id: cashier.profileId, name: cashier.name },
        authorizedBy: { id: ids.cashier2, name: cashier2.name },
        selfAuthorized: false,
      });
      expect(res.body.tenders).toEqual([
        { lineNo: 1, paymentMethodId: cashMethod, methodCode: 'cash', methodKind: 'cash', amount: 8000, cashReceived: 8000, reference: null },
      ]);
      expect(await snapshot()).toEqual({
        paymentsCount: before.paymentsCount - 1,
        totalSales: before.totalSales - 8000,
        listed: false,
        completed: false,
        payments: 0,
        monthSales: before.monthSales - 8000,
      });
      expect(await orderRow(orderId)).toMatchObject({ status: 'delivered' });
      expect((await cash().get('/api/orders?status=delivered')).body.map((o: { id: string }) => o.id)).toContain(orderId);
      expect(await db('SELECT voided_at IS NOT NULL AS voided FROM payments WHERE id = $1', [paymentId])).toEqual([{ voided: true }]);

      const twice = await cash().post(`/api/payments/${paymentId}/void`, { reason: 'duplicate_charge', authorizationId: await authorize('void_payment', ids.cashier2, paymentId, cashier.email) });
      expect(twice.status).toBe(409);
      expect(twice.body.code).toBe('payment_voided');
      const again = await pay(orderId, 8000);
      expect(again.status).toBe(200);
      expect(again.body.status).toBe('paid');
      expect((await snapshot()).paymentsCount).toBe(before.paymentsCount);

      const audit = await admin().get(`/api/audit?type=payment_voided&actorId=${cashier.profileId}&authorizerId=${ids.cashier2}`);
      expect(audit.status).toBe(200);
      expect(audit.body).toHaveLength(1);
      expect(audit.body[0]).toMatchObject({ eventType: 'payment_voided', paymentId, orderId, amount: 8000, actor: { name: cashier.name }, authorizedBy: { name: cashier2.name } });
    });

    it('refuses the void of a payment whose drawer is closed (409) and of another restaurant (404)', async () => {
      const { orderId } = await newOrder([{ name: 'Tinto', price: 3000, quantity: 1, status: 'served' }]);
      const paid = await pay(orderId, 3000);
      const foreign = await adminB().post(`/api/payments/${paid.body.paymentId}/void`, { reason: 'duplicate_charge' });
      expect(foreign.status).toBe(404);
      expect(foreign.body.code).toBe('payment_not_found');
      await db(`UPDATE cash_registers SET status = 'closed', closing_timestamp = now() WHERE id = $1`, [ids.register]);
      try {
        const res = await cash().post(`/api/payments/${paid.body.paymentId}/void`, { reason: 'duplicate_charge', authorizationId: await authorize('void_payment', ids.cashier2, paid.body.paymentId, cashier.email) });
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ message: 'La caja de este pago ya está cerrada; no se puede anular', code: 'register_closed' });
      } finally {
        await db(`UPDATE cash_registers SET status = 'open', closing_timestamp = NULL WHERE id = $1`, [ids.register]);
      }
    });
  });

  describe('GET /audit', () => {
    it('is admin only, newest first, filtered by date range, type, actor and authorizer', async () => {
      expect((await waiter().get('/api/audit')).status).toBe(403);
      expect((await cash().get('/api/audit')).status).toBe(403);
      const all = await admin().get('/api/audit');
      expect(all.status).toBe(200);
      expect(all.body.length).toBeGreaterThan(3);
      const times = all.body.map((e: { createdAt: string }) => e.createdAt);
      expect([...times].sort().reverse()).toEqual(times);
      expect(Object.keys(all.body[0]).sort()).toEqual([
        'actor', 'amount', 'authorizedBy', 'createdAt', 'details', 'eventType', 'id', 'orderId', 'orderNumber', 'orderType', 'paymentId',
        'reason', 'reasonLabel', 'reasonText', 'selfAuthorized',
      ]);
      const voids = await admin().get('/api/audit?type=items_voided');
      expect(voids.body.length).toBeGreaterThan(0);
      expect(voids.body.every((e: { eventType: string }) => e.eventType === 'items_voided')).toBe(true);
      const byWaiter = await admin().get(`/api/audit?actorId=${fixtures.waiterA.profileId}`);
      expect(byWaiter.body.every((e: { actor: { id: string } }) => e.actor.id === fixtures.waiterA.profileId)).toBe(true);
      const byCashier2 = await admin().get(`/api/audit?authorizerId=${ids.cashier2}`);
      expect(byCashier2.body.every((e: { authorizedBy: { id: string } }) => e.authorizedBy.id === ids.cashier2)).toBe(true);
      expect((await admin().get(`/api/audit?from=${today}&to=${today}`)).body).toHaveLength(all.body.length);
      expect((await admin().get('/api/audit?from=2020-01-01&to=2020-01-02')).body).toEqual([]);
      expect((await admin().get('/api/audit?from=2026-02-02&to=2026-02-01')).status).toBe(422);
      expect((await admin().get('/api/audit?type=deleted')).status).toBe(422);
      expect((await adminB().get('/api/audit')).body).toEqual([]);
    });
  });
  describe('verifier round 2', () => {
    it('a fully voided line is not counted among the popular dishes', async () => {
      const { orderId, items } = await newOrder([
        { name: 'Arepa', price: 5000, quantity: 1 },
        { name: 'Jugo anulado', price: 3000, quantity: 1 },
      ]);
      const authorizationId = await authorize('void_item', cashier.profileId, orderId);
      expect((await waiter().post(`/api/orders/${orderId}/items/void`, { items: [{ itemId: items[1], quantity: 1 }], reason: 'dish_returned', authorizationId })).status).toBe(200);
      expect((await pay(orderId, 5000)).status).toBe(200);
      const dash = await admin().get('/api/dashboard/summary');
      expect(dash.status).toBe(200);
      expect(dash.body.popularDishes.map((d: { name: string }) => d.name)).not.toContain('Jugo anulado');
    });

    it('undo-split of a split with void history answers 409 split_has_voids and keeps the void (B2)', async () => {
      const { orderId, items } = await newOrder([
        { name: 'Arepa', price: 5000, quantity: 5 },
        { name: 'Arepa', price: 5000, quantity: 1 },
        { name: 'Jugo', price: 2000, quantity: 1 },
      ]);
      const authorizationId = await authorize('void_item', cashier.profileId, orderId);
      expect((await waiter().post(`/api/orders/${orderId}/items/void`, { items: [{ itemId: items[0], quantity: 2 }], reason: 'dish_returned', authorizationId })).status).toBe(200);
      const split = await cash().post(`/api/orders/${orderId}/split`, { items: [{ orderItemId: items[0], quantity: 3 }] });
      expect(split.status).toBe(200);
      const undo = await cash().post(`/api/orders/${split.body.childOrderId}/undo-split`);
      expect(undo.status).toBe(409);
      expect(undo.body).toMatchObject({ message: 'Esta cuenta dividida tiene productos anulados; no se puede deshacer la división', code: 'split_has_voids' });
      expect(await db('SELECT count(*)::int AS n FROM order_item_voids WHERE order_item_id = $1', [items[0]])).toEqual([{ n: 1 }]);
    });

    it('an authorization is bound to its order and to the staff member who asked for it (A1)', async () => {
      const a = await newOrder([{ name: 'Lomo', price: 90000, quantity: 2 }]);
      const b = await newOrder([{ name: 'Lomo', price: 90000, quantity: 2 }]);
      const forA = await authorize('void_item', cashier.profileId, a.orderId);
      const voidOf = (order: { orderId: string; items: string[] }) => ({ items: [{ itemId: order.items[0], quantity: 2 }], reason: 'dish_returned', authorizationId: forA });
      const otherOrder = await waiter().post(`/api/orders/${b.orderId}/items/void`, voidOf(b));
      expect(otherOrder.status).toBe(403);
      expect(otherOrder.body.code).toBe('authorization_invalid');
      const otherActor = await admin().post(`/api/orders/${a.orderId}/items/void`, voidOf(a));
      expect(otherActor.status).toBe(403);
      expect(otherActor.body.code).toBe('authorization_invalid');
      expect(await db('SELECT quantity FROM order_items WHERE id = ANY($1) ORDER BY id', [[a.items[0], b.items[0]]])).toEqual([{ quantity: 2 }, { quantity: 2 }]);
      expect((await waiter().post(`/api/orders/${a.orderId}/items/void`, voidOf(a))).status).toBe(200);
    });

    it('POST /auth/authorize needs the target of the action (A1)', async () => {
      const { orderId } = await newOrder([{ name: 'Arepa', price: 5000, quantity: 1 }]);
      const base = { pin: PINS[cashier.profileId], profileId: cashier.profileId };
      expect((await waiter().post('/api/auth/authorize', { ...base, action: 'void_item' })).status).toBe(422);
      expect((await waiter().post('/api/auth/authorize', { ...base, action: 'void_item', targetType: 'payment', targetId: orderId })).status).toBe(422);
      expect((await waiter().post('/api/auth/authorize', { ...base, action: 'void_payment', targetType: 'order', targetId: orderId })).status).toBe(422);
      const res = await waiter().post('/api/auth/authorize', { ...base, action: 'void_item', targetType: 'order', targetId: orderId });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ action: 'void_item', targetType: 'order', targetId: orderId });
    });

    it('on a shared terminal the identified waiter cancels with another supervisor; the requester is the waiter (A2)', async () => {
      expect((await admin().put('/api/config', { waiterAccessMode: 'shared_terminal' })).status).toBe(200);
      try {
        const opened = await server().post('/api/auth/terminal/login').send({ email: cashier.email, password: PASSWORD });
        expect(opened.status).toBe(200);
        const terminal = cookiePair(setCookies(opened).vipe_access);
        const identified = await onTerminal(terminal).post('/api/auth/identify', { profileId: fixtures.waiterA.profileId, pin: PINS[fixtures.waiterA.profileId] });
        expect(identified.status).toBe(200);
        const acting = identified.body.token as string;
        const { orderId } = await newOrder([{ name: 'Arepa', price: 5000, quantity: 1 }]);

        const noClaim = await onTerminal(terminal).post(`/api/orders/${orderId}/cancel`, { reason: 'customer_left' });
        expect(noClaim.status).toBe(403);
        expect(noClaim.body.code).toBe('acting_required');

        const auth = await onTerminal(terminal, acting).post('/api/auth/authorize', {
          pin: PINS[ids.cashier2],
          action: 'cancel_order',
          profileId: ids.cashier2,
          targetType: 'order',
          targetId: orderId,
        });
        expect(auth.status).toBe(201);
        expect(await db('SELECT requested_by_profile_id FROM supervisor_authorizations WHERE id = $1', [auth.body.authorizationId])).toEqual([
          { requested_by_profile_id: fixtures.waiterA.profileId },
        ]);
        const res = await onTerminal(terminal, acting).post(`/api/orders/${orderId}/cancel`, { reason: 'customer_left', authorizationId: auth.body.authorizationId });
        expect(res.status).toBe(200);
        expect(res.body.cancellation).toMatchObject({ cancelledBy: { id: fixtures.waiterA.profileId }, authorizedBy: { id: ids.cashier2 }, selfAuthorized: false });
      } finally {
        expect((await admin().put('/api/config', { waiterAccessMode: 'own_accounts' })).status).toBe(200);
      }
    });
  });
});
