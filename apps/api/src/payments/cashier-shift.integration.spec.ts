import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/**
 * T18 (S2, S8): tender references, the register opener, the paid orders of a
 * register and the shift figures the cashier's sheet derives from register_summary.
 */
const s = {
  cashierUser: '10000000-0000-0000-0000-0000000000d1',
  cashierProfile: '20000000-0000-0000-0000-0000000000d1',
  cashierEmail: 'cashier@shift.test',
  zone: '98000000-0000-0000-0000-0000000000e1',
  table: '98000000-0000-0000-0000-0000000000e2',
  /** Table 7 (Terraza), waiter A: paid in cash with a 1.000 tip. */
  o1: '98000000-0000-0000-0000-000000000001',
  /** Counter order without table or waiter: paid by transfer with a reference. */
  o2: '98000000-0000-0000-0000-000000000002',
  /** Table 7: Nequi with a reference + cash. */
  o3: '98000000-0000-0000-0000-000000000003',
  /** Probe order for refused payloads (never paid). */
  o4: '98000000-0000-0000-0000-000000000004',
  registerB: '98000000-0000-0000-0000-0000000000b1',
  orderB: '98000000-0000-0000-0000-0000000000b2',
  key1: '98000000-0000-4000-8000-0000000000c1',
  key2: '98000000-0000-4000-8000-0000000000c2',
  key3: '98000000-0000-4000-8000-0000000000c3',
  keyB: '98000000-0000-4000-8000-0000000000cb',
  probeKey: '98000000-0000-4000-8000-0000000000ff',
} as const;

const PAID_ORDER_KEYS = [
  'amountDue', 'customerName', 'orderId', 'orderNumber', 'orderType', 'paidAt', 'paymentId', 'tableNumber', 'tenders', 'tip', 'total',
  'waiter', 'zoneName',
];
const PAID_TENDER_KEYS = ['amount', 'methodCode', 'methodKind', 'methodName', 'reference'];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('cashier shift endpoints (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};
  const methods: Record<string, string> = {};
  let registerA = '';

  beforeAll(async () => {
    database = await startTestDatabase();
    await seedShift(database.superuserUrl);
    app = await createTestApp(database.apiUrl);
    for (const email of [fixtures.adminA.email, fixtures.waiterA.email, fixtures.adminB.email, s.cashierEmail]) {
      const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD });
      cookies[email] = cookiePair(setCookies(res).vipe_access);
    }
    for (const row of await db<{ id: string; code: string }>('SELECT id, code FROM payment_methods WHERE restaurant_id = $1', [
      fixtures.restaurantA,
    ])) {
      methods[row.code] = row.id;
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
    };
  };
  const cashier = () => as(s.cashierEmail);
  const adminA = () => as(fixtures.adminA.email);
  const waiterA = () => as(fixtures.waiterA.email);
  const adminB = () => as(fixtures.adminB.email);
  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    superuserQuery<T>(database.superuserUrl, text, values);
  const pay = (orderId: string, idempotencyKey: string, tenders: object[], tipAmount = 0) =>
    cashier().post('/api/payments', { orderId, cashRegisterId: registerA, tipAmount, tenders, idempotencyKey });
  const storedTenders = (orderId: string) =>
    db(
      `SELECT t.line_no, t.method_code, t.amount::int, t.cash_received::int, t.reference
         FROM payment_tenders t JOIN payments p ON p.id = t.payment_id WHERE p.order_id = $1 ORDER BY t.line_no`,
      [orderId],
    );
  const counts = async () =>
    (await db<{ payments: number; tenders: number }>(
      'SELECT (SELECT count(*)::int FROM payments) AS payments, (SELECT count(*)::int FROM payment_tenders) AS tenders',
    ))[0];

  describe('register opener', () => {
    it('refuses a client-set openedBy and stores nothing', async () => {
      for (const body of [{ initialCash: 0, openedBy: fixtures.waiterA.profileId }, { initialCash: 0, opened_by: fixtures.waiterA.profileId }]) {
        const res = await cashier().post('/api/registers/open', body);
        expect(res.status).toBe(422);
      }
      expect(await db(`SELECT count(*)::int AS n FROM cash_registers WHERE restaurant_id = $1`, [fixtures.restaurantA])).toEqual([{ n: 0 }]);
    });

    it('records the caller as opener and exposes openedBy {id, name}', async () => {
      const res = await cashier().post('/api/registers/open', { initialCash: 20000 });
      expect(res.status).toBe(201);
      expect(res.body.openedBy).toEqual({ id: s.cashierProfile, name: 'Caja Turno' });
      registerA = res.body.id;
      expect(await db('SELECT opened_by FROM cash_registers WHERE id = $1', [registerA])).toEqual([{ opened_by: s.cashierProfile }]);
      expect((await waiterA().get('/api/registers/current')).body.openedBy).toEqual({ id: s.cashierProfile, name: 'Caja Turno' });
      expect((await adminA().get(`/api/registers/${registerA}`)).body.openedBy).toEqual({ id: s.cashierProfile, name: 'Caja Turno' });
    });

    it('answers openedBy null for a register without opener', async () => {
      const res = await adminB().get(`/api/registers/${s.registerB}`);
      expect(res.status).toBe(200);
      expect(res.body.openedBy).toBeNull();
    });
  });

  describe('tender reference', () => {
    it('keeps an old payload (no reference) as before: reference NULL, same response', async () => {
      const res = await pay(s.o1, s.key1, [{ paymentMethodId: methods.cash, amount: 11000, cashReceived: 20000 }], 1000);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        paymentId: expect.any(String),
        status: 'paid',
        alreadyPaid: false,
        amountDue: 10000,
        tipAmount: 1000,
        totalCharged: 11000,
        changeGiven: 9000,
        drawerWarning: false,
        drawerCashBefore: 20000,
        tenders: [{ lineNo: 1, methodCode: 'cash', amount: 11000, cashReceived: 20000 }],
      });
      expect(await storedTenders(s.o1)).toEqual([{ line_no: 1, method_code: 'cash', amount: 11000, cash_received: 20000, reference: null }]);
    });

    it('refuses a reference on a cash line with 422 and writes nothing', async () => {
      const before = await counts();
      const res = await pay(s.o4, s.probeKey, [{ paymentMethodId: methods.cash, amount: 4000, cashReceived: 4000, reference: '123' }]);
      expect(res.status).toBe(422);
      expect(res.body).toEqual({ statusCode: 422, error: 'Unprocessable Entity', message: 'Una línea en efectivo no lleva referencia' });
      expect(await counts()).toEqual(before);
      expect(await db('SELECT status FROM orders WHERE id = $1', [s.o4])).toEqual([{ status: 'delivered' }]);
    });

    it('refuses an empty, blank or too long reference with 422 and writes nothing', async () => {
      const before = await counts();
      for (const reference of ['', '  \t\n ', 'x'.repeat(61), 12]) {
        const res = await pay(s.o4, s.probeKey, [{ paymentMethodId: methods.transfer, amount: 4000, cashReceived: null, reference }]);
        expect(res.status).toBe(422);
      }
      expect(await counts()).toEqual(before);
    });

    it('stores a card/transfer reference trimmed, with tabs and newlines as spaces; the response is unchanged', async () => {
      const reference = `  Aprob\t4821\n${'9'.repeat(48)} `;
      const res = await pay(s.o2, s.key2, [{ paymentMethodId: methods.transfer, amount: 8000, cashReceived: null, reference }]);
      expect(res.status).toBe(200);
      expect(res.body.tenders).toEqual([{ lineNo: 1, methodCode: 'transfer', amount: 8000, cashReceived: null }]);
      expect(await storedTenders(s.o2)).toEqual([
        { line_no: 1, method_code: 'transfer', amount: 8000, cash_received: null, reference: `Aprob 4821 ${'9'.repeat(48)}` },
      ]);
    });

    it('stores a Nequi reference next to a cash line; null means none', async () => {
      const res = await pay(s.o3, s.key3, [
        { paymentMethodId: methods.nequi, amount: 5000, cashReceived: null, reference: 'NQ-77' },
        { paymentMethodId: methods.cash, amount: 2000, cashReceived: 2000, reference: null },
      ]);
      expect(res.status).toBe(200);
      expect(await storedTenders(s.o3)).toEqual([
        { line_no: 1, method_code: 'nequi', amount: 5000, cash_received: null, reference: 'NQ-77' },
        { line_no: 2, method_code: 'cash', amount: 2000, cash_received: 2000, reference: null },
      ]);
    });

    it('returns reference on the tenders of GET /payments', async () => {
      const res = await waiterA().get(`/api/payments?orderIds=${s.o1},${s.o3}`);
      expect(res.status).toBe(200);
      const byOrder = Object.fromEntries(res.body.map((x: { orderId: string; tenders: unknown[] }) => [x.orderId, x.tenders]));
      expect(byOrder[s.o1]).toEqual([expect.objectContaining({ methodCode: 'cash', reference: null })]);
      expect(byOrder[s.o3]).toEqual([
        expect.objectContaining({ methodCode: 'nequi', reference: 'NQ-77' }),
        expect.objectContaining({ methodCode: 'cash', reference: null }),
      ]);
    });
  });

  describe('GET /registers/:id/paid-orders', () => {
    it('lists the paid orders of the register, newest first, with table, zone, waiter, tip and tenders', async () => {
      const res = await cashier().get(`/api/registers/${registerA}/paid-orders`);
      expect(res.status).toBe(200);
      expect(res.body.map((o: { orderId: string }) => o.orderId)).toEqual([s.o3, s.o2, s.o1]);
      expect(Object.keys(res.body[0]).sort()).toEqual(PAID_ORDER_KEYS);
      expect(Object.keys(res.body[0].tenders[0]).sort()).toEqual(PAID_TENDER_KEYS);
      const [o3, o2, o1] = res.body;
      expect(o1).toEqual({
        orderId: s.o1,
        orderNumber: expect.any(Number),
        orderType: 'dine_in',
        customerName: null,
        tableNumber: 7,
        zoneName: 'Terraza',
        waiter: { id: fixtures.waiterA.profileId, name: 'Waiter A' },
        paymentId: expect.any(String),
        amountDue: 10000,
        tip: 1000,
        total: 11000,
        paidAt: expect.stringMatching(ISO),
        tenders: [{ methodCode: 'cash', methodName: 'Efectivo', methodKind: 'cash', amount: 11000, reference: null }],
      });
      expect(o2).toMatchObject({ orderType: 'dine_in', tableNumber: null, zoneName: null, waiter: null, total: 8000 });
      expect(o2.tenders).toEqual([
        { methodCode: 'transfer', methodName: 'Transferencia', methodKind: 'electronic', amount: 8000, reference: `Aprob 4821 ${'9'.repeat(48)}` },
      ]);
      expect(o3.tenders.map((t: { methodCode: string; reference: string | null }) => [t.methodCode, t.reference])).toEqual([
        ['nequi', 'NQ-77'],
        ['cash', null],
      ]);
      const numbers = await db<{ id: string; order_number: number }>('SELECT id, order_number FROM orders WHERE id = ANY($1)', [[s.o1, s.o2, s.o3]]);
      for (const row of numbers) {
        expect(res.body.find((o: { orderId: string }) => o.orderId === row.id).orderNumber).toBe(row.order_number);
      }
    });

    it('bounds the list with limit (1..200)', async () => {
      const res = await adminA().get(`/api/registers/${registerA}/paid-orders?limit=2`);
      expect(res.status).toBe(200);
      expect(res.body.map((o: { orderId: string }) => o.orderId)).toEqual([s.o3, s.o2]);
      for (const limit of ['0', '201', 'x']) {
        expect((await adminA().get(`/api/registers/${registerA}/paid-orders?limit=${limit}`)).status).toBe(422);
      }
      expect((await adminA().get(`/api/registers/${registerA}/paid-orders?status=paid`)).status).toBe(422);
    });

    it('admits cashier and admin only', async () => {
      const res = await waiterA().get(`/api/registers/${registerA}/paid-orders`);
      expect(res.status).toBe(403);
    });

    it("isolates tenants: another restaurant's register is 404 and B lists only its own", async () => {
      const foreign = await adminB().get(`/api/registers/${registerA}/paid-orders`);
      expect(foreign.status).toBe(404);
      const own = await adminB().get(`/api/registers/${s.registerB}/paid-orders`);
      expect(own.status).toBe(200);
      expect(own.body.map((o: { orderId: string }) => o.orderId)).toEqual([s.orderB]);
      expect((await adminA().get(`/api/registers/${s.registerB}/paid-orders`)).status).toBe(404);
    });
  });

  describe('shift figures (register_summary over the fixture)', () => {
    it('gives sales, tips, totals by method, payment count and expected cash', async () => {
      const res = await cashier().get(`/api/registers/summary?ids=${registerA}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        paymentsCount: 3,
        totalBilled: 25000,
        totalTips: 1000,
        totalSales: 26000,
        totalChange: 9000,
        initialCash: 20000,
        expectedCash: 33000,
      });
      const byMethod = Object.fromEntries(res.body.methods.map((m: { code: string; total: number; tendersCount: number }) => [m.code, [m.total, m.tendersCount]]));
      expect(byMethod).toMatchObject({ cash: [13000, 2], transfer: [8000, 1], nequi: [5000, 1] });
    });
  });
});

async function seedShift(superuserUrl: string) {
  const A = fixtures.restaurantA;
  const B = fixtures.restaurantB;
  const q = (text: string, values: unknown[] = []) => superuserQuery(superuserUrl, text, values);
  await q(
    `INSERT INTO users (id, email, password_hash, password_algo)
       SELECT $1, $2, password_hash, password_algo FROM users WHERE email = $3`,
    [s.cashierUser, s.cashierEmail, fixtures.adminA.email],
  );
  await q(`INSERT INTO profiles (id, user_id, full_name, email, role, restaurant_id) VALUES ($1, $2, 'Caja Turno', $3, 'cashier', $4)`, [
    s.cashierProfile, s.cashierUser, s.cashierEmail, A,
  ]);
  await q(`INSERT INTO zones (id, restaurant_id, name) VALUES ($1, $2, 'Terraza')`, [s.zone, A]);
  await q(`INSERT INTO tables (id, number, restaurant_id, zone_id) VALUES ($1, 7, $2, $3)`, [s.table, A, s.zone]);
  await q(
    `INSERT INTO orders (id, status, subtotal, tax, tax_percentage, total, restaurant_id, table_id, waiter_id, order_type) VALUES
       ($1, 'delivered', 10000, 0, 0, 10000, $5, $6, $7, 'dine_in'),
       ($2, 'delivered', 8000, 0, 0, 8000, $5, NULL, NULL, 'dine_in'),
       ($3, 'delivered', 7000, 0, 0, 7000, $5, $6, $7, 'dine_in'),
       ($4, 'delivered', 4000, 0, 0, 4000, $5, NULL, NULL, 'dine_in')`,
    [s.o1, s.o2, s.o3, s.o4, A, s.table, fixtures.waiterA.profileId],
  );
  await q(
    `INSERT INTO order_items (order_id, name, price, quantity, status, restaurant_id) VALUES
       ($1, 'Bandeja', 10000, 1, 'served', $5), ($2, 'Arepa', 8000, 1, 'served', $5),
       ($3, 'Jugo', 7000, 1, 'served', $5), ($4, 'Agua', 4000, 1, 'served', $5)`,
    [s.o1, s.o2, s.o3, s.o4, A],
  );
  await q(`INSERT INTO cash_registers (id, opening_timestamp, initial_cash, status, restaurant_id) VALUES ($1, now(), 0, 'open', $2)`, [
    s.registerB, B,
  ]);
  await q(`INSERT INTO orders (id, status, subtotal, tax, tax_percentage, total, restaurant_id) VALUES ($1, 'paid', 3000, 0, 0, 3000, $2)`, [
    s.orderB, B,
  ]);
  await q(
    `WITH pay AS (
       INSERT INTO payments (order_id, cash_register_id, amount_due, tip_amount, total_charged, change_given, idempotency_key, restaurant_id)
       VALUES ($1, $2, 3000, 0, 3000, 0, $3, $4) RETURNING id)
     INSERT INTO payment_tenders (restaurant_id, payment_id, line_no, payment_method_id, method_code, method_kind, amount, cash_received)
       SELECT $4, pay.id, 1, m.id, m.code, m.kind, 3000, 3000 FROM pay, payment_methods m WHERE m.restaurant_id = $4 AND m.code = 'cash'`,
    [s.orderB, s.registerB, s.keyB, B],
  );
}
