import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/**
 * T3 (S5, S6, S7): the admin's business day, day ledger and period report.
 * Restaurant A (America/Bogota, cut-off 4) has business day Tuesday
 * 2026-11-10 with three registers: reg1 (Cashier A, a deposit, a withdrawal,
 * cash and transfer payments with tips, a voided cash payment), reg2 (Cajera
 * Tarde, Nequi and cash payments, an order cancellation, validated by Admin A)
 * and reg3, opened at 01:30 on the 11th, which still belongs to the 10th.
 * reg4 opens at 04:30 on the 11th (that day) and stays open. reg0 is the
 * Tuesday before (2026-11-03) and regOct falls in October.
 */
const c = {
  cashierUser: '10000000-0000-0000-0000-0000000000c1',
  cashierProfile: '20000000-0000-0000-0000-0000000000c1',
  cashierEmail: 'cashier@cash.test',
  cashier2User: '10000000-0000-0000-0000-0000000000c2',
  cashier2Profile: '20000000-0000-0000-0000-0000000000c2',
  cashier2Email: 'cashier2@cash.test',
  waiter2User: '10000000-0000-0000-0000-0000000000c3',
  waiter2Profile: '20000000-0000-0000-0000-0000000000c3',
  zone: '97000000-0000-0000-0000-0000000000e1',
  table7: '97000000-0000-0000-0000-0000000000e7',
  table8: '97000000-0000-0000-0000-0000000000e8',
  table9: '97000000-0000-0000-0000-0000000000e9',
  reg0: '97000000-0000-0000-0000-000000000a00',
  regOct: '97000000-0000-0000-0000-000000000a0f',
  reg1: '97000000-0000-0000-0000-000000000a01',
  reg2: '97000000-0000-0000-0000-000000000a02',
  reg3: '97000000-0000-0000-0000-000000000a03',
  reg4: '97000000-0000-0000-0000-000000000a04',
  regB: '97000000-0000-0000-0000-000000000ab1',
  o0: '97000000-0000-0000-0000-000000000b00',
  oOct: '97000000-0000-0000-0000-000000000b0f',
  o1: '97000000-0000-0000-0000-000000000b01',
  o2: '97000000-0000-0000-0000-000000000b02',
  o3: '97000000-0000-0000-0000-000000000b03',
  o4: '97000000-0000-0000-0000-000000000b04',
  o5: '97000000-0000-0000-0000-000000000b05',
  o6: '97000000-0000-0000-0000-000000000b06',
  oB: '97000000-0000-0000-0000-000000000bb1',
  p0: '97000000-0000-0000-0000-000000000c00',
  pOct: '97000000-0000-0000-0000-000000000c0f',
  p1: '97000000-0000-0000-0000-000000000c01',
  p2: '97000000-0000-0000-0000-000000000c02',
  p3: '97000000-0000-0000-0000-000000000c03',
  p4: '97000000-0000-0000-0000-000000000c04',
  p5: '97000000-0000-0000-0000-000000000c05',
  pB: '97000000-0000-0000-0000-000000000cb1',
  deposit: '97000000-0000-0000-0000-000000000d01',
  withdrawal: '97000000-0000-0000-0000-000000000d02',
  auditVoid: '97000000-0000-0000-0000-000000000e01',
  auditCancel: '97000000-0000-0000-0000-000000000e02',
  regSep1: '97000000-0000-0000-0000-000000000a91',
  regSep2: '97000000-0000-0000-0000-000000000a92',
} as const;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const REGISTER_OPEN = 'La caja sigue abierta: ciérrala antes de validar el turno.';
const RANGE_TOO_LONG = 'El período no puede superar 366 días.';
const RANGE_INVERTED = 'La fecha inicial debe ser anterior o igual a la final.';
const DAY_KEYS = ['date', 'previous', 'registers', 'status', 'tipsByWaiter', 'totals', 'voids', 'z'];
const DAY_OPEN = 'Hay un turno abierto en este día: ciérralo antes de emitir el informe Z.';
const DAY_EMPTY = 'No hay turnos de caja en este día: no hay nada que cerrar.';
const Z_KEYS = ['businessDay', 'emittedAt', 'emittedBy', 'number', 'snapshot'];
const SNAPSHOT_KEYS = ['date', 'discounts', 'orders', 'previous', 'registers', 'status', 'taxes', 'tipsByMethod', 'tipsByWaiter', 'totals', 'voids'];
const DAY_REGISTER_KEYS = [
  'cashDifference', 'closeNote', 'closedAt', 'closedBy', 'countedCash', 'deposits', 'expected', 'id', 'initialCash', 'methods',
  'openedAt', 'openedBy', 'salesNet', 'status', 'tickets', 'tips', 'tipsPayout', 'validatedAt', 'validatedBy', 'withdrawals',
];
const TOTALS_KEYS = [
  'avgTicket', 'counted', 'deliveries', 'deposits', 'difference', 'expected', 'methods', 'salesNet', 'tables', 'tickets', 'tips',
  'withdrawals',
];
const BUCKET_KEYS = ['avgTicket', 'difference', 'end', 'methods', 'salesNet', 'start', 'tickets', 'tips', 'voids'];
const ADMIN_A = { id: fixtures.adminA.profileId, name: 'Admin A' };
const CASHIER_A = { id: c.cashierProfile, name: 'Cashier A' };
const CASHIER_2 = { id: c.cashier2Profile, name: 'Cajera Tarde' };

type Method = { code: string; total: number; count: number };
const byCode = (methods: Method[]) => Object.fromEntries(methods.map((m) => [m.code, [m.total, m.count]]));

describe('cash endpoints (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};
  const numbers: Record<string, number> = {};

  beforeAll(async () => {
    database = await startTestDatabase();
    await seedCash(database.superuserUrl);
    app = await createTestApp(database.apiUrl);
    for (const email of [fixtures.adminA.email, fixtures.waiterA.email, fixtures.adminB.email, c.cashierEmail]) {
      const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD });
      cookies[email] = cookiePair(setCookies(res).vipe_access);
    }
    for (const row of await db<{ id: string; order_number: number }>('SELECT id, order_number FROM orders')) {
      numbers[row.id] = row.order_number;
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
  const adminB = () => as(fixtures.adminB.email);
  const cashierA = () => as(c.cashierEmail);
  const waiterA = () => as(fixtures.waiterA.email);
  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    superuserQuery<T>(database.superuserUrl, text, values);
  const registerIds = (body: { registers: { id: string }[] }) => body.registers.map((reg) => reg.id);

  describe('access', () => {
    it('answers 401 without a session and 403 for cashier and waiter on every /cash route', async () => {
      for (const url of ['/api/cash/days/2026-11-10', '/api/cash/days/2026-11-10/ledger', '/api/cash/report?from=2026-11-01&to=2026-11-30&group=day']) {
        expect((await request(app.getHttpServer()).get(url)).status).toBe(401);
        expect((await cashierA().get(url)).status).toBe(403);
        expect((await waiterA().get(url)).status).toBe(403);
      }
    });

    it('validates the date', async () => {
      for (const date of ['2026-02-30', '10-11-2026', 'today']) {
        expect((await adminA().get(`/api/cash/days/${date}`)).status).toBe(422);
        expect((await adminA().get(`/api/cash/days/${date}/ledger`)).status).toBe(422);
      }
    });
  });

  describe('business day (S5)', () => {
    it('puts a register opened at 01:30 in the previous day and one opened at 04:30 in the same day', async () => {
      const day10 = await adminA().get('/api/cash/days/2026-11-10');
      expect(day10.status).toBe(200);
      expect(registerIds(day10.body)).toEqual([c.reg1, c.reg2, c.reg3]);
      expect(day10.body.status).toBe('closed');
      const day11 = await adminA().get('/api/cash/days/2026-11-11');
      expect(registerIds(day11.body)).toEqual([c.reg4]);
      expect(day11.body.status).toBe('open');
      const empty = await adminA().get('/api/cash/days/2026-11-12');
      expect(empty.body).toMatchObject({ date: '2026-11-12', status: 'empty', registers: [] });
    });

    it('follows businessDayCutoffHour: with cut-off 1 the 01:30 register is the next day', async () => {
      expect((await adminA().get('/api/config')).body.businessDayCutoffHour).toBe(4);
      await db(`INSERT INTO business_config (key, value, restaurant_id) VALUES ('business_day_cutoff_hour', '1', $1)`, [fixtures.restaurantA]);
      try {
        expect(registerIds((await adminA().get('/api/cash/days/2026-11-10')).body)).toEqual([c.reg1, c.reg2]);
        expect(registerIds((await adminA().get('/api/cash/days/2026-11-11')).body)).toEqual([c.reg3, c.reg4]);
      } finally {
        await db(`DELETE FROM business_config WHERE key = 'business_day_cutoff_hour' AND restaurant_id = $1`, [fixtures.restaurantA]);
      }
    });
  });

  describe('GET /cash/days/:date', () => {
    it('serves every register with its figures, count, closer and validation', async () => {
      const res = await adminA().get('/api/cash/days/2026-11-10');
      expect(Object.keys(res.body).sort()).toEqual(DAY_KEYS);
      const [reg1, reg2, reg3] = res.body.registers;
      for (const reg of res.body.registers) {
        expect(Object.keys(reg).sort()).toEqual(DAY_REGISTER_KEYS);
      }
      expect(reg1).toMatchObject({
        id: c.reg1, status: 'closed', openedAt: '2026-11-10T12:58:00.000Z', closedAt: '2026-11-10T20:12:00.000Z',
        openedBy: CASHIER_A, closedBy: CASHIER_A, validatedBy: null, validatedAt: null,
        initialCash: 200000, salesNet: 80000, tickets: 2, tips: 8000, deposits: 50000, withdrawals: 45000, tipsPayout: 8000,
        expected: 252000, countedCash: 250000, cashDifference: -2000, closeNote: 'Faltante de prueba',
      });
      expect(byCode(reg1.methods)).toEqual({ cash: [55000, 1], transfer: [33000, 1], nequi: [0, 0], bancolombia: [0, 0] });
      expect(Object.keys(reg1.methods[0]).sort()).toEqual(['code', 'count', 'id', 'kind', 'name', 'total']);
      expect(reg1.methods[0]).toMatchObject({ code: 'cash', name: 'Efectivo', kind: 'cash', id: expect.any(String) });
      expect(reg2).toMatchObject({
        id: c.reg2, openedBy: CASHIER_2, closedBy: CASHIER_2, validatedBy: ADMIN_A, validatedAt: '2026-11-11T13:00:00.000Z',
        initialCash: 100000, salesNet: 65000, tickets: 2, tips: 4000, deposits: 0, withdrawals: 0, expected: 121000,
        countedCash: 121000, cashDifference: 0, closeNote: null,
      });
      expect(byCode(reg2.methods)).toEqual({ cash: [25000, 1], transfer: [0, 0], nequi: [44000, 1], bancolombia: [0, 0] });
      expect(reg3).toMatchObject({ id: c.reg3, openedAt: '2026-11-11T06:30:00.000Z', salesNet: 0, tickets: 0, expected: 0 });
    });

    it('totals the day: sales, tickets, average, tables, deliveries, tips, methods, cash and the count', async () => {
      const { totals } = (await adminA().get('/api/cash/days/2026-11-10')).body;
      expect(Object.keys(totals).sort()).toEqual(TOTALS_KEYS);
      expect(totals).toMatchObject({
        salesNet: 145000, tickets: 4, avgTicket: 36250, tables: 2, deliveries: { count: 1, amount: 25000 }, tips: 12000,
        deposits: 50000, withdrawals: 45000, expected: 373000, counted: 371000, difference: -2000,
      });
      expect(byCode(totals.methods)).toEqual({ cash: [80000, 2], transfer: [33000, 1], nequi: [44000, 1], bancolombia: [0, 0] });
    });

    it("groups tips by the order's waiter, compares with the same weekday last week and lists the voids", async () => {
      const { body } = await adminA().get('/api/cash/days/2026-11-10');
      expect(body.tipsByWaiter).toEqual([
        { waiterId: fixtures.waiterA.profileId, name: 'Waiter A', amount: 8000 },
        { waiterId: c.waiter2Profile, name: 'Mesero Dos', amount: 4000 },
      ]);
      expect(body.previous).toEqual({ date: '2026-11-03', salesNet: 10000 });
      expect(body.voids).toEqual({
        count: 2,
        amount: 35000,
        items: [
          {
            at: '2026-11-10T19:30:00.000Z', kind: 'payment_void', orderNumber: numbers[c.o3], table: 'Domicilio', amount: 20000,
            reason: 'duplicate_charge', reasonText: null, requestedBy: 'Cashier A', authorizedBy: 'Admin A',
          },
          {
            at: '2026-11-10T23:00:00.000Z', kind: 'order_cancellation', orderNumber: numbers[c.o6], table: '9', amount: 15000,
            reason: 'other', reasonText: 'Cliente se fue', requestedBy: 'Cajera Tarde', authorizedBy: 'Admin A',
          },
        ],
      });
    });

    it("never shows another restaurant's registers, payments or voids", async () => {
      const b = (await adminB().get('/api/cash/days/2026-11-10')).body;
      expect(registerIds(b)).toEqual([c.regB]);
      expect(b.totals).toMatchObject({ salesNet: 3000, tickets: 1, tips: 0 });
      expect(b.voids).toEqual({ count: 0, amount: 0, items: [] });
      expect(b.tipsByWaiter).toEqual([]);
      expect(b.previous).toEqual({ date: '2026-11-03', salesNet: 0 });
      const a = (await adminA().get('/api/cash/days/2026-11-10')).body;
      expect(registerIds(a)).not.toContain(c.regB);
    });
  });

  describe('GET /cash/days/:date/ledger', () => {
    type Entry = { registerId: string | null; kind: string; at: string; cashDelta: number; cashBalance: number | null } & Record<string, unknown>;

    it('lists the events in order with a running cash balance per register that ends at the expected cash before tips', async () => {
      const res = await adminA().get('/api/cash/days/2026-11-10/ledger');
      expect(res.status).toBe(200);
      expect(res.body.date).toBe('2026-11-10');
      const entries: Entry[] = res.body.entries;
      expect(entries.map((e) => [e.registerId, e.kind, e.at, e.cashDelta, e.cashBalance])).toEqual([
        [c.reg1, 'opening', '2026-11-10T12:58:00.000Z', 200000, 200000],
        [c.reg1, 'cash_movement', '2026-11-10T14:00:00.000Z', 50000, 250000],
        [c.reg1, 'cash_movement', '2026-11-10T15:00:00.000Z', -45000, 205000],
        [c.reg1, 'payment', '2026-11-10T17:00:00.000Z', 55000, 260000],
        [c.reg1, 'payment', '2026-11-10T18:00:00.000Z', 0, 260000],
        [c.reg1, 'payment', '2026-11-10T19:00:00.000Z', 20000, 280000],
        [c.reg1, 'payment_void', '2026-11-10T19:30:00.000Z', -20000, 260000],
        [c.reg1, 'close', '2026-11-10T20:12:00.000Z', 0, 260000],
        [c.reg2, 'opening', '2026-11-10T20:15:00.000Z', 100000, 100000],
        [c.reg2, 'payment', '2026-11-10T21:00:00.000Z', 0, 100000],
        [c.reg2, 'payment', '2026-11-10T22:00:00.000Z', 25000, 125000],
        [c.reg2, 'order_cancellation', '2026-11-10T23:00:00.000Z', 0, 125000],
        [c.reg2, 'close', '2026-11-11T04:04:00.000Z', 0, 125000],
        [c.reg3, 'opening', '2026-11-11T06:30:00.000Z', 0, 0],
        [c.reg3, 'close', '2026-11-11T08:00:00.000Z', 0, 0],
        [c.reg2, 'validation', '2026-11-11T13:00:00.000Z', 0, 125000],
      ]);
    });

    it('describes each entry with order number, table, people, tenders, reasons and the count', async () => {
      const entries: Entry[] = (await adminA().get('/api/cash/days/2026-11-10/ledger')).body.entries;
      const [opening, deposit, withdrawal, p1, , p3, voided, close] = entries;
      expect(opening).toMatchObject({ amount: 200000, openedBy: CASHIER_A });
      expect(deposit).toMatchObject({ type: 'deposit', amount: 50000, reason: 'change_fund', description: '', createdBy: CASHIER_A });
      expect(withdrawal).toMatchObject({ type: 'withdrawal', amount: 45000, reason: 'supplier', description: 'Hielo', createdBy: CASHIER_A });
      expect(p1).toMatchObject({
        orderNumber: numbers[c.o1], table: '7', waiter: { id: fixtures.waiterA.profileId, name: 'Waiter A' }, cashier: CASHIER_A,
        amount: 50000, tip: 5000, change: 5000,
        tenders: [{ method: 'Efectivo', code: 'cash', kind: 'cash', amount: 55000 }],
      });
      expect(p1.voided).toBe(false);
      expect(p3).toMatchObject({
        orderNumber: numbers[c.o3], table: 'Domicilio', waiter: null, amount: 20000, voided: true,
        tenders: [{ method: 'Efectivo', code: 'cash', kind: 'cash', amount: 20000 }],
      });
      expect(voided).toMatchObject({
        orderNumber: numbers[c.o3], amount: 20000, reason: 'duplicate_charge', requestedBy: 'Cashier A', authorizedBy: 'Admin A',
      });
      expect(close).toMatchObject({ expected: 252000, counted: 250000, difference: -2000, note: 'Faltante de prueba', closedBy: CASHIER_A });
      expect(entries.at(-1)).toMatchObject({ kind: 'validation', validatedBy: ADMIN_A });
      expect(entries.find((e) => e.kind === 'order_cancellation')).toMatchObject({
        orderNumber: numbers[c.o6], table: '9', amount: 15000, reason: 'other', reasonText: 'Cliente se fue', requestedBy: 'Cajera Tarde',
      });
    });

    it("isolates the ledger to the caller's restaurant", async () => {
      const entries: Entry[] = (await adminB().get('/api/cash/days/2026-11-10/ledger')).body.entries;
      expect(entries.map((e) => [e.registerId, e.kind])).toEqual([[c.regB, 'opening'], [c.regB, 'payment'], [c.regB, 'close']]);
    });
  });

  describe('GET /cash/report', () => {
    it('groups by day, with the previous period of the same length', async () => {
      const res = await adminA().get('/api/cash/report?from=2026-11-01&to=2026-11-30&group=day');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ from: '2026-11-01', to: '2026-11-30', group: 'day' });
      expect(res.body.buckets).toHaveLength(30);
      for (const bucket of [...res.body.buckets, res.body.totals, res.body.previous]) {
        expect(Object.keys(bucket).sort()).toEqual(BUCKET_KEYS);
      }
      const day10 = res.body.buckets.find((b: { start: string }) => b.start === '2026-11-10');
      expect(day10).toMatchObject({
        start: '2026-11-10', end: '2026-11-10', salesNet: 145000, tickets: 4, avgTicket: 36250, tips: 12000, difference: -2000,
        voids: { count: 2, amount: 35000 },
      });
      expect(byCode(day10.methods)).toEqual({ cash: [80000, 2], transfer: [33000, 1], nequi: [44000, 1], bancolombia: [0, 0] });
      expect(res.body.buckets.find((b: { start: string }) => b.start === '2026-11-03')).toMatchObject({ salesNet: 10000, tickets: 1 });
      expect(res.body.buckets.find((b: { start: string }) => b.start === '2026-11-11')).toMatchObject({ salesNet: 0, tickets: 0, avgTicket: 0 });
      expect(res.body.totals).toMatchObject({ start: '2026-11-01', end: '2026-11-30', salesNet: 155000, tickets: 5, avgTicket: 31000 });
      expect(res.body.previous).toMatchObject({ start: '2026-10-02', end: '2026-10-31', salesNet: 7000, tickets: 1 });
    });

    it('groups by ISO week (Monday) and by month, clipped to the range', async () => {
      const weeks = (await adminA().get('/api/cash/report?from=2026-11-01&to=2026-11-30&group=week')).body.buckets;
      expect(weeks.map((b: { start: string; end: string; salesNet: number }) => [b.start, b.end, b.salesNet])).toEqual([
        ['2026-11-01', '2026-11-01', 0],
        ['2026-11-02', '2026-11-08', 10000],
        ['2026-11-09', '2026-11-15', 145000],
        ['2026-11-16', '2026-11-22', 0],
        ['2026-11-23', '2026-11-29', 0],
        ['2026-11-30', '2026-11-30', 0],
      ]);
      const months = (await adminA().get('/api/cash/report?from=2026-10-01&to=2026-11-30&group=month')).body;
      expect(months.buckets.map((b: { start: string; end: string; salesNet: number }) => [b.start, b.end, b.salesNet])).toEqual([
        ['2026-10-01', '2026-10-31', 7000],
        ['2026-11-01', '2026-11-30', 155000],
      ]);
      expect(months.previous).toMatchObject({ start: '2026-08-01', end: '2026-09-30', salesNet: 0 });
    });

    it('reports the difference per cashier and the tips per waiter', async () => {
      const { body } = await adminA().get('/api/cash/report?from=2026-11-01&to=2026-11-30&group=month');
      expect(body.byCashier).toEqual([
        { profileId: fixtures.adminA.profileId, name: 'Admin A', shifts: 1, difference: 0 },
        { profileId: c.cashier2Profile, name: 'Cajera Tarde', shifts: 1, difference: 0 },
        { profileId: c.cashierProfile, name: 'Cashier A', shifts: 3, difference: -2000 },
      ]);
      expect(body.tipsByWaiter).toEqual([
        { waiterId: fixtures.waiterA.profileId, name: 'Waiter A', amount: 8000 },
        { waiterId: c.waiter2Profile, name: 'Mesero Dos', amount: 4000 },
      ]);
    });

    it('validates the query: dates, group, order and at most 366 days', async () => {
      for (const query of ['from=2026-11-01&to=2026-11-30', 'from=2026-11-01&to=2026-11-30&group=year', 'from=x&to=2026-11-30&group=day', 'to=2026-11-30&group=day']) {
        expect((await adminA().get(`/api/cash/report?${query}`)).status).toBe(422);
      }
      const long = await adminA().get('/api/cash/report?from=2025-11-01&to=2026-11-02&group=month');
      expect(long.status).toBe(422);
      expect(long.body).toMatchObject({ code: 'range_too_long', message: RANGE_TOO_LONG });
      const inverted = await adminA().get('/api/cash/report?from=2026-11-30&to=2026-11-01&group=day');
      expect(inverted.status).toBe(422);
      expect(inverted.body).toMatchObject({ code: 'range_inverted', message: RANGE_INVERTED });
      expect((await adminA().get('/api/cash/report?from=2025-11-02&to=2026-11-02&group=month')).status).toBe(200);
    });

    it("isolates the report to the caller's restaurant", async () => {
      const { body } = await adminB().get('/api/cash/report?from=2026-11-01&to=2026-11-30&group=month');
      expect(body.totals).toMatchObject({ salesNet: 3000, tickets: 1 });
      expect(body.previous).toMatchObject({ salesNet: 0 });
      expect(body.byCashier).toEqual([]);
      expect(body.tipsByWaiter).toEqual([]);
    });
  });

  describe('POST /registers/:id/validate (S7)', () => {
    it('refuses a cashier (403), an open register (409) and another restaurant (404), changing nothing', async () => {
      expect((await cashierA().post(`/api/registers/${c.reg1}/validate`)).status).toBe(403);
      const open = await adminA().post(`/api/registers/${c.reg4}/validate`);
      expect(open.status).toBe(409);
      expect(open.body).toMatchObject({ code: 'register_open', message: REGISTER_OPEN });
      expect((await adminB().post(`/api/registers/${c.reg1}/validate`)).status).toBe(404);
      expect(await db('SELECT validated_by, validated_at FROM cash_registers WHERE id = ANY($1)', [[c.reg1, c.reg4]])).toEqual([
        { validated_by: null, validated_at: null },
        { validated_by: null, validated_at: null },
      ]);
    });

    it('stores the admin and the time once; a second call returns the stored values', async () => {
      const first = await adminA().post(`/api/registers/${c.reg1}/validate`);
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ id: c.reg1, status: 'closed', validatedBy: ADMIN_A, validatedAt: expect.stringMatching(ISO) });
      const again = await adminA().post(`/api/registers/${c.reg1}/validate`);
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ validatedBy: ADMIN_A, validatedAt: first.body.validatedAt });
      expect((await adminA().get(`/api/registers/${c.reg1}`)).body).toMatchObject({ validatedBy: ADMIN_A, validatedAt: first.body.validatedAt });
      const day = (await adminA().get('/api/cash/days/2026-11-10')).body;
      expect(day.registers[0]).toMatchObject({ validatedBy: ADMIN_A, validatedAt: first.body.validatedAt });
    });
  });

  describe('informe Z (S8, S9, S10)', () => {
    const zRows = () => db<{ restaurant_id: string; number: number; business_day: string }>(
      `SELECT restaurant_id, number, to_char(business_day, 'YYYY-MM-DD') AS business_day FROM z_reports ORDER BY restaurant_id, number`);

    beforeAll(async () => {
      // Two closed business days without sales for the concurrent emits.
      await db(
        `INSERT INTO cash_registers (id, opening_timestamp, closing_timestamp, initial_cash, final_cash, status, restaurant_id, opened_by, closed_by,
                                     counted_cash, cash_difference) VALUES
           ($1, '2026-09-01 10:00-05', '2026-09-01 20:00-05', 0, 0, 'closed', $3, $4, $4, 0, 0),
           ($2, '2026-09-02 10:00-05', '2026-09-02 20:00-05', 0, 0, 'closed', $3, $4, $4, 0, 0)`,
        [c.regSep1, c.regSep2, fixtures.restaurantA, c.cashierProfile],
      );
    });

    it('answers 401 without a session and 403 for cashier and waiter, emitting nothing', async () => {
      const server = request(app.getHttpServer());
      expect((await server.post('/api/cash/days/2026-11-10/z')).status).toBe(401);
      for (const who of [cashierA, waiterA]) {
        expect((await who().post('/api/cash/days/2026-11-10/z')).status).toBe(403);
        expect((await who().get('/api/cash/z?from=2026-11-01&to=2026-11-30')).status).toBe(403);
        expect((await who().get('/api/cash/z/1')).status).toBe(403);
      }
      expect(await zRows()).toEqual([]);
    });

    it('refuses a day with an open register (409 day_open) and a day without registers (409 day_empty)', async () => {
      const open = await adminA().post('/api/cash/days/2026-11-11/z');
      expect(open.status).toBe(409);
      expect(open.body).toMatchObject({ code: 'day_open', message: DAY_OPEN });
      const empty = await adminA().post('/api/cash/days/2026-11-12/z');
      expect(empty.status).toBe(409);
      expect(empty.body).toMatchObject({ code: 'day_empty', message: DAY_EMPTY });
      expect((await adminA().post('/api/cash/days/2026-02-30/z')).status).toBe(422);
      expect(await zRows()).toEqual([]);
    });

    it('emits Z 1 for a closed day with the day snapshot, the taxes of the paid orders, order range, tips apart and voids', async () => {
      const day = (await adminA().get('/api/cash/days/2026-11-10')).body;
      expect(day.z).toBeNull();
      const res = await adminA().post('/api/cash/days/2026-11-10/z');
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(Z_KEYS);
      expect(res.body).toMatchObject({ number: 1, businessDay: '2026-11-10', emittedBy: ADMIN_A, emittedAt: expect.stringMatching(ISO) });
      const { snapshot } = res.body;
      expect(Object.keys(snapshot).sort()).toEqual(SNAPSHOT_KEYS);
      const { z: _z, ...daySummary } = day;
      expect(snapshot).toMatchObject(daySummary);
      // Default INC at the default rate 10; base and tax are the seeded orders' subtotal and tax (0).
      expect(snapshot.taxes).toEqual({ type: 'INC', name: 'Impuesto nacional al consumo', label: 'INC (10 %)', rate: 10, base: 145000, tax: 0 });
      expect(snapshot.taxes.base + snapshot.taxes.tax).toBe(snapshot.totals.salesNet);
      const paid = [c.o1, c.o2, c.o4, c.o5].map((id) => numbers[id]);
      expect(snapshot.orders).toEqual({ first: Math.min(...paid), last: Math.max(...paid) });
      expect(snapshot.discounts).toBe(0);
      expect(snapshot.tipsByMethod).toEqual([
        { code: 'cash', name: 'Efectivo', kind: 'cash', amount: 5000 },
        { code: 'transfer', name: 'Transferencia', kind: 'electronic', amount: 3000 },
        { code: 'nequi', name: 'Nequi', kind: 'electronic', amount: 4000 },
      ]);
      expect(snapshot.tipsByWaiter).toEqual(day.tipsByWaiter);
      expect(snapshot.totals).toMatchObject({ salesNet: 145000, tips: 12000 });
      expect(snapshot.voids).toMatchObject({ count: 2, amount: 35000 });

      const after = (await adminA().get('/api/cash/days/2026-11-10')).body;
      expect(after.z).toEqual({ number: 1, emittedAt: res.body.emittedAt, emittedBy: ADMIN_A });
      expect((await adminA().get('/api/cash/days/2026-11-03')).body.z).toBeNull();
    });

    it('is idempotent: a second emit of the same day returns the stored Z without a new number', async () => {
      const first = (await adminA().get('/api/cash/z/1')).body;
      const again = await adminA().post('/api/cash/days/2026-11-10/z');
      expect(again.status).toBe(200);
      expect(again.body).toEqual(first);
      expect(await zRows()).toEqual([{ restaurant_id: fixtures.restaurantA, number: 1, business_day: '2026-11-10' }]);
    });

    it('numbers the next day 2, and concurrent emits never share a number; the configured tax type is used', async () => {
      expect((await adminA().post('/api/cash/days/2026-11-03/z')).body).toMatchObject({ number: 2, businessDay: '2026-11-03' });
      await db(`INSERT INTO business_config (key, value, restaurant_id) VALUES ('tax_type', 'IVA', $1), ('tax_percentage', '19', $1)`, [
        fixtures.restaurantA,
      ]);
      try {
        const [a, b, again] = await Promise.all([
          adminA().post('/api/cash/days/2026-09-01/z'),
          adminA().post('/api/cash/days/2026-09-02/z'),
          adminA().post('/api/cash/days/2026-09-02/z'),
        ]);
        expect([a.status, b.status, again.status]).toEqual([200, 200, 200]);
        expect([a.body.number, b.body.number].sort()).toEqual([3, 4]);
        expect(again.body.number).toBe(b.body.number);
        expect(a.body.snapshot.taxes).toEqual({ type: 'IVA', name: 'IVA', label: 'IVA (19 %)', rate: 19, base: 0, tax: 0 });
        expect(a.body.snapshot.orders).toEqual({ first: null, last: null });
      } finally {
        await db(`DELETE FROM business_config WHERE key IN ('tax_type', 'tax_percentage') AND restaurant_id = $1`, [fixtures.restaurantA]);
      }
      expect((await zRows()).map((row) => row.number)).toEqual([1, 2, 3, 4]);
    });

    it('lists the Zs of a range by number with sales and difference, and flags gaps in the numbering', async () => {
      const res = await adminA().get('/api/cash/z?from=2026-09-01&to=2026-11-30');
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['from', 'gaps', 'items', 'to']);
      expect(res.body.items.map((z: { number: number; businessDay: string }) => [z.number, z.businessDay])).toEqual([
        [1, '2026-11-10'], [2, '2026-11-03'], [3, expect.any(String)], [4, expect.any(String)],
      ]);
      expect(Object.keys(res.body.items[0]).sort()).toEqual(['businessDay', 'difference', 'emittedAt', 'emittedBy', 'number', 'salesNet']);
      expect(res.body.items[0]).toMatchObject({ salesNet: 145000, difference: -2000, emittedBy: ADMIN_A });
      expect(res.body.gaps).toEqual([]);
      expect((await adminA().get('/api/cash/z?from=2026-11-01&to=2026-11-30')).body.items.map((z: { number: number }) => z.number)).toEqual([1, 2]);

      await db(`DELETE FROM z_reports WHERE restaurant_id = $1 AND number = 3`, [fixtures.restaurantA]);
      const gap = (await adminA().get('/api/cash/z?from=2026-09-01&to=2026-11-30')).body;
      expect(gap.items.map((z: { number: number }) => z.number)).toEqual([1, 2, 4]);
      expect(gap.gaps).toEqual([3]);

      for (const query of ['from=2026-11-01', 'from=x&to=2026-11-30', 'from=2026-11-30&to=2026-11-01']) {
        expect((await adminA().get(`/api/cash/z?${query}`)).status).toBe(422);
      }
    });

    it('serves one Z by number (404 unknown, 422 not a number)', async () => {
      const res = await adminA().get('/api/cash/z/2');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ number: 2, businessDay: '2026-11-03', snapshot: { date: '2026-11-03', totals: { salesNet: 10000 } } });
      expect((await adminA().get('/api/cash/z/99')).status).toBe(404);
      expect((await adminA().get('/api/cash/z/abc')).status).toBe(422);
    });

    it("numbers per restaurant and never shows another restaurant's Zs", async () => {
      expect((await adminB().get('/api/cash/z/1')).status).toBe(404);
      expect((await adminB().get('/api/cash/z?from=2026-09-01&to=2026-11-30')).body).toMatchObject({ items: [], gaps: [] });
      expect((await adminB().get('/api/cash/days/2026-11-10')).body.z).toBeNull();
      const b = await adminB().post('/api/cash/days/2026-11-10/z');
      expect(b.body).toMatchObject({ number: 1, businessDay: '2026-11-10', snapshot: { totals: { salesNet: 3000 } } });
      expect((await adminA().get('/api/cash/z/1')).body.snapshot.totals.salesNet).toBe(145000);
      expect((await adminA().get('/api/cash/z?from=2026-09-01&to=2026-11-30')).body.items).toHaveLength(3);
    });
  });

  describe('informe Z taxes from the paid orders (S8, S9)', () => {
    // One closed register per August day, with one paid order shaped as pay_order leaves it:
    // amount_due = subtotal (gross - discounts) + tax (on the subtotal) + delivery fee (untaxed).
    const paidDay = async (day: string, n: number, order: { type: string; subtotal: number; discounts: number; tax: number; due: number }) => {
      const register = `97000000-0000-0000-0000-00000000080${n}`;
      const orderId = `97000000-0000-0000-0000-00000000081${n}`;
      await db(
        `INSERT INTO cash_registers (id, opening_timestamp, closing_timestamp, initial_cash, final_cash, status, restaurant_id, opened_by, closed_by,
                                     counted_cash, cash_difference) VALUES ($1, $2::date + time '10:00', $2::date + time '20:00', 0, 0, 'closed', $3, $4, $4, 0, 0)`,
        [register, day, fixtures.restaurantA, c.cashierProfile],
      );
      await db(
        `INSERT INTO orders (id, status, subtotal, total_discounts, tax, tax_percentage, total, restaurant_id, order_type)
           VALUES ($1, 'paid', $2, $3, $4, 8, $5, $6, $7)`,
        [orderId, order.subtotal, order.discounts, order.tax, order.due, fixtures.restaurantA, order.type],
      );
      await db(
        `WITH pay AS (
           INSERT INTO payments (id, order_id, cash_register_id, cashier_profile_id, amount_due, tip_amount, total_charged, change_given,
                                 idempotency_key, created_at, restaurant_id)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, 0, $4, 0, gen_random_uuid(), $5::date + time '12:00', $6) RETURNING id)
         INSERT INTO payment_tenders (restaurant_id, payment_id, line_no, payment_method_id, method_code, method_kind, amount, cash_received)
           SELECT $6, pay.id, 1, m.id, m.code, m.kind, $4, $4 FROM pay JOIN payment_methods m ON m.restaurant_id = $6 AND m.code = 'cash'`,
        [orderId, register, c.cashierProfile, order.due, day, fixtures.restaurantA],
      );
      return (await adminA().post(`/api/cash/days/${day}/z`)).body;
    };

    it("takes base and tax from the order's subtotal and tax: a delivery fee is not taxed", async () => {
      // 20000 food + 1600 INC (8 %) + 5000 delivery fee.
      const z = await paidDay('2026-08-03', 1, { type: 'delivery', subtotal: 20000, discounts: 0, tax: 1600, due: 26600 });
      expect(z.snapshot.totals).toMatchObject({ salesNet: 26600, tickets: 1 });
      expect(z.snapshot.taxes).toEqual({ type: 'INC', name: 'Impuesto nacional al consumo', label: 'INC (10 %)', rate: 10, base: 20000, tax: 1600 });
    });

    it('reports a manual discount: salesNet is the amount due and the Z discounts the 2000', async () => {
      // 20000 gross - 2000 manual discount = 18000 + 1440 INC.
      const z = await paidDay('2026-08-04', 2, { type: 'dine_in', subtotal: 18000, discounts: 2000, tax: 1440, due: 19440 });
      expect(z.snapshot.totals.salesNet).toBe(19440);
      expect(z.snapshot.discounts).toBe(2000);
      expect(z.snapshot.taxes).toMatchObject({ base: 18000, tax: 1440 });
    });

    it('counts a 100 % courtesy closed with a 0 cash tender as a ticket with no sales and no tax', async () => {
      const z = await paidDay('2026-08-05', 3, { type: 'dine_in', subtotal: 0, discounts: 20000, tax: 0, due: 0 });
      expect(z.snapshot.totals).toMatchObject({ salesNet: 0, tickets: 1 });
      expect(byCode(z.snapshot.totals.methods).cash).toEqual([0, 1]);
      expect(z.snapshot.discounts).toBe(20000);
      expect(z.snapshot.taxes).toMatchObject({ base: 0, tax: 0 });
    });
  });
});

async function seedCash(superuserUrl: string) {
  const A = fixtures.restaurantA;
  const B = fixtures.restaurantB;
  const q = (text: string, values: unknown[] = []) => superuserQuery(superuserUrl, text, values);
  await q(
    `INSERT INTO users (id, email, password_hash, password_algo)
       SELECT u.id, u.email, a.password_hash, a.password_algo
         FROM (VALUES ($1::uuid, $2::text), ($3::uuid, $4::text), ($5::uuid, 'waiter2@cash.test')) u(id, email),
              users a WHERE a.email = $6`,
    [c.cashierUser, c.cashierEmail, c.cashier2User, c.cashier2Email, c.waiter2User, fixtures.adminA.email],
  );
  await q(
    `INSERT INTO profiles (id, user_id, full_name, email, role, restaurant_id) VALUES
       ($1, $2, 'Cashier A', $3, 'cashier', $10), ($4, $5, 'Cajera Tarde', $6, 'cashier', $10), ($7, $8, 'Mesero Dos', $9, 'waiter', $10)`,
    [c.cashierProfile, c.cashierUser, c.cashierEmail, c.cashier2Profile, c.cashier2User, c.cashier2Email, c.waiter2Profile, c.waiter2User, 'waiter2@cash.test', A],
  );
  await q(`INSERT INTO zones (id, restaurant_id, name) VALUES ($1, $2, 'Salón')`, [c.zone, A]);
  await q(`INSERT INTO tables (id, number, restaurant_id, zone_id) VALUES ($1, 7, $4, $5), ($2, 8, $4, $5), ($3, 9, $4, $5)`, [
    c.table7, c.table8, c.table9, A, c.zone,
  ]);
  await q(
    `INSERT INTO cash_registers (id, opening_timestamp, closing_timestamp, initial_cash, final_cash, status, restaurant_id, opened_by, closed_by,
                                 counted_cash, cash_difference, close_note, validated_by, validated_at) VALUES
       ($1, '2026-11-03 10:00-05', '2026-11-03 20:00-05', 0, 10000, 'closed', $7, $8, $8, NULL, NULL, NULL, NULL, NULL),
       ($2, '2026-11-10 07:58-05', '2026-11-10 15:12-05', 200000, 252000, 'closed', $7, $8, $8, 250000, -2000, 'Faltante de prueba', NULL, NULL),
       ($3, '2026-11-10 15:15-05', '2026-11-10 23:04-05', 100000, 121000, 'closed', $7, $9, $9, 121000, 0, NULL, $10, '2026-11-11 08:00-05'),
       ($4, '2026-11-11 01:30-05', '2026-11-11 03:00-05', 0, 0, 'closed', $7, $8, $8, 0, 0, NULL, NULL, NULL),
       ($5, '2026-11-11 04:30-05', NULL, 0, NULL, 'open', $7, $10, NULL, NULL, NULL, NULL, NULL, NULL),
       ($6, '2026-10-15 10:00-05', '2026-10-15 20:00-05', 0, 7000, 'closed', $7, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
    [c.reg0, c.reg1, c.reg2, c.reg3, c.reg4, c.regOct, A, c.cashierProfile, c.cashier2Profile, fixtures.adminA.profileId],
  );
  await q(
    `INSERT INTO cash_registers (id, opening_timestamp, closing_timestamp, initial_cash, final_cash, status, restaurant_id)
       VALUES ($1, '2026-11-10 09:00-05', '2026-11-10 18:00-05', 0, 3000, 'closed', $2)`,
    [c.regB, B],
  );
  await q(
    `INSERT INTO orders (id, status, subtotal, tax, tax_percentage, total, restaurant_id, table_id, waiter_id, order_type) VALUES
       ($1, 'paid', 10000, 0, 0, 10000, $10, $11, $13, 'dine_in'),
       ($2, 'paid', 50000, 0, 0, 50000, $10, $11, $13, 'dine_in'),
       ($3, 'paid', 30000, 0, 0, 30000, $10, $12, $13, 'dine_in'),
       ($4, 'delivered', 20000, 0, 0, 20000, $10, NULL, NULL, 'delivery'),
       ($5, 'paid', 40000, 0, 0, 40000, $10, $11, $14, 'dine_in'),
       ($6, 'paid', 25000, 0, 0, 25000, $10, NULL, NULL, 'delivery'),
       ($7, 'cancelled', 15000, 0, 0, 15000, $10, $15, $14, 'dine_in'),
       ($8, 'paid', 7000, 0, 0, 7000, $10, NULL, NULL, 'dine_in'),
       ($9, 'paid', 3000, 0, 0, 3000, $16, NULL, NULL, 'dine_in')`,
    [c.o0, c.o1, c.o2, c.o3, c.o4, c.o5, c.o6, c.oOct, c.oB, A, c.table7, c.table8, fixtures.waiterA.profileId, c.waiter2Profile, c.table9, B],
  );
  // [payment, order, register, amount due, tip, change, paid at, voided at, cashier, restaurant, tenders [code, amount, received]]
  const payments: [string, string, string, number, number, number, string, string | null, string | null, string, [string, number, number | null][]][] = [
    [c.p0, c.o0, c.reg0, 10000, 0, 0, '2026-11-03 11:00-05', null, c.cashierProfile, A, [['cash', 10000, 10000]]],
    [c.pOct, c.oOct, c.regOct, 7000, 0, 0, '2026-10-15 11:00-05', null, null, A, [['transfer', 7000, null]]],
    [c.p1, c.o1, c.reg1, 50000, 5000, 5000, '2026-11-10 12:00-05', null, c.cashierProfile, A, [['cash', 55000, 60000]]],
    [c.p2, c.o2, c.reg1, 30000, 3000, 0, '2026-11-10 13:00-05', null, c.cashierProfile, A, [['transfer', 33000, null]]],
    [c.p3, c.o3, c.reg1, 20000, 0, 0, '2026-11-10 14:00-05', '2026-11-10 14:30-05', c.cashierProfile, A, [['cash', 20000, 20000]]],
    [c.p4, c.o4, c.reg2, 40000, 4000, 0, '2026-11-10 16:00-05', null, c.cashier2Profile, A, [['nequi', 44000, null]]],
    [c.p5, c.o5, c.reg2, 25000, 0, 5000, '2026-11-10 17:00-05', null, c.cashier2Profile, A, [['cash', 25000, 30000]]],
    [c.pB, c.oB, c.regB, 3000, 0, 0, '2026-11-10 10:00-05', null, null, B, [['cash', 3000, 3000]]],
  ];
  for (const [id, order, register, due, tip, change, at, voidedAt, cashier, restaurant, tenders] of payments) {
    await q(
      `WITH pay AS (
         INSERT INTO payments (id, order_id, cash_register_id, cashier_profile_id, amount_due, tip_amount, total_charged, change_given,
                               idempotency_key, created_at, voided_at, restaurant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $5::bigint + $6::bigint, $7, gen_random_uuid(), $8, $9, $10) RETURNING id)
       INSERT INTO payment_tenders (restaurant_id, payment_id, line_no, payment_method_id, method_code, method_kind, amount, cash_received)
         SELECT $10, pay.id, t.line_no, m.id, m.code, m.kind, t.amount, t.received
           FROM pay, jsonb_to_recordset($11::jsonb) AS t(line_no int, code text, amount bigint, received bigint)
           JOIN payment_methods m ON m.restaurant_id = $10 AND m.code = t.code`,
      [id, order, register, cashier, due, tip, change, at, voidedAt, restaurant,
        JSON.stringify(tenders.map(([code, amount, received], index) => ({ line_no: index + 1, code, amount, received })))],
    );
  }
  await q(
    `INSERT INTO cash_transactions (id, amount, type, reason, description, timestamp, cash_register_id, restaurant_id, created_by) VALUES
       ($1, 50000, 'deposit', 'change_fund', '', '2026-11-10 09:00-05', $3, $4, $5),
       ($2, 45000, 'withdrawal', 'supplier', 'Hielo', '2026-11-10 10:00-05', $3, $4, $5)`,
    [c.deposit, c.withdrawal, c.reg1, A, c.cashierProfile],
  );
  await q(
    `INSERT INTO audit_log (id, restaurant_id, event_type, order_id, payment_id, actor_profile_id, actor_name, authorized_by_profile_id,
                            authorized_by_name, authorization_id, reason_code, reason_text, amount, created_at) VALUES
       ($1, $3, 'payment_voided', $4, $5, $6, 'Cashier A', $7, 'Admin A', gen_random_uuid(), 'duplicate_charge', NULL, 20000, '2026-11-10 14:30-05'),
       ($2, $3, 'order_cancelled', $8, NULL, $9, 'Cajera Tarde', $7, 'Admin A', gen_random_uuid(), 'other', 'Cliente se fue', 15000, '2026-11-10 18:00-05')`,
    [c.auditVoid, c.auditCancel, A, c.o3, c.p3, c.cashierProfile, fixtures.adminA.profileId, c.o6, c.cashier2Profile],
  );
  await q(
    `INSERT INTO payment_voids (restaurant_id, payment_id, order_id, cash_register_id, audit_id, amount_due, tip_amount, total_charged,
                                change_given, methods, tenders, paid_at, reason_code, voided_by, voided_by_name, authorized_by,
                                authorized_by_name, authorization_id, voided_at)
       VALUES ($1, $2, $3, $4, $5, 20000, 0, 20000, 0, 'cash',
               (SELECT jsonb_build_array(jsonb_build_object('line_no', 1, 'payment_method_id', m.id, 'method_code', 'cash', 'method_kind', 'cash',
                                                            'amount', 20000, 'cash_received', 20000))
                  FROM payment_methods m WHERE m.restaurant_id = $1 AND m.code = 'cash'), '2026-11-10 14:00-05',
               'duplicate_charge', $6, 'Cashier A', $7, 'Admin A', gen_random_uuid(), '2026-11-10 14:30-05')`,
    [A, c.p3, c.o3, c.reg1, c.auditVoid, c.cashierProfile, fixtures.adminA.profileId],
  );
  await q(
    `INSERT INTO order_cancellations (restaurant_id, order_id, audit_id, previous_status, reason_code, reason_text, cancelled_by,
                                      cancelled_by_name, authorized_by, authorized_by_name, authorization_id, subtotal, tax, tip, total,
                                      items, sent_items, cancelled_at)
       VALUES ($1, $2, $3, 'kitchen', 'other', 'Cliente se fue', $4, 'Cajera Tarde', $5, 'Admin A', gen_random_uuid(), 15000, 0, 0, 15000,
               '[]', 0, '2026-11-10 18:00-05')`,
    [A, c.o6, c.auditCancel, c.cashier2Profile, fixtures.adminA.profileId],
  );
}
