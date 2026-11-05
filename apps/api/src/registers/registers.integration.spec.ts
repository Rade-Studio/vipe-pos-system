import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/** Rows seeded as the superuser for this spec only. */
const r = {
  cashierUser: '10000000-0000-0000-0000-0000000000f1',
  cashierProfile: '20000000-0000-0000-0000-0000000000f1',
  cashierEmail: 'cashier@a.test',
  /** Opened 2026-03-10 23:30 in Bogota (04:30 UTC on the 11th). */
  late: '9a000000-0000-0000-0000-000000000001',
  /** Opened 2026-03-11 00:30 in Bogota. */
  early: '9a000000-0000-0000-0000-000000000002',
  /** Restaurant B, opened 2026-03-10 12:00 in Bogota. */
  registerB: '9a000000-0000-0000-0000-0000000000b1',
  legacyOrder: '9a000000-0000-0000-0000-000000000011',
  legacyTx: '9a000000-0000-0000-0000-000000000021',
  cashTx: '9a000000-0000-0000-0000-000000000031',
} as const;

const REGISTER_KEYS = ['closingTimestamp', 'createdAt', 'finalCash', 'id', 'initialCash', 'openingTimestamp', 'status', 'updatedAt'];
const CASH_TX_KEYS = ['amount', 'cashRegisterId', 'description', 'id', 'timestamp', 'type'];
const LEGACY_KEYS = [
  'amount', 'cashChange', 'cashReceived', 'cashRegisterId', 'id', 'method', 'orderId', 'tableId', 'timestamp',
  'tipAmount', 'totalDiscounts', 'waiterId',
];
const SUMMARY_KEYS = [
  'cashDeposits', 'cashWithdrawals', 'expectedCash', 'expectedCashAfterTips', 'initialCash', 'legacy', 'methods',
  'paymentsCount', 'registersCount', 'tipsPayout', 'totalBilled', 'totalChange', 'totalSales', 'totalTips',
];
const METHOD_KEYS = ['code', 'isActive', 'kind', 'name', 'paymentMethodId', 'sortOrder', 'tendersCount', 'total'];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('registers endpoints (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};
  let openId = '';

  beforeAll(async () => {
    database = await startTestDatabase();
    await seedRegisters(database.superuserUrl);
    app = await createTestApp(database.apiUrl);
    for (const email of [fixtures.adminA.email, fixtures.waiterA.email, fixtures.adminB.email, r.cashierEmail]) {
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
    };
  };
  const adminA = () => as(fixtures.adminA.email);
  const waiterA = () => as(fixtures.waiterA.email);
  const adminB = () => as(fixtures.adminB.email);
  const cashierA = () => as(r.cashierEmail);
  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    superuserQuery<T>(database.superuserUrl, text, values);
  const ids = (body: { id: string }[]) => body.map((row) => row.id);

  describe('reads', () => {
    it('answers 200 with null when no register is open', async () => {
      const res = await waiterA().get('/api/registers/current');
      expect(res.status).toBe(200);
      expect(res.body).toBeNull();
      expect(res.text).toBe('null');
    });

    it("filters by day in the restaurant's timezone (23:30 Bogota is that day, 00:30 the next)", async () => {
      const day10 = await adminA().get('/api/registers?date=2026-03-10');
      expect(day10.status).toBe(200);
      expect(ids(day10.body)).toEqual([r.late]);
      expect(Object.keys(day10.body[0]).sort()).toEqual(REGISTER_KEYS);
      expect(day10.body[0]).toMatchObject({
        openingTimestamp: '2026-03-11T04:30:00.000Z',
        status: 'closed',
        initialCash: 10000,
        finalCash: 15000,
        closingTimestamp: expect.stringMatching(ISO),
      });
      expect(ids((await adminA().get('/api/registers?date=2026-03-11')).body)).toEqual([r.early]);
      expect((await adminA().get('/api/registers?date=2026-03-12')).body).toEqual([]);
    });

    it('reads the timezone from the restaurants row', async () => {
      await db(`UPDATE restaurants SET timezone = 'UTC' WHERE id = $1`, [fixtures.restaurantA]);
      try {
        expect((await adminA().get('/api/registers?date=2026-03-10')).body).toEqual([]);
        expect(ids((await adminA().get('/api/registers?date=2026-03-11')).body)).toEqual([r.early, r.late]);
      } finally {
        await db(`UPDATE restaurants SET timezone = 'America/Bogota' WHERE id = $1`, [fixtures.restaurantA]);
      }
    });

    it('validates the date', async () => {
      for (const date of ['2026-02-30', '10-03-2026', 'today']) {
        expect((await adminA().get(`/api/registers?date=${date}`)).status).toBe(422);
      }
    });

    it('isolates tenants on every list and on :id', async () => {
      expect(ids((await adminB().get('/api/registers?date=2026-03-10')).body)).toEqual([r.registerB]);
      expect(ids((await adminA().get('/api/registers')).body)).toEqual([r.early, r.late]);
      expect(ids((await adminB().get('/api/registers')).body)).toEqual([r.registerB]);
      expect((await adminB().get(`/api/registers/${r.late}`)).status).toBe(404);
      expect((await adminB().get(`/api/registers/${r.late}/cash-transactions`)).status).toBe(404);
    });

    it('embeds legacy transactions and cash transactions on demand', async () => {
      const plain = await waiterA().get(`/api/registers/${r.late}`);
      expect(plain.status).toBe(200);
      expect(Object.keys(plain.body).sort()).toEqual(REGISTER_KEYS);
      const full = await waiterA().get(`/api/registers/${r.late}?include=transactions,cashTransactions`);
      expect(Object.keys(full.body).sort()).toEqual([...REGISTER_KEYS, 'cashTransactions', 'transactions'].sort());
      expect(full.body.transactions).toHaveLength(1);
      expect(Object.keys(full.body.transactions[0]).sort()).toEqual(LEGACY_KEYS);
      expect(full.body.transactions[0]).toMatchObject({ id: r.legacyTx, orderId: r.legacyOrder, method: 'cash', amount: 5000, cashReceived: 10000, cashChange: 5000 });
      expect(full.body.cashTransactions).toEqual([
        { id: r.cashTx, cashRegisterId: r.late, amount: 2000, type: 'withdrawal', description: 'Propinas', timestamp: expect.stringMatching(ISO) },
      ]);
      const list = await waiterA().get('/api/registers?date=2026-03-10&include=cashTransactions');
      expect(list.body[0].cashTransactions).toHaveLength(1);
      expect(list.body[0].transactions).toBeUndefined();
      expect((await waiterA().get(`/api/registers/${r.late}?include=payments`)).status).toBe(422);
    });
  });

  describe('open, move cash, summarize, close', () => {
    it('refuses the waiter on open', async () => {
      expect((await waiterA().post('/api/registers/open', { initialCash: 1000 })).status).toBe(403);
    });

    it('opens a register with the server clock', async () => {
      const before = Date.now();
      const res = await cashierA().post('/api/registers/open', { initialCash: 50000 });
      const after = Date.now();
      expect(res.status).toBe(201);
      expect(Object.keys(res.body).sort()).toEqual(REGISTER_KEYS);
      expect(res.body).toMatchObject({ status: 'open', initialCash: 50000, closingTimestamp: null, finalCash: null });
      const opened = Date.parse(res.body.openingTimestamp);
      expect(opened).toBeGreaterThanOrEqual(before - 1000);
      expect(opened).toBeLessThanOrEqual(after + 1000);
      openId = res.body.id;
      expect(await db('SELECT restaurant_id FROM cash_registers WHERE id = $1', [openId])).toEqual([{ restaurant_id: fixtures.restaurantA }]);
    });

    it('answers 409 to a second open and keeps one open register', async () => {
      const res = await adminA().post('/api/registers/open', { initialCash: 1 });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ statusCode: 409, error: 'Conflict', message: 'A register is already open' });
      expect(await db(`SELECT id FROM cash_registers WHERE restaurant_id = $1 AND status = 'open'`, [fixtures.restaurantA])).toEqual([{ id: openId }]);
    });

    it('validates the open body (no client timestamp)', async () => {
      for (const body of [{ initialCash: -1 }, {}, { initialCash: 1, openingTimestamp: '2020-01-01T00:00:00Z' }]) {
        expect((await cashierA().post('/api/registers/open', body)).status).toBe(422);
      }
    });

    it("never returns another restaurant's open register as current", async () => {
      const res = await adminB().get('/api/registers/current');
      expect(res.status).toBe(200);
      expect(res.text).toBe('null');
    });

    it('opens independently per restaurant', async () => {
      const res = await adminB().post('/api/registers/open', { initialCash: 0 });
      expect(res.status).toBe(201);
    });

    it('returns the open register as current', async () => {
      const res = await waiterA().get('/api/registers/current?include=transactions,cashTransactions');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: openId, status: 'open', transactions: [], cashTransactions: [] });
    });

    it('records cash transactions with the server clock', async () => {
      const deposit = await cashierA().post(`/api/registers/${openId}/cash-transactions`, { amount: 20000, type: 'deposit', description: 'Base' });
      expect(deposit.status).toBe(201);
      expect(Object.keys(deposit.body).sort()).toEqual(CASH_TX_KEYS);
      expect(deposit.body).toMatchObject({ cashRegisterId: openId, amount: 20000, type: 'deposit', description: 'Base', timestamp: expect.stringMatching(ISO) });
      expect(Math.abs(Date.parse(deposit.body.timestamp) - Date.now())).toBeLessThan(60_000);
      const withdrawal = await cashierA().post(`/api/registers/${openId}/cash-transactions`, { amount: 5000, type: 'withdrawal' });
      expect(withdrawal.status).toBe(201);
      expect(withdrawal.body.description).toBe('');
      const list = await waiterA().get(`/api/registers/${openId}/cash-transactions`);
      expect(list.body.map((t: { type: string }) => t.type)).toEqual(['withdrawal', 'deposit']);
    });

    it('validates cash transactions and refuses the waiter and other restaurants', async () => {
      const url = `/api/registers/${openId}/cash-transactions`;
      for (const body of [{ amount: 0, type: 'deposit' }, { amount: 1, type: 'refund' }, { amount: 1, type: 'deposit', timestamp: 'x' }]) {
        expect((await cashierA().post(url, body)).status).toBe(422);
      }
      expect((await waiterA().post(url, { amount: 1, type: 'deposit' })).status).toBe(403);
      expect((await adminB().post(url, { amount: 1, type: 'deposit' })).status).toBe(404);
      expect(await db('SELECT count(*)::int AS n FROM cash_transactions WHERE cash_register_id = $1', [openId])).toEqual([{ n: 2 }]);
    });

    it('passes register_summary through in camelCase', async () => {
      const res = await cashierA().get(`/api/registers/summary?ids=${openId}`);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(SUMMARY_KEYS);
      expect(res.body).toMatchObject({
        registersCount: 1,
        initialCash: 50000,
        paymentsCount: 0,
        cashDeposits: 20000,
        cashWithdrawals: 5000,
        expectedCash: 65000,
        tipsPayout: 0,
        expectedCashAfterTips: 65000,
        legacy: { paymentsCount: 0, total: 0, tips: 0, change: 0, byMethod: {} },
      });
      expect(Object.keys(res.body.methods[0]).sort()).toEqual(METHOD_KEYS);
      expect(res.body.methods.map((m: { code: string }) => m.code)).toEqual(['cash', 'transfer', 'nequi', 'bancolombia']);
      const both = await adminA().get(`/api/registers/summary?ids=${openId},${r.late}`);
      expect(both.body).toMatchObject({ registersCount: 2, initialCash: 60000, legacy: { paymentsCount: 1, total: 5000, byMethod: { cash: 5000 } } });
    });

    it('keeps the RPC errors of register_summary with their code', async () => {
      const waiter = await waiterA().get(`/api/registers/summary?ids=${openId}`);
      expect(waiter.status).toBe(403);
      expect(waiter.body).toMatchObject({ code: '42501' });
      const foreign = await adminB().get(`/api/registers/summary?ids=${openId}`);
      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual({ statusCode: 404, error: 'Not Found', message: 'Not found', code: 'P0002' });
      expect((await adminA().get('/api/registers/summary?ids=')).status).toBe(422);
    });

    it('refuses the waiter and other restaurants on close', async () => {
      expect((await waiterA().post(`/api/registers/${openId}/close`)).status).toBe(403);
      const foreign = await adminB().post(`/api/registers/${openId}/close`);
      expect(foreign.status).toBe(404);
      expect(foreign.body.code).toBe('P0002');
    });

    it('closes through close_register and returns the server closingTimestamp', async () => {
      const res = await cashierA().post(`/api/registers/${openId}/close`);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['cashRegisterId', 'closingTimestamp', 'finalCash', 'status', 'summary']);
      expect(res.body).toMatchObject({ status: 'closed', cashRegisterId: openId, finalCash: 65000, closingTimestamp: expect.stringMatching(ISO) });
      expect(res.body.summary).toMatchObject({ expectedCashAfterTips: 65000, cashDeposits: 20000 });
      const [row] = await db<{ closing: string; status: string; final_cash: string }>(
        `SELECT to_char(closing_timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS closing, status, final_cash::text
           FROM cash_registers WHERE id = $1`,
        [openId],
      );
      expect(row).toEqual({ closing: res.body.closingTimestamp, status: 'closed', final_cash: '65000.00' });

      const replay = await cashierA().post(`/api/registers/${openId}/close`);
      expect(replay.status).toBe(200);
      expect(replay.body).toMatchObject({ status: 'already_closed', finalCash: 65000, closingTimestamp: res.body.closingTimestamp });
    });

    it('has no current register after the close, refuses cash on it and lets a new one open', async () => {
      expect((await waiterA().get('/api/registers/current')).body).toBeNull();
      const cash = await cashierA().post(`/api/registers/${openId}/cash-transactions`, { amount: 1, type: 'deposit' });
      expect(cash.status).toBe(409);
      expect(cash.body.message).toBe('Register is closed');
      expect((await cashierA().post('/api/registers/open', { initialCash: 0 })).status).toBe(201);
    });
  });
});

async function seedRegisters(superuserUrl: string) {
  const A = fixtures.restaurantA;
  const B = fixtures.restaurantB;
  const q = (text: string, values: unknown[] = []) => superuserQuery(superuserUrl, text, values);
  await q(
    `INSERT INTO users (id, email, password_hash, password_algo)
       SELECT $1, $2, password_hash, password_algo FROM users WHERE email = $3`,
    [r.cashierUser, r.cashierEmail, fixtures.adminA.email],
  );
  await q(
    `INSERT INTO profiles (id, user_id, full_name, email, role, restaurant_id) VALUES ($1, $2, 'Cashier A', $3, 'cashier', $4)`,
    [r.cashierProfile, r.cashierUser, r.cashierEmail, A],
  );
  await q(
    `INSERT INTO cash_registers (id, opening_timestamp, closing_timestamp, initial_cash, final_cash, status, restaurant_id) VALUES
       ($1, '2026-03-10 23:30:00-05', '2026-03-11 06:00:00-05', 10000, 15000, 'closed', $4),
       ($2, '2026-03-11 00:30:00-05', '2026-03-11 08:00:00-05', 0, 0, 'closed', $4),
       ($3, '2026-03-10 12:00:00-05', '2026-03-10 20:00:00-05', 0, 0, 'closed', $5)`,
    [r.late, r.early, r.registerB, A, B],
  );
  await q(`INSERT INTO orders (id, status, subtotal, tax, tax_percentage, total, restaurant_id) VALUES ($1, 'paid', 5000, 0, 0, 5000, $2)`, [
    r.legacyOrder,
    A,
  ]);
  await q(
    `INSERT INTO payment_transactions (id, order_id, amount, method, cash_received, cash_change, timestamp, cash_register_id, restaurant_id)
       VALUES ($1, $2, 5000, 'cash', 10000, 5000, '2026-03-10 23:45:00-05', $3, $4)`,
    [r.legacyTx, r.legacyOrder, r.late, A],
  );
  await q(
    `INSERT INTO cash_transactions (id, amount, type, description, timestamp, cash_register_id, restaurant_id)
       VALUES ($1, 2000, 'withdrawal', 'Propinas', '2026-03-10 23:50:00-05', $2, $3)`,
    [r.cashTx, r.late, A],
  );
}
