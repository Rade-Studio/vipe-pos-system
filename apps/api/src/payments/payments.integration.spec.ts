import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/** Rows seeded as the superuser for this spec only. */
const p = {
  cashierUser: '10000000-0000-0000-0000-0000000000e1',
  cashierProfile: '20000000-0000-0000-0000-0000000000e1',
  cashierEmail: 'cashier@a.test',
  registerA: '99000000-0000-0000-0000-0000000000a1',
  registerB: '99000000-0000-0000-0000-0000000000b1',
  /** Paid in cash, then replayed and refused with another key. */
  o1: '99000000-0000-0000-0000-000000000001',
  /** Paid with change above the drawer: drawer warning. */
  o2: '99000000-0000-0000-0000-000000000002',
  /** Split and undone. */
  o3: '99000000-0000-0000-0000-000000000003',
  o3Arepa: '99000000-0000-0000-0000-000000000031',
  o3Jugo: '99000000-0000-0000-0000-000000000032',
  /** Paid with Nequi + cash: snake_case tender mapping. */
  o5: '99000000-0000-0000-0000-000000000005',
  /** Paid before pay_order existed: only a legacy payment_transactions row. */
  legacyOrder: '99000000-0000-0000-0000-000000000006',
  legacyTx: '99000000-0000-0000-0000-000000000061',
  /** Paid three days ago: outside today's completed list. */
  oldOrder: '99000000-0000-0000-0000-000000000007',
  deliveryUser: '10000000-0000-0000-0000-0000000000e2',
  deliveryProfile: '20000000-0000-0000-0000-0000000000e2',
  deliveryEmail: 'delivery@a.test',
  /** Paid by the delivery operator. */
  o8: '99000000-0000-0000-0000-000000000008',
  key8: '99000000-0000-4000-8000-0000000000c8',
  /** Paid, created 2026-03-10 23:30 in Bogota (04:30 UTC on the 11th). */
  lateOrder: '99000000-0000-0000-0000-000000000009',
  /** Restaurant B, paid today. */
  orderB: '99000000-0000-0000-0000-0000000000b2',
  key1: '99000000-0000-4000-8000-0000000000c1',
  key2: '99000000-0000-4000-8000-0000000000c2',
  key5: '99000000-0000-4000-8000-0000000000c5',
  otherKey: '99000000-0000-4000-8000-0000000000ff',
} as const;

const METHOD_KEYS = ['code', 'id', 'isActive', 'kind', 'name', 'sortOrder'];
const PAY_KEYS = [
  'alreadyPaid', 'amountDue', 'changeGiven', 'drawerCashBefore', 'drawerWarning', 'paymentId', 'status', 'tenders',
  'tipAmount', 'totalCharged',
];
const PAYMENT_KEYS = [
  'amountDue', 'cashRegisterId', 'cashierProfileId', 'changeGiven', 'createdAt', 'id', 'idempotencyKey', 'orderId',
  'tenders', 'tipAmount', 'totalCharged',
];
const TENDER_KEYS = ['amount', 'cashReceived', 'id', 'lineNo', 'methodCode', 'methodKind', 'paymentId', 'paymentMethodId', 'reference'];
const LEGACY_KEYS = [
  'amount', 'cashChange', 'cashReceived', 'cashRegisterId', 'id', 'method', 'orderId', 'tableId', 'timestamp',
  'tipAmount', 'totalDiscounts', 'waiterId',
];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('payments endpoints (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};
  const methods: Record<string, string> = {};
  let today = '';

  beforeAll(async () => {
    database = await startTestDatabase();
    await seedPayments(database.superuserUrl);
    app = await createTestApp(database.apiUrl);
    for (const email of [fixtures.adminA.email, fixtures.waiterA.email, fixtures.adminB.email, p.cashierEmail, p.deliveryEmail]) {
      const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD });
      cookies[email] = cookiePair(setCookies(res).vipe_access);
    }
    const rows = await db<{ id: string; code: string }>('SELECT id, code FROM payment_methods WHERE restaurant_id = $1', [
      fixtures.restaurantA,
    ]);
    for (const row of rows) {
      methods[row.code] = row.id;
    }
    today = (await db<{ d: string }>(`SELECT (now() AT TIME ZONE 'America/Bogota')::date::text AS d`))[0].d;
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
      put: (url: string, body?: object) => server.put(url).set('Cookie', cookie).send(body),
    };
  };
  const adminA = () => as(fixtures.adminA.email);
  const waiterA = () => as(fixtures.waiterA.email);
  const adminB = () => as(fixtures.adminB.email);
  const cashierA = () => as(p.cashierEmail);
  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    superuserQuery<T>(database.superuserUrl, text, values);
  const cashTender = (amount: number, cashReceived: number) => ({ paymentMethodId: methods.cash, amount, cashReceived });
  const pay = (orderId: string, idempotencyKey: string, tenders: object[], tipAmount = 0) =>
    cashierA().post('/api/payments', { orderId, cashRegisterId: p.registerA, tipAmount, tenders, idempotencyKey });

  describe('payment methods', () => {
    it('lists every method of the tenant, inactive included, by sortOrder', async () => {
      const res = await waiterA().get('/api/payments/methods');
      expect(res.status).toBe(200);
      expect(Object.keys(res.body[0]).sort()).toEqual(METHOD_KEYS);
      expect(res.body.map((m: { code: string; sortOrder: number; kind: string }) => [m.code, m.sortOrder, m.kind])).toEqual([
        ['cash', 10, 'cash'],
        ['transfer', 20, 'electronic'],
        ['nequi', 30, 'electronic'],
        ['bancolombia', 40, 'electronic'],
        ['retired', 50, 'electronic'],
      ]);
      expect(res.body.find((m: { code: string }) => m.code === 'retired').isActive).toBe(false);
    });

    it('isolates tenants: restaurant B lists only its own methods', async () => {
      const res = await adminB().get('/api/payments/methods');
      expect(res.status).toBe(200);
      expect(res.body.map((m: { code: string }) => m.code)).toEqual(['cash', 'transfer', 'nequi', 'bancolombia']);
      expect(res.body.map((m: { id: string }) => m.id)).not.toContain(methods.cash);
    });

    it('derives a unique code slug and appends at max(sortOrder) + 1 on the server', async () => {
      const first = await adminA().post('/api/payments/methods', { name: '  Tarjeta Débito ', kind: 'electronic' });
      expect(first.status).toBe(201);
      expect(Object.keys(first.body).sort()).toEqual(METHOD_KEYS);
      expect(first.body).toMatchObject({ code: 'tarjeta_debito', name: 'Tarjeta Débito', kind: 'electronic', isActive: true, sortOrder: 51 });
      const second = await adminA().post('/api/payments/methods', { name: 'Tarjeta débito', kind: 'cash' });
      expect(second.status).toBe(201);
      expect(second.body).toMatchObject({ code: 'tarjeta_debito_2', kind: 'cash', sortOrder: 52 });
      const stored = await db('SELECT restaurant_id FROM payment_methods WHERE id = $1', [second.body.id]);
      expect(stored).toEqual([{ restaurant_id: fixtures.restaurantA }]);
    });

    it('rejects an empty name, an unknown kind and unknown fields with 422', async () => {
      const before = await db('SELECT count(*)::int AS n FROM payment_methods');
      for (const body of [{ name: '   ', kind: 'cash' }, { name: 'Bono', kind: 'voucher' }, { name: 'Bono', kind: 'cash', code: 'bono' }]) {
        const res = await adminA().post('/api/payments/methods', body);
        expect(res.status).toBe(422);
      }
      expect(await db('SELECT count(*)::int AS n FROM payment_methods')).toEqual(before);
    });

    it('updates name and isActive, never the code', async () => {
      const res = await adminA().patch(`/api/payments/methods/${methods.bancolombia}`, { name: 'Bancolombia QR', isActive: false });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: methods.bancolombia, code: 'bancolombia', name: 'Bancolombia QR', isActive: false });
      expect((await adminA().patch(`/api/payments/methods/${methods.bancolombia}`, { code: 'x' })).status).toBe(422);
      expect((await adminA().patch(`/api/payments/methods/${methods.bancolombia}`, {})).status).toBe(422);
      await adminA().patch(`/api/payments/methods/${methods.bancolombia}`, { name: 'Bancolombia', isActive: true });
    });

    it("answers 404 for another restaurant's method", async () => {
      const res = await adminB().patch(`/api/payments/methods/${methods.cash}`, { name: 'Hijacked' });
      expect(res.status).toBe(404);
      expect((await db('SELECT name FROM payment_methods WHERE id = $1', [methods.cash]))[0]).toEqual({ name: 'Efectivo' });
    });

    it('reorders every method atomically', async () => {
      const list = (await adminA().get('/api/payments/methods')).body as { id: string }[];
      const reversed = list.map((m) => m.id).reverse();
      const res = await adminA().put('/api/payments/methods/order', { ids: reversed });
      expect(res.status).toBe(200);
      expect(res.body.map((m: { id: string; sortOrder: number }) => [m.id, m.sortOrder])).toEqual(reversed.map((id, index) => [id, index]));
    });

    it('rolls the whole reorder back when one id is unknown or foreign', async () => {
      const before = (await adminA().get('/api/payments/methods')).body as { id: string; sortOrder: number }[];
      const foreign = (await adminB().get('/api/payments/methods')).body[0].id as string;
      const ids = before.map((m) => m.id).reverse();
      ids[ids.length - 1] = foreign;
      const res = await adminA().put('/api/payments/methods/order', { ids });
      expect(res.status).toBe(422);
      expect(res.body.message).toBe('ids must list every payment method of the restaurant once');
      const after = (await adminA().get('/api/payments/methods')).body as { id: string; sortOrder: number }[];
      expect(after.map((m) => [m.id, m.sortOrder])).toEqual(before.map((m) => [m.id, m.sortOrder]));
      const duplicated = before.map((m) => m.id);
      duplicated[1] = duplicated[0];
      expect((await adminA().put('/api/payments/methods/order', { ids: duplicated })).status).toBe(422);
    });

    it('refuses method writes to the waiter and the cashier (RLS lets only admin write the catalog)', async () => {
      for (const caller of [waiterA(), cashierA()]) {
        expect((await caller.post('/api/payments/methods', { name: 'Bono', kind: 'cash' })).status).toBe(403);
      }
      expect((await waiterA().patch(`/api/payments/methods/${methods.cash}`, { name: 'X' })).status).toBe(403);
      expect((await cashierA().put('/api/payments/methods/order', { ids: [methods.cash] })).status).toBe(403);
    });
  });

  describe('POST /payments (pay_order)', () => {
    it('pays the order and returns the RPC result in camelCase', async () => {
      const res = await pay(p.o1, p.key1, [cashTender(10000, 10000)]);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(PAY_KEYS);
      expect(res.body).toEqual({
        paymentId: expect.any(String),
        status: 'paid',
        alreadyPaid: false,
        amountDue: 10000,
        tipAmount: 0,
        totalCharged: 10000,
        changeGiven: 0,
        drawerWarning: false,
        drawerCashBefore: 0,
        tenders: [{ lineNo: 1, methodCode: 'cash', amount: 10000, cashReceived: 10000 }],
      });
      expect(await db('SELECT status FROM orders WHERE id = $1', [p.o1])).toEqual([{ status: 'paid' }]);
    });

    it('replays with the same idempotency key as already_paid', async () => {
      const res = await pay(p.o1, p.key1, [cashTender(10000, 10000)]);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'already_paid',
        alreadyPaid: true,
        amountDue: 10000,
        totalCharged: 10000,
        drawerWarning: false,
        drawerCashBefore: 0,
        tenders: [{ lineNo: 1, methodCode: 'cash', amount: 10000, cashReceived: 10000 }],
      });
      expect(await db('SELECT count(*)::int AS n FROM payments WHERE order_id = $1', [p.o1])).toEqual([{ n: 1 }]);
    });

    it('refuses another key on a paid order with 422, the verbatim message and code P0001', async () => {
      const res = await pay(p.o1, p.otherKey, [cashTender(10000, 10000)]);
      expect(res.status).toBe(422);
      expect(res.body).toEqual({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: `pay_order: order ${p.o1} is already paid`,
        code: 'P0001',
      });
      expect(await db('SELECT count(*)::int AS n FROM payments WHERE order_id = $1', [p.o1])).toEqual([{ n: 1 }]);
    });

    it('passes the drawer warning through when the change exceeds the drawer', async () => {
      const res = await pay(p.o2, p.key2, [cashTender(5000, 50000)]);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'paid', changeGiven: 45000, drawerWarning: true, drawerCashBefore: 10000 });
    });

    it('maps camelCase tenders to the snake_case RPC argument, cash_received null for electronic', async () => {
      const res = await pay(p.o5, p.key5, [
        { paymentMethodId: methods.nequi, amount: 3000, cashReceived: null },
        { paymentMethodId: methods.cash, amount: 5500, cashReceived: 6000 },
      ], 500);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        amountDue: 8000,
        tipAmount: 500,
        totalCharged: 8500,
        changeGiven: 500,
        tenders: [
          { lineNo: 1, methodCode: 'nequi', amount: 3000, cashReceived: null },
          { lineNo: 2, methodCode: 'cash', amount: 5500, cashReceived: 6000 },
        ],
      });
      const stored = await db(
        `SELECT t.line_no, t.payment_method_id, t.amount::int, t.cash_received::int, p.idempotency_key, p.cashier_profile_id
           FROM payment_tenders t JOIN payments p ON p.id = t.payment_id WHERE p.order_id = $1 ORDER BY t.line_no`,
        [p.o5],
      );
      expect(stored).toEqual([
        { line_no: 1, payment_method_id: methods.nequi, amount: 3000, cash_received: null, idempotency_key: p.key5, cashier_profile_id: p.cashierProfile },
        { line_no: 2, payment_method_id: methods.cash, amount: 5500, cash_received: 6000, idempotency_key: p.key5, cashier_profile_id: p.cashierProfile },
      ]);
    });

    it('keeps rejected and not-found RPC errors with their code', async () => {
      const short = await cashierA().post('/api/payments', {
        orderId: p.o3, cashRegisterId: p.registerA, tipAmount: 0, tenders: [cashTender(1, 1)], idempotencyKey: p.otherKey,
      });
      expect(short.status).toBe(422);
      expect(short.body).toMatchObject({ code: 'P0001', message: 'pay_order: tenders sum to 1 but amount_due + tip = 13000' });
      const foreign = await cashierA().post('/api/payments', {
        orderId: p.orderB, cashRegisterId: p.registerA, tipAmount: 0, tenders: [cashTender(1, 1)], idempotencyKey: p.otherKey,
      });
      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual({ statusCode: 404, error: 'Not Found', message: 'Not found', code: 'P0002' });
    });

    it('lets the delivery operator pay', async () => {
      const res = await as(p.deliveryEmail).post('/api/payments', {
        orderId: p.o8, cashRegisterId: p.registerA, tipAmount: 0, tenders: [cashTender(2000, 2000)], idempotencyKey: p.key8,
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'paid', amountDue: 2000, alreadyPaid: false });
      expect(await db('SELECT cashier_profile_id FROM payments WHERE order_id = $1', [p.o8])).toEqual([{ cashier_profile_id: p.deliveryProfile }]);
    });

    it('validates the body with 422 and refuses the waiter with 403', async () => {
      const base = { orderId: p.o3, cashRegisterId: p.registerA, tipAmount: 0, tenders: [cashTender(1, 1)], idempotencyKey: p.otherKey };
      for (const body of [{ ...base, tipAmount: -1 }, { ...base, tenders: [] }, { ...base, idempotencyKey: 'nope' }, { ...base, extra: 1 }]) {
        expect((await cashierA().post('/api/payments', body)).status).toBe(422);
      }
      expect((await waiterA().post('/api/payments', base)).status).toBe(403);
    });
  });

  describe('GET /payments', () => {
    it('lists payments of registers with tenders embedded, newest first', async () => {
      const res = await waiterA().get(`/api/payments?cashRegisterIds=${p.registerA}`);
      expect(res.status).toBe(200);
      expect(res.body.map((x: { orderId: string }) => x.orderId)).toEqual([p.o8, p.o5, p.o2, p.o1]);
      expect(Object.keys(res.body[1]).sort()).toEqual(PAYMENT_KEYS);
      expect(Object.keys(res.body[1].tenders[0]).sort()).toEqual(TENDER_KEYS);
      expect(res.body[1]).toMatchObject({
        cashRegisterId: p.registerA,
        cashierProfileId: p.cashierProfile,
        idempotencyKey: p.key5,
        createdAt: expect.stringMatching(ISO),
        tenders: [
          { lineNo: 1, methodCode: 'nequi', methodKind: 'electronic', amount: 3000, cashReceived: null },
          { lineNo: 2, methodCode: 'cash', methodKind: 'cash', amount: 5500, cashReceived: 6000 },
        ],
      });
    });

    it('lists payments of orders and answers [] for an empty list', async () => {
      const res = await waiterA().get(`/api/payments?orderIds=${p.o1},${p.o2}`);
      expect(res.status).toBe(200);
      expect(res.body.map((x: { orderId: string }) => x.orderId).sort()).toEqual([p.o1, p.o2].sort());
      expect((await waiterA().get('/api/payments?orderIds=')).body).toEqual([]);
      expect((await waiterA().get('/api/payments?cashRegisterIds=')).body).toEqual([]);
    });

    it('requires exactly one filter', async () => {
      expect((await waiterA().get('/api/payments')).status).toBe(422);
      expect((await waiterA().get(`/api/payments?orderIds=${p.o1}&cashRegisterIds=${p.registerA}`)).status).toBe(422);
      expect((await waiterA().get('/api/payments?orderIds=nope')).status).toBe(422);
    });

    it("never returns another restaurant's payments", async () => {
      expect((await adminB().get(`/api/payments?cashRegisterIds=${p.registerA}`)).body).toEqual([]);
      expect((await adminB().get(`/api/payments?orderIds=${p.o1}`)).body).toEqual([]);
    });
  });

  describe('split and undo split', () => {
    it('splits items into a child order and returns both bills', async () => {
      const res = await cashierA().post(`/api/orders/${p.o3}/split`, { items: [{ orderItemId: p.o3Jugo, quantity: 1 }] });
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['child', 'childOrderId', 'parent']);
      expect(res.body.parent).toEqual({ orderId: p.o3, subtotal: 10000, tax: 0, tip: expect.any(Number), total: expect.any(Number) });
      expect(res.body.child).toEqual({ orderId: res.body.childOrderId, subtotal: 3000, tax: 0, tip: expect.any(Number), total: expect.any(Number) });
      const child = await db('SELECT parent_order_id, is_partial_order FROM orders WHERE id = $1', [res.body.childOrderId]);
      expect(child).toEqual([{ parent_order_id: p.o3, is_partial_order: true }]);

      const undo = await cashierA().post(`/api/orders/${res.body.childOrderId}/undo-split`);
      expect(undo.status).toBe(200);
      expect(undo.body).toEqual({ parent: { orderId: p.o3, subtotal: 13000, tax: 0, tip: expect.any(Number), total: expect.any(Number) } });
      expect(await db('SELECT id FROM orders WHERE id = $1', [res.body.childOrderId])).toEqual([]);
    });

    it('surfaces a split_order error as 422 with the verbatim message and its code', async () => {
      const missing = '99000000-0000-0000-0000-0000000000ee';
      const res = await cashierA().post(`/api/orders/${p.o3}/split`, { items: [{ orderItemId: missing, quantity: 1 }] });
      expect(res.status).toBe(422);
      expect(res.body).toEqual({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'split_order: item[1] does not belong to the order',
        code: 'P0001',
      });
    });

    it('validates the items and refuses the waiter', async () => {
      expect((await cashierA().post(`/api/orders/${p.o3}/split`, { items: [] })).status).toBe(422);
      expect((await cashierA().post(`/api/orders/${p.o3}/split`, { items: [{ orderItemId: p.o3Jugo, quantity: 0 }] })).status).toBe(422);
      expect((await waiterA().post(`/api/orders/${p.o3}/split`, { items: [{ orderItemId: p.o3Jugo, quantity: 1 }] })).status).toBe(403);
      expect((await waiterA().post(`/api/orders/${p.o3}/undo-split`)).status).toBe(403);
    });
  });

  describe('GET /orders/completed', () => {
    it('returns the paid orders of the day with payments, tenders and legacy transactions in one response', async () => {
      const res = await waiterA().get(`/api/orders/completed?date=${today}`);
      expect(res.status).toBe(200);
      const ids = res.body.map((o: { id: string }) => o.id);
      expect(ids.sort()).toEqual([p.o1, p.o2, p.o5, p.o8, p.legacyOrder].sort());
      const paid = res.body.find((o: { id: string }) => o.id === p.o5);
      expect(paid).toMatchObject({ status: 'paid', total: 8500, legacyTransactions: [] });
      expect(paid.items.length).toBeGreaterThan(0);
      expect(Object.keys(paid.payment).sort()).toEqual(PAYMENT_KEYS);
      expect(paid.payment.tenders.map((t: { methodCode: string }) => t.methodCode)).toEqual(['nequi', 'cash']);
      const legacy = res.body.find((o: { id: string }) => o.id === p.legacyOrder);
      expect(legacy.payment).toBeNull();
      expect(legacy.legacyTransactions).toHaveLength(1);
      expect(Object.keys(legacy.legacyTransactions[0]).sort()).toEqual(LEGACY_KEYS);
      expect(legacy.legacyTransactions[0]).toMatchObject({
        id: p.legacyTx,
        orderId: p.legacyOrder,
        method: 'nequi',
        amount: 7000,
        tipAmount: 0,
        cashRegisterId: p.registerA,
        timestamp: expect.stringMatching(ISO),
      });
    });

    it("cuts the day at the restaurant's midnight", async () => {
      const day10 = await waiterA().get('/api/orders/completed?date=2026-03-10');
      expect(day10.body.map((o: { id: string }) => o.id)).toEqual([p.lateOrder]);
      const day11 = await waiterA().get('/api/orders/completed?date=2026-03-11');
      expect(day11.body.map((o: { id: string }) => o.id)).toEqual([]);
    });

    it("isolates tenants and validates the date", async () => {
      const res = await adminB().get(`/api/orders/completed?date=${today}`);
      expect(res.body.map((o: { id: string }) => o.id)).toEqual([p.orderB]);
      expect((await waiterA().get('/api/orders/completed?date=2026-13-01')).status).toBe(422);
      expect((await waiterA().get('/api/orders/completed')).status).toBe(422);
    });
  });
});

async function seedPayments(superuserUrl: string) {
  const A = fixtures.restaurantA;
  const B = fixtures.restaurantB;
  const q = (text: string, values: unknown[] = []) => superuserQuery(superuserUrl, text, values);
  await q(
    `INSERT INTO users (id, email, password_hash, password_algo)
       SELECT $1, $2, password_hash, password_algo FROM users WHERE email = $3`,
    [p.cashierUser, p.cashierEmail, fixtures.adminA.email],
  );
  await q(
    `INSERT INTO profiles (id, user_id, full_name, email, role, restaurant_id) VALUES ($1, $2, 'Cashier A', $3, 'cashier', $4)`,
    [p.cashierProfile, p.cashierUser, p.cashierEmail, A],
  );
  await q(
    `INSERT INTO users (id, email, password_hash, password_algo)
       SELECT $1, $2, password_hash, password_algo FROM users WHERE email = $3`,
    [p.deliveryUser, p.deliveryEmail, fixtures.adminA.email],
  );
  await q(
    `INSERT INTO profiles (id, user_id, full_name, email, role, restaurant_id) VALUES ($1, $2, 'Delivery A', $3, 'delivery_operator', $4)`,
    [p.deliveryProfile, p.deliveryUser, p.deliveryEmail, A],
  );
  await q(
    `INSERT INTO orders (id, status, subtotal, tax, tax_percentage, total, restaurant_id, created_at) VALUES
       ($1, 'delivered', 2000, 0, 0, 2000, $3, now() - interval '1 second'),
       ($2, 'paid', 3000, 0, 0, 3000, $3, '2026-03-10 23:30:00-05')`,
    [p.o8, p.lateOrder, A],
  );
  await q(`INSERT INTO order_items (order_id, name, price, quantity, status, restaurant_id) VALUES ($1, 'Jugo', 2000, 1, 'served', $2)`, [p.o8, A]);
  await q(
    `INSERT INTO payment_methods (restaurant_id, code, name, kind, is_active, sort_order) VALUES ($1, 'retired', 'Retirado', 'electronic', false, 50)`,
    [A],
  );
  await q(
    `INSERT INTO cash_registers (id, opening_timestamp, initial_cash, status, restaurant_id) VALUES
       ($1, now(), 0, 'open', $3), ($2, now(), 0, 'open', $4)`,
    [p.registerA, p.registerB, A, B],
  );
  await q(
    `INSERT INTO orders (id, status, subtotal, tax, tax_percentage, total, restaurant_id, created_at) VALUES
       ($1, 'delivered', 10000, 0, 0, 10000, $8, now()),
       ($2, 'delivered', 5000, 0, 0, 5000, $8, now() + interval '1 second'),
       ($3, 'delivered', 13000, 0, 0, 13000, $8, now()),
       ($4, 'delivered', 8000, 0, 0, 8000, $8, now() + interval '2 seconds'),
       ($5, 'paid', 7000, 0, 0, 7000, $8, now()),
       ($6, 'paid', 9000, 0, 0, 9000, $8, now() - interval '3 days'),
       ($7, 'paid', 4000, 0, 0, 4000, $9, now())`,
    [p.o1, p.o2, p.o3, p.o5, p.legacyOrder, p.oldOrder, p.orderB, A, B],
  );
  await q(
    `INSERT INTO order_items (order_id, name, price, quantity, status, restaurant_id) VALUES
       ($1, 'Arepa', 10000, 1, 'served', $5), ($2, 'Jugo', 5000, 1, 'served', $5), ($3, 'Arepa', 4000, 2, 'served', $5),
       ($4, 'Legacy', 7000, 1, 'served', $5)`,
    [p.o1, p.o2, p.o5, p.legacyOrder, A],
  );
  await q(
    `INSERT INTO order_items (id, order_id, name, price, quantity, status, restaurant_id) VALUES
       ($1, $3, 'Arepa', 5000, 2, 'served', $4), ($2, $3, 'Jugo', 3000, 1, 'served', $4)`,
    [p.o3Arepa, p.o3Jugo, p.o3, A],
  );
  await q(
    `INSERT INTO payment_transactions (id, order_id, amount, method, timestamp, cash_register_id, tip_amount, restaurant_id)
       VALUES ($1, $2, 7000, 'nequi', now(), $3, 0, $4)`,
    [p.legacyTx, p.legacyOrder, p.registerA, A],
  );
}
