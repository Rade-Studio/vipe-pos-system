import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/**
 * H-014 / S2 (odd/tasks/qa-noviembre-2026.md T12): the invoice consecutive per
 * restaurant assigned by pay_order (0043), the DIAN data in /config, and the
 * warn-only range and validity notices on the payment.
 */
const A = fixtures.restaurantA;
const ids = {
  register: '43000000-0000-0000-0000-0000000000a1',
  dish: '43000000-0000-0000-0000-0000000000d1',
  customer: '43000000-0000-0000-0000-0000000000c1',
  address: '43000000-0000-0000-0000-0000000000c2',
} as const;
const order = (n: number) => `43000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const INVOICE_DEFAULTS = {
  invoicePrefix: 'POS',
  invoiceResolution: null,
  invoiceRangeFrom: 1,
  invoiceRangeTo: null,
  invoiceValidFrom: null,
  invoiceValidTo: null,
  taxRegime: null,
};

describe('invoice numbering and DIAN data (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};
  let cashMethod = '';
  let today = '';

  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) => superuserQuery<T>(database.superuserUrl, text, values);
  const as = (email: string) => ({
    get: (url: string) => request(app.getHttpServer()).get(url).set('Cookie', cookies[email]),
    post: (url: string, body?: object) => request(app.getHttpServer()).post(url).set('Cookie', cookies[email]).send(body),
    put: (url: string, body?: object) => request(app.getHttpServer()).put(url).set('Cookie', cookies[email]).send(body),
  });
  const admin = () => as(fixtures.adminA.email);
  const pay = (orderId: string, amount = 10000, idempotencyKey: string = crypto.randomUUID()) =>
    admin().post('/api/payments', {
      orderId,
      cashRegisterId: ids.register,
      tipAmount: 0,
      tenders: [{ paymentMethodId: cashMethod, amount, cashReceived: amount }],
      idempotencyKey,
    });
  const configRows = () =>
    db<{ key: string; value: string }>(`SELECT key, value FROM business_config WHERE restaurant_id = $1 AND key LIKE 'invoice%' ORDER BY key`, [A]);
  const addDay = (iso: string, days: number) => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  beforeAll(async () => {
    database = await startTestDatabase();
    await db(`INSERT INTO cash_registers (id, restaurant_id, opening_timestamp, initial_cash, status) VALUES ($1, $2, now(), 0, 'open')`, [ids.register, A]);
    await db(`INSERT INTO dishes (id, name, price, active, restaurant_id) VALUES ($1, 'Arepa', 5000, true, $2)`, [ids.dish, A]);
    await db(`INSERT INTO customers (id, phone, name, restaurant_id) VALUES ($1, '3101234567', 'Ana', $2)`, [ids.customer, A]);
    await db(`INSERT INTO customer_addresses (id, customer_id, address_line, is_default, restaurant_id) VALUES ($1, $2, 'Calle 1', true, $3)`, [
      ids.address, ids.customer, A,
    ]);
    for (let n = 1; n <= 12; n += 1) {
      await db(`INSERT INTO orders (id, status, subtotal, tax, tax_percentage, total, restaurant_id) VALUES ($1, 'delivered', 10000, 0, 0, 10000, $2)`, [order(n), A]);
      await db(`INSERT INTO order_items (order_id, name, price, quantity, status, restaurant_id) VALUES ($1, 'Arepa', 10000, 1, 'served', $2)`, [order(n), A]);
    }
    [{ id: cashMethod }] = await db<{ id: string }>(`SELECT id FROM payment_methods WHERE restaurant_id = $1 AND code = 'cash'`, [A]);
    [{ today }] = await db<{ today: string }>(`SELECT to_char((now() AT TIME ZONE timezone)::date, 'YYYY-MM-DD') AS today FROM restaurants WHERE id = $1`, [A]);
    app = await createTestApp(database.apiUrl);
    for (const email of [fixtures.adminA.email, fixtures.waiterA.email]) {
      const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD });
      cookies[email] = cookiePair(setCookies(res).vipe_access);
    }
  });

  afterAll(async () => {
    await app?.close();
    await database?.stop();
  });

  describe('configuration (Ajustes)', () => {
    it('GET /config carries the invoice keys with their defaults', async () => {
      const res = await as(fixtures.waiterA.email).get('/api/config');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject(INVOICE_DEFAULTS);
    });

    it('refuses a non-admin with 403 and stores nothing', async () => {
      const res = await as(fixtures.waiterA.email).put('/api/config', { invoicePrefix: 'FE' });
      expect(res.status).toBe(403);
      expect(await configRows()).toEqual([]);
    });

    it.each([
      [{ invoicePrefix: 'pos-1' }, 'invoicePrefix'],
      [{ invoicePrefix: '' }, 'invoicePrefix'],
      [{ invoiceRangeFrom: 0 }, 'invoiceRangeFrom'],
      [{ invoiceValidTo: '31/12/2026' }, 'invoiceValidTo'],
      [{ taxRegime: 'simplificado' }, 'taxRegime'],
    ])('refuses %j with 422 naming the field and stores nothing', async (body, field) => {
      const res = await admin().put('/api/config', body);
      expect(res.status).toBe(422);
      expect(JSON.stringify(res.body)).toContain(field);
      expect(await configRows()).toEqual([]);
    });

    it('refuses a range that ends before it starts, also against the stored start', async () => {
      const both = await admin().put('/api/config', { invoiceRangeFrom: 100, invoiceRangeTo: 50 });
      expect(both.status).toBe(422);
      expect(both.body.message).toBe('El número final del rango autorizado debe ser mayor o igual al inicial');
      expect(await configRows()).toEqual([]);
      expect((await admin().put('/api/config', { invoiceRangeFrom: 100 })).status).toBe(200);
      const after = await admin().put('/api/config', { invoiceRangeTo: 99 });
      expect(after.status).toBe(422);
      expect(await configRows()).toEqual([{ key: 'invoice_range_from', value: '100' }]);
      expect((await admin().put('/api/config', { invoiceRangeFrom: 1 })).status).toBe(200);
    });

    it('refuses a validity that ends before it starts', async () => {
      const res = await admin().put('/api/config', { invoiceValidFrom: '2026-06-01', invoiceValidTo: '2026-05-31' });
      expect(res.status).toBe(422);
      expect(res.body.message).toBe('La fecha final de la vigencia debe ser igual o posterior a la inicial');
    });

    it('stores the DIAN data for the admin and clears a value with null', async () => {
      const res = await admin().put('/api/config', {
        invoiceResolution: ' 18764000001234 ',
        invoiceRangeTo: 5000,
        invoiceValidFrom: '2026-01-01',
        invoiceValidTo: '2099-12-31',
        taxRegime: 'responsable_iva',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        ...INVOICE_DEFAULTS,
        invoiceResolution: '18764000001234',
        invoiceRangeTo: 5000,
        invoiceValidFrom: '2026-01-01',
        invoiceValidTo: '2099-12-31',
        taxRegime: 'responsable_iva',
      });
      const cleared = await admin().put('/api/config', { invoiceResolution: null, taxRegime: null });
      expect(cleared.body).toMatchObject({ invoiceResolution: null, taxRegime: null, invoiceRangeTo: 5000 });
      await admin().put('/api/config', { invoiceResolution: '18764000001234', taxRegime: 'responsable_iva' });
    });

    it('keeps the other keys working as before (taxType)', async () => {
      const res = await admin().put('/api/config', { taxType: 'IVA' });
      expect(res.status).toBe(200);
      expect(res.body.taxType).toBe('IVA');
    });
  });

  describe('assignment at the payment', () => {
    it('numbers the first payment POS-000001 with the fiscal snapshot and no warning', async () => {
      const res = await pay(order(1));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'paid',
        invoiceNumber: 'POS-000001',
        invoiceFiscal: {
          prefix: 'POS',
          resolution: '18764000001234',
          rangeFrom: 1,
          rangeTo: 5000,
          validFrom: '2026-01-01',
          validTo: '2099-12-31',
          taxRegime: 'responsable_iva',
        },
        invoiceWarnings: [],
      });
    });

    it('a replay returns the stored number', async () => {
      const key = crypto.randomUUID();
      const first = await pay(order(2), 10000, key);
      const again = await pay(order(2), 10000, key);
      expect(first.body.invoiceNumber).toBe('POS-000002');
      expect(again.body).toMatchObject({ status: 'already_paid', invoiceNumber: 'POS-000002' });
    });

    it('a refused payment uses no number', async () => {
      const bad = await pay(order(3), 9999);
      expect(bad.status).toBe(422);
      expect((await pay(order(3))).body.invoiceNumber).toBe('POS-000003');
    });

    it('concurrent payments get distinct consecutive numbers', async () => {
      const results = await Promise.all([4, 5, 6, 7, 8].map((n) => pay(order(n))));
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      expect(results.map((r) => r.body.invoiceNumber as string).sort()).toEqual([
        'POS-000004', 'POS-000005', 'POS-000006', 'POS-000007', 'POS-000008',
      ]);
    });

    it('GET /payments shows the stored number and snapshot for a reprint', async () => {
      const res = await admin().get(`/api/payments?orderIds=${order(1)}`);
      expect(res.status).toBe(200);
      expect(res.body[0]).toMatchObject({ invoiceNumber: 'POS-000001', invoiceFiscal: { resolution: '18764000001234' } });
    });

    it('a delivery payment is numbered too', async () => {
      const created = await admin().post('/api/delivery/orders', {
        customer: { id: ids.customer },
        address: { id: ids.address },
        items: [{ dishId: ids.dish, quantity: 1 }],
        deliveryFee: 2000,
        paymentMode: 'prepaid',
      });
      expect(created.status).toBe(201);
      const res = await pay(created.body.orderId as string, 7000);
      expect(res.status).toBe(200);
      expect(res.body.invoiceNumber).toBe('POS-000009');
    });

    it('warns without blocking when the range is ending or the resolution expires soon', async () => {
      expect((await admin().put('/api/config', { invoiceRangeTo: 15, invoiceValidTo: addDay(today, 10) })).status).toBe(200);
      const res = await pay(order(9));
      expect(res.status).toBe(200);
      expect(res.body.invoiceNumber).toBe('POS-000010');
      expect(res.body.invoiceWarnings).toEqual(['range_ending', 'resolution_expiring']);
    });

    it('warns without blocking when the range is exceeded or the resolution expired', async () => {
      expect((await admin().put('/api/config', { invoiceRangeTo: 10, invoiceValidTo: addDay(today, -1), invoiceValidFrom: '2026-01-01' })).status).toBe(200);
      const res = await pay(order(10));
      expect(res.status).toBe(200);
      expect(res.body.invoiceNumber).toBe('POS-000011');
      expect(res.body.invoiceWarnings).toEqual(['range_exceeded', 'resolution_expired']);
    });

    it('a new prefix and range start apply to the next payment', async () => {
      expect((await admin().put('/api/config', { invoicePrefix: 'FE', invoiceRangeFrom: 1000, invoiceRangeTo: 2000, invoiceValidTo: '2099-12-31' })).status).toBe(200);
      const res = await pay(order(11));
      expect(res.body).toMatchObject({ invoiceNumber: 'FE-001000', invoiceWarnings: [] });
    });
  });
});
