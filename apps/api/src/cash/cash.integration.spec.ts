import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/**
 * T3 (S5, S6): the admin's business day summary.
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
} as const;

const DAY_KEYS = ['date', 'previous', 'registers', 'status', 'tipsByWaiter', 'totals', 'voids'];
const DAY_REGISTER_KEYS = [
  'cashDifference', 'closeNote', 'closedAt', 'closedBy', 'countedCash', 'deposits', 'expected', 'id', 'initialCash', 'methods',
  'openedAt', 'openedBy', 'salesNet', 'status', 'tickets', 'tips', 'tipsPayout', 'validatedAt', 'validatedBy', 'withdrawals',
];
const TOTALS_KEYS = [
  'avgTicket', 'counted', 'deliveries', 'deposits', 'difference', 'expected', 'methods', 'salesNet', 'tables', 'tickets', 'tips',
  'withdrawals',
];
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
    it('answers 401 without a session and 403 for cashier and waiter', async () => {
      const url = '/api/cash/days/2026-11-10';
      expect((await request(app.getHttpServer()).get(url)).status).toBe(401);
      expect((await cashierA().get(url)).status).toBe(403);
      expect((await waiterA().get(url)).status).toBe(403);
    });

    it('validates the date', async () => {
      for (const date of ['2026-02-30', '10-11-2026', 'today']) {
        expect((await adminA().get(`/api/cash/days/${date}`)).status).toBe(422);
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
