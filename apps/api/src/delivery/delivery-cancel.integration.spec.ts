import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/**
 * F3b (odd/tasks/fase3-operacion.md): a delivery is cancelled only through the
 * audited cancel_order of F1. A reason is always required; a supervisor PIN
 * only when the delivery is paid, and that payment is voided with it. Admin
 * Canceladas (GET /orders/cancelled) and Anulaciones (GET /audit) list it.
 */
const A = fixtures.restaurantA;
const ids = {
  operatorUser: '10000000-0000-0000-0000-0000000000c1',
  operator: '20000000-0000-0000-0000-0000000000c1',
  register: '30000000-0000-0000-0000-0000000000c1',
  dish: '30000000-0000-0000-0000-0000000000c2',
  customer: '30000000-0000-0000-0000-0000000000c3',
  address: '30000000-0000-0000-0000-0000000000c4',
};
const operator = { email: 'operator@a.test', profileId: ids.operator, name: 'Operadora A' };
const cashier = { email: fixtures.bcryptUser.email, profileId: fixtures.bcryptUser.profileId, name: 'Legacy A' };
const PINS: Record<string, string> = { [fixtures.adminA.profileId]: '9157', [cashier.profileId]: '582046' };
const LEGACY_LABEL = 'Sin motivo registrado (antes de la auditoría)';

describe('audited delivery cancellation (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let today: string;
  let cashMethod: string;
  const cookies: Record<string, string> = {};

  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    superuserQuery<T>(database.superuserUrl, text, values);
  const as = (email: string) => ({
    get: (url: string) => request(app.getHttpServer()).get(url).set('Cookie', cookies[email]),
    post: (url: string, body?: object) => request(app.getHttpServer()).post(url).set('Cookie', cookies[email]).send(body),
    put: (url: string, body?: object) => request(app.getHttpServer()).put(url).set('Cookie', cookies[email]).send(body),
  });
  const admin = () => as(fixtures.adminA.email);
  const op = () => as(operator.email);
  const cancel = (orderId: string, body: object, caller = op()) => caller.post(`/api/delivery/orders/${orderId}/cancel`, body);
  /** A delivery of one arepa (5000) with a 2000 fee, created by the operator. */
  const newDelivery = async () => {
    const res = await op().post('/api/delivery/orders', {
      customer: { id: ids.customer },
      address: { id: ids.address },
      items: [{ dishId: ids.dish, quantity: 1 }],
      deliveryFee: 2000,
      paymentMode: 'prepaid',
    });
    expect(res.status).toBe(201);
    return res.body.orderId as string;
  };
  const pay = async (orderId: string): Promise<void> => {
    const res = await as(cashier.email).post('/api/payments', {
      orderId,
      cashRegisterId: ids.register,
      tipAmount: 0,
      tenders: [{ paymentMethodId: cashMethod, amount: 7000, cashReceived: 7000 }],
      idempotencyKey: crypto.randomUUID(),
    });
    expect(res.status).toBe(200);
  };
  const authorize = async (supervisor: string, orderId: string, caller = operator.email) => {
    const res = await as(caller).post('/api/auth/authorize', { pin: PINS[supervisor], action: 'cancel_order', profileId: supervisor, targetType: 'order', targetId: orderId });
    expect(res.status).toBe(201);
    return res.body.authorizationId as string;
  };
  const state = async (orderId: string) =>
    (await db<{ s: string }>(
      `SELECT o.status || '/' || od.delivery_status || '/' || (SELECT count(*) FROM payments p WHERE p.order_id = o.id AND p.voided_at IS NULL)
              || '/' || (SELECT count(*) FROM audit_log a WHERE a.order_id = o.id) AS s
         FROM orders o JOIN order_deliveries od ON od.order_id = o.id WHERE o.id = $1`, [orderId]))[0].s;
  const cancelledRow = async (orderId: string) =>
    ((await admin().get(`/api/orders/cancelled?date=${today}`)).body as { id: string }[]).find((row) => row.id === orderId);
  const auditRows = async (orderId: string) =>
    ((await admin().get('/api/audit')).body as { orderId: string }[]).filter((row) => row.orderId === orderId);

  beforeAll(async () => {
    database = await startTestDatabase();
    await db(`INSERT INTO users (id, email, password_hash, password_algo) SELECT $1, $2, password_hash, password_algo FROM users WHERE email = $3`, [
      ids.operatorUser, operator.email, fixtures.adminA.email,
    ]);
    await db(`INSERT INTO profiles (id, user_id, full_name, email, role, restaurant_id) VALUES ($1, $2, $3, $4, 'delivery_operator', $5)`, [
      ids.operator, ids.operatorUser, operator.name, operator.email, A,
    ]);
    await db(`INSERT INTO dishes (id, name, price, active, restaurant_id) VALUES ($1, 'Arepa', 5000, true, $2)`, [ids.dish, A]);
    await db(`INSERT INTO customers (id, phone, name, restaurant_id) VALUES ($1, '3101234567', 'Ana', $2)`, [ids.customer, A]);
    await db(`INSERT INTO customer_addresses (id, customer_id, address_line, is_default, restaurant_id) VALUES ($1, $2, 'Calle 1', true, $3)`, [
      ids.address, ids.customer, A,
    ]);
    await db(`INSERT INTO cash_registers (id, restaurant_id, opening_timestamp, initial_cash, status) VALUES ($1, $2, now(), 50000, 'open')`, [ids.register, A]);
    [{ id: cashMethod }] = await db<{ id: string }>(`SELECT id FROM payment_methods WHERE restaurant_id = $1 AND code = 'cash'`, [A]);
    [{ today }] = await db<{ today: string }>(`SELECT to_char((now() AT TIME ZONE timezone)::date, 'YYYY-MM-DD') AS today FROM restaurants WHERE id = $1`, [A]);
    app = await createTestApp(database.apiUrl);
    for (const email of [fixtures.adminA.email, fixtures.waiterA.email, cashier.email, operator.email, fixtures.adminB.email]) {
      const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD });
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

  it('the old status action no longer cancels a delivery behind the audit', async () => {
    const orderId = await newDelivery();
    const res = await op().post(`/api/delivery/orders/${orderId}/status`, { action: 'cancel' });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'P0001', message: 'set_delivery_status: cancel goes through cancel_order (a reason is required)' });
    expect(await state(orderId)).toBe('kitchen/received/0/0');
  });

  it('an unpaid delivery is cancelled with a reason only, and shows in Canceladas and Anulaciones', async () => {
    const orderId = await newDelivery();
    const res = await cancel(orderId, { reason: 'other', reasonText: ' El cliente  no contesta ' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ orderId, status: 'cancelled' });
    expect(await state(orderId)).toBe('cancelled/cancelled/0/1');
    expect(await cancelledRow(orderId)).toMatchObject({
      orderType: 'delivery',
      status: 'cancelled',
      delivery: { customerName: 'Ana', deliveryFee: 2000 },
      cancellation: {
        reason: 'other',
        reasonLabel: 'Otro',
        reasonText: 'El cliente no contesta',
        cancelledBy: { id: operator.profileId, name: operator.name },
        authorizedBy: null,
        legacy: false,
        total: 7000,
      },
    });
    expect(await auditRows(orderId)).toEqual([
      expect.objectContaining({ eventType: 'order_cancelled', orderType: 'delivery', actor: { id: operator.profileId, name: operator.name }, authorizedBy: null, amount: 7000, reasonText: 'El cliente no contesta' }),
    ]);
  });

  it('refuses a missing reason or a short text with 422 and a stable code, changing nothing', async () => {
    const orderId = await newDelivery();
    for (const [body, code, message] of [
      [{}, 'reason_invalid', 'Elige un motivo de la lista'],
      [{ reason: 'bored' }, 'reason_invalid', 'Elige un motivo de la lista'],
      [{ reason: 'other' }, 'reason_text_required', 'Escribe el motivo (entre 3 y 200 caracteres)'],
      [{ reason: 'other', reasonText: 'no' }, 'reason_text_required', 'Escribe el motivo (entre 3 y 200 caracteres)'],
    ] as const) {
      const res = await cancel(orderId, body);
      expect(res.status).toBe(422);
      expect(res.body).toEqual({ statusCode: 422, error: 'Unprocessable Entity', message, code });
    }
    expect(await state(orderId)).toBe('kitchen/received/0/0');
  });

  it('a paid delivery needs a supervisor (403 authorization_required); with another supervisor it is cancelled and the payment voided', async () => {
    const orderId = await newDelivery();
    await pay(orderId);
    const refused = await cancel(orderId, { reason: 'customer_left' });
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Esta acción necesita la autorización de un supervisor',
      code: 'authorization_required',
    });
    expect(await state(orderId)).toBe('paid/received/1/0');

    const authorizationId = await authorize(cashier.profileId, orderId);
    const res = await cancel(orderId, { reason: 'customer_left', authorizationId });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ orderId, status: 'cancelled' });
    expect(await state(orderId)).toBe('cancelled/cancelled/0/2');
    expect((await cancelledRow(orderId)) as unknown).toMatchObject({
      cancellation: { reason: 'customer_left', previousStatus: 'paid', authorizedBy: { id: cashier.profileId, name: cashier.name }, total: 7000 },
    });
    const events = await auditRows(orderId);
    expect(events.map((event) => (event as unknown as { eventType: string }).eventType).sort()).toEqual(['order_cancelled', 'payment_voided']);
    const summary = await admin().get(`/api/registers/summary?ids=${ids.register}`);
    expect(summary.body).toMatchObject({ paymentsCount: 0, totalSales: 0 });
    // The authorization was spent; without one the order is already cancelled.
    expect((await cancel(orderId, { reason: 'customer_left', authorizationId })).body.code).toBe('authorization_invalid');
    expect((await cancel(orderId, { reason: 'customer_left' })).body.code).toBe('order_cancelled');
  });

  it('the requester may not authorize themself unless the restaurant allows it', async () => {
    const orderId = await newDelivery();
    await pay(orderId);
    const authorizationId = await authorize(fixtures.adminA.profileId, orderId, fixtures.adminA.email);
    const res = await cancel(orderId, { reason: 'customer_left', authorizationId }, admin());
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('self_authorization_not_allowed');
    expect(await state(orderId)).toBe('paid/received/1/0');
  });

  it('a paid delivery of a closed drawer answers 409 register_closed and nothing changes', async () => {
    const orderId = await newDelivery();
    await pay(orderId);
    await db(`UPDATE cash_registers SET status = 'closed', closing_timestamp = now() WHERE id = $1`, [ids.register]);
    try {
      const res = await cancel(orderId, { reason: 'customer_left', authorizationId: await authorize(cashier.profileId, orderId) });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'register_closed', message: 'La caja de este pago ya está cerrada; no se puede anular' });
      expect(await state(orderId)).toBe('paid/received/1/0');
    } finally {
      await db(`UPDATE cash_registers SET status = 'open', closing_timestamp = NULL WHERE id = $1`, [ids.register]);
    }
  });

  it('a delivery cancelled before the audit is listed in Canceladas with "Sin motivo registrado…" and no actor, and not in Anulaciones', async () => {
    const orderId = await newDelivery();
    await db(`SET session_replication_role = replica;
              UPDATE order_deliveries SET delivery_status = 'cancelled', cancelled_at = now() WHERE order_id = '${orderId}';
              UPDATE orders SET status = 'cancelled' WHERE id = '${orderId}'`);
    expect(await cancelledRow(orderId)).toMatchObject({
      delivery: { customerName: 'Ana', deliveryFee: 2000 },
      cancellation: { reason: null, reasonLabel: LEGACY_LABEL, reasonText: null, cancelledBy: null, authorizedBy: null, previousStatus: null, legacy: true, total: 7000 },
    });
    expect(await auditRows(orderId)).toEqual([]);
    expect((await cancel(orderId, { reason: 'customer_left' })).body.code).toBe('order_cancelled');
  });

  it('roles and tenancy: waiter and cashier may not, another restaurant gets 404, POST /orders/:id/cancel keeps cashiers out', async () => {
    const orderId = await newDelivery();
    expect((await cancel(orderId, { reason: 'customer_left' }, as(fixtures.waiterA.email))).status).toBe(403);
    expect((await cancel(orderId, { reason: 'customer_left' }, as(cashier.email))).status).toBe(403);
    const foreign = await cancel(orderId, { reason: 'customer_left' }, as(fixtures.adminB.email));
    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe('order_not_found');
    const viaOrders = await as(cashier.email).post(`/api/orders/${orderId}/cancel`, { reason: 'customer_left' });
    expect(viaOrders.status).toBe(409);
    expect(viaOrders.body.code).toBe('delivery_order');
    expect(await state(orderId)).toBe('kitchen/received/0/0');
  });
});
