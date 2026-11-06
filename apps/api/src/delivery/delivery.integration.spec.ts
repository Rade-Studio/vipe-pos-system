import type { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Clock } from '../common/clock';
import { createOpenApiDocument } from '../configure-app';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, superuserQuery, type TestDatabase } from '../testing/test-database';

/** Rows seeded as the superuser for this spec only. */
const d = {
  operatorUser: '10000000-0000-0000-0000-0000000000d1',
  operatorProfile: '20000000-0000-0000-0000-0000000000d1',
  operatorEmail: 'delivery@a.test',
  kitchenUser: '10000000-0000-0000-0000-0000000000d2',
  kitchenProfile: '20000000-0000-0000-0000-0000000000d2',
  kitchenEmail: 'kitchen@a.test',
  arepa: 'db000000-0000-0000-0000-000000000001',
  jugo: 'db000000-0000-0000-0000-000000000002',
  otherDish: 'db000000-0000-0000-0000-0000000000b1',
  ana: 'cb000000-0000-0000-0000-000000000001',
  anaHome: 'ab000000-0000-0000-0000-000000000001',
  anaWork: 'ab000000-0000-0000-0000-000000000002',
  other: 'cb000000-0000-0000-0000-000000000002',
  otherHome: 'ab000000-0000-0000-0000-000000000003',
  anaInB: 'cb000000-0000-0000-0000-0000000000b1',
  pedro: 'eb000000-0000-0000-0000-000000000001',
  retiredCourier: 'eb000000-0000-0000-0000-000000000002',
  courierB: 'eb000000-0000-0000-0000-0000000000b1',
  flour: '9b000000-0000-0000-0000-000000000001',
} as const;

const ANA_PHONE = '3101234567';
const DELIVERY_KEYS = [
  'addressLine', 'addressReference', 'cancelledAt', 'cashChangeFor', 'courierEta', 'courierId', 'courierLocation', 'createdAt',
  'customerId', 'customerName', 'customerPhone', 'deliveredAt', 'deliveryFee', 'dispatchedAt', 'failedAt', 'failureReason',
  'neighborhood', 'notes', 'orderId', 'paymentMode', 'prepaidMethod', 'returnedAt', 'status', 'updatedAt',
];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

async function eventually(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('delivery endpoints (Testcontainers, vipe_api)', () => {
  let database: TestDatabase;
  let app: INestApplication;
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    database = await startTestDatabase();
    await seedDelivery(database.superuserUrl);
    app = await createTestApp(database.apiUrl);
    const emails = [
      fixtures.adminA.email, fixtures.waiterA.email, fixtures.adminB.email, fixtures.bcryptUser.email, d.operatorEmail, d.kitchenEmail,
    ];
    for (const email of emails) {
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
      put: (url: string, body?: object) => server.put(url).set('Cookie', cookie).send(body),
    };
  };
  const adminA = () => as(fixtures.adminA.email);
  const waiterA = () => as(fixtures.waiterA.email);
  const cashierA = () => as(fixtures.bcryptUser.email);
  const adminB = () => as(fixtures.adminB.email);
  const operatorA = () => as(d.operatorEmail);
  const kitchenA = () => as(d.kitchenEmail);
  const db = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    superuserQuery<T>(database.superuserUrl, text, values);
  const count = async (text: string, values: unknown[] = []) =>
    Number((await db<{ n: string }>(`SELECT count(*)::text AS n FROM ${text}`, values))[0].n);
  const snapshot = async () => ({
    orders: await count(`orders WHERE order_type = 'delivery'`),
    deliveries: await count('order_deliveries'),
    customers: await count('customers'),
    addresses: await count('customer_addresses'),
    jobs: await count('print_jobs'),
    movements: await count('inventory_movements'),
  });
  const setInventoryControl = (enabled: boolean) =>
    db(
      `INSERT INTO business_config (restaurant_id, key, value) VALUES ($1, 'inventory_control_enabled', $2)
       ON CONFLICT (restaurant_id, key) DO UPDATE SET value = excluded.value`,
      [fixtures.restaurantA, String(enabled)],
    );
  const order = (extra: object = {}) => ({
    customer: { id: d.ana },
    address: { id: d.anaHome },
    items: [
      { dishId: d.jugo, quantity: 2, comments: ' sin hielo ' },
      { dishId: d.arepa, quantity: 1 },
    ],
    deliveryFee: 4000,
    paymentMode: 'cash_on_delivery',
    cashChangeFor: 50000,
    notes: 'Portería',
    ...extra,
  });
  const create = (extra: object = {}) => operatorA().post('/api/delivery/orders', order(extra));
  const deliveryStatus = async (orderId: string) =>
    (await db<{ delivery_status: string }>('SELECT delivery_status FROM order_deliveries WHERE order_id = $1', [orderId]))[0]
      ?.delivery_status;
  /** Move a delivery through the RPC as the operator. */
  const act = (orderId: string, action: string, extra: object = {}) =>
    operatorA().post(`/api/delivery/orders/${orderId}/status`, { action, ...extra });

  it('answers 401 without the access cookie', async () => {
    expect((await request(app.getHttpServer()).get('/api/delivery/active')).status).toBe(401);
  });

  describe('GET /delivery/customers', () => {
    it('normalises the phone like the web (+57 mobile prefix and formatting dropped) and returns the addresses, default first', async () => {
      const res = await operatorA().get('/api/delivery/customers').query({ phone: '+57 310-123 4567' });
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['addresses', 'customer', 'history']);
      expect(res.body.customer).toEqual({
        id: d.ana,
        phone: ANA_PHONE,
        name: 'Ana',
        notes: null,
        createdAt: expect.stringMatching(ISO),
        updatedAt: expect.stringMatching(ISO),
      });
      expect(res.body.addresses.map((a: { id: string; isDefault: boolean }) => [a.id, a.isDefault])).toEqual([
        [d.anaHome, true],
        [d.anaWork, false],
      ]);
      expect(res.body.addresses[0]).toEqual({
        id: d.anaHome,
        customerId: d.ana,
        label: 'Casa',
        addressLine: 'Calle 1 # 2-3',
        neighborhood: 'Centro',
        reference: null,
        isDefault: true,
        createdAt: expect.stringMatching(ISO),
        updatedAt: expect.stringMatching(ISO),
      });
    });

    it('answers 404 for an unknown phone and for a phone known only in another restaurant', async () => {
      const unknown = await operatorA().get('/api/delivery/customers').query({ phone: '3009999999' });
      expect(unknown.status).toBe(404);
      expect(unknown.body).toEqual({ statusCode: 404, error: 'Not Found', message: 'Customer not found' });
      const inB = await operatorA().get('/api/delivery/customers').query({ phone: '3207654321' });
      expect(inB.status).toBe(404);
    });

    it('answers 422 for a phone that is not 7..15 digits, and when phone is missing', async () => {
      const res = await operatorA().get('/api/delivery/customers').query({ phone: '12-34' });
      expect(res.status).toBe(422);
      expect(res.body).toEqual({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'phone: Phone must have 7 to 15 digits',
      });
      expect((await operatorA().get('/api/delivery/customers')).status).toBe(422);
    });

    it('is forbidden to waiter and kitchen', async () => {
      expect((await waiterA().get('/api/delivery/customers').query({ phone: ANA_PHONE })).status).toBe(403);
      expect((await kitchenA().get('/api/delivery/customers').query({ phone: ANA_PHONE })).status).toBe(403);
    });
  });

  describe('couriers', () => {
    it('lists by name, every row or only the active ones; tenant scoped', async () => {
      const all = await operatorA().get('/api/delivery/couriers');
      expect(all.status).toBe(200);
      expect(all.body.map((c: { id: string }) => c.id)).toEqual([d.pedro, d.retiredCourier]);
      expect(all.body[0]).toEqual({
        id: d.pedro,
        name: 'Pedro',
        phone: '3001112233',
        isActive: true,
        createdAt: expect.stringMatching(ISO),
        updatedAt: expect.stringMatching(ISO),
      });
      const active = await cashierA().get('/api/delivery/couriers').query({ activeOnly: 'true' });
      expect(active.body.map((c: { id: string }) => c.id)).toEqual([d.pedro]);
      const inB = await adminB().get('/api/delivery/couriers');
      expect(inB.body.map((c: { id: string }) => c.id)).toEqual([d.courierB]);
      expect((await operatorA().get('/api/delivery/couriers').query({ activeOnly: 'yes' })).status).toBe(422);
    });

    it('admin creates a courier with the name trimmed and the phone normalised; a blank phone is null', async () => {
      const res = await adminA().post('/api/delivery/couriers', { name: '  Rosa  ', phone: '+57 315 000 1122' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: 'Rosa', phone: '3150001122', isActive: true });
      const blank = await adminA().post('/api/delivery/couriers', { name: 'Luis', phone: '  ' });
      expect(blank.body).toMatchObject({ name: 'Luis', phone: null });
      const [row] = await db<{ restaurant_id: string }>('SELECT restaurant_id FROM couriers WHERE id = $1', [res.body.id]);
      expect(row.restaurant_id).toBe(fixtures.restaurantA);
    });

    it('refuses invalid couriers with 422 and roles other than admin and delivery_operator with 403, writing nothing', async () => {
      const before = await count('couriers');
      const badPhone = await adminA().post('/api/delivery/couriers', { name: 'X', phone: '123' });
      expect(badPhone.status).toBe(422);
      expect(badPhone.body.message).toBe('phone: Phone must have 7 to 15 digits');
      expect((await adminA().post('/api/delivery/couriers', { name: '   ' })).status).toBe(422);
      expect((await adminA().post('/api/delivery/couriers', { name: 'X', extra: 1 })).status).toBe(422);
      for (const caller of [waiterA(), cashierA(), kitchenA()]) {
        expect((await caller.post('/api/delivery/couriers', { name: 'Op' })).status).toBe(403);
      }
      expect(await count('couriers')).toBe(before);
    });

    it('admin patches name, phone and isActive; an empty phone clears it; unknown or other-tenant id is 404', async () => {
      const created = await adminA().post('/api/delivery/couriers', { name: 'Temporal', phone: '3001110000' });
      const res = await adminA().patch(`/api/delivery/couriers/${created.body.id}`, { name: ' Fijo ', phone: '', isActive: false });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: created.body.id, name: 'Fijo', phone: null, isActive: false });
      expect((await adminA().patch(`/api/delivery/couriers/${created.body.id}`, {})).status).toBe(422);
      expect((await adminA().patch(`/api/delivery/couriers/${d.courierB}`, { isActive: false })).status).toBe(404);
      for (const caller of [waiterA(), cashierA(), kitchenA()]) {
        expect((await caller.patch(`/api/delivery/couriers/${d.pedro}`, { isActive: false })).status).toBe(403);
      }
      const [pedro] = await db<{ is_active: boolean }>('SELECT is_active FROM couriers WHERE id = $1', [d.pedro]);
      expect(pedro.is_active).toBe(true);
    });
  });

  describe('POST /delivery/orders', () => {
    it('creates order, delivery snapshot and kitchen command in one transaction and reports the stock consumption', async () => {
      const res = await create();
      expect(res.status).toBe(201);
      expect(Object.keys(res.body).sort()).toEqual(['addressId', 'consumption', 'customerId', 'delivery', 'orderId', 'printJob']);
      const { orderId } = res.body;
      expect(res.body.customerId).toBe(d.ana);
      expect(res.body.addressId).toBe(d.anaHome);
      expect(Object.keys(res.body.delivery).sort()).toEqual(DELIVERY_KEYS);
      expect(res.body.delivery).toMatchObject({
        orderId,
        customerId: d.ana,
        customerName: 'Ana',
        customerPhone: ANA_PHONE,
        addressLine: 'Calle 1 # 2-3',
        neighborhood: 'Centro',
        addressReference: null,
        deliveryFee: 4000,
        paymentMode: 'cash_on_delivery',
        cashChangeFor: 50000,
        courierId: null,
        prepaidMethod: null,
        courierEta: null,
        courierLocation: null,
        returnedAt: null,
        status: 'received',
        notes: 'Portería',
        createdAt: expect.stringMatching(ISO),
      });
      expect(res.body.consumption).toEqual({ orderId, enabled: false, consumedItems: 0, totalCost: 0, shortages: [] });
      expect(res.body.printJob).toEqual({ id: expect.any(String), kind: 'command', createdAt: expect.stringMatching(ISO) });

      const [orderRow] = await db<{ order_type: string; status: string; subtotal: string; tax: string; waiter_id: string }>(
        'SELECT order_type, status, subtotal::text, tax::text, waiter_id FROM orders WHERE id = $1',
        [orderId],
      );
      expect(orderRow).toEqual({ order_type: 'delivery', status: 'kitchen', subtotal: '11000.00', tax: '0.00', waiter_id: d.operatorProfile });
      const [job] = await db<{ kind: string; payload: Record<string, unknown>; restaurant_id: string }>(
        'SELECT kind, payload, restaurant_id FROM print_jobs WHERE id = $1',
        [res.body.printJob.id],
      );
      // The CommandPayload DeliveryOrderForm built (buildDeliveryKitchenCommand), with the job id as invoiceNumber.
      expect(job).toEqual({
        kind: 'command',
        restaurant_id: fixtures.restaurantA,
        payload: {
          invoiceNumber: res.body.printJob.id,
          waiter: 'Delivery A',
          table: null,
          items: [
            { name: 'Jugo', quantity: 2, comments: 'sin hielo' },
            { name: 'Arepa', quantity: 1 },
          ],
          delivery: {
            customerName: 'Ana',
            phone: ANA_PHONE,
            address: 'Calle 1 # 2-3, Centro',
            paymentMode: 'cash_on_delivery',
            deliveryFee: 4000,
            notes: 'Portería',
            cashChangeFor: 50000,
          },
        },
      });
    });

    it('maps a new customer {phone, name} and a new address with save to the RPC; addressId is the saved row', async () => {
      const res = await create({
        customer: { phone: '3112223344', name: '  Bea  ' },
        address: { addressLine: 'Carrera 9 # 8-7', neighborhood: 'Norte', reference: 'Torre 2', label: 'Oficina', save: true },
        paymentMode: 'prepaid',
        cashChangeFor: null,
        notes: null,
      });
      expect(res.status).toBe(201);
      const [customer] = await db<{ id: string; name: string; restaurant_id: string }>(
        `SELECT id, name, restaurant_id FROM customers WHERE phone = '3112223344'`,
      );
      expect(customer).toEqual({ id: res.body.customerId, name: 'Bea', restaurant_id: fixtures.restaurantA });
      const [address] = await db('SELECT id, customer_id, label, address_line, neighborhood, reference, is_default FROM customer_addresses WHERE customer_id = $1', [customer.id]);
      expect(address).toEqual({
        id: res.body.addressId,
        customer_id: customer.id,
        label: 'Oficina',
        address_line: 'Carrera 9 # 8-7',
        neighborhood: 'Norte',
        reference: 'Torre 2',
        is_default: false,
      });
      expect(res.body.delivery).toMatchObject({ paymentMode: 'prepaid', cashChangeFor: null, notes: null, addressReference: 'Torre 2' });
      const [job] = await db<{ payload: { delivery: Record<string, unknown> } }>('SELECT payload FROM print_jobs WHERE id = $1', [res.body.printJob.id]);
      expect(job.payload.delivery).toEqual({
        customerName: 'Bea',
        phone: '3112223344',
        address: 'Carrera 9 # 8-7, Norte (Torre 2)',
        paymentMode: 'prepaid',
        deliveryFee: 4000,
      });
    });

    it('an existing phone with a different name renames the customer; a new address without save is not stored', async () => {
      const before = await count('customer_addresses');
      const res = await create({ customer: { phone: '3005556677', name: 'Carlos R.' }, address: { addressLine: 'Calle 50' } });
      expect(res.status).toBe(201);
      expect(res.body.customerId).toBe(d.other);
      expect(res.body.addressId).toBeNull();
      expect(res.body.delivery).toMatchObject({ customerName: 'Carlos R.', addressLine: 'Calle 50' });
      expect(await count('customer_addresses')).toBe(before);
      const [row] = await db<{ name: string }>('SELECT name FROM customers WHERE id = $1', [d.other]);
      expect(row.name).toBe('Carlos R.');
    });

    it('refuses cashChangeFor on a prepaid order with 422 (the web dropped it client-side) and writes nothing', async () => {
      const before = await snapshot();
      const res = await create({ paymentMode: 'prepaid', cashChangeFor: 1000 });
      expect(res.status).toBe(422);
      expect(res.body.message).toBe('cashChangeFor: Must be null when paymentMode is prepaid');
      expect((await create({ unknown: true })).status).toBe(422);
      expect(await snapshot()).toEqual(before);
    });

    const rpcErrors: [string, object, number, string, string][] = [
      ['customer with id and phone', { customer: { id: d.ana, phone: ANA_PHONE } }, 422, '22023',
        'create_delivery_order: p_customer must carry either id or phone, not both'],
      ['customer with neither id nor phone', { customer: { name: 'Nadie' } }, 422, '22023',
        'create_delivery_order: p_customer must carry id or phone'],
      ['bad customer phone', { customer: { phone: '12' } }, 422, '22023',
        'create_delivery_order: p_customer.phone must match 7..15 digits'],
      ['new customer without name', { customer: { phone: '3990000000' } }, 422, '22023',
        'create_delivery_order: p_customer.name is required when creating a new customer (1..120 chars)'],
      ['unknown customer id', { customer: { id: d.anaInB } }, 404, 'P0002', 'Not found'],
      ['address id and line', { address: { id: d.anaHome, addressLine: 'x' } }, 422, '22023',
        'create_delivery_order: p_address must carry either id or address_line, not both'],
      ['address of another customer', { address: { id: d.otherHome } }, 404, 'P0002', 'Not found'],
      ['blank address line', { address: { addressLine: '  ' } }, 422, '22023',
        'create_delivery_order: p_address.address_line is required (1..200 chars)'],
      ['long label', { address: { addressLine: 'Calle 1', label: 'x'.repeat(41) } }, 422, '22023',
        'create_delivery_order: p_address.label must be <= 40 chars'],
      ['no items', { items: [] }, 422, '22023', 'create_delivery_order: p_items must be a non-empty array'],
      ['quantity 0', { items: [{ dishId: d.jugo, quantity: 0 }] }, 422, '22023',
        'create_delivery_order: item[1].quantity must be between 1 and 999'],
      ['dish of another restaurant', { items: [{ dishId: d.otherDish, quantity: 1 }] }, 404, 'P0002', 'Not found'],
      ['negative fee', { deliveryFee: -1 }, 422, '22023', 'create_delivery_order: p_delivery_fee must be a non-negative integer'],
      ['negative change', { cashChangeFor: -5 }, 422, '22023',
        'create_delivery_order: p_cash_change_for must be a non-negative integer (or NULL)'],
      ['long notes', { notes: 'n'.repeat(301) }, 422, '22023', 'create_delivery_order: p_notes accepts at most 300 characters'],
      ['customer id not a uuid', { customer: { id: 'nope' } }, 422, '22023', 'create_delivery_order: p_customer.id is not a uuid'],
      ['unknown address id', { address: { id: 'ab000000-0000-0000-0000-0000000000ff' } }, 404, 'P0002', 'Not found'],
      ['101 lines', { items: Array.from({ length: 101 }, () => ({ dishId: d.jugo, quantity: 1 })) }, 422, '22023',
        'create_delivery_order: p_items accepts at most 100 lines'],
      ['long neighborhood', { address: { addressLine: 'Calle 1', neighborhood: 'n'.repeat(81) } }, 422, '22023',
        'create_delivery_order: p_address.neighborhood must be <= 80 chars'],
      ['long reference', { address: { addressLine: 'Calle 1', reference: 'r'.repeat(201) } }, 422, '22023',
        'create_delivery_order: p_address.reference must be <= 200 chars'],
    ];
    it.each(rpcErrors)('%s surfaces the RPC SQLSTATE and message, and writes nothing', async (_name, extra, status, code, message) => {
      const before = await snapshot();
      const res = await create(extra);
      expect(res.status).toBe(status);
      expect(res.body).toMatchObject({ statusCode: status, message, code });
      expect(await snapshot()).toEqual(before);
    });

    it('a waiter, a cashier and the kitchen are refused by the RPC (42501), an admin may create', async () => {
      const before = await snapshot();
      for (const caller of [waiterA(), cashierA(), kitchenA()]) {
        const res = await caller.post('/api/delivery/orders', order());
        expect(res.status).toBe(403);
        expect(res.body).toEqual({ statusCode: 403, error: 'Forbidden', message: 'Permission denied', code: '42501' });
      }
      expect(await snapshot()).toEqual(before);
      const res = await adminA().post('/api/delivery/orders', order());
      expect(res.status).toBe(201);
      const [job] = await db<{ payload: { waiter: string } }>('SELECT payload FROM print_jobs WHERE id = $1', [res.body.printJob.id]);
      expect(job.payload.waiter).toBe('Admin A');
    });

    it('a stock shortage keeps the order and is reported in consumption.shortages', async () => {
      await setInventoryControl(true);
      try {
        const res = await create({ items: [{ dishId: d.arepa, quantity: 2 }] });
        expect(res.status).toBe(201);
        expect(res.body.consumption).toEqual({
          orderId: res.body.orderId,
          enabled: true,
          consumedItems: 1,
          totalCost: 0,
          shortages: [{ itemId: d.flour, name: 'Harina', unit: 'g', missing: 50 }],
        });
        expect(await deliveryStatus(res.body.orderId)).toBe('received');
        const [item] = await db<{ stamped: boolean }>(
          'SELECT stock_consumed_at IS NOT NULL AS stamped FROM order_items WHERE order_id = $1',
          [res.body.orderId],
        );
        expect(item.stamped).toBe(true);
      } finally {
        await setInventoryControl(false);
      }
    });

    it('a failing print enqueue rolls back the order, the delivery, the new customer and the stock', async () => {
      await setInventoryControl(true);
      await db(`CREATE FUNCTION public.t11_fail_print() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'printer queue down' USING ERRCODE = 'XX000'; END $$`);
      await db('CREATE TRIGGER t11_fail_print BEFORE INSERT ON public.print_jobs FOR EACH ROW EXECUTE FUNCTION public.t11_fail_print()');
      try {
        const before = await snapshot();
        const res = await create({ customer: { phone: '3887776655', name: 'Rollback' }, address: { addressLine: 'Calle 9', save: true } });
        expect(res.status).toBe(500);
        expect(res.body).toEqual({ statusCode: 500, error: 'Internal Server Error', message: 'Internal server error' });
        expect(await snapshot()).toEqual(before);
      } finally {
        await db('DROP TRIGGER t11_fail_print ON public.print_jobs');
        await db('DROP FUNCTION public.t11_fail_print()');
        await setInventoryControl(false);
      }
    });
  });

  describe('POST /delivery/orders/:id/status', () => {
    it('walks the lifecycle and returns the delivery row in camelCase', async () => {
      const { orderId } = (await create()).body;
      const preparing = await kitchenA().post(`/api/delivery/orders/${orderId}/status`, { action: 'start_preparing' });
      expect(preparing.status).toBe(200);
      expect(Object.keys(preparing.body).sort()).toEqual(DELIVERY_KEYS);
      expect(preparing.body).toMatchObject({ orderId, status: 'preparing' });
      expect((await kitchenA().post(`/api/delivery/orders/${orderId}/status`, { action: 'mark_ready' })).body.status).toBe('ready');
      const dispatched = await act(orderId, 'dispatch', { courierId: d.pedro });
      expect(dispatched.body).toMatchObject({ status: 'out_for_delivery', courierId: d.pedro, dispatchedAt: expect.stringMatching(ISO) });
      const failed = await act(orderId, 'fail', { reason: '  No contesta ' });
      expect(failed.body).toMatchObject({ status: 'failed', failureReason: 'No contesta', failedAt: expect.stringMatching(ISO) });
      expect((await act(orderId, 'dispatch', { courierId: d.pedro })).body).toMatchObject({ status: 'out_for_delivery', failureReason: null });
      const delivered = await adminA().post(`/api/delivery/orders/${orderId}/status`, { action: 'deliver' });
      expect(delivered.body).toMatchObject({ status: 'delivered', deliveredAt: expect.stringMatching(ISO) });
    });

    it('cancel moves the delivery and the order to cancelled', async () => {
      const { orderId } = (await create()).body;
      const res = await act(orderId, 'cancel');
      expect(res.body).toMatchObject({ status: 'cancelled', cancelledAt: expect.stringMatching(ISO) });
      const [row] = await db<{ status: string }>('SELECT status FROM orders WHERE id = $1', [orderId]);
      expect(row.status).toBe('cancelled');
    });

    it('surfaces every set_delivery_status error with its SQLSTATE and message, changing nothing', async () => {
      const { orderId } = (await create()).body;
      const cases: [object, number, string, string][] = [
        [{ action: 'fly' }, 422, '22023', "set_delivery_status: unknown action 'fly'"],
        [{ action: 'deliver' }, 422, 'P0001',
          `set_delivery_status: action 'deliver' is not allowed from state 'received' (allowed: out_for_delivery)`],
        [{ action: 'dispatch' }, 422, 'P0001',
          `set_delivery_status: action 'dispatch' is not allowed from state 'received' (allowed: ready, failed)`],
      ];
      for (const [body, status, code, message] of cases) {
        const res = await operatorA().post(`/api/delivery/orders/${orderId}/status`, body);
        expect(res.status).toBe(status);
        expect(res.body).toEqual({ statusCode: status, error: 'Unprocessable Entity', message, code });
      }
      await act(orderId, 'mark_ready');
      const again = await act(orderId, 'mark_ready');
      expect(again.body).toMatchObject({
        statusCode: 422,
        code: 'P0001',
        message: `set_delivery_status: delivery for order ${orderId} is already in state 'ready'`,
      });
      const noCourier = await act(orderId, 'dispatch');
      expect(noCourier.body).toMatchObject({ code: '22023', message: 'set_delivery_status: dispatch requires p_courier_id' });
      const inactive = await act(orderId, 'dispatch', { courierId: d.retiredCourier });
      expect(inactive.status).toBe(422);
      expect(inactive.body).toMatchObject({ code: '22023', message: `set_delivery_status: courier ${d.retiredCourier} is not active` });
      const otherTenant = await act(orderId, 'dispatch', { courierId: d.courierB });
      expect(otherTenant.status).toBe(404);
      expect(otherTenant.body).toEqual({ statusCode: 404, error: 'Not Found', message: 'Not found', code: 'P0002' });
      await act(orderId, 'dispatch', { courierId: d.pedro });
      const noReason = await act(orderId, 'fail', { reason: '   ' });
      expect(noReason.body).toMatchObject({ code: '22023', message: 'set_delivery_status: fail requires a non-empty reason' });
      const longReason = await act(orderId, 'fail', { reason: 'r'.repeat(201) });
      expect(longReason.body).toMatchObject({ code: '22023', message: 'set_delivery_status: fail reason must be <= 200 characters' });
      expect(await deliveryStatus(orderId)).toBe('out_for_delivery');
    });

    it('refuses to cancel a paid order with the verbatim "already has a payment" message', async () => {
      const { orderId } = (await create()).body;
      await db(`SET session_replication_role = replica; UPDATE orders SET status = 'paid' WHERE id = '${orderId}'`);
      const res = await act(orderId, 'cancel');
      expect(res.status).toBe(422);
      expect(res.body).toEqual({
        statusCode: 422,
        error: 'Unprocessable Entity',
        code: 'P0001',
        message: `set_delivery_status: order ${orderId} already has a payment (refunds are out of scope)`,
      });
      expect(await deliveryStatus(orderId)).toBe('received');
    });

    it('role matrix: kitchen may start_preparing and mark_ready only; waiter and cashier may not act', async () => {
      const { orderId } = (await create()).body;
      const kitchenCancel = await kitchenA().post(`/api/delivery/orders/${orderId}/status`, { action: 'cancel' });
      expect(kitchenCancel.status).toBe(403);
      expect(kitchenCancel.body).toEqual({ statusCode: 403, error: 'Forbidden', message: 'Permission denied', code: '42501' });
      for (const caller of [waiterA(), cashierA()]) {
        expect((await caller.post(`/api/delivery/orders/${orderId}/status`, { action: 'mark_ready' })).body.code).toBe('42501');
      }
      expect(await deliveryStatus(orderId)).toBe('received');
      expect((await kitchenA().post(`/api/delivery/orders/${orderId}/status`, { action: 'mark_ready' })).status).toBe(200);
    });

    it('another restaurant cannot see or move the delivery (P0002), and bad input is 422', async () => {
      const { orderId } = (await create()).body;
      const res = await adminB().post(`/api/delivery/orders/${orderId}/status`, { action: 'cancel' });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('P0002');
      expect(await deliveryStatus(orderId)).toBe('received');
      expect((await act('not-a-uuid', 'cancel')).status).toBe(422);
      expect((await act(orderId, 'cancel', { courierId: 'x' })).status).toBe(422);
      expect((await operatorA().post(`/api/delivery/orders/${orderId}/status`, { action: 'cancel', extra: 1 })).status).toBe(422);
    });
  });

  describe('GET /delivery/active', () => {
    it('returns DeliveryOrderWithBill rows, newest update first, with amountDue = subtotal + tax and isPaid', async () => {
      await db(
        `INSERT INTO business_config (restaurant_id, key, value) VALUES ($1, 'tax_percentage', '10')
         ON CONFLICT (restaurant_id, key) DO UPDATE SET value = excluded.value`,
        [fixtures.restaurantA],
      );
      const { orderId } = (await create()).body;
      await db(`INSERT INTO business_config (restaurant_id, key, value) VALUES ($1, 'tax_percentage', '0')
                ON CONFLICT (restaurant_id, key) DO UPDATE SET value = excluded.value`, [fixtures.restaurantA]);
      const res = await kitchenA().get('/api/delivery/active');
      expect(res.status).toBe(200);
      const row = res.body[0];
      expect(Object.keys(row).sort()).toEqual(['amountDue', 'delivery', 'isPaid', 'subtotal', 'tax']);
      expect(row).toMatchObject({ subtotal: 11000, tax: 1100, amountDue: 12100, isPaid: false, delivery: { orderId, status: 'received' } });
      expect(Object.keys(row.delivery).sort()).toEqual(DELIVERY_KEYS);
      const updated = res.body.map((r: { delivery: { updatedAt: string } }) => r.delivery.updatedAt);
      expect([...updated].sort().reverse()).toEqual(updated);
      expect((await adminB().get('/api/delivery/active')).body).toEqual([]);
      expect((await waiterA().get('/api/delivery/active')).status).toBe(403);
    });

    /** Three cancelled deliveries whose updated_at is pinned, read under a fixed clock. */
    const boundary = async (nowIso: string, rows: Record<string, string>) => {
      const ids: Record<string, string> = {};
      for (const name of Object.keys(rows)) {
        ids[name] = (await create()).body.orderId;
        await act(ids[name], 'cancel');
      }
      await db(`UPDATE restaurants SET timezone = 'America/Bogota' WHERE id = '${fixtures.restaurantA}'`);
      for (const [name, at] of Object.entries(rows)) {
        await db(`SET session_replication_role = replica; UPDATE order_deliveries SET updated_at = '${at}' WHERE order_id = '${ids[name]}'`);
      }
      // CommonModule provides the one Clock, so stubbing app.get(Clock) reaches DeliveryService.
      const spy = vi.spyOn(app.get(Clock), 'now').mockReturnValue(new Date(nowIso));
      try {
        const listed = (await operatorA().get('/api/delivery/active')).body.map((r: { delivery: { orderId: string } }) => r.delivery.orderId);
        return Object.fromEntries(Object.entries(ids).map(([name, id]) => [name, listed.includes(id)]));
      } finally {
        spy.mockRestore();
      }
    };

    // The wall clock must not leak into the boundary: CI once ran at 00:44 Bogota (L38).
    for (const wall of ['2026-11-05T05:44:00Z', '2026-11-05T04:30:00Z', '2026-11-05T12:00:00Z', '2026-11-05T23:59:00Z']) {
      describe(`with the real clock at ${wall}`, () => {
        let realCookie: string;
        beforeEach(async () => {
          vi.useFakeTimers({ toFake: ['Date'], now: new Date(wall) });
          // The access token must be minted under the pinned clock or it may already be expired.
          realCookie = cookies[d.operatorEmail];
          const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email: d.operatorEmail, password: PASSWORD });
          cookies[d.operatorEmail] = cookiePair(setCookies(res).vipe_access);
        });
        afterEach(() => {
          cookies[d.operatorEmail] = realCookie;
          vi.useRealTimers();
        });

        it('at 23:30 Bogota (04:30Z) keeps terminal rows from local midnight (05:00Z, inclusive) on, drops 04:59Z', async () => {
          expect(
            await boundary('2026-11-05T04:30:00Z', {
              midnight: '2026-11-04T05:00:00Z',
              late: '2026-11-05T04:00:00Z',
              before: '2026-11-04T04:59:00Z',
            }),
          ).toEqual({ midnight: true, late: true, before: false });
        });

        it('at 00:30 Bogota (05:30Z) the previous evening is gone and the new day is in', async () => {
          expect(
            await boundary('2026-11-04T05:30:00Z', {
              justBefore: '2026-11-04T04:59:59Z',
              justAfter: '2026-11-04T05:00:01Z',
              midnight: '2026-11-04T05:00:00Z',
            }),
          ).toEqual({ justBefore: false, justAfter: true, midnight: true });
        });
      });
    }
  });

  describe('dispatch console details (T19)', () => {
    const method = async (restaurant: string, code: string) =>
      (await db<{ id: string }>('SELECT id FROM payment_methods WHERE restaurant_id = $1 AND code = $2', [restaurant, code]))[0].id;
    const readyOrder = async (extra: object = {}) => {
      const { orderId } = (await create(extra)).body;
      await act(orderId, 'mark_ready');
      return orderId as string;
    };
    const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

    describe('couriers for the delivery operator', () => {
      it('the operator creates a courier and switches it off and on', async () => {
        const created = await operatorA().post('/api/delivery/couriers', { name: ' Nuevo ', phone: '3150009988' });
        expect(created.status).toBe(201);
        expect(created.body).toMatchObject({ name: 'Nuevo', phone: '3150009988', isActive: true });
        const off = await operatorA().patch(`/api/delivery/couriers/${created.body.id}`, { isActive: false });
        expect(off.status).toBe(200);
        expect(off.body).toMatchObject({ id: created.body.id, name: 'Nuevo', isActive: false });
        expect((await operatorA().patch(`/api/delivery/couriers/${created.body.id}`, { isActive: true })).body.isActive).toBe(true);
        const [row] = await db<{ restaurant_id: string }>('SELECT restaurant_id FROM couriers WHERE id = $1', [created.body.id]);
        expect(row.restaurant_id).toBe(fixtures.restaurantA);
      });

      it('the operator may not rename a courier or change its phone (403), and cannot reach another restaurant (404)', async () => {
        for (const patch of [{ name: 'Otro' }, { phone: '3000000000' }, { name: 'Otro', isActive: false }]) {
          const res = await operatorA().patch(`/api/delivery/couriers/${d.pedro}`, patch);
          expect(res.status).toBe(403);
          expect(res.body).toEqual({ statusCode: 403, error: 'Forbidden', message: 'A delivery operator may only change isActive' });
        }
        expect((await operatorA().patch(`/api/delivery/couriers/${d.courierB}`, { isActive: false })).status).toBe(404);
        const rows = await db<{ name: string; phone: string; is_active: boolean }>(
          'SELECT name, phone, is_active FROM couriers WHERE id = ANY($1) ORDER BY name', [[d.pedro, d.courierB]]);
        expect(rows).toEqual([
          { name: 'Courier B', phone: null, is_active: true },
          { name: 'Pedro', phone: '3001112233', is_active: true },
        ]);
      });
    });

    describe('prepaid channel and per-order fee', () => {
      it('a prepaid order records its payment method; the DTO carries {id, name}', async () => {
        const nequi = await method(fixtures.restaurantA, 'nequi');
        const res = await create({ paymentMode: 'prepaid', cashChangeFor: null, prepaidMethodId: nequi });
        expect(res.status).toBe(201);
        expect(res.body.delivery.prepaidMethod).toEqual({ id: nequi, name: 'Nequi' });
        const [row] = await db<{ prepaid_method_id: string }>('SELECT prepaid_method_id FROM order_deliveries WHERE order_id = $1', [res.body.orderId]);
        expect(row.prepaid_method_id).toBe(nequi);
        const board = (await operatorA().get('/api/delivery/active')).body as { delivery: { orderId: string; prepaidMethod: unknown } }[];
        expect(board.find((r) => r.delivery.orderId === res.body.orderId)?.delivery.prepaidMethod).toEqual({ id: nequi, name: 'Nequi' });
      });

      it('a method on cash on delivery, of another restaurant or not a uuid is refused, writing nothing', async () => {
        const before = await snapshot();
        const cod = await create({ prepaidMethodId: await method(fixtures.restaurantA, 'nequi') });
        expect(cod.status).toBe(422);
        expect(cod.body).toMatchObject({ code: '22023', message: "create_delivery_order: p_prepaid_method_id is only allowed when p_payment_mode = 'prepaid'" });
        const foreign = await create({ paymentMode: 'prepaid', cashChangeFor: null, prepaidMethodId: await method(fixtures.restaurantB, 'nequi') });
        expect(foreign.status).toBe(404);
        expect(foreign.body.code).toBe('P0002');
        expect((await create({ paymentMode: 'prepaid', cashChangeFor: null, prepaidMethodId: 'nequi' })).status).toBe(422);
        expect(await snapshot()).toEqual(before);
      });

      it('the operator sets the fee of the order being created; the restaurant-wide suggested fee stays admin-only', async () => {
        await db(
          `INSERT INTO business_config (restaurant_id, key, value) VALUES ($1, 'delivery_default_fee', '5000')
           ON CONFLICT (restaurant_id, key) DO UPDATE SET value = excluded.value`,
          [fixtures.restaurantA],
        );
        const res = await create({ deliveryFee: 7500 });
        expect(res.body.delivery.deliveryFee).toBe(7500);
        const put = await operatorA().put('/api/config', { deliveryDefaultFee: 9000 });
        expect(put.status).toBe(403);
        const [cfg] = await db<{ value: string }>(
          `SELECT value FROM business_config WHERE restaurant_id = $1 AND key = 'delivery_default_fee'`, [fixtures.restaurantA]);
        expect(cfg.value).toBe('5000');
      });
    });

    describe('courier ETA and location at dispatch', () => {
      it('dispatch stores the ETA and the trimmed location; the old payload stores neither', async () => {
        const orderId = await readyOrder();
        const eta = inMinutes(30);
        const res = await act(orderId, 'dispatch', { courierId: d.pedro, courierEta: eta, courierLocation: '  Laureles ' });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: 'out_for_delivery', courierEta: eta, courierLocation: 'Laureles', returnedAt: null });
        const old = await act(await readyOrder(), 'dispatch', { courierId: d.pedro });
        expect(old.body).toMatchObject({ status: 'out_for_delivery', courierEta: null, courierLocation: null });
      });

      it('refuses an ETA in the past or beyond 6 hours, a long location, and either on another action, changing nothing', async () => {
        const orderId = await readyOrder();
        const cases: [object, string][] = [
          [{ action: 'dispatch', courierId: d.pedro, courierEta: inMinutes(-1) }, 'set_delivery_status: p_courier_eta must be after now and within 6 hours'],
          [{ action: 'dispatch', courierId: d.pedro, courierEta: inMinutes(6 * 60 + 5) }, 'set_delivery_status: p_courier_eta must be after now and within 6 hours'],
          [{ action: 'dispatch', courierId: d.pedro, courierLocation: 'x'.repeat(61) }, 'set_delivery_status: p_courier_location must be 1..60 characters'],
          [{ action: 'cancel', courierLocation: 'Laureles' }, 'set_delivery_status: p_courier_eta and p_courier_location are only allowed with dispatch'],
        ];
        for (const [body, message] of cases) {
          const res = await operatorA().post(`/api/delivery/orders/${orderId}/status`, body);
          expect(res.status).toBe(422);
          expect(res.body).toEqual({ statusCode: 422, error: 'Unprocessable Entity', code: '22023', message });
        }
        const notADate = await act(orderId, 'dispatch', { courierId: d.pedro, courierEta: 'mañana' });
        expect(notADate.status).toBe(422);
        expect(notADate.body.code).toBeUndefined();
        expect(await deliveryStatus(orderId)).toBe('ready');
      });
    });

    describe('POST /delivery/orders/:id/return', () => {
      it('records the courier back once, on a delivered or failed delivery', async () => {
        const orderId = await readyOrder();
        await act(orderId, 'dispatch', { courierId: d.pedro });
        const early = await operatorA().post(`/api/delivery/orders/${orderId}/return`);
        expect(early.status).toBe(422);
        expect(early.body).toEqual({
          statusCode: 422,
          error: 'Unprocessable Entity',
          code: 'P0001',
          message: `return_courier: delivery for order ${orderId} is in state 'out_for_delivery' (allowed: delivered, failed)`,
        });
        await act(orderId, 'deliver');
        const res = await operatorA().post(`/api/delivery/orders/${orderId}/return`);
        expect(res.status).toBe(200);
        expect(Object.keys(res.body).sort()).toEqual(DELIVERY_KEYS);
        expect(res.body).toMatchObject({ orderId, status: 'delivered', returnedAt: expect.stringMatching(ISO) });
        const again = await operatorA().post(`/api/delivery/orders/${orderId}/return`);
        expect(again.body).toMatchObject({ statusCode: 422, code: 'P0001', message: `return_courier: the courier of order ${orderId} already returned` });

        const failedId = await readyOrder();
        await act(failedId, 'dispatch', { courierId: d.pedro });
        await act(failedId, 'fail', { reason: 'No contesta' });
        expect((await adminA().post(`/api/delivery/orders/${failedId}/return`)).body).toMatchObject({ status: 'failed', returnedAt: expect.stringMatching(ISO) });
      });

      it('waiter, cashier and kitchen get 403 (42501), another restaurant 404, a bad id 422; nothing changes', async () => {
        const orderId = await readyOrder();
        await act(orderId, 'dispatch', { courierId: d.pedro });
        await act(orderId, 'deliver');
        for (const caller of [waiterA(), cashierA(), kitchenA()]) {
          const res = await caller.post(`/api/delivery/orders/${orderId}/return`);
          expect(res.status).toBe(403);
          expect(res.body).toEqual({ statusCode: 403, error: 'Forbidden', message: 'Permission denied', code: '42501' });
        }
        const other = await adminB().post(`/api/delivery/orders/${orderId}/return`);
        expect(other.status).toBe(404);
        expect(other.body.code).toBe('P0002');
        expect((await operatorA().post('/api/delivery/orders/nope/return')).status).toBe(422);
        const [row] = await db<{ returned_at: string | null }>('SELECT returned_at FROM order_deliveries WHERE order_id = $1', [orderId]);
        expect(row.returned_at).toBeNull();
      });
    });

    describe('GET /delivery/customers history', () => {
      it('counts the customer\'s deliveries (cancelled ones excluded) with the last date and address', async () => {
        const { orderId } = (await create({ address: { addressLine: 'Calle Última 9', neighborhood: 'Laureles' } })).body;
        const cancelled = (await create({ address: { addressLine: 'Cancelada 1' } })).body.orderId;
        await act(cancelled, 'cancel');
        const [expected] = await db<{ n: number; last: Date }>(
          `SELECT count(*)::int AS n, max(created_at) AS last FROM order_deliveries WHERE customer_id = $1 AND delivery_status <> 'cancelled'`,
          [d.ana],
        );
        const res = await operatorA().get('/api/delivery/customers').query({ phone: ANA_PHONE });
        expect(res.body.history).toEqual({
          ordersCount: expected.n,
          lastOrderAt: expected.last.toISOString(),
          lastAddress: { addressLine: 'Calle Última 9', neighborhood: 'Laureles', reference: null },
        });
        const [last] = await db<{ order_id: string }>(
          `SELECT order_id FROM order_deliveries WHERE customer_id = $1 AND delivery_status <> 'cancelled' ORDER BY created_at DESC, order_id DESC LIMIT 1`, [d.ana]);
        expect(last.order_id).toBe(orderId);
      });

      it('a customer without deliveries has an empty history', async () => {
        await db(`INSERT INTO customers (phone, name, restaurant_id) VALUES ('3221110000', 'Sin pedidos', $1)`, [fixtures.restaurantA]);
        const res = await operatorA().get('/api/delivery/customers').query({ phone: '3221110000' });
        expect(res.body.history).toEqual({ ordersCount: 0, lastOrderAt: null, lastAddress: null });
      });
    });

    describe('GET /delivery/closed-today', () => {
      it('counts today\'s delivered, cancelled and failed deliveries and averages dispatched → delivered minutes', async () => {
        const B = fixtures.restaurantB;
        const asB = adminB();
        const newB = async () => {
          const res = await asB.post('/api/delivery/orders', {
            customer: { phone: '3207654321' }, address: { addressLine: 'Calle B' }, items: [{ dishId: d.otherDish, quantity: 1 }],
            deliveryFee: 0, paymentMode: 'cash_on_delivery',
          });
          expect(res.status).toBe(201);
          await asB.post(`/api/delivery/orders/${res.body.orderId}/status`, { action: 'mark_ready' });
          return res.body.orderId as string;
        };
        const out = async (id: string, action: string, extra: object = {}) => {
          await asB.post(`/api/delivery/orders/${id}/status`, { action: 'dispatch', courierId: d.courierB });
          await asB.post(`/api/delivery/orders/${id}/status`, { action, ...extra });
        };
        const [d30, d20, old, failed, cancelled] = [await newB(), await newB(), await newB(), await newB(), await newB()];
        await out(d30, 'deliver');
        await out(d20, 'deliver');
        await out(old, 'deliver');
        await out(failed, 'fail', { reason: 'No contesta' });
        await asB.post(`/api/delivery/orders/${cancelled}/status`, { action: 'cancel' });
        const pin = (id: string, set: string) =>
          db(`SET session_replication_role = replica; UPDATE order_deliveries SET ${set} WHERE order_id = '${id}'`);
        await pin(d30, `dispatched_at = delivered_at - interval '30 minutes'`);
        await pin(d20, `dispatched_at = delivered_at - interval '20 minutes'`);
        await pin(old, `dispatched_at = now() - interval '3 days', delivered_at = now() - interval '3 days', updated_at = now() - interval '3 days'`);

        const res = await asB.get('/api/delivery/closed-today');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ deliveredCount: 2, cancelledCount: 1, failedCount: 1, averageDeliveryMinutes: 25 });
        const [rows] = await db<{ n: number }>('SELECT count(*)::int AS n FROM order_deliveries WHERE restaurant_id = $1', [B]);
        expect(rows.n).toBe(5);
      });

      it('is open to the board readers and forbidden to the waiter', async () => {
        for (const caller of [operatorA(), cashierA(), kitchenA(), adminA()]) {
          const res = await caller.get('/api/delivery/closed-today');
          expect(res.status).toBe(200);
          expect(Object.keys(res.body).sort()).toEqual(['averageDeliveryMinutes', 'cancelledCount', 'deliveredCount', 'failedCount']);
        }
        expect((await waiterA().get('/api/delivery/closed-today')).status).toBe(403);
      });
    });
  });

  it('OpenAPI states where each create limit is enforced', () => {
    const schemas = createOpenApiDocument(app).components!.schemas! as Record<string, { properties: Record<string, Record<string, unknown>> }>;
    const req = schemas.CreateDeliveryOrderRequest.properties;
    expect(req.items).toMatchObject({ maxItems: 500 });
    expect(req.items.description).toContain('validated by create_delivery_order');
    expect(req.notes.description).toContain('validated by create_delivery_order');
    expect(req.deliveryFee.description).toContain('validated by create_delivery_order');
    expect(req.deliveryFee).not.toHaveProperty('minimum');
    const item = schemas.CreateDeliveryItem.properties;
    expect(item.quantity).not.toHaveProperty('minimum');
    expect(item.quantity.description).toContain('validated by create_delivery_order');
  });

  it('POST /delivery/orders emits an order_deliveries INSERT to the restaurant room only', async () => {
    await app.listen(0, '127.0.0.1');
    const url = `${await app.getUrl()}/realtime`.replace('[::1]', '127.0.0.1');
    const sockets: Socket[] = [];
    const connect = async (email: string) => {
      const socket = io(url, { transports: ['websocket'], reconnection: false, extraHeaders: { Cookie: cookies[email] } });
      sockets.push(socket);
      const events: { table: string; eventType: string; new: Record<string, unknown> }[] = [];
      socket.on('pos_changes', (event: (typeof events)[number]) => events.push(event));
      await new Promise((resolve, reject) => {
        socket.once('ready', resolve);
        socket.once('connect_error', reject);
      });
      return events;
    };
    try {
      const a = await connect(fixtures.adminA.email);
      const b = await connect(fixtures.adminB.email);
      const { orderId } = (await create()).body;
      await eventually(() => a.some((e) => e.table === 'order_deliveries'));
      const insert = a.find((e) => e.table === 'order_deliveries');
      expect(insert?.eventType).toBe('INSERT');
      expect(insert?.new).toMatchObject({ order_id: orderId, delivery_status: 'received', restaurant_id: fixtures.restaurantA });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(b.filter((e) => e.table === 'order_deliveries')).toEqual([]);
    } finally {
      sockets.forEach((socket) => socket.close());
    }
  });
});

async function seedDelivery(superuserUrl: string) {
  const A = fixtures.restaurantA;
  const B = fixtures.restaurantB;
  const q = (text: string, values: unknown[] = []) => superuserQuery(superuserUrl, text, values);
  for (const [user, profile, email, name, role] of [
    [d.operatorUser, d.operatorProfile, d.operatorEmail, 'Delivery A', 'delivery_operator'],
    [d.kitchenUser, d.kitchenProfile, d.kitchenEmail, 'Kitchen A', 'kitchen'],
  ]) {
    await q(
      `INSERT INTO users (id, email, password_hash, password_algo)
         SELECT $1, $2, password_hash, password_algo FROM users WHERE email = $3`,
      [user, email, fixtures.adminA.email],
    );
    await q(`INSERT INTO profiles (id, user_id, full_name, email, role, restaurant_id) VALUES ($1, $2, $3, $4, $5, $6)`, [
      profile, user, name, email, role, A,
    ]);
  }
  await q(
    `INSERT INTO dishes (id, name, price, active, restaurant_id) VALUES
       ($1, 'Arepa', 5000, true, $4), ($2, 'Jugo', 3000, true, $4), ($3, 'Otro plato', 9000, true, $5)`,
    [d.arepa, d.jugo, d.otherDish, A, B],
  );
  await q(
    `INSERT INTO customers (id, phone, name, restaurant_id) VALUES
       ($1, $4, 'Ana', $5), ($2, '3005556677', 'Carlos', $5), ($3, '3207654321', 'Ana B', $6)`,
    [d.ana, d.other, d.anaInB, ANA_PHONE, A, B],
  );
  await q(
    `INSERT INTO customer_addresses (id, customer_id, label, address_line, neighborhood, is_default, restaurant_id, created_at) VALUES
       ($1, $4, 'Trabajo', 'Avenida 5', NULL, false, $6, now() - interval '2 days'),
       ($2, $4, 'Casa', 'Calle 1 # 2-3', 'Centro', true, $6, now() - interval '1 day'),
       ($3, $5, NULL, 'Calle 7', NULL, true, $6, now())`,
    [d.anaWork, d.anaHome, d.otherHome, d.ana, d.other, A],
  );
  await q(
    `INSERT INTO couriers (id, name, phone, is_active, restaurant_id) VALUES
       ($1, 'Pedro', '3001112233', true, $4), ($2, 'Retirado', NULL, false, $4), ($3, 'Courier B', NULL, true, $5)`,
    [d.pedro, d.retiredCourier, d.courierB, A, B],
  );
  // One arepa takes 100 g of flour; the default location holds 150 g.
  await q(`INSERT INTO ingredients (id, name, unit, restaurant_id) VALUES ($1, 'Harina', 'g', $2)`, [d.flour, A]);
  await q(
    `WITH r AS (INSERT INTO recipes (dish_id, restaurant_id) VALUES ($1, $2) RETURNING id)
     INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, restaurant_id) SELECT id, $3, 100, $2 FROM r`,
    [d.arepa, A, d.flour],
  );
  await q(
    `INSERT INTO inventory_lots (restaurant_id, ingredient_id, location_id, quantity)
       SELECT $1, $2, private.ensure_default_inventory_location($1), 150`,
    [A, d.flour],
  );
}
