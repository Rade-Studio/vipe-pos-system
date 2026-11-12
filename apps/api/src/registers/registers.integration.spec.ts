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
  openOrder1: '9a000000-0000-0000-0000-000000000041',
  openOrder2: '9a000000-0000-0000-0000-000000000042',
} as const;

const OPEN_ORDERS_MANY = 'Hay 2 órdenes abiertas. Cóbralas o cancélalas, o confirma que pasan a la siguiente caja.';
const OPEN_ORDERS_ONE = 'Hay 1 orden abierta. Cóbrala o cancélala, o confirma que pasa a la siguiente caja.';

const REGISTER_KEYS = [
  'cashDifference', 'closeNote', 'closedBy', 'closingTimestamp', 'countedCash', 'createdAt', 'denominations', 'finalCash', 'id',
  'initialCash', 'openedBy', 'openingTimestamp', 'status', 'updatedAt', 'validatedAt', 'validatedBy',
];
const CASH_TX_KEYS = ['amount', 'cashRegisterId', 'createdBy', 'description', 'id', 'reason', 'timestamp', 'type'];
const CLOSE_KEYS = [
  'cashDifference', 'cashRegisterId', 'closeNote', 'closedBy', 'closingTimestamp', 'countedCash', 'denominations', 'finalCash', 'status',
  'summary',
];
const COUNTED_CASH_REQUIRED = 'Ingresa el efectivo contado para cerrar la caja.';
const COUNT_MISMATCH = 'La suma de billetes y monedas no coincide con el efectivo contado.';
const NOTE_REQUIRED = 'El contado no cuadra con lo esperado: escribe una nota de 3 a 300 caracteres.';
const DESCRIPTION_REQUIRED = 'Describe el motivo del movimiento.';
const REGISTER_OPEN = 'La caja sigue abierta: ciérrala antes de validar el turno.';
const NO_COUNT = { countedCash: null, cashDifference: null, closeNote: null, denominations: null, closedBy: null };
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
        ...NO_COUNT,
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
        {
          id: r.cashTx, cashRegisterId: r.late, amount: 2000, type: 'withdrawal', description: 'Propinas', timestamp: expect.stringMatching(ISO),
          reason: null, createdBy: null,
        },
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
      expect(res.body).toMatchObject({ status: 'open', initialCash: 50000, closingTimestamp: null, finalCash: null, ...NO_COUNT });
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

    it('records cash transactions with the server clock, the reason and the caller as author', async () => {
      const cashier = { id: r.cashierProfile, name: 'Cashier A' };
      const deposit = await cashierA().post(`/api/registers/${openId}/cash-transactions`, {
        amount: 20000, type: 'deposit', reason: 'change_fund', description: 'Base',
      });
      expect(deposit.status).toBe(201);
      expect(Object.keys(deposit.body).sort()).toEqual(CASH_TX_KEYS);
      expect(deposit.body).toMatchObject({
        cashRegisterId: openId, amount: 20000, type: 'deposit', description: 'Base', timestamp: expect.stringMatching(ISO),
        reason: 'change_fund', createdBy: cashier,
      });
      expect(Math.abs(Date.parse(deposit.body.timestamp) - Date.now())).toBeLessThan(60_000);
      const withdrawal = await cashierA().post(`/api/registers/${openId}/cash-transactions`, { amount: 5000, type: 'withdrawal', reason: 'supplier' });
      expect(withdrawal.status).toBe(201);
      expect(withdrawal.body).toMatchObject({ description: '', reason: 'supplier', createdBy: cashier });
      const list = await waiterA().get(`/api/registers/${openId}/cash-transactions`);
      expect(list.body.map((t: { type: string; reason: string }) => [t.type, t.reason])).toEqual([['withdrawal', 'supplier'], ['deposit', 'change_fund']]);
      expect(list.body.map((t: { createdBy: unknown }) => t.createdBy)).toEqual([cashier, cashier]);
      expect(await db('SELECT reason, created_by FROM cash_transactions WHERE id = $1', [deposit.body.id])).toEqual([
        { reason: 'change_fund', created_by: r.cashierProfile },
      ]);
      const embedded = await waiterA().get(`/api/registers/${openId}?include=cashTransactions`);
      expect(embedded.body.cashTransactions[0]).toMatchObject({ reason: 'supplier', createdBy: cashier });
    });

    it('validates cash transactions and refuses the waiter and other restaurants', async () => {
      const url = `/api/registers/${openId}/cash-transactions`;
      for (const body of [
        { amount: 0, type: 'deposit', reason: 'change_fund' },
        { amount: 1, type: 'refund', reason: 'change_fund' },
        { amount: 1, type: 'deposit', reason: 'change_fund', timestamp: 'x' },
        { amount: 1, type: 'deposit' },
        { amount: 1, type: 'deposit', reason: null },
        { amount: 1, type: 'deposit', reason: 'refund' },
        { amount: 1, type: 'deposit', reason: 'Otro' },
      ]) {
        expect((await cashierA().post(url, body)).status).toBe(422);
      }
      for (const description of [undefined, null, '', '   ']) {
        const other = await cashierA().post(url, { amount: 1, type: 'deposit', reason: 'other', description });
        expect(other.status).toBe(422);
        expect(other.body).toEqual({ statusCode: 422, error: 'Unprocessable Entity', message: DESCRIPTION_REQUIRED, code: 'description_required' });
      }
      expect((await waiterA().post(url, { amount: 1, type: 'deposit', reason: 'change_fund' })).status).toBe(403);
      expect((await adminB().post(url, { amount: 1, type: 'deposit', reason: 'change_fund' })).status).toBe(404);
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

    it('answers 409 open_orders while the restaurant has open orders and keeps the register open', async () => {
      // The shared fixtures carry open orders; only this spec's orders are counted from here on.
      await db(`UPDATE orders SET status = 'cancelled' WHERE status IN ('active', 'kitchen', 'delivered')`);
      await db(
        `INSERT INTO orders (id, status, subtotal, tax, tax_percentage, total, restaurant_id) VALUES
           ($1, 'kitchen', 1000, 0, 0, 1000, $3), ($2, 'delivered', 2000, 0, 0, 2000, $3)`,
        [r.openOrder1, r.openOrder2, fixtures.restaurantA],
      );
      const many = await cashierA().post(`/api/registers/${openId}/close`);
      expect(many.status).toBe(409);
      expect(many.body).toEqual({ statusCode: 409, error: 'Conflict', message: OPEN_ORDERS_MANY, code: 'open_orders', count: 2 });
      await db(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [r.openOrder2]);
      const one = await cashierA().post(`/api/registers/${openId}/close`, { leaveOpenOrders: false });
      expect(one.status).toBe(409);
      expect(one.body).toEqual({ statusCode: 409, error: 'Conflict', message: OPEN_ORDERS_ONE, code: 'open_orders', count: 1 });
      expect(await db('SELECT status, closing_timestamp FROM cash_registers WHERE id = $1', [openId])).toEqual([
        { status: 'open', closing_timestamp: null },
      ]);
    });

    it('validates the close body (unknown keys are 422)', async () => {
      for (const body of [
        { leaveOpen: true },
        { leaveOpenOrders: 'yes' },
        { countedCash: -1 },
        { countedCash: 10.5 },
        { countedCash: '65000' },
        { countedCash: 65000, denominations: [{ value: 3000, quantity: 1 }] },
        { countedCash: 65000, denominations: [{ value: 1000, quantity: -1 }] },
        { countedCash: 65000, denominations: [{ value: 1000, quantity: 1.5 }] },
        { countedCash: 65000, denominations: [{ value: 1000 }] },
        { countedCash: 64000, note: '  ab ' },
        { countedCash: 64000, note: 'x'.repeat(301) },
      ]) {
        expect((await cashierA().post(`/api/registers/${openId}/close`, { leaveOpenOrders: true, ...body })).status).toBe(422);
      }
      await db(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [r.openOrder1]);
    });

    it('requires the count while the register is open and leaves it open on every refusal', async () => {
      const close = (body?: object) => cashierA().post(`/api/registers/${openId}/close`, body);
      for (const body of [undefined, {}, { leaveOpenOrders: true }, { denominations: [{ value: 50000, quantity: 1 }] }]) {
        const res = await close(body);
        expect(res.status).toBe(422);
        expect(res.body).toEqual({ statusCode: 422, error: 'Unprocessable Entity', message: COUNTED_CASH_REQUIRED, code: 'counted_cash_required' });
      }
      const mismatch = await close({ countedCash: 65000, denominations: [{ value: 50000, quantity: 1 }, { value: 10000, quantity: 1 }] });
      expect(mismatch.status).toBe(422);
      expect(mismatch.body).toEqual({ statusCode: 422, error: 'Unprocessable Entity', message: COUNT_MISMATCH, code: 'count_mismatch' });
      for (const body of [{ countedCash: 64000 }, { countedCash: 66000, note: null }, { countedCash: 0 }]) {
        const res = await close(body);
        expect(res.status).toBe(422);
        expect(res.body).toEqual({ statusCode: 422, error: 'Unprocessable Entity', message: NOTE_REQUIRED, code: 'note_required' });
      }
      expect(
        await db('SELECT status, closing_timestamp, final_cash, counted_cash, closed_by FROM cash_registers WHERE id = $1', [openId]),
      ).toEqual([{ status: 'open', closing_timestamp: null, final_cash: null, counted_cash: null, closed_by: null }]);
    });

    it('closes through close_register, stores the count and returns the server closingTimestamp', async () => {
      const denominations = [{ value: 50000, quantity: 1 }, { value: 10000, quantity: 1 }, { value: 2000, quantity: 2 }];
      const res = await cashierA().post(`/api/registers/${openId}/close`, { countedCash: 64000, denominations, note: '  Faltan dos mil  ' });
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(CLOSE_KEYS);
      const count = {
        countedCash: 64000, cashDifference: -1000, closeNote: 'Faltan dos mil', denominations, closedBy: { id: r.cashierProfile, name: 'Cashier A' },
      };
      expect(res.body).toMatchObject({
        status: 'closed', cashRegisterId: openId, finalCash: 65000, closingTimestamp: expect.stringMatching(ISO), ...count,
      });
      expect(res.body.summary).toMatchObject({ expectedCashAfterTips: 65000, cashDeposits: 20000 });
      const [row] = await db<{ closing: string; status: string; final_cash: string }>(
        `SELECT to_char(closing_timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS closing, status, final_cash::text
           FROM cash_registers WHERE id = $1`,
        [openId],
      );
      expect(row).toEqual({ closing: res.body.closingTimestamp, status: 'closed', final_cash: '65000.00' });
      const stored = 'SELECT counted_cash::text, cash_difference::text, close_note, denominations, closed_by FROM cash_registers WHERE id = $1';
      const storedRow = { counted_cash: '64000.00', cash_difference: '-1000.00', close_note: 'Faltan dos mil', denominations, closed_by: r.cashierProfile };
      expect(await db(stored, [openId])).toEqual([storedRow]);

      for (const body of [undefined, { countedCash: 0 }, { countedCash: 65000, note: 'Otro conteo' }]) {
        const replay = await adminA().post(`/api/registers/${openId}/close`, body);
        expect(replay.status).toBe(200);
        expect(Object.keys(replay.body).sort()).toEqual(CLOSE_KEYS);
        expect(replay.body).toMatchObject({ status: 'already_closed', finalCash: 65000, closingTimestamp: res.body.closingTimestamp, ...count });
      }
      expect(await db(stored, [openId])).toEqual([storedRow]);

      const read = await waiterA().get(`/api/registers/${openId}`);
      expect(Object.keys(read.body).sort()).toEqual(REGISTER_KEYS);
      expect(read.body).toMatchObject({ status: 'closed', finalCash: 65000, ...count });
      const listed = (await adminA().get('/api/registers')).body.find((reg: { id: string }) => reg.id === openId);
      expect(listed).toMatchObject(count);
    });

    it('answers a replay on a register closed before the count with null count fields', async () => {
      const replay = await cashierA().post(`/api/registers/${r.late}/close`);
      expect(replay.status).toBe(200);
      expect(replay.body).toMatchObject({ status: 'already_closed', finalCash: 15000, ...NO_COUNT });
    });

    it('has no current register after the close, refuses cash on it and lets a new one open', async () => {
      expect((await waiterA().get('/api/registers/current')).body).toBeNull();
      const cash = await cashierA().post(`/api/registers/${openId}/cash-transactions`, { amount: 1, type: 'deposit', reason: 'change_fund' });
      expect(cash.status).toBe(409);
      expect(cash.body.message).toBe('Register is closed');
      expect((await cashierA().post('/api/registers/open', { initialCash: 0 })).status).toBe(201);
    });

    it('closes with leaveOpenOrders: true and leaves the orders open; a replay keeps already_closed', async () => {
      const [{ id }] = await db<{ id: string }>(`SELECT id FROM cash_registers WHERE restaurant_id = $1 AND status = 'open'`, [fixtures.restaurantA]);
      await db(`UPDATE orders SET status = 'active' WHERE id = $1`, [r.openOrder1]);
      expect((await cashierA().post(`/api/registers/${id}/close`)).status).toBe(409);
      const gated = await cashierA().post(`/api/registers/${id}/close`, { countedCash: 0 });
      expect(gated.status).toBe(409);
      expect(gated.body).toMatchObject({ code: 'open_orders', count: 1 });
      const res = await cashierA().post(`/api/registers/${id}/close`, { leaveOpenOrders: true, countedCash: 0 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'closed', cashRegisterId: id, finalCash: 0, countedCash: 0, cashDifference: 0, closeNote: null, denominations: null,
        closedBy: { id: r.cashierProfile, name: 'Cashier A' },
      });
      expect(await db('SELECT status FROM orders WHERE id = $1', [r.openOrder1])).toEqual([{ status: 'active' }]);
      const replay = await cashierA().post(`/api/registers/${id}/close`);
      expect(replay.status).toBe(200);
      expect(replay.body.status).toBe('already_closed');
    });
  });

  describe('POST /registers/:id/validate (S7)', () => {
    const ADMIN_A = { id: fixtures.adminA.profileId, name: 'Admin A' };

    it('refuses a cashier (403), an open register (409) and another restaurant (404), changing nothing', async () => {
      const { id } = (await cashierA().post('/api/registers/open', { initialCash: 0 })).body;
      expect((await cashierA().post(`/api/registers/${r.early}/validate`)).status).toBe(403);
      const open = await adminA().post(`/api/registers/${id}/validate`);
      expect(open.status).toBe(409);
      expect(open.body).toMatchObject({ code: 'register_open', message: REGISTER_OPEN });
      expect((await adminB().post(`/api/registers/${r.early}/validate`)).status).toBe(404);
      expect(await db('SELECT validated_by, validated_at FROM cash_registers WHERE id = ANY($1)', [[r.early, id]])).toEqual([
        { validated_by: null, validated_at: null },
        { validated_by: null, validated_at: null },
      ]);
    });

    it('stores the admin and the time once; a second call returns the stored values', async () => {
      expect((await adminA().get(`/api/registers/${r.early}`)).body).toMatchObject({ validatedBy: null, validatedAt: null });
      const first = await adminA().post(`/api/registers/${r.early}/validate`);
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ id: r.early, status: 'closed', validatedBy: ADMIN_A, validatedAt: expect.stringMatching(ISO) });
      const again = await adminA().post(`/api/registers/${r.early}/validate`);
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ validatedBy: ADMIN_A, validatedAt: first.body.validatedAt });
      expect((await adminA().get(`/api/registers/${r.early}`)).body).toMatchObject({ validatedBy: ADMIN_A, validatedAt: first.body.validatedAt });
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
